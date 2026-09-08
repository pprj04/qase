/**
 * R6-T5 — Store-integrity visibility (observability ONLY).
 *
 * G6: corrupt loads and write failures were console-only. This module is a
 * single, per-store in-memory health registry that the existing persistence
 * layers record into at the moment failure is detected. No behavior change,
 * no new persistence, no new diagnostic system — the numbers are surfaced
 * through the EXISTING GET /api/v1/diagnostics/state-integrity route.
 *
 * Contract (same truthfulness rules as R6-T1's evidence save-health):
 *  - Counters live for the lifetime of the process. A restart resets them —
 *    that is honest (process-scoped facts), and the corrupt-* / .corrupt-<ts>
 *    files the quarantine paths preserve remain on disk for forensics.
 *  - Explicit null (never a fabricated value) for "never failed / never
 *    corrupted".
 *  - Quarantine identifiers are stored as BASENAMES only — the public
 *    diagnostics response must never contain filesystem paths.
 *
 * Registered stores (actual store names from tracing):
 *  - sessions   (store.js      → sessions.json)
 *  - missions   (missions.js   → missions.json)
 *  - findings   (findings.js   → findings.json)
 *  - evidence   (evidenceGraph.js → evidence-graph.json)
 */

const registry = new Map();

function slot(name) {
	if (!registry.has(name)) {
		registry.set(name, {
			corruptLoadCount: 0,
			lastCorruptLoadAt: null,
			lastCorruptBackup: null, // basename only, e.g. 'sessions.json.corrupt-1725620000000'
			writeFailureCount: 0,
			lastWriteFailureAt: null,
			lastWriteFailureError: null
		});
	}
	return registry.get(name);
}

/** Record a corrupt-load (quarantine) event for a store.
 *  `backupPath` may be an absolute path — only its basename is kept.
 *  Error text is sanitized: absolute paths stripped (an fs error message
 *  often embeds the full store path, e.g. ENOENT on /workspace/.qase/…). */
export function recordCorruptLoad(storeName, { error, backupPath = null } = {}) {
	const s = slot(storeName);
	s.corruptLoadCount++;
	s.lastCorruptLoadAt = Date.now();
	if (backupPath) s.lastCorruptBackup = String(backupPath).split(/[\\/]/).pop();
	if (error) s.lastCorruptLoadError = sanitizeErrorText(error);
	return s;
}

/** Record a persistence failure for a store. */
export function recordWriteFailure(storeName, { error } = {}) {
	const s = slot(storeName);
	s.writeFailureCount++;
	s.lastWriteFailureAt = Date.now();
	s.lastWriteFailureError = sanitizeErrorText(error ?? 'unknown error');
	return s;
}

/** Public-safe error text: bounded length, absolute paths reduced to their
 *  basename so diagnostics never expose the filesystem layout. */
function sanitizeErrorText(raw) {
	const bounded = String(raw).slice(0, 300);
	return bounded.replace(/[^\s'"]*\/[^\s'"]*/g, (m) => m.split(/[\\/]/).pop());
}

/**
 * Public-safe snapshot for diagnostics. Always returns all four stores so
 * the API shape is stable; `recoveredAsEmpty` is set when a corrupt load
 * left the store running from empty state.
 */
export function getStoreHealthSnapshot() {
	const names = ['sessions', 'missions', 'findings', 'evidence'];
	const out = {};
	for (const name of names) {
		const s = registry.get(name);
		out[name] = {
			corruptLoadCount: s?.corruptLoadCount ?? 0,
			lastCorruptLoadAt: s?.lastCorruptLoadAt ?? null,
			lastCorruptBackup: s?.lastCorruptBackup ?? null,
			lastCorruptLoadError: s?.lastCorruptLoadError ?? null,
			writeFailureCount: s?.writeFailureCount ?? 0,
			lastWriteFailureAt: s?.lastWriteFailureAt ?? null,
			lastWriteFailureError: s?.lastWriteFailureError ?? null,
			// A corrupt load always left this store running from empty in the
			// current process — surfaced so operators never mistake a silent
			// reset for a healthy boot.
			recoveredAsEmpty: (s?.corruptLoadCount ?? 0) > 0
		};
	}
	return out;
}

/** Test-only: reset the registry (hermetic suites). */
export function _clearForTesting() {
	registry.clear();
}
