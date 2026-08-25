'use strict';

/**
 * B1 W8 — test-mutation restore markers (crash-durable).
 *
 * Problem: a test that snapshots → mutates server config (e.g. BrowserStack
 * credentials) and is then SIGKILLed leaves the mutation in place. `finally`
 * and signal handlers do not run on SIGKILL / power loss / OOM-kill.
 *
 * Solution: BEFORE mutating, the test writes a marker file containing the
 * exact original config snapshot. The SERVER, at boot, looks for any pending
 * markers and restores them (then removes the marker). A marker is only
 * removed after a successful restore, so a crash DURING restore leaves it in
 * place for the next boot.
 *
 * Marker file: .qase/test-restore/<pid>-<ts>.json
 *   { savedConfig: {...}, note: "...", createdAt: ts }
 *
 * Server boot calls restorePendingTestMarkers() (config.js) — idempotent,
 * safe in production (no-op when the directory is absent).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.env.QASE_DATA_DIR ?? '.qase', 'test-restore');

/** Test-side: snapshot the current config and arm a restore marker. */
export function armConfigRestoreMarker(snapshot, note = 'test mutation') {
	mkdirSync(DIR, { recursive: true });
	const marker = join(DIR, `m-${Date.now()}-${process.pid}.json`);
	writeFileSync(marker, JSON.stringify({ savedConfig: snapshot, note, createdAt: Date.now() }, null, 2));
	return marker;
}

/** Test-side: disarm after a clean in-process restore (finally path). */
export function disarmConfigRestoreMarker(marker) {
	try { rmSync(marker, { force: true }); } catch { /* gone */ }
}

/**
 * Server-side (boot): apply every pending marker, newest-first, then remove
 * it. Called from config.js after the store loads. Returns the number of
 * restores applied.
 */
export function restorePendingTestMarkers({ saveConfig }) {
	if (!existsSync(DIR)) return 0;
	let applied = 0;
	for (const name of [...readdirSync(DIR)].sort().reverse()) {
		if (!name.endsWith('.json')) continue;
		const file = join(DIR, name);
		try {
			const { savedConfig } = JSON.parse(readFileSync(file, 'utf8'));
			if (savedConfig && typeof savedConfig === 'object') {
				saveConfig(savedConfig);
				applied += 1;
				console.warn(`[test-restore] recovered config from ${name} (test crashed before restore)`);
			}
			rmSync(file, { force: true });
		} catch (err) {
			console.error(`[test-restore] marker ${name} unreadable — leaving for manual inspection:`, err?.message ?? err);
		}
	}
	return applied;
}
