import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildFeedbackMessage,
	createWhatsAppNotifier,
	formatSubmittedOn,
	parseWhatsAppConfig,
	WhatsAppNotificationError
} from './whatsappNotifier.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALID_ENV = {
	QASE_WHATSAPP_ENABLED: 'true',
	QASE_WHATSAPP_ACCESS_TOKEN: 'EAAG-secret-token-value',
	QASE_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
	QASE_WHATSAPP_RECIPIENTS: '+15550000001, +15550000002,+15550000003,+15550000004'
};

function makeLedgerSandbox() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qase-wa-'));
	return { dir, ledgerFile: path.join(dir, 'ledger.json') };
}

function jsonResponse(status, body = '{}', headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { 'content-type': 'application/json', ...headers },
		text: async () => body
	};
}

function recordingFetch(responses) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
		const next = responses.length > 1 ? responses.shift() : responses[0];
		if (typeof next === 'function') return next(url, init);
		return next;
	};
	impl.calls = calls;
	return impl;
}

function collectingLogger() {
	const entries = { info: [], warn: [], error: [] };
	return {
		entries,
		info: (event, fields) => entries.info.push({ event, fields }),
		warn: (event, fields) => entries.warn.push({ event, fields }),
		error: (event, fields) => entries.error.push({ event, fields })
	};
}

const FEEDBACK = {
	id: '11111111-2222-4333-8444-555555555555',
	runId: 'cf5b7e5f-a4fa-4189-85a3-7d07473ad7c0',
	rating: 5,
	comments: 'Great coverage of the checkout flow.'
};

const CONTEXT = {
	mode: 'qa',
	title: 'Homepage regression sweep',
	targetUrl: 'https://qase.dev/',
	submittedByName: 'Priya Sharma',
	submittedAt: Date.UTC(2026, 9, 6, 17, 0, 0) // 06-Oct-2026 in UTC evening
};

// ---------------------------------------------------------------------------
// parseWhatsAppConfig
// ---------------------------------------------------------------------------

test('parseWhatsAppConfig returns undefined when disabled or unset', () => {
	assert.equal(parseWhatsAppConfig({}), undefined);
	assert.equal(parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_ENABLED: 'false' }), undefined);
	assert.equal(parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_ENABLED: '' }), undefined);
});

test('parseWhatsAppConfig rejects non-boolean enable flags', () => {
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_ENABLED: 'yes' }), /true or false/);
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_ENABLED: '1' }), /true or false/);
});

test('parseWhatsAppConfig parses recipients, applies defaults, and freezes', () => {
	const config = parseWhatsAppConfig(VALID_ENV);
	assert.deepEqual(config.recipients, ['+15550000001', '+15550000002', '+15550000003', '+15550000004']);
	assert.equal(config.apiVersion, 'v20.0');
	assert.equal(config.apiOrigin, 'https://graph.facebook.com');
	assert.equal(config.timeoutMs, 15_000);
	assert.equal(config.accessToken, 'EAAG-secret-token-value');
	assert.equal(config.phoneNumberId, '123456789012345');
	assert.ok(Object.isFrozen(config));
});

test('parseWhatsAppConfig dedupes recipients and accepts bare numbers', () => {
	const config = parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_RECIPIENTS: '+15550000001,15550000001' });
	assert.deepEqual(config.recipients, ['+15550000001']);
});

test('parseWhatsAppConfig requires token, phone id, and at least one recipient', () => {
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_ACCESS_TOKEN: '' }), /QASE_WHATSAPP_ACCESS_TOKEN/);
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_PHONE_NUMBER_ID: '' }), /QASE_WHATSAPP_PHONE_NUMBER_ID/);
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_RECIPIENTS: 'not-a-number' }), /invalid numbers/);
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_RECIPIENTS: '' }), /at least one recipient/);
});

// ---------------------------------------------------------------------------
// buildFeedbackMessage / formatSubmittedOn
// ---------------------------------------------------------------------------

test('formatSubmittedOn renders 06-Oct-2026 style timestamps', () => {
	assert.match(formatSubmittedOn(Date.UTC(2026, 9, 6, 17, 0, 0)), /^06-Oct-2026 5:00 PM$/);
});

test('buildFeedbackMessage emits the agreed notification format', () => {
	const message = buildFeedbackMessage(FEEDBACK, CONTEXT);
	assert.equal(message, [
		'📢 QASE User Feedback Received',
		'',
		'A new user feedback has been submitted after completion of a QASE test run.',
		'',
		'⭐ Rating: 5/5',
		'',
		'📝 User Feedback:',
		'Great coverage of the checkout flow.',
		'',
		'📊 QA Run:',
		'Homepage regression sweep · New QA Run · #cf5b7e5f',
		'',
		'🌐 Target:',
		'https://qase.dev/',
		'',
		'👤 Submitted By:',
		'Priya Sharma',
		'',
		'🕒 Submitted On:',
		'06-Oct-2026 5:00 PM'
	].join('\n'));
});

test('buildFeedbackMessage clamps ratings and fills safe defaults', () => {
	const message = buildFeedbackMessage(
		{ id: 'x', runId: 'abcd1234-0000-0000-0000-000000000000', rating: 9, comments: '   ' },
		{ mode: 'sqa', submittedAt: CONTEXT.submittedAt }
	);
	assert.match(message, /⭐ Rating: 5\/5/);
	assert.match(message, /\(no description provided\)/);
	assert.match(message, /SQA · #abcd1234/);
	assert.match(message, /🌐 Target:\n—/);
	assert.match(message, /👤 Submitted By:\nQASE user/);
});

test('buildFeedbackMessage truncates far beyond the Cloud API text cap', () => {
	const message = buildFeedbackMessage({ ...FEEDBACK, comments: 'x'.repeat(9_000) }, CONTEXT);
	assert.ok(message.length <= 4_096);
	assert.ok(message.endsWith('…'));
});

// ---------------------------------------------------------------------------
// notifier construction
// ---------------------------------------------------------------------------

test('createWhatsAppNotifier is a no-op (undefined) when disabled', () => {
	assert.equal(createWhatsAppNotifier({ environment: {} }), undefined);
});

test('createWhatsAppNotifier stays off and logs once on invalid config', () => {
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: { ...VALID_ENV, QASE_WHATSAPP_ACCESS_TOKEN: '' },
		logger
	});
	assert.equal(notifier, undefined);
	assert.equal(logger.entries.error.length, 1);
	assert.match(logger.entries.error[0].event, /whatsapp\.config\.invalid/);
});

// ---------------------------------------------------------------------------
// dispatch behaviour
// ---------------------------------------------------------------------------

test('dispatch delivers to every recipient with the Cloud API contract', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = recordingFetch([jsonResponse(200)]);
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV,
		fetchImpl,
		logger,
		ledgerFile: sandbox.ledgerFile,
		sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);

	assert.equal(fetchImpl.calls.length, 4);
	for (const call of fetchImpl.calls) {
		assert.match(call.url, /^https:\/\/graph\.facebook\.com\/v20\.0\/123456789012345\/messages$/);
		assert.equal(call.init.method, 'POST');
		assert.equal(call.init.redirect, 'error');
		assert.equal(call.init.headers.Authorization, 'Bearer EAAG-secret-token-value');
		assert.equal(call.body.messaging_product, 'whatsapp');
		assert.equal(call.body.type, 'text');
		assert.equal(call.body.text.body.startsWith('📢 QASE User Feedback Received'), true);
	}
	assert.deepEqual(fetchImpl.calls.map(call => call.body.to), VALID_ENV.QASE_WHATSAPP_RECIPIENTS.split(',').map(v => v.trim()));

	const ledger = JSON.parse(fs.readFileSync(sandbox.ledgerFile, 'utf8'));
	assert.equal(ledger[FEEDBACK.id].status, 'delivered');
	assert.equal(ledger[FEEDBACK.id].delivered, 4);
	assert.equal(logger.entries.info.filter(e => e.event === 'whatsapp.feedback.notified').length, 1);
});

test('dispatch is idempotent: a ledgered feedback id never resends', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = recordingFetch([jsonResponse(200)]);
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT); // duplicate submit / retry
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	assert.equal(fetchImpl.calls.length, 4); // still only the original 4 sends
});

test('concurrent dispatches of the same feedback collapse via the pending entry', async () => {
	const sandbox = makeLedgerSandbox();
	let gate;
	const gatePromise = new Promise(resolve => { gate = resolve; });
	const fetchImpl = recordingFetch([async () => { await gatePromise; return jsonResponse(200); }]);
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	const first = notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	const second = notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	gate();
	await Promise.all([first, second]);
	assert.equal(fetchImpl.calls.length, 4);
});

test('auth failure (401) is terminal: no retries, feedback unaffected, promise resolves', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = recordingFetch([jsonResponse(401, '{"error":{"message":"invalid token"}}')]);
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await assert.doesNotReject(notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT));

	assert.equal(fetchImpl.calls.length, 1); // dead token: 1 call, no retries, no further recipients
	assert.equal(logger.entries.warn.filter(e => e.event === 'whatsapp.delivery.failed').length, 1);
	const ledger401 = JSON.parse(fs.readFileSync(sandbox.ledgerFile, 'utf8'));
	assert.equal(ledger401[FEEDBACK.id].status, 'failed');
	assert.ok(!String(ledger401[FEEDBACK.id].lastError ?? '').toLowerCase().includes('token'));
});

test('server errors (5xx) and timeouts retry up to three attempts, then give up cleanly', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = recordingFetch([jsonResponse(503)]);
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '99999999-1111-4222-8333-444444444444' }, CONTEXT);
	// 4 recipients × 3 attempts, sequential
	assert.equal(fetchImpl.calls.length, 12);
	const ledger = JSON.parse(fs.readFileSync(sandbox.ledgerFile, 'utf8'));
	assert.equal(ledger['99999999-1111-4222-8333-444444444444'].status, 'failed');
	assert.equal(ledger['99999999-1111-4222-8333-444444444444'].attempts, 3);
});

test('network timeouts are classified retryable and succeed on a later attempt', async () => {
	const sandbox = makeLedgerSandbox();
	const timeoutError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
	const fetchImpl = recordingFetch([
		() => Promise.reject(timeoutError),
		jsonResponse(200)
	]);
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '88888888-1111-4222-8333-444444444444' }, CONTEXT);
	const ledger = JSON.parse(fs.readFileSync(sandbox.ledgerFile, 'utf8'));
	assert.equal(ledger['88888888-1111-4222-8333-444444444444'].status, 'delivered');
	// first recipient: 1 failed + 1 ok, remaining recipients: 1 ok each
	assert.equal(fetchImpl.calls.length, 5);
});

test('partial delivery is recorded as partial, not delivered', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = recordingFetch([
		jsonResponse(200),
		jsonResponse(200),
		jsonResponse(200),
		jsonResponse(429, '{"error":{"code":4}}')
	]);
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '77777777-1111-4222-8333-444444444444' }, CONTEXT);
	const ledger = JSON.parse(fs.readFileSync(sandbox.ledgerFile, 'utf8'));
	assert.equal(ledger['77777777-1111-4222-8333-444444444444'].status, 'partial');
	assert.equal(ledger['77777777-1111-4222-8333-444444444444'].delivered, 3);
});

test('rate limiting (429) retries and ultimately records failure without throwing', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = recordingFetch([jsonResponse(429, '{"error":{"message":"rate limited"}}')]);
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await assert.doesNotReject(
		notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '66666666-1111-4222-8333-444444444444' }, CONTEXT)
	);
	assert.equal(fetchImpl.calls.length, 12); // retried per recipient
});

test('dispatch never rejects even when fetchImpl throws unexpected junk', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = recordingFetch([() => Promise.reject('string error')]);
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await assert.doesNotReject(
		notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '55555555-1111-4222-8333-444444444444' }, CONTEXT)
	);
	const ledger = JSON.parse(fs.readFileSync(sandbox.ledgerFile, 'utf8'));
	assert.ok(['failed', 'partial'].includes(ledger['55555555-1111-4222-8333-444444444444'].status));
});

// ---------------------------------------------------------------------------
// security: token never leaks into logs or the ledger
// ---------------------------------------------------------------------------

test('no credential material appears in logs or ledger, even when upstream echoes it back', async () => {
	const sandbox = makeLedgerSandbox();
	const leakyBody = JSON.stringify({ error: { message: 'bad access_token: EAAG-secret-token-value for Bearer EAAG-secret-token-value' } });
	const fetchImpl = recordingFetch([jsonResponse(500, leakyBody)]);
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '44444444-1111-4222-8333-444444444444' }, CONTEXT);

	const ledgerText = fs.readFileSync(sandbox.ledgerFile, 'utf8');
	for (const surface of [ledgerText, JSON.stringify(logger.entries)]) {
		assert.ok(!surface.includes('EAAG-secret-token-value'), 'token leaked');
	}
	assert.ok(logger.entries.warn.some(e => e.event === 'whatsapp.delivery.failed'));
});

// ---------------------------------------------------------------------------
// error typing
// ---------------------------------------------------------------------------

test('WhatsAppNotificationError carries code, retryability, and upstream status', () => {
	const error = new WhatsAppNotificationError('nope', { code: 'x', retryable: true, upstreamStatus: 429 });
	assert.equal(error.code, 'x');
	assert.equal(error.retryable, true);
	assert.equal(error.upstreamStatus, 429);
	assert.equal(new WhatsAppNotificationError('m').retryable, false);
});
