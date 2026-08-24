/**
 * M1-P4.3 — Backward-compatible pagination helper for large collection APIs.
 *
 * Contract (see docs/M1-P4.3-STATE-MODEL.md §pagination):
 *  - No `limit` query param  → response stays EXACTLY as today: the full array
 *    (existing API consumers and tests keep working).
 *  - `?limit=N` present      → envelope `{ items, total, limit, offset }` with
 *    stable ordering (already-sorted list is sliced; ordering itself is the
 *    caller's deterministic sort), offset support, and a hard maximum of 500
 *    to prevent unbounded page requests.
 *
 * The helper never mutates the input list.
 */

const MAX_LIMIT = 500;

/**
 * @param {any[]} list       deterministically-sorted list (caller's order)
 * @param {object} query     express request.query (limit, offset read as strings)
 * @param {object} [options]
 * @param {number} [options.maxLimit=500]
 * @returns {{ paginated: boolean, body: any[]|object }}
 */
export function paginateList(list, query, options = {}) {
	const maxLimit = options.maxLimit ?? MAX_LIMIT;
	const rawLimit = query?.limit;

	// Backward compatibility: no limit param → full array, unchanged shape.
	if (rawLimit == null || rawLimit === '') {
		return { paginated: false, body: list };
	}

	let limit = Number.parseInt(String(rawLimit), 10);
	if (!Number.isFinite(limit) || limit < 1) limit = 10; // invalid → small default, not error (smallest safe)
	limit = Math.min(limit, maxLimit);

	let offset = Number.parseInt(String(query.offset ?? '0'), 10);
	if (!Number.isFinite(offset) || offset < 0) offset = 0;

	const total = Array.isArray(list) ? list.length : 0;
	const items = Array.isArray(list) ? list.slice(offset, offset + limit) : [];

	return {
		paginated: true,
		body: { items, total, limit, offset, hasMore: offset + items.length < total }
	};
}
