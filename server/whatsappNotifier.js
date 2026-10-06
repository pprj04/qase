import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sanitizeErrorDetail } from './errorSanitizer.js';

/**
 * WhatsApp notifications for user feedback (Meta WhatsApp Business Cloud API).
 *
 * Hard guarantees, in order:
 *  1. A feedback submission NEVER fails, blocks, or slows down because of
 *     this module. Dispatch is fire-and-forget; every error path logs a
 *     sanitized warning and returns.
 *  2. One feedback record id → at most one message per recipient, ever. A
 *     persisted idempotency ledger (same atomic-write pattern as the
 *     feedback store) makes double-submit and API retries collapse.
 *  3. The access token is never logged, never echoed into errors.
 */

export class WhatsAppNotificationError extends Error {
	constructor(message, { code = 'whatsapp_notification_failed', retryable = false, upstreamStatus } = {}) {
		super(message);
		this.name = 'WhatsAppNotificationError';
		this.code = code;
		this.retryable = retryable;
		if (Number.isInteger(upstreamStatus)) this.upstreamStatus = upstreamStatus;
	}
}

const E164 = /^\+[1-9]\d{7,14}$/;
const STATE_DIR = path.join(process.cwd(), '.qase');
const LEDGER_FILE = path.join(STATE_DIR, 'whatsapp-notifications.json');
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
const MAX_RECIPIENTS = 20;
const MAX_MESSAGE_CHARS = 4_096; // Cloud API text message cap

/** Strict parse of QASE_WHATSAPP_ENABLED — same style as the Drytis flag. */
function enabledFlag(environment) {
	const raw = environment.QASE_WHATSAPP_ENABLED;
	if (raw === undefined || raw === '') return false;
	const value = raw.trim().toLowerCase();
	if (value === 'true') return true;
	if (value === 'false') return false;
	throw new Error('QASE_WHATSAPP_ENABLED must be true or false.');
}

function required(environment, key) {
	const value = typeof environment[key] === 'string' ? environment[key].trim() : '';
	if (value === '') {
		throw new Error(`WhatsApp notifications are enabled but ${key} is not configured.`);
	}
	if (/[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error(`${key} contains invalid characters.`);
	}
	return value;
}

function parseRecipients(raw) {
	const recipients = String(raw ?? '')
		.split(',')
		.map(entry => entry.replace(/[\s()\u2013\u2014-]/g, ''))
		.filter(entry => entry !== '')
		.map(entry => (entry.startsWith('+') ? entry : `+${entry}`));
	const invalid = recipients.filter(entry => !E164.test(entry));
	if (invalid.length > 0) {
		throw new Error(`QASE_WHATSAPP_RECIPIENTS contains invalid numbers: ${invalid.join(', ')}.`);
	}
	if (recipients.length === 0) {
		throw new Error('QASE_WHATSAPP_RECIPIENTS must list at least one recipient.');
	}
	if (recipients.length > MAX_RECIPIENTS) {
		throw new Error(`QASE_WHATSAPP_RECIPIENTS accepts at most ${MAX_RECIPIENTS} recipients.`);
	}
	return [...new Set(recipients)];
}

/**
 * Parse notifier configuration from an environment-like object.
 * Returns `undefined` when the integration is disabled — callers then carry
 * on exactly as before the feature existed.
 */
export function parseWhatsAppConfig(environment = process.env) {
	if (!enabledFlag(environment)) return undefined;
	return Object.freeze({
		accessToken: required(environment, 'QASE_WHATSAPP_ACCESS_TOKEN'),
		phoneNumberId: required(environment, 'QASE_WHATSAPP_PHONE_NUMBER_ID'),
		recipients: parseRecipients(environment.QASE_WHATSAPP_RECIPIENTS),
		apiVersion: (typeof environment.QASE_WHATSAPP_API_VERSION === 'string' && environment.QASE_WHATSAPP_API_VERSION.trim() !== ''
			? environment.QASE_WHATSAPP_API_VERSION.trim() : 'v20.0'),
		apiOrigin: (typeof environment.QASE_WHATSAPP_API_ORIGIN === 'string' && environment.QASE_WHATSAPP_API_ORIGIN.trim() !== ''
			? environment.QASE_WHATSAPP_API_ORIGIN.trim() : 'https://graph.facebook.com'),
		timeoutMs: 15_000
	});
}

/** Timestamp in the report style (e.g. 06-Oct-2026 10:30 PM). Built from UTC
 * parts manually so the output is identical on every ICU/locale build. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatSubmittedOn(timestampMs) {
	const date = new Date(timestampMs);
	const hours24 = date.getUTCHours();
	const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
	const pad = value => String(value).padStart(2, '0');
	return `${pad(date.getUTCDate())}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()} `
		+ `${hours12}:${pad(date.getUTCMinutes())} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

const MODE_LABELS = { qa: 'New QA Run', sqa: 'SQA', founder: 'Founder Review' };

/**
 * Build the notification body. Pure function of the feedback record and the
 * run context; only the fields below ever travel — never tokens, never
 * report content, never finding details.
 */
export function buildFeedbackMessage(feedback, context = {}) {
	const rating = Math.max(1, Math.min(5, Number(feedback.rating) || 0));
	const comments = typeof feedback.comments === 'string' && feedback.comments.trim() !== ''
		? feedback.comments.trim()
		: '(no description provided)';
	const modeLabel = MODE_LABELS[context.mode] ?? 'QASE';
	const runTitle = typeof context.title === 'string' && context.title.trim() !== '' ? context.title.trim() : 'QASE test run';
	const shortId = typeof feedback.runId === 'string' && feedback.runId.length >= 8 ? feedback.runId.slice(0, 8) : '—';
	const target = typeof context.targetUrl === 'string' && context.targetUrl !== '' ? context.targetUrl : '—';
	const submittedBy = typeof context.submittedByName === 'string' && context.submittedByName.trim() !== ''
		? context.submittedByName.trim() : 'QASE user';
	const submittedOn = Number.isFinite(context.submittedAt) ? formatSubmittedOn(context.submittedAt) : formatSubmittedOn(Date.now());
	const lines = [
		'📢 QASE User Feedback Received',
		'',
		'A new user feedback has been submitted after completion of a QASE test run.',
		'',
		`⭐ Rating: ${rating}/5`,
		'',
		'📝 User Feedback:',
		comments,
		'',
		'📊 QA Run:',
		`${runTitle} · ${modeLabel} · #${shortId}`,
		'',
		'🌐 Target:',
		target,
		'',
		'👤 Submitted By:',
		submittedBy,
		'',
		'🕒 Submitted On:',
		submittedOn
	];
	const message = lines.join('\n');
	return message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS - 1)}…` : message;
}

/** Load the persisted idempotency ledger (feedback id → outcome). */
function loadLedger(file = LEDGER_FILE) {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
	} catch {
		// Missing or corrupt ledger starts empty; the idempotency guarantee
		// degrades to in-flight tracking only, never double-delivery of a
		// completed send.
	}
	return {};
}

function persistLedger(ledger, file = LEDGER_FILE) {
	let tmp;
	try {
		fs.mkdirSync(STATE_DIR, { recursive: true });
		tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
		fs.writeFileSync(tmp, JSON.stringify(ledger, undefined, '\t'), { mode: 0o600 });
		fs.renameSync(tmp, file);
	} catch (error) {
		if (tmp) { try { fs.unlinkSync(tmp); } catch { /* best-effort */ } }
		console.error(`[qase-whatsapp] failed to persist notification ledger: ${error?.code ?? 'unknown'}`);
	}
}

/** Map an upstream failure to a typed error with a retryability verdict. */
function toNotificationError(error, attemptLabel) {
	if (error instanceof WhatsAppNotificationError) return error;
	if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
		return new WhatsAppNotificationError('WhatsApp request timed out.', { code: 'whatsapp_timeout', retryable: true });
	}
	if (error?.name === 'TypeError' && typeof error?.message === 'string' && /fetch|network/i.test(error.message)) {
		return new WhatsAppNotificationError('WhatsApp API is unreachable.', { code: 'whatsapp_unreachable', retryable: true });
	}
	// Unknown failures are treated as retryable a bounded number of times.
	return new WhatsAppNotificationError(`${attemptLabel} failed.`, { code: 'whatsapp_notification_failed', retryable: true });
}

async function readBoundedText(response, maximum) {
	const text = await response.text();
	return text.length > maximum ? text.slice(0, maximum) : text;
}

async function sendToRecipient(config, recipient, message, { fetchImpl, createTimeoutSignal }) {
	const url = `${config.apiOrigin}/${config.apiVersion}/${config.phoneNumberId}/messages`;
	let response;
	try {
		response = await fetchImpl(url, {
			method: 'POST',
			redirect: 'error',
			signal: createTimeoutSignal(config.timeoutMs),
			headers: {
				'Authorization': `Bearer ${config.accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				messaging_product: 'whatsapp',
				recipient_type: 'individual',
				to: recipient,
				type: 'text',
				text: { preview_url: false, body: message }
			})
		});
	} catch (error) {
		throw toNotificationError(error, 'WhatsApp message delivery');
	}
	if (response.ok) return;
	const detail = sanitizeErrorDetail(await readBoundedText(response, 512));
	const status = response.status;
	if (status === 401 || status === 403) {
		throw new WhatsAppNotificationError('WhatsApp authentication failed.', { code: 'whatsapp_auth_failed', upstreamStatus: status });
	}
	if (status === 429) {
		throw new WhatsAppNotificationError('WhatsApp API rate limit reached.', { code: 'whatsapp_rate_limited', retryable: true, upstreamStatus: status });
	}
	if (status >= 500) {
		throw new WhatsAppNotificationError('WhatsApp API returned a server error.', { code: 'whatsapp_server_error', retryable: true, upstreamStatus: status });
	}
	throw new WhatsAppNotificationError('WhatsApp rejected the message.', { code: 'whatsapp_rejected', upstreamStatus: status });
}

/**
 * Create the configured notifier. `undefined` when the integration is off —
 * the dispatch call then becomes a no-op, mirroring drytisIntegrationFactory.
 */
export function createWhatsAppNotifier(options = {}) {
	const environment = options.environment ?? process.env;
	const logger = options.logger ?? console;
	const fetchImpl = options.fetchImpl ?? fetch;
	const createTimeoutSignal = options.createTimeoutSignal ?? (timeoutMs => AbortSignal.timeout(timeoutMs));
	const sleep = options.sleep ?? (ms => new Promise(resolve => { setTimeout(resolve, ms); }));
	const ledgerFile = options.ledgerFile ?? LEDGER_FILE;
	const loadLedgerImpl = options.loadLedger ?? loadLedger;
	const persistLedgerImpl = options.persistLedger ?? persistLedger;

	let config;
	try {
		config = options.config ?? parseWhatsAppConfig(environment);
	} catch (error) {
		// Misconfiguration must never take feedback down: log once, stay off.
		logger.error?.('whatsapp.config.invalid', { reason: sanitizeErrorDetail(error) });
		return undefined;
	}
	if (!config) return undefined;

	const ledger = loadLedgerImpl(ledgerFile);

	function logFailure(event, feedback, error) {
		const fields = {
			runId: feedback?.runId,
			reason: error instanceof Error ? sanitizeErrorDetail(error) : String(error ?? 'unknown')
		};
		if (Number.isInteger(error?.upstreamStatus)) fields.status = error.upstreamStatus;
		logger.warn?.(event, fields);
	}

	/**
	 * Fire-and-forget dispatch for one committed feedback record. Returns a
	 * tracked promise; NEVER let it reject (the caller may legitimately
	 * ignore it — guarantee 1).
	 */
	function dispatchFeedbackNotification(feedback, context = {}) {
		if (!feedback?.id || !Array.isArray(config.recipients) || config.recipients.length === 0) {
			return Promise.resolve();
		}
		// Idempotency: a delivered (or in-flight) feedback id never resends.
		const prior = ledger[feedback.id];
		if (prior && (prior.status === 'delivered' || prior.status === 'pending')) {
			return Promise.resolve();
		}
		const entry = { status: 'pending', attempts: 0, recipients: config.recipients.length, updatedAt: Date.now() };
		ledger[feedback.id] = entry;
		persistLedgerImpl(ledger, ledgerFile);

		const message = buildFeedbackMessage(feedback, context);
			const run = (async () => {
				let delivered = 0;
				const failures = [];
				let authFailed = false;
				for (const recipient of config.recipients) {
					let attempt = 0;
					let sent = false;
					while (attempt < MAX_ATTEMPTS && !sent) {
						attempt += 1;
						entry.attempts = attempt;
						try {
							await sendToRecipient(config, recipient, message, { fetchImpl, createTimeoutSignal });
							sent = true;
							delivered += 1;
						} catch (error) {
							const typed = toNotificationError(error, 'WhatsApp message delivery');
							// A dead credential helps no recipient: stop the whole
							// dispatch instead of hammering the API three times each.
							if (typed.code === 'whatsapp_auth_failed') {
								failures.push(`${recipient}: ${typed.message}`);
								logFailure('whatsapp.delivery.failed', feedback, typed);
								attempt = MAX_ATTEMPTS; // exits the retry loop
								authFailed = true; // ...and stops remaining recipients
								continue;
							}
							if (!typed.retryable || attempt >= MAX_ATTEMPTS) {
								failures.push(`${recipient}: ${typed.message}`);
								logFailure('whatsapp.delivery.failed', feedback, typed);
								break;
							}
							await sleep(RETRY_DELAY_MS * attempt);
						}
					}
					if (authFailed) break;
				}
			entry.status = failures.length === 0 ? 'delivered' : delivered > 0 ? 'partial' : 'failed';
			if (failures.length > 0) entry.lastError = sanitizeErrorDetail(failures.join(' | '), 500);
			entry.delivered = delivered;
			entry.updatedAt = Date.now();
			persistLedgerImpl(ledger, ledgerFile);
			if (entry.status === 'delivered') {
				logger.info?.('whatsapp.feedback.notified', { runId: feedback.runId, attempts: entry.attempts });
			}
		})();
		// Guarantee 1: the dispatch promise itself never rejects.
		return run.catch(error => {
			logFailure('whatsapp.dispatch.failed', feedback, error);
			entry.status = 'failed';
			entry.lastError = sanitizeErrorDetail(error);
			entry.updatedAt = Date.now();
			persistLedgerImpl(ledger, ledgerFile);
		});
	}

	return Object.freeze({ dispatchFeedbackNotification, buildMessage: buildFeedbackMessage });
}

/** Convenience for app wiring: disabled/invalid → undefined (no-op). */
export function createConfiguredWhatsAppNotifier(options = {}) {
	return createWhatsAppNotifier(options);
}
