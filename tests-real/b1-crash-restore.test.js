'use strict';

/**
 * B1 W8 — crash-durable BrowserStack config restore.
 *
 * Proof: a child process snapshots config, arms a restore marker, mutates the
 * config (browserstackEnabled=true + garbage creds), then is SIGKILLed —
 * finally/signal handlers never run. Restarting the module (simulating server
 * boot) must restore the snapshot from the marker and clear it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

function childScript() {
	return `
		process.env.QASE_DATA_DIR = ${JSON.stringify(process.env.QASE_DATA_DIR)};
		const { getConfig, saveConfig } = await import(${JSON.stringify('file://' + join(ROOT, 'server/config.js'))});
		const { armConfigRestoreMarker } = await import(${JSON.stringify('file://' + join(ROOT, 'server/testRestore.js'))});
		const before = JSON.parse(JSON.stringify(getConfig()));
		armConfigRestoreMarker(before, 'B1 crash-restore proof mutation');
		saveConfig({ browserstackEnabled: true, browserstackUser: 'SIGKILLED_USER', browserstackKey: 'SIGKILLED_KEY', browserstackStrict: true });
		// Signal the parent the mutation is live, then die without restoring.
		process.stdout.write('MUTATED\\n');
		await new Promise(r => setTimeout(r, 30000));
	`;
}

test('W8: SIGKILL mid-mutation → next boot restores the snapshot from the marker', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'qase-w8-'));
	process.env.QASE_DATA_DIR = dir;
	// Hermeticity guard: config.js must follow QASE_DATA_DIR (cwd-independent),
	// or this suite would mutate the REAL .qase/config.json.
	try {
		const { saveConfig } = await import('../server/config.js');
		saveConfig({ browserstackEnabled: false, browserstackUser: 'ORIGINAL_USER', browserstackKey: 'ORIGINAL_KEY', maxTurns: 120, concurrentRuns: 3 });
		const real = readFileSync(join(ROOT, '.qase', 'config.json'), 'utf8');
		assert.ok(!real.includes('ORIGINAL_USER'), 'isolation: the live config.json must never see test values');
	} catch (err) {
		assert.fail(`QASE_DATA_DIR isolation broken — test would clobber the live store: ${err.message}`);
	}
	try {
		// Seed an original config state on disk first (marker will snapshot this).
		const { saveConfig } = await import('../server/config.js');
		saveConfig({ browserstackEnabled: false, browserstackUser: 'ORIGINAL_USER', browserstackKey: 'ORIGINAL_KEY', maxTurns: 120, concurrentRuns: 3 });

		// Child mutates then gets SIGKILLed (finally never runs).
		const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript()], { encoding: 'utf8', timeout: 20000 });
		assert.match(child.stdout ?? '', /MUTATED/, 'child reached the mutated state');

		// Marker must still exist on disk (crash happened before disarm).
		const markerDir = join(dir, 'test-restore');
		assert.ok(existsSync(markerDir), 'marker directory persisted the crash');
		assert.ok(readdirSync(markerDir).some(f => f.endsWith('.json')), 'at least one restore marker on disk');

		// Simulated server boot: fresh module (cache cleared) → readStored() runs
		// restorePendingTestMarkers() before anything else sees stored config.
		const { getConfig } = await import('../server/config.js?boot=' + Date.now());
		const cfg = getConfig();
		assert.equal(cfg.browserstackEnabled, false, 'mutation was rolled back by boot recovery');
		assert.equal(cfg.browserstackUser, 'ORIGINAL_USER', 'original BS user restored');
		assert.equal(cfg.browserstackKey, 'ORIGINAL_KEY', 'original BS key restored');
		// Marker removed after successful restore → next boot is a no-op.
		assert.deepEqual(readdirSync(markerDir), [], 'marker cleared after restore');
	} finally {
		rmSync(dir, { recursive: true, force: true });
		delete process.env.QASE_DATA_DIR;
	}
});
