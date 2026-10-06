import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildFeedbackMessage,
	buildMessagePayload,
	createWhatsAppNotifier,
	formatSubmittedOn,
	notificationIdFor,
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

/**
 * fetch stub with per-recipient scripted responses.
 * scripts: Map recipient -> array of responses (consumed left to right; last repeats).
 */
function perRecipientFetch(scripts, fallback = jsonResponse(200)) {
	const calls = [];
	const impl = async (url, init) => {
		const body = init?.body ? JSON.parse(init.body) : null;
		calls.push({ url, init, body });
		const queue = impl.scripts.get(body?.to);
		if (queue && queue.length > 0) {
			const next = queue.length > 1 ? queue.shift() : queue[0];
			return typeof next === 'function' ? next(url, init) : next;
		}
		const fb = impl.fallback;
		return typeof fb === 'function' ? fb(url, init) : fb;
	};
	impl.calls = calls;
	impl.scripts = scripts;
	impl.fallback = fallback;
	return impl;
}

function callsTo(fetchImpl, recipient) {
	return fetchImpl.calls.filter(call => call.body?.to === recipient);
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

function readLedger(sandbox) {
	return JSON.parse(fs.readFileSync(sandbox.ledgerFile, 'utf8'));
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
	submittedAt: Date.UTC(2026, 9, 6, 17, 0, 0)
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
	assert.equal(config.templateName, undefined);
	assert.equal(config.templateLanguage, undefined);
	assert.ok(Object.isFrozen(config));
});

test('parseWhatsAppConfig dedupes recipients and accepts bare numbers', () => {
	const config = parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_RECIPIENTS: '+15550000001,15550000001' });
	assert.deepEqual(config.recipients, ['+15550000001']);
});

test('parseWhatsAppConfig parses optional template settings', () => {
	const config = parseWhatsAppConfig({
		...VALID_ENV,
		QASE_WHATSAPP_TEMPLATE_NAME: 'qase_feedback_alert',
		QASE_WHATSAPP_TEMPLATE_LANGUAGE: 'en_US'
	});
	assert.equal(config.templateName, 'qase_feedback_alert');
	assert.equal(config.templateLanguage, 'en_US');
	// language defaults to 'en' when a template is named without a language
	const defaults = parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_TEMPLATE_NAME: 'qase_feedback_alert' });
	assert.equal(defaults.templateLanguage, 'en');
});

test('parseWhatsAppConfig requires token, phone id, and at least one recipient', () => {
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_ACCESS_TOKEN: '' }), /QASE_WHATSAPP_ACCESS_TOKEN/);
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_PHONE_NUMBER_ID: '' }), /QASE_WHATSAPP_PHONE_NUMBER_ID/);
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_RECIPIENTS: 'not-a-number' }), /invalid numbers/);
	assert.throws(() => parseWhatsAppConfig({ ...VALID_ENV, QASE_WHATSAPP_RECIPIENTS: '' }), /at least one recipient/);
});

// ---------------------------------------------------------------------------
// message building
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

test('buildMessagePayload defaults to free-form text and names the notification id pattern', () => {
	const config = parseWhatsAppConfig(VALID_ENV);
	const payload = buildMessagePayload(config, FEEDBACK, CONTEXT);
	assert.equal(payload.type, 'text');
	assert.equal(payload.messaging_product, 'whatsapp');
	assert.match(payload.text.body, /📢 QASE User Feedback Received/);
	assert.equal(notificationIdFor(FEEDBACK.id), 'WHATSAPP-11111111-2222-4333-8444-555555555555');
});

test('buildMessagePayload switches to an approved template when configured', () => {
	const config = parseWhatsAppConfig({
		...VALID_ENV,
		QASE_WHATSAPP_TEMPLATE_NAME: 'qase_feedback_alert',
		QASE_WHATSAPP_TEMPLATE_LANGUAGE: 'en_US'
	});
	const payload = buildMessagePayload(config, FEEDBACK, CONTEXT);
	assert.equal(payload.type, 'template');
	assert.equal(payload.template.name, 'qase_feedback_alert');
	assert.equal(payload.template.language.code, 'en_US');
	const params = payload.template.components.find(c => c.type === 'body').parameters.map(p => p.text);
	assert.deepEqual(params, [
		'⭐ Rating: 5/5',
		'Great coverage of the checkout flow.',
		'Homepage regression sweep · New QA Run · #cf5b7e5f',
		'https://qase.dev/',
		'Priya Sharma',
		'06-Oct-2026 5:00 PM'
	]);
});

// ---------------------------------------------------------------------------
// notifier construction + startup visibility
// ---------------------------------------------------------------------------

test('createWhatsAppNotifier is a no-op (undefined) when disabled — but logs the state', () => {
	const logger = collectingLogger();
	assert.equal(createWhatsAppNotifier({ environment: {}, logger }), undefined);
	const states = logger.entries.info.filter(e => e.event === 'whatsapp.integration');
	assert.equal(states.length, 1);
	assert.equal(states[0].fields.state, 'disabled');
	assert.match(states[0].fields.reason, /QASE_WHATSAPP_ENABLED/);
});

test('createWhatsAppNotifier stays off and logs once on invalid config', () => {
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: { ...VALID_ENV, QASE_WHATSAPP_ACCESS_TOKEN: '' },
		logger
	});
	assert.equal(notifier, undefined);
	assert.equal(logger.entries.error.length, 1);
	assert.equal(logger.entries.error[0].event, 'whatsapp.integration');
	assert.equal(logger.entries.error[0].fields.state, 'invalid');
	assert.match(logger.entries.error[0].fields.reason, /QASE_WHATSAPP_ACCESS_TOKEN/);
});

test('createWhatsAppNotifier logs the enabled state with recipient count and mode', () => {
	const sandbox = makeLedgerSandbox();
	const logger = collectingLogger();
	createWhatsAppNotifier({ environment: VALID_ENV, logger, ledgerFile: sandbox.ledgerFile });
	const states = logger.entries.info.filter(e => e.event === 'whatsapp.integration');
	assert.equal(states.length, 1);
	assert.equal(states[0].fields.state, 'enabled');
	assert.equal(states[0].fields.recipients, 4);
	assert.equal(states[0].fields.mode, 'text');
});

// ---------------------------------------------------------------------------
// dispatch behaviour
// ---------------------------------------------------------------------------

test('dispatch delivers to every recipient and ends SENT with per-recipient states', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map());
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
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

	const entry = readLedger(sandbox)[FEEDBACK.id];
	assert.equal(entry.status, 'SENT');
	assert.equal(entry.notificationId, `WHATSAPP-${FEEDBACK.id}`);
	assert.ok(entry.recipients.every(r => r.state === 'sent' && r.attempts === 1));
	assert.equal(logger.entries.info.filter(e => e.event === 'whatsapp.feedback.notified').length, 1);
});

test('dispatch is idempotent: a SENT or in-flight notification never resends', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map());
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT); // duplicate submit
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	assert.equal(fetchImpl.calls.length, 4);
});

test('per-recipient failure isolation: others still attempted and recorded', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map([
		['+15550000002', [jsonResponse(503)] // fails all 3 attempts
		]]));
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);

	// All four recipients attempted; only the failing one burned retries.
	assert.equal(fetchImpl.calls.length, 6); // r2: 3 attempts; r1/r3/r4: 1 each
	const entry = readLedger(sandbox)[FEEDBACK.id];
	assert.equal(entry.status, 'FAILED');
	const byRecipient = Object.fromEntries(entry.recipients.map(r => [r.to, r]));
	assert.equal(byRecipient['+15550000001'].state, 'sent');
	assert.equal(byRecipient['+15550000002'].state, 'failed');
	assert.equal(byRecipient['+15550000002'].attempts, 3);
	assert.equal(byRecipient['+15550000003'].state, 'sent');
	assert.equal(byRecipient['+15550000004'].state, 'sent');
	assert.ok(logger.entries.warn.some(e => e.event === 'whatsapp.notification.failed'));
});

test('retryable failure transitions PENDING → RETRYING → FAILED (attempts capped)', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map(), jsonResponse(500));
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '99999999-1111-4222-8333-444444444444' }, CONTEXT);

	assert.equal(fetchImpl.calls.length, 12); // 4 recipients × 3 attempts
	const entry = readLedger(sandbox)['99999999-1111-4222-8333-444444444444'];
	assert.equal(entry.status, 'FAILED');
	assert.ok(entry.recipients.every(r => r.state === 'failed' && r.attempts === 3));
	assert.ok(entry.recipients.every(r => /server error/i.test(r.lastError)));
});

test('timeout then success: recipient ends sent after a retry', async () => {
	const sandbox = makeLedgerSandbox();
	const timeoutError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
	const fetchImpl = perRecipientFetch(new Map([
		['+15550000001', [() => Promise.reject(timeoutError), jsonResponse(200)]] // first attempt fails, second ok; repeats after
		]));
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '88888888-1111-4222-8333-444444444444' }, CONTEXT);
	const entry = readLedger(sandbox)['88888888-1111-4222-8333-444444444444'];
	assert.equal(entry.status, 'SENT');
	assert.equal(callsTo(fetchImpl, '+15550000001').length, 2);
	assert.equal(callsTo(fetchImpl, '+15550000002').length, 1);
});

test('auth failure (401) is terminal: no retries, remaining recipients unattempted, feedback unaffected', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map(), jsonResponse(401, '{"error":{"message":"invalid token"}}'));
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await assert.doesNotReject(notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT));

	assert.equal(fetchImpl.calls.length, 1); // dead token: 1 call, nothing else attempted
	const entry = readLedger(sandbox)[FEEDBACK.id];
	assert.equal(entry.status, 'FAILED');
	const byRecipient = Object.fromEntries(entry.recipients.map(r => [r.to, r]));
	assert.equal(byRecipient['+15550000001'].state, 'failed');
	assert.equal(byRecipient['+15550000002'].state, 'retrying'); // unattempted marker kept visible
	assert.ok(!String(entry.recipients[0].lastError).toLowerCase().includes('token'));
	assert.ok(logger.entries.warn.some(e => e.event === 'whatsapp.delivery.failed'));
});

test('rate limiting (429) retries per recipient and never throws', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map(), jsonResponse(429, '{"error":{"message":"rate limited"}}'));
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
	const fetchImpl = perRecipientFetch(new Map(), () => Promise.reject('string error'));
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await assert.doesNotReject(
		notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '55555555-1111-4222-8333-444444444444' }, CONTEXT)
	);
	const entry = readLedger(sandbox)['55555555-1111-4222-8333-444444444444'];
	assert.equal(entry.status, 'FAILED');
});

// ---------------------------------------------------------------------------
// retry mechanism
// ---------------------------------------------------------------------------

test('retryNotification replays a FAILED notification without resending to sent recipients', async () => {
	const sandbox = makeLedgerSandbox();
	// First dispatch: recipient 1 ok, recipient 2 down (503 all attempts).
	const fetchImpl = perRecipientFetch(new Map([
		['+15550000002', [jsonResponse(503)]]
	]));
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	assert.equal(readLedger(sandbox)[FEEDBACK.id].status, 'FAILED');
	const sentAfterFirst = callsTo(fetchImpl, '+15550000001').length;

	// Recovery: provider healthy again — clear the stuck 503 queue for r2.
	fetchImpl.scripts.set('+15550000002', []);
	const result = await notifier.retryNotification(`WHATSAPP-${FEEDBACK.id}`);
	assert.equal(result.ok, true);
	assert.equal(result.notification.status, 'SENT');

	// No duplicate to the already-sent recipient; only the failed one retried.
	assert.equal(callsTo(fetchImpl, '+15550000001').length, sentAfterFirst);
	assert.equal(callsTo(fetchImpl, '+15550000002').length, 4); // 3 + 1 recovery
});

test('retryNotification guards: SENT, in-flight, unknown, non-replayable', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map());
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	assert.deepEqual(await notifier.retryNotification('WHATSAPP-does-not-exist'), { ok: false, reason: 'not_found' });

	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);
	assert.deepEqual(await notifier.retryNotification(`WHATSAPP-${FEEDBACK.id}`), { ok: false, reason: 'already_sent' });

	// In-flight: hold the first dispatch open while retrying.
	const gate = {};
	const gatePromise = new Promise(resolve => { gate.resolve = resolve; });
	const held = perRecipientFetch(new Map(), async () => { await gatePromise; return jsonResponse(200); });
	const heldNotifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl: held, ledgerFile: makeLedgerSandbox().ledgerFile, sleep: async () => {}
	});
	const inflight = heldNotifier.dispatchFeedbackNotification(
		{ ...FEEDBACK, id: '77777777-1111-4222-8333-444444444444' }, CONTEXT);
	assert.deepEqual(
		await heldNotifier.retryNotification('WHATSAPP-77777777-1111-4222-8333-444444444444'),
		{ ok: false, reason: 'in_progress' });
	gate.resolve();
	await inflight;
});

// ---------------------------------------------------------------------------
// listing / inspection
// ---------------------------------------------------------------------------

test('listNotifications exposes sanitized public records with filters', async () => {
	const sandbox = makeLedgerSandbox();
	const fetchImpl = perRecipientFetch(new Map());
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification(FEEDBACK, CONTEXT);

	const all = notifier.listNotifications();
	assert.equal(all.length, 1);
	assert.equal(all[0].notificationId, `WHATSAPP-${FEEDBACK.id}`);
	assert.equal(all[0].status, 'SENT');
	assert.equal(all[0].feedbackId, FEEDBACK.id);
	assert.ok(!('replay' in all[0])); // replay context is internal
	assert.ok(!('accessToken' in all[0]));

	assert.equal(notifier.listNotifications({ status: 'FAILED' }).length, 0);
	assert.equal(notifier.listNotifications({ feedbackId: FEEDBACK.id }).length, 1);
	assert.equal(notifier.getNotification(`WHATSAPP-${FEEDBACK.id}`).status, 'SENT');
	assert.equal(notifier.getNotification('missing'), undefined);
});

// ---------------------------------------------------------------------------
// security: token never leaks into logs or the ledger
// ---------------------------------------------------------------------------

test('no credential material appears in logs or ledger, even when upstream echoes it back', async () => {
	const sandbox = makeLedgerSandbox();
	const leakyBody = JSON.stringify({ error: { message: 'bad access_token: EAAG-secret-token-value for Bearer EAAG-secret-token-value' } });
	const fetchImpl = perRecipientFetch(new Map(), jsonResponse(500, leakyBody));
	const logger = collectingLogger();
	const notifier = createWhatsAppNotifier({
		environment: VALID_ENV, fetchImpl, logger, ledgerFile: sandbox.ledgerFile, sleep: async () => {}
	});
	await notifier.dispatchFeedbackNotification({ ...FEEDBACK, id: '44444444-1111-4222-8333-444444444444' }, CONTEXT);

	const ledgerText = fs.readFileSync(sandbox.ledgerFile, 'utf8');
	for (const surface of [ledgerText, JSON.stringify(logger.entries), JSON.stringify(notifier.listNotifications())]) {
		assert.ok(!surface.includes('EAAG-secret-token-value'), 'token leaked');
	}
	assert.ok(logger.entries.warn.some(e => e.event === 'whatsapp.notification.failed'));
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
