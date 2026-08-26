/**
 * Pulse OpenAPI helpers — shared implementation for the Drytis Pulse read surface.
 *
 * Every exposed GET endpoint uses these to:
 *   - render epoch-ms timestamps as ISO 8601 UTC strings (deep, key-filtered);
 *   - answer Pulse's collection contract `{ data, total, page, page_size }` when the
 *     caller sends `page`/`page_size` — while staying byte-identical to the legacy
 *     response (bare array, or `{items,…}` under `?limit=`) when they don't;
 *   - accept `from`/`to` date filters (inclusive/exclusive) on time-based
 *     collections, rejecting unparseable values with 400;
 *   - join human-readable names beside foreign ids (project_name, mission_name,
 *     session_title) so charts are not labelled with UUIDs.
 *
 * No dependencies. Pure functions only — trivially unit-testable.
 */

/** Keys whose values are durations/scores, never timestamps — never ISO-converted. */
const NON_TIMESTAMP_KEYS = new Set([
	// durations / elapsed time (milliseconds as NUMBERS — must stay numbers)
	'duration', 'durationMs', 'avgDurationMs', 'totalDurationMs', 'elapsed', 'elapsedMs',
	'durationMsTotal', 'timeMs', 'latencyMs', 'responseTime', 'responseTimeMs',
	// numeric counters that merely end in At/ts-like words are handled by name checks below
]);

const TIMESTAMP_SUFFIX_RE = /(^|_)(at|ts|time)$/i;
const TIMESTAMP_EXACT_RE = /^(ts|createdAt|updatedAt|startedAt|completedAt|lastActivity|queuedAt|ranAt|recordedAt|lastRun|nextRun|firstSeen|lastSeen|lastValidated|expiresAt|deletedAt|approvedAt|reviewedAt|generatedAt|savedAt|timestamp)$/;

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** True when the value is a plausible epoch-**millisecond** timestamp. */
function isEpochMs(value) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
	// 2001-09-09 (1e12) … 5138-11-16 (1e14): milliseconds, not seconds, not tiny counters.
	return value >= 1e12 && value < 1e14;
}

/**
 * Deep-convert epoch-ms timestamps to ISO 8601 UTC strings.
 * A field is converted only when BOTH the value looks like epoch-ms AND the key
 * name looks like a timestamp (`*At`, `*ts`, `*Time`, or a known exact name) —
 * counters such as `total`, `turnCount` or durations keep their numeric type.
 */
export function deepIsoTimestamps(value, seen = new Set()) {
	if (Array.isArray(value)) return value.map(item => deepIsoTimestamps(item, seen));
	if (!isPlainObject(value)) return value;
	if (seen.has(value)) return value; // cycle guard
	seen.add(value);
	const out = {};
	for (const [key, raw] of Object.entries(value)) {
		if (NON_TIMESTAMP_KEYS.has(key)) {
			out[key] = deepIsoTimestamps(raw, seen);
			continue;
		}
		if (isEpochMs(raw) && (TIMESTAMP_EXACT_RE.test(key) || TIMESTAMP_SUFFIX_RE.test(key))) {
			out[key] = new Date(raw).toISOString();
			continue;
		}
		out[key] = deepIsoTimestamps(raw, seen);
	}
	return out;
}

/**
 * Parse Pulse paging params. Returns null when the caller sent NEITHER `page` NOR
 * `page_size` — the signal to keep the legacy response shape untouched.
 */
export function parsePulsePaging(query) {
	const hasPage = query?.page != null && query.page !== '';
	const hasPageSize = query?.page_size != null && query.page_size !== '';
	if (!hasPage && !hasPageSize) return null;

	let page = Number.parseInt(String(query.page ?? 1), 10);
	if (!Number.isFinite(page) || page < 1) page = 1;
	let pageSize = Number.parseInt(String(query.page_size ?? 100), 10);
	if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 100;
	pageSize = Math.min(pageSize, 500); // hard cap, matches pagination.js MAX_LIMIT
	return { page, pageSize };
}

/**
 * Wrap a deterministically-sorted list in the Pulse envelope.
 * Preserves any extra fields (queueDepth, governor, metrics, …) the legacy
 * response carried alongside the records.
 */
export function pulseEnvelope(list, paging, extras = {}) {
	const total = Array.isArray(list) ? list.length : 0;
	const offset = (paging.page - 1) * paging.pageSize;
	const data = Array.isArray(list) ? list.slice(offset, offset + paging.pageSize) : [];
	return { data, total, page: paging.page, page_size: paging.pageSize, ...extras };
}

/** True when the caller asked for the Pulse envelope (page/page_size present). */
export function wantsPulseEnvelope(query) {
	return parsePulsePaging(query) !== null;
}

/**
 * Parse a `from`/`to` pair (`YYYY-MM-DD`, from inclusive, to exclusive).
 * Returns `{ fromMs, toMs }` (either may be undefined) or a `{ error }` when a
 * supplied value is unparseable — callers must answer 400 on error.
 */
export function parseDateRange(query) {
	const parse = (raw, name) => {
		if (raw == null || raw === '') return undefined;
		const str = String(raw).trim();
		// Strict ISO calendar date: YYYY-MM-DD (no time component).
		if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return { error: `${name} must be YYYY-MM-DD` };
		const ms = Date.parse(`${str}T00:00:00.000Z`);
		if (!Number.isFinite(ms)) return { error: `${name} is not a valid date` };
		return ms;
	};
	const from = parse(query?.from, 'from');
	if (from?.error) return from;
	const to = parse(query?.to, 'to');
	if (to?.error) return to;
	return { fromMs: from, toMs: to };
}

/** Filter a list on an epoch-ms field: from <= x < to (missing bounds pass). */
export function applyDateRange(list, range, field) {
	if (!range || (range.fromMs == null && range.toMs == null)) return list;
	return list.filter(item => {
		const ts = Number(item?.[field]);
		if (!Number.isFinite(ts)) return false; // records without the field match nothing
		if (range.fromMs != null && ts < range.fromMs) return false;
		if (range.toMs != null && ts >= range.toMs) return false;
		return true;
	});
}

/**
 * Name-resolver wiring: each route passes the store getters it already imports.
 * `withForeignNames(record, resolvers)` returns a NEW object — the stored record
 * is never mutated (ids may be missing; omitted name fields then stay absent).
 */
export function withForeignNames(record, { projectName } = {}) {
	if (!record || typeof record !== 'object') return record;
	const out = { ...record };
	if (out.projectId != null && projectName) {
		const name = projectName(out.projectId);
		if (name != null) out.projectName = name;
	}
	return out;
}

const CAMEL_RE = /([a-z0-9])([A-Z])/g;
function snakeKey(k) { return k.replace(CAMEL_RE, '$1_$2').toLowerCase(); }

/**
 * Deep-convert all object keys from camelCase to snake_case.
 * Arrays are traversed; non-objects pass through unchanged. Used for raw
 * store outputs (e.g. getPatternProvenance) that were never projected.
 */
export function deepSnakeKeys(value, seen = new Set()) {
	if (Array.isArray(value)) return value.map(item => deepSnakeKeys(item, seen));
	if (!isPlainObject(value)) return value;
	if (seen.has(value)) return value;
	seen.add(value);
	const out = {};
	for (const [k, v] of Object.entries(value)) out[snakeKey(k)] = deepSnakeKeys(v, seen);
	return out;
}
