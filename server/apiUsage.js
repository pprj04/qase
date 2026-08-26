/**
 * C1 G3 — Bounded API request telemetry for the /api/v2 read surface.
 *
 * QASE previously had NO store containing request data, so "traffic on QASE's
 * own API" was an impossible metric. This module counts requests as they
 * happen and persists a bounded daily aggregate.
 *
 * Honest limits (documented in the OpenAPI description + playbook):
 *   - Counts start at first deployment of this module — no historical backfill
 *     (past requests were never recorded; fabricating them would be a lie).
 *   - Anonymous/auth-failure counts are NOT recorded — only authenticated
 *     requests are usage. 401 rejections show up in server logs, not here.
 *   - Bounded: MAX_DAYS buckets (90), flushed on an interval and on shutdown.
 *   - Buckets are (day, endpoint-pattern) — path templates, not raw URLs, so
 *     no identifiers from path/query leak into the store.
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './atomicWrite.js';

const STORE_PATH = join(process.cwd(), '.qase', 'api-usage.json');
const MAX_DAYS = 90;
const MAX_PATTERNS_PER_DAY = 200;
const OVERFLOW_KEY = '__other__';
const FLUSH_INTERVAL_MS = 10_000;

let store = { since: null, days: {} };
let dirty = false;
let flushTimer = null;
/** date-key (YYYY-MM-DD) → Map(pathTemplate → count) */
const pending = new Map();

function dayKey(ts) {
	return new Date(ts).toISOString().slice(0, 10);
}

function load() {
	try {
		if (existsSync(STORE_PATH)) {
			const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
			if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
				store = { since: raw.since ?? null, days: raw.days };
			}
		}
	} catch {
		// Corrupt/absent store — start empty rather than crash the server.
		store = { since: null, days: {} };
	}
}

function prune() {
	const keys = Object.keys(store.days).sort();
	while (keys.length > MAX_DAYS) {
		delete store.days[keys.shift()];
	}
	// Hard bound on distinct patterns per day so an authenticated client
	// enumerating unmatched paths (404s, crawlers) cannot grow the store
	// without limit. Overflow rolls into a single __other__ bucket.
	for (const day of Object.keys(store.days)) {
		const bucket = store.days[day];
		const patterns = Object.keys(bucket);
		if (patterns.length > MAX_PATTERNS_PER_DAY) {
			const sorted = patterns
				.filter(k => k !== OVERFLOW_KEY)
				.sort((a, b) => bucket[a] - bucket[b]); // ascending — drop least-hit
			let overflow = bucket[OVERFLOW_KEY] ?? 0;
			while (Object.keys(bucket).length > MAX_PATTERNS_PER_DAY - 1) {
				const victim = sorted.shift();
				if (victim === undefined) break;
				overflow += bucket[victim];
				delete bucket[victim];
			}
			bucket[OVERFLOW_KEY] = overflow;
		}
	}
}

function flushSync() {
	if (!dirty) return;
	// Merge pending into store
	for (const [day, byPath] of pending) {
		const bucket = store.days[day] ?? (store.days[day] = {});
		for (const [tpl, count] of byPath) bucket[tpl] = (bucket[tpl] ?? 0) + count;
	}
	pending.clear();
	prune();
	try {
		mkdirSync(join(process.cwd(), '.qase'), { recursive: true });
		atomicWrite(STORE_PATH, JSON.stringify(store));
		dirty = false;
	} catch (error) {
		// Persistence failure must never break request handling.
		console.error('[api-usage] flush failed:', error?.message ?? error);
	}
}

export function initApiUsageTracker() {
	load();
	if (!store.since) {
		store.since = new Date().toISOString();
		dirty = true;
		flushSync();
	}
	if (flushTimer) clearInterval(flushTimer);
	flushTimer = setInterval(flushSync, FLUSH_INTERVAL_MS);
	flushTimer.unref?.();
	// Best-effort flush on shutdown so the last ≤10s window isn't lost.
	for (const sig of ['SIGTERM', 'SIGINT']) {
		process.once(sig, () => { try { flushSync(); } catch { /* already dying */ } });
	}
}

/**
 * Express middleware factory: counts authenticated requests by path template.
 * Mount AFTER requireApiToken so only authenticated traffic is counted.
 * Path template is resolved at response finish (req.route is only populated
 * after the route layer matched — at middleware time it is undefined).
 */
export function apiUsageCounter() {
	return (req, res, next) => {
		try {
			const day = dayKey(Date.now());
			res.on('finish', () => {
				try {
					// Prefer the matched route template; fall back to the
					// URL path with ids collapsed (no query string — ever).
					let tpl = req.route?.path;
					if (!tpl) {
						tpl = (req.baseUrl ?? '') + (req.path ?? '');
						tpl = tpl
							.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
							.replace(/\/\d+(?=\/|$)/g, '/:n');
					}
					let byPath = pending.get(day);
					if (!byPath) { byPath = new Map(); pending.set(day, byPath); }
					byPath.set(tpl, (byPath.get(tpl) ?? 0) + 1);
					dirty = true;
				} catch { /* counting must never break */ }
			});
		} catch {
			// Counting must never break a request.
		}
		next();
	};
}

/**
 * Read model: daily rows sorted ascending.
 * @returns {{since: string|null, rows: Array<{day:string, total:number, endpoints:Record<string,number>}>}}
 */
export function getApiUsage() {
	flushSync();
	const rows = Object.keys(store.days).sort().map(day => {
		const endpoints = store.days[day] ?? {};
		return {
			day,
			total: Object.values(endpoints).reduce((a, b) => a + b, 0),
			endpoints,
		};
	});
	return { since: store.since, rows };
}

/** @internal test hook — clears the in-memory + on-disk store. */
export function __resetApiUsageForTesting() {
	if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
	pending.clear();
	store = { since: null, days: {} };
	dirty = false;
	try { if (existsSync(STORE_PATH)) atomicWrite(STORE_PATH, JSON.stringify(store)); } catch { /* ignore */ }
}
