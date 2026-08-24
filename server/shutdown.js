/**
 * M1-P4.4 Phase 2 — graceful-shutdown flush registry.
 *
 * Problem (P4.4 audit S-P4.4-1): every QASE store persists through a
 * 250–500 ms debounced timer, but the SIGINT/SIGTERM handler closed
 * browsers and called process.exit(0) without flushing anything — any
 * mutation inside the debounce window was silently lost.
 *
 * Each store registers a flusher here. A flusher should:
 *   - return { dirty: boolean, ok: boolean, error?: string }
 *   - be synchronous (all stores use atomicWrite, which is sync)
 *   - be idempotent — calling it twice must not rewrite the file
 *     unnecessarily (the per-store dirty/timer check handles that)
 *
 * flushAllStores() runs every registered flusher once, logs one line per
 * store (flushed / clean / flush-failed), and never throws. One store's
 * failure never blocks the others.
 */

const flushers = new Map(); // name -> () => { dirty, ok, error }

/**
 * Register (or replace) a store flusher.
 * @param {string} name Store name for logging (e.g. 'sessions').
 * @param {() => {dirty: boolean, ok: boolean, error?: string}} fn
 */
export function registerStoreFlush(name, fn) {
	flushers.set(name, fn);
}

/**
 * Flush every registered store once. Safe to call multiple times —
 * flushers are expected to report dirty:false after their first run.
 * @param {{ log?: (msg: string) => void }} [options]
 * @returns {{ flushed: string[], failed: {name: string, error: string}[], clean: string[] }}
 */
export function flushAllStores(options = {}) {
	const log = options.log || ((msg) => console.log(msg));
	const flushed = [];
	const failed = [];
	const clean = [];
	for (const [name, fn] of flushers) {
		try {
			const result = fn() || {};
			if (result.dirty === false) {
				clean.push(name);
			} else if (result.ok === false) {
				failed.push({ name, error: result.error || 'unknown error' });
				log(`[shutdown] flush-failed: ${name} — ${result.error || 'unknown error'}`);
			} else {
				flushed.push(name);
				log(`[shutdown] flushed: ${name}`);
			}
		} catch (err) {
			failed.push({ name, error: err.message });
			log(`[shutdown] flush-failed: ${name} — ${err.message}`);
		}
	}
	return { flushed, failed, clean };
}
