import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sanitizeErrorDetail } from './errorSanitizer.js';

/**
 * WhatsApp notifications for user feedback (Meta WhatsApp Business Cloud API).
 *
 * Provider: Meta WhatsApp Business Cloud API
 *   POST {origin}/{version}/{PHONE_NUMBER_ID}/messages  (Bearer access token)
 *
 * Free-form text messages are only delivered by Meta inside a 24-hour
 * customer-service window after the recipient last messaged the business
 * number. Outside that window Meta requires a pre-approved TEMPLATE —
 * configure QASE_WHATSAPP_TEMPLATE_NAME (+ _LANGUAGE) to send via template.
 *
 * Hard guarantees, in order:
 *  1. A feedback submission NEVER fails, blocks, or slows down because of
 *     this module. Dispatch is fire-and-forget; every error path logs a
 *     sanitized warning and returns.
 *  2. One feedback record id → at most one message per recipient, ever. A
 *     persisted idempotency ledger (same atomic-write pattern as the
 *     feedback store) makes double-submit and retries collapse, and retries
 *     of FAILED notifications skip recipients already accepted.
 *  3. The access token is never logged, never echoed into errors.
 *  4. The integration never fails silently: the construction state
 *     (enabled / disabled / invalid) is logged exactly once at startup.
 *
 * Notification lifecycle (per feedback id):
 *   PENDING → RETRYING → SENT      (every recipient accepted by provider)
 *                     → FAILED     (one or more recipients not accepted;
 *                                   per-recipient states say which and why)
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
export const NOTIFICATION_STATUSES = ['PENDING', 'RETRYING', 'SENT', 'FAILED'];

/** notification id for a feedback record — stable, derived, idempotent. */
export function notificationIdFor(feedbackId) {
	return `WHATSAPP-${feedbackId}`;
}

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

function optional(environment, key) {
	const value = typeof environment[key] === 'string' ? environment[key].trim() : '';
	if (value === '') return undefined;
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
	const templateName = optional(environment, 'QASE_WHATSAPP_TEMPLATE_NAME');
	return Object.freeze({
		accessToken: required(environment, 'QASE_WHATSAPP_ACCESS_TOKEN'),
		phoneNumberId: required(environment, 'QASE_WHATSAPP_PHONE_NUMBER_ID'),
		recipients: parseRecipients(environment.QASE_WHATSAPP_RECIPIENTS),
		apiVersion: (typeof environment.QASE_WHATSAPP_API_VERSION === 'string' && environment.QASE_WHATSAPP_API_VERSION.trim() !== ''
			? environment.QASE_WHATSAPP_API_VERSION.trim() : 'v20.0'),
		apiOrigin: (typeof environment.QASE_WHATSAPP_API_ORIGIN === 'string' && environment.QASE_WHATSAPP_API_ORIGIN.trim() !== ''
			? environment.QASE_WHATSAPP_API_ORIGIN.trim() : 'https://graph.facebook.com'),
		timeoutMs: 15_000,
		templateName,
		templateLanguage: optional(environment, 'QASE_WHATSAPP_TEMPLATE_LANGUAGE') ?? (templateName ? 'en' : undefined)
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

function feedbackValues(feedback, context = {}) {
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
	return { rating, comments, modeLabel, runTitle, shortId, target, submittedBy, submittedOn };
}

/**
 * Build the free-form notification body. Pure function of the feedback record
 * and the run context; only the fields below ever travel — never tokens,
 * never report content, never finding details.
 */
export function buildFeedbackMessage(feedback, context = {}) {
	const v = feedbackValues(feedback, context);
	const lines = [
		'📢 QASE User Feedback Received',
		'',
		'A new user feedback has been submitted after completion of a QASE test run.',
		'',
		`⭐ Rating: ${v.rating}/5`,
		'',
		'📝 User Feedback:',
		v.comments,
		'',
		'📊 QA Run:',
		`${v.runTitle} · ${v.modeLabel} · #${v.shortId}`,
		'',
		'🌐 Target:',
		v.target,
		'',
		'👤 Submitted By:',
		v.submittedBy,
		'',
		'🕒 Submitted On:',
		v.submittedOn
	];
	const message = lines.join('\n');
	return message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS - 1)}…` : message;
}

/** Template payload components mirroring the free-form message fields. */
function buildTemplateComponents(v) {
	return [
		{ type: 'body', parameters: [
			{ type: 'text', text: `⭐ Rating: ${v.rating}/5` },
			{ type: 'text', text: v.comments },
			{ type: 'text', text: `${v.runTitle} · ${v.modeLabel} · #${v.shortId}` },
			{ type: 'text', text: v.target },
			{ type: 'text', text: v.submittedBy },
			{ type: 'text', text: v.submittedOn }
		] }
	];
}

/**
 * Build the Cloud API message payload for one recipient. Free-form text by
 * default; when a template is configured, the approved template carries the
 * same fields as named parameters (required outside the 24h window).
 */
export function buildMessagePayload(config, feedback, context = {}) {
	const v = feedbackValues(feedback, context);
	if (config.templateName) {
		return {
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			to: v.to, // filled by caller
			type: 'template',
			template: {
				name: config.templateName,
				language: { code: config.templateLanguage ?? 'en' },
				components: buildTemplateComponents(v)
			}
		};
	}
	return {
		messaging_product: 'whatsapp',
		recipient_type: 'individual',
		to: v.to, // filled by caller
		type: 'text',
		text: { preview_url: false, body: buildFeedbackMessage(feedback, context) }
	};
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
		fs.mkdirSync(path.dirname(file), { recursive: true });
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

async function sendToRecipient(config, recipient, payloadBody, { fetchImpl, createTimeoutSignal }) {
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
			body: JSON.stringify({ ...payloadBody, to: recipient })
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
	throw new WhatsAppNotificationError('WhatsApp rejected the message.', { code: 'whatsapp_rejected', upstreamStatus: status, detail });
}

function publicEntry(entry) {
	// Projection safe for APIs and logs: statuses, recipients, sanitized reason.
	return {
		notificationId: entry.notificationId,
		feedbackId: entry.feedbackId,
		runId: entry.runId,
		status: entry.status,
		recipients: entry.recipients.map(recipient => ({
			to: recipient.to,
			state: recipient.state,
			attempts: recipient.attempts,
			...(Number.isInteger(recipient.upstreamStatus) ? { upstreamStatus: recipient.upstreamStatus } : {}),
			...(recipient.lastError ? { lastError: recipient.lastError } : {})
		})),
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt
	};
}

/**
 * Create the configured notifier. `undefined` when the integration is off —
 * the dispatch call then becomes a no-op, mirroring drytisIntegrationFactory.
 * The construction state is ALWAYS logged once (never silent).
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
		logger.error?.('whatsapp.integration', {
			state: 'invalid',
			reason: sanitizeErrorDetail(error)
		});
		return undefined;
	}
	if (!config) {
		// Root-cause guard: a disabled integration must be VISIBLE, not silent.
		logger.info?.('whatsapp.integration', {
			state: 'disabled',
			reason: 'QASE_WHATSAPP_ENABLED is not true'
		});
		return undefined;
	}
	logger.info?.('whatsapp.integration', {
		state: 'enabled',
		recipients: config.recipients.length,
		mode: config.templateName ? `template:${config.templateName}` : 'text'
	});

	const ledger = loadLedgerImpl(ledgerFile);

	function logFailure(event, notificationId, feedback, error) {
		const fields = {
			notificationId,
			feedbackId: feedback?.id,
			runId: feedback?.runId,
			reason: error instanceof Error ? sanitizeErrorDetail(error) : String(error ?? 'unknown')
		};
		if (Number.isInteger(error?.upstreamStatus)) fields.status = error.upstreamStatus;
		logger.warn?.(event, fields);
	}

	/**
	 * Send to every recipient that has not already been accepted, tracking
	 * per-recipient state. Idempotent per (notification, recipient) pair.
	 */
	async function runDispatch(entry, feedback, context) {
		const notificationId = entry.notificationId;
		const payload = buildMessagePayload(config, feedback, context);
		let authFailed = false;
		for (const recipient of entry.recipients) {
			if (recipient.state === 'sent') continue; // retry never duplicates
			recipient.state = 'retrying';
			entry.status = 'RETRYING';
			persistLedgerImpl(ledger, ledgerFile);
			let sent = false;
			let attempt = 0; // attempts within THIS dispatch (recipient.attempts is cumulative)
			while (attempt < MAX_ATTEMPTS) {
				attempt += 1;
				recipient.attempts += 1;
				persistLedgerImpl(ledger, ledgerFile);
				try {
					await sendToRecipient(config, recipient.to, payload, { fetchImpl, createTimeoutSignal });
					sent = true;
					break;
				} catch (error) {
					const typed = toNotificationError(error, 'WhatsApp message delivery');
					if (Number.isInteger(typed.upstreamStatus)) recipient.upstreamStatus = typed.upstreamStatus;
					recipient.lastError = typed.message;
					// A dead credential helps no recipient: stop the whole
					// dispatch instead of hammering the API three times each.
					if (typed.code === 'whatsapp_auth_failed') {
						authFailed = true;
						break;
					}
					if (!typed.retryable) break;
					if (attempt >= MAX_ATTEMPTS) break;
					await sleep(RETRY_DELAY_MS * attempt);
				}
			}
			if (sent) {
				recipient.state = 'sent';
				delete recipient.lastError;
			} else {
				recipient.state = 'failed';
				logFailure('whatsapp.delivery.failed', notificationId, feedback,
					recipient.lastError ? new Error(recipient.lastError) : new Error('WhatsApp message delivery failed.'));
			}
			entry.updatedAt = Date.now();
			persistLedgerImpl(ledger, ledgerFile);
			if (authFailed) break; // remaining recipients stay unattempted
		}
		const allSent = entry.recipients.every(recipient => recipient.state === 'sent');
		entry.status = allSent ? 'SENT' : 'FAILED';
		entry.updatedAt = Date.now();
		persistLedgerImpl(ledger, ledgerFile);
		if (entry.status === 'SENT') {
			logger.info?.('whatsapp.feedback.notified', {
				notificationId,
				feedbackId: feedback.id,
				runId: feedback.runId,
				recipients: entry.recipients.length
			});
		} else {
			const failed = entry.recipients.filter(recipient => recipient.state !== 'sent');
			logFailure('whatsapp.notification.failed', notificationId, feedback,
				new Error(`status FAILED — ${failed.length}/${entry.recipients.length} recipient(s) not accepted: ${failed.map(r => `${r.to}(${r.lastError ?? 'unattempted'})`).join('; ')}`));
		}
	}

	function newEntry(feedback, context) {
		return {
			notificationId: notificationIdFor(feedback.id),
			feedbackId: feedback.id,
			runId: feedback.runId,
			status: 'PENDING',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			recipients: config.recipients.map(to => ({ to, state: 'retrying', attempts: 0 })),
			// Retain exactly what a retry needs to rebuild the payload.
			replay: {
				feedback: { id: feedback.id, runId: feedback.runId, rating: feedback.rating, comments: feedback.comments },
				context: {
					mode: context.mode,
					title: context.title,
					targetUrl: context.targetUrl,
					submittedByName: context.submittedByName,
					submittedAt: Number.isFinite(context.submittedAt) ? context.submittedAt : Date.now()
				}
			}
		};
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
		const notificationId = notificationIdFor(feedback.id);
		// Idempotency: a completed (SENT) or in-flight (PENDING/RETRYING)
		// notification never restarts from scratch.
		const prior = ledger[feedback.id];
		if (prior && ['SENT', 'PENDING', 'RETRYING'].includes(prior.status)) {
			return Promise.resolve();
		}
		const entry = prior ?? newEntry(feedback, context);
		// A FAILED entry being re-dispatched keeps its per-recipient states —
		// already-accepted recipients are skipped (no duplicate messages).
		entry.status = 'PENDING';
		entry.updatedAt = Date.now();
		ledger[feedback.id] = entry;
		persistLedgerImpl(ledger, ledgerFile);

		const run = runDispatch(entry, feedback, context);
		// Guarantee 1: the dispatch promise itself never rejects.
		return run.catch(error => {
			logFailure('whatsapp.dispatch.failed', notificationId, feedback, error);
			entry.status = 'FAILED';
			entry.updatedAt = Date.now();
			persistLedgerImpl(ledger, ledgerFile);
		});
	}

	/**
	 * Retry a FAILED notification by id (WHATSAPP-<feedbackId>). Resolves to
	 * { ok: true, notification } on dispatch, { ok: false, reason } when the
	 * retry is not allowed. Already-sent recipients are skipped by runDispatch.
	 */
	function retryNotification(id) {
		const entry = Object.values(ledger).find(candidate => candidate.notificationId === id || candidate.feedbackId === id);
		if (!entry) {
			return Promise.resolve({ ok: false, reason: 'not_found' });
		}
		if (entry.status === 'SENT') {
			return Promise.resolve({ ok: false, reason: 'already_sent' });
		}
		if (entry.status === 'PENDING' || entry.status === 'RETRYING') {
			return Promise.resolve({ ok: false, reason: 'in_progress' });
		}
		const { feedback, context } = entry.replay ?? {};
		if (!feedback?.id) {
			return Promise.resolve({ ok: false, reason: 'not_replayable' });
		}
		entry.status = 'PENDING';
		entry.updatedAt = Date.now();
		persistLedgerImpl(ledger, ledgerFile);
		return runDispatch(entry, feedback, context)
			.catch(error => {
				logFailure('whatsapp.dispatch.failed', entry.notificationId, feedback, error);
				entry.status = 'FAILED';
				entry.updatedAt = Date.now();
				persistLedgerImpl(ledger, ledgerFile);
			})
			.then(() => ({ ok: true, notification: publicEntry(entry) }));
	}

	/** List notification records (admin projection — sanitized). */
	function listNotifications(filter = {}) {
		let entries = Object.values(ledger);
		if (filter.status) entries = entries.filter(entry => entry.status === filter.status);
		if (filter.feedbackId) entries = entries.filter(entry => entry.feedbackId === filter.feedbackId);
		entries.sort((a, b) => b.createdAt - a.createdAt);
		return entries.map(publicEntry);
	}

	/** Inspect one notification by notification id or feedback id. */
	function getNotification(id) {
		const entry = Object.values(ledger).find(candidate => candidate.notificationId === id || candidate.feedbackId === id);
		return entry ? publicEntry(entry) : undefined;
	}

	return Object.freeze({
		dispatchFeedbackNotification,
		retryNotification,
		listNotifications,
		getNotification,
		buildMessage: buildFeedbackMessage
	});
}

/** Convenience for app wiring: disabled/invalid → undefined (no-op). */
export function createConfiguredWhatsAppNotifier(options = {}) {
	return createWhatsAppNotifier(options);
}
