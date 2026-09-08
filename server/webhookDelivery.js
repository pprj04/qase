/**
 * B1 W5 — Signed, persisted, retried webhook delivery.
 *
 * Replaces the in-memory `webhooks` Map (lost on restart) and the unsigned
 * fire-and-forget fetch. Contract:
 *   - Subscriptions persist to .qase/webhook-subscriptions.json (P4.4 pattern).
 *   - Deliveries persist to .qase/webhook-deliveries.json with attempt state.
 *   - Every POST carries X-Qase-Signature: t=<ts>,v1=<hmac-sha256(secret, ts + '.' + body)>,
 *     X-Qase-Timestamp, X-Qase-Event, and the mission's X-Correlation-Id when known.
 *   - Retry: exponential backoff (1s, 4s, 16s, 64s, 256s), max 5 attempts.
 *   - Restart recovery: pending deliveries are resumed by the timer loop.
 *   - SSRF: URLs are validated through targetGuard.validateWebhookUrl BEFORE
 *     every delivery attempt (a re-resolved DNS entry can flip a host to a
 *     private address between registration and delivery).
 *
 * The signing secret is QASE_INTEGRATION_SECRET (env-only, never logged).
 */

import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerStoreFlush } from './shutdown.js';
import { validateWebhookUrl } from './targetGuard.js';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// R6-T5 fix — honor QASE_DATA_DIR (the documented isolation contract; same
// class of bug as storeHygiene.js pre-T4). Without this, a child server run
// with a temp data dir wrote webhook deliveries into the REAL store.
const QASE_DIR = process.env.QASE_DATA_DIR ?? join(__dirname, '..', '.qase');
const SUBS_FILE = join(QASE_DIR, 'webhook-subscriptions.json');
const DELIV_FILE = join(QASE_DIR, 'webhook-deliveries.json');

export const WEBHOOK_EVENTS = ['mission.completed', 'mission.failed', 'finding.revalidated'];

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 4_000, 16_000, 64_000, 256_000];
const DELIVERY_TIMEOUT_MS = 8_000;
/** Keep the delivery ledger bounded — latest 2,000 records. */
const MAX_DELIVERY_RECORDS = 2_000;

/** subscriptions: id -> { id, url, events, workspaceId|null, missionId|null, label, createdAt } */
const subscriptions = new Map();
/** deliveries: id -> { id, subId, event, payload, attempts, nextAttemptAt, lastError, status } */
const deliveries = new Map();

/* ── persistence (M1-P4.4 pattern) ──────────────────────────────── */

function loadFile(file, intoMap) {
	try {
		if (!existsSync(file)) return;
		const rows = JSON.parse(readFileSync(file, 'utf8'));
		if (Array.isArray(rows)) for (const row of rows) intoMap.set(row.id, row);
	} catch (err) {
		console.error(`[webhooks] ${basename(file)} corrupt — starting EMPTY (${err.message})`);
	}
}
function basename(p) { return p.split('/').pop(); }

let subSaveTimer = null, delivSaveTimer = null;

function persistSubs() {
	if (subSaveTimer) return;
	subSaveTimer = setTimeout(() => {
		subSaveTimer = null;
		try {
			mkdirSync(dirname(SUBS_FILE), { recursive: true });
			atomicWrite(SUBS_FILE, JSON.stringify([...subscriptions.values()], null, 2));
		} catch (err) { console.error(`[webhooks] subs save failed: ${err.message}`); }
	}, 500).unref?.();
}

function persistDeliveries() {
	if (delivSaveTimer) return;
	delivSaveTimer = setTimeout(() => {
		delivSaveTimer = null;
		try {
			mkdirSync(dirname(DELIV_FILE), { recursive: true });
			// Newest-first ledger, bounded.
			const rows = [...deliveries.values()]
				.sort((a, b) => b.createdAt - a.createdAt)
				.slice(0, MAX_DELIVERY_RECORDS);
			atomicWrite(DELIV_FILE, JSON.stringify(rows, null, 2));
		} catch (err) { console.error(`[webhooks] deliveries save failed: ${err.message}`); }
	}, 500).unref?.();
}

export function flushWebhookStores() {
	if (subSaveTimer) { clearTimeout(subSaveTimer); subSaveTimer = null; }
	if (delivSaveTimer) { clearTimeout(delivSaveTimer); delivSaveTimer = null; }
	try {
		mkdirSync(dirname(SUBS_FILE), { recursive: true });
		atomicWrite(SUBS_FILE, JSON.stringify([...subscriptions.values()], null, 2));
	} catch (err) { console.error(`[webhooks] subs flush failed: ${err.message}`); }
	try {
		const rows = [...deliveries.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_DELIVERY_RECORDS);
		atomicWrite(DELIV_FILE, JSON.stringify(rows, null, 2));
	} catch (err) { console.error(`[webhooks] deliveries flush failed: ${err.message}`); }
}

/* ── subscriptions ───────────────────────────────────────────────── */

export function registerWebhookSubscription({ url, events, workspaceId = null, missionId = null, label = '' }) {
	const cleanEvents = (Array.isArray(events) ? events : [events]).filter(e => WEBHOOK_EVENTS.includes(e));
	if (!cleanEvents.length) throw new Error(`events must include one of ${WEBHOOK_EVENTS.join(', ')}`);
	const sub = {
		id: randomUUID(),
		url,
		events: cleanEvents,
		workspaceId,
		missionId,
		label: label || '',
		createdAt: Date.now()
	};
	subscriptions.set(sub.id, sub);
	persistSubs();
	return sub;
}

export function listWebhookSubscriptions() {
	return [...subscriptions.values()];
}

export function removeWebhookSubscription(id) {
	const had = subscriptions.delete(id);
	if (had) persistSubs();
	return had;
}

/** Subscriptions matching an event + workspace/mission scope. */
export function matchingSubscriptions(event, { workspaceId = null, missionId = null } = {}) {
	return [...subscriptions.values()].filter(s => s.events.includes(event) && (
		(s.workspaceId == null) || (workspaceId != null && s.workspaceId === workspaceId)
	) && (
		(s.missionId == null) || (missionId != null && s.missionId === missionId)
	));
}

/* ── signing ─────────────────────────────────────────────────────── */

function signingSecret() {
	return process.env.QASE_INTEGRATION_SECRET?.trim() || '';
}

export function signWebhookPayload(bodyText, timestamp = String(Math.floor(Date.now() / 1000))) {
	const secret = signingSecret();
	if (!secret) return { timestamp, signature: '' };
	const mac = createHmac('sha256', secret).update(`${timestamp}.${bodyText}`, 'utf8').digest('hex');
	return { timestamp, signature: `v1=${mac}` };
}

/** Verify helper (mirrors the reference client; also used by tests). */
export function verifyWebhookSignature(bodyText, timestamp, signatureHeader) {
	if (!signingSecret()) return false;
	const expected = signWebhookPayload(bodyText, timestamp).signature;
	return expected === signatureHeader;
}

/* ── delivery engine ─────────────────────────────────────────────── */

export function enqueueDelivery(event, payload, { workspaceId = null, missionId = null, correlationId = null } = {}) {
	const subs = matchingSubscriptions(event, { workspaceId, missionId });
	if (!subs.length) return [];
	const created = [];
	for (const sub of subs) {
		const eventId = `evt_${randomUUID()}`;
		const body = {
			id: eventId,
			event,
			ts: Date.now(),
			workspaceId: workspaceId ?? null,
			...(correlationId ? { correlationId } : {}),
			...payload
		};
		const delivery = {
			id: randomUUID(),
			subId: sub.id,
			url: sub.url,
			event,
			eventId,
			payload: body,
			attempts: 0,
			nextAttemptAt: Date.now(),
			lastError: null,
			status: 'pending',     // pending | delivered | failed
			createdAt: Date.now(),
			completedAt: null
		};
		deliveries.set(delivery.id, delivery);
		created.push(delivery);
	}
	persistDeliveries();
	// Kick the pump immediately for a fast first attempt.
	pumpDeliveries();
	return created.map(d => ({ id: d.id, subId: d.subId, event: d.event, status: d.status }));
}

async function attemptDelivery(delivery) {
	const bodyText = JSON.stringify(delivery.payload);
	const { timestamp, signature } = signWebhookPayload(bodyText);
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
		const res = await fetch(delivery.url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Qase-Event': delivery.event,
				'X-Qase-Event-Id': delivery.eventId,
				'X-Qase-Attempt': String(delivery.attempts + 1),
				'X-Qase-Timestamp': timestamp,
				...(signature ? { 'X-Qase-Signature': signature } : {}),
				...(delivery.payload?.correlationId ? { 'X-Correlation-Id': String(delivery.payload.correlationId) } : {})
			},
			body: bodyText,
			signal: controller.signal
		});
		clearTimeout(timer);
		if (res.ok) {
			delivery.status = 'delivered';
			delivery.completedAt = Date.now();
			delivery.lastError = null;
		} else {
			throw new Error(`receiver responded ${res.status}`);
		}
	} catch (err) {
		delivery.lastError = err instanceof Error ? err.message : String(err);
		delivery.attempts += 1;
		if (delivery.attempts >= MAX_ATTEMPTS) {
			delivery.status = 'failed';
			delivery.completedAt = Date.now();
		} else {
			delivery.nextAttemptAt = Date.now() + BACKOFF_MS[Math.min(delivery.attempts - 1, BACKOFF_MS.length - 1)];
		}
	}
	persistDeliveries();
}

let pumpTimer = null;
let pumping = false;

export async function pumpDeliveries() {
	if (pumping) return;
	pumping = true;
	try {
		const now = Date.now();
		const due = [...deliveries.values()].filter(d => d.status === 'pending' && d.nextAttemptAt <= now);
		for (const delivery of due) {
			if (delivery.status !== 'pending') continue;
			// SSRF re-validation before EVERY attempt.
			const check = await validateWebhookUrl(delivery.url).catch(() => ({ ok: false }));
			if (!check?.ok) {
				delivery.lastError = `blocked by targetGuard (${check?.code ?? 'invalid'})`;
				delivery.attempts += 1;
				if (delivery.attempts >= MAX_ATTEMPTS) {
					delivery.status = 'failed';
					delivery.completedAt = Date.now();
				} else {
					delivery.nextAttemptAt = Date.now() + BACKOFF_MS[Math.min(delivery.attempts - 1, BACKOFF_MS.length - 1)];
				}
				continue;
			}
			await attemptDelivery(delivery);
		}
	} finally {
		pumping = false;
		scheduleNextPump();
	}
}

export async function pumpDeliveriesForTest() {
	// Test hook: reset any stale timer (mirrors a fresh boot) and force a
	// synchronous pump cycle. Not used by production code paths.
	pumpTimer = null;
	await pumpDeliveries();
}

function scheduleNextPump() {
	if (pumpTimer) return;
	const nextDue = [...deliveries.values()]
		.filter(d => d.status === 'pending')
		.map(d => d.nextAttemptAt)
		.sort((a, b) => a - b)[0];
	if (nextDue === undefined) return;
	const delay = Math.max(nextDue - Date.now(), 250);
	// B1 W5 bugfix: clear pumpTimer INSIDE the callback — without this the
	// stale (already-fired) timer object blocked every later scheduleNextPump,
	// so failed deliveries sat 'pending' forever after their first retry.
	pumpTimer = setTimeout(() => {
		pumpTimer = null;
		pumpDeliveries();
	}, delay);
	pumpTimer.unref?.();
}

export function deliveryLedger({ status, limit = 100 } = {}) {
	let rows = [...deliveries.values()].sort((a, b) => b.createdAt - a.createdAt);
	if (status) rows = rows.filter(d => d.status === status);
	return rows.slice(0, Math.min(limit, 500));
}

export function getDelivery(id) {
	return deliveries.get(id) ?? null;
}

/* ── boot ────────────────────────────────────────────────────────── */

loadFile(SUBS_FILE, subscriptions);
loadFile(DELIV_FILE, deliveries);
registerStoreFlush('webhook-subscriptions', () => { flushWebhookStores(); return { dirty: false, ok: true }; });
registerStoreFlush('webhook-deliveries', () => { flushWebhookStores(); return { dirty: false, ok: true }; });
// Restart recovery — any pending delivery resumes on the next pump.
pumpDeliveries();
