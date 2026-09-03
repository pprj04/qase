'use strict';

/**
 * R2-B/G8+D — boot-time orphan browser sweep.
 *
 * QASE owns exactly one browser source: the Playwright-managed cache under
 * ~/.cache/ms-playwright (chromium + chromium_headless_shell — see
 * agent.js's CLEANSLATE_BROWSER_EXECUTABLE resolution). If QASE dies
 * abnormally (SIGKILL, container pause), those Chromium processes survive
 * with no parent bridge to ever close them. At BOOT no legitimate QASE-owned
 * Chromium is running yet (the governor has not started a mission), so a
 * sweep there can only kill orphans of a previous run.
 *
 * Ownership is deliberately conservative:
 *   - ONLY processes whose cmdline references the ms-playwright cache path.
 *   - NEVER system Chrome/Chromium binaries (/opt/google/chrome, /usr/bin/…)
 *     even though the runtime may fall back to them — killing a user's real
 *     browser is out of the question; the fallback case is accepted as a
 *     documented residual risk (the process watcher in resource cleanup
 *     still reclaims those when their session record survives).
 *   - NEVER node processes (the workspace's own @playwright/mcp service is a
 *     node CLI — its cmdline contains no browser path).
 *
 * Disabled with QASE_ORPHAN_SWEEP=0 (test seam).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE = join(homedir(), '.cache', 'ms-playwright');

/** Ownership test — exported for behavioral tests. */
export function isQaseOwnedChromium(cmdline) {
	if (typeof cmdline !== 'string' || cmdline.length === 0) return false;
	// Only QASE's Playwright cache launches, and only the browser binaries.
	if (!cmdline.includes(CACHE)) return false;
	// Exclude the cache path appearing via unrelated tools (e.g. a node CLI
	// invoked FROM the cache dir): require the browser binary shape.
	if (!/chromium[^/]*\/chrome|chrome-headless-shell/.test(cmdline)) return false;
	// Explicitly refuse common non-browser binaries.
	if (/\bnode\b/.test(cmdline)) return false;
	return true;
}

/** Read one /proc/<pid>/cmdline ('\\0'-separated) → space-joined string. */
function readCmdline(pid) {
	try {
		const raw = readFileSync(join('/proc', String(pid), 'cmdline'));
		return raw.toString('utf8').split('\0').filter(Boolean).join(' ');
	} catch {
		return null; // gone or not ours to read
	}
}

/**
 * Sweep once. Returns a diagnostic report; never throws.
 */
export function sweepOrphanBrowsers({ log = console.log, kill = process.kill } = {}) {
	const report = { cacheRoot: CACHE, scanned: 0, matched: 0, killed: 0, errors: 0, disabled: false };
	if (process.env.QASE_ORPHAN_SWEEP === '0') {
		report.disabled = true;
		return report;
	}
	let entries;
	try {
		entries = readdirSync('/proc').filter((n) => /^\d+$/.test(n));
	} catch {
		return report;
	}
	for (const pidStr of entries) {
		const pid = Number(pidStr);
		if (pid === process.pid) continue;
		report.scanned += 1;
		const cmdline = readCmdline(pid);
		if (!cmdline || !isQaseOwnedChromium(cmdline)) continue;
		report.matched += 1;
		try {
			kill(pid, 'SIGKILL');
			report.killed += 1;
		} catch {
			// Already-dead or protected — fine either way.
			report.errors += 1;
		}
	}
	if (report.matched > 0) {
		log(`[orphan-sweep] killed ${report.killed} orphan QASE Chromium process(es) from a previous run (matched ${report.matched}, scanned ${report.scanned})`);
	}
	return report;
}
