import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from './app.js';
import { createInstanceAccess } from './instanceAccess.js';
const { createLocalApplicationServices } = await import('./localServices.js');

const TENANT = {
	organizationId: randomUUID(),
	projectId: randomUUID(),
	actorUserId: randomUUID(),
	actorEmail: 'webhook-owner@example.test',
	actorName: 'Webhook Owner'
};

function makeRecorder() {
	const updates = [];
	return {
		updates,
		notifier: {
			dispatchFeedbackNotification: async () => {},
			getNotification: () => undefined,
			recordDeliveryStatus(update) {
				updates.push(update);
				return true;
			}
		}
	};
}

async function buildApp(environment = {}, notifier) {
	const services = createLocalApplicationServices({ tenantContext: TENANT });
	await services.runs.load();
	const application = createApplication({
		services,
		access: createInstanceAccess({ tenantContext: TENANT }),
		environment: { ...process.env, ...environment },
		whatsappNotifier: notifier ?? makeRecorder().notifier
	});
	const server = await new Promise(resolve => {
		const candidate = application.app.listen(0, '127.0.0.1', () => resolve(candidate));
	});
	return {
		origin: `http://127.0.0.1:${server.address().port}`,
		close: () => new Promise(resolve => server.close(resolve))
	};
}

function metaStatusPayload(statuses) {
	return {
		object: 'whatsapp_business_account',
		entry: [{ id: '123', changes: [{ field: 'messages', value: { statuses } }] }]
	};
}

test('GET /webhooks/whatsapp verifies the Meta subscription challenge', async () => {
	const app = await buildApp({ QASE_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me' });
	try {
		const good = await fetch(`${app.origin}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=CHALLENGE_12345&hub.secret=x`);
		assert.equal(good.status, 200);
		assert.equal(await good.text(), 'CHALLENGE_12345');

		const bad = await fetch(`${app.origin}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x`);
		assert.equal(bad.status, 403);

		const wrongMode = await fetch(`${app.origin}/webhooks/whatsapp?hub.mode=other&hub.verify_token=verify-me&hub.challenge=x`);
		assert.equal(wrongMode.status, 403);
	} finally {
		await app.close();
	}
});

test('GET webhook verification is 403 when no verify token is configured', async () => {
	const app = await buildApp({});
	try {
		const response = await fetch(`${app.origin}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=x`);
		assert.equal(response.status, 403);
		assert.equal(await response.text(), 'Forbidden');
	} finally {
		await app.close();
	}
});

test('POST /webhooks/whatsapp ingests statuses and always answers 200 quickly', async () => {
	const recorder = makeRecorder();
	const app = await buildApp({ QASE_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me' }, recorder.notifier);
	try {
		const response = await fetch(`${app.origin}/webhooks/whatsapp`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(metaStatusPayload([
				{ id: 'wamid.A', status: 'delivered', timestamp: '1760000000', recipient_id: '1555' },
				{ id: 'wamid.B', status: 'failed', timestamp: '1760000001', errors: [{ code: 131026, message: 'undeliverable' }] }
			]))
		});
		assert.equal(response.status, 200);
		assert.equal(await response.text(), 'OK');

		assert.equal(recorder.updates.length, 2);
		assert.equal(recorder.updates[0].messageId, 'wamid.A');
		assert.equal(recorder.updates[0].status, 'delivered');
		assert.equal(recorder.updates[0].timestamp, 1_760_000_000_000);
		assert.equal(recorder.updates[1].messageId, 'wamid.B');
		assert.equal(recorder.updates[1].errorCode, 131026);
	} finally {
		await app.close();
	}
});

test('POST webhook: malformed payloads are ignored but still 200 (never crash)', async () => {
	const recorder = makeRecorder();
	const app = await buildApp({ QASE_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me' }, recorder.notifier);
	try {
		const responses = await Promise.all([
			// Note: syntactically valid JSON reaches the handler (the global
			// express.json parses it); truly malformed bodies are converted to
			// 200 by the error middleware. Both paths must never surface 4xx/5xx.
			fetch(`${app.origin}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"entry": ' }),
			fetch(`${app.origin}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ object: 'whatsapp_business_account', entry: 'junk' }) }),
			fetch(`${app.origin}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
		]);
		for (const response of responses) assert.equal(response.status, 200);
		assert.equal(recorder.updates.length, 0);
	} finally {
		await app.close();
	}
});

test('POST webhook ingestion is skipped (still 200) when the verify token is unset', async () => {
	const recorder = makeRecorder();
	const app = await buildApp({}, recorder.notifier);
	try {
		const response = await fetch(`${app.origin}/webhooks/whatsapp`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(metaStatusPayload([{ id: 'wamid.C', status: 'delivered', timestamp: '1760000000' }]))
		});
		assert.equal(response.status, 200);
		assert.equal(recorder.updates.length, 0);
	} finally {
		await app.close();
	}
});

test('webhook routes bypass the /api session-auth gate (no cookie, no CSRF)', async () => {
	const app = await buildApp({ QASE_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me' });
	try {
		const get = await fetch(`${app.origin}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=ok`);
		assert.equal(get.status, 200);
		const post = await fetch(`${app.origin}/webhooks/whatsapp`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(metaStatusPayload([]))
		});
		assert.equal(post.status, 200);
		// The API gate itself still holds: an anonymous /api call is 401.
		const api = await fetch(`${app.origin}/api/sessions`);
		assert.equal(api.status, 401);
	} finally {
		await app.close();
	}
});
