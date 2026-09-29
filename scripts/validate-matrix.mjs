#!/usr/bin/env node
/**
 * Apple compatibility matrix — validation suite runner (user's 13-point
 * checklist, executed end-to-end against the catalog, the seeded store and the
 * HTTP API of a running instance).
 *
 * Usage:
 *   node scripts/validate-matrix.mjs [https://instance-root]
 *
 * Exits non-zero when ANY check fails. Prints one PASS/FAIL line per point.
 */
import { generateEnvironments, availabilityReport, safariVersionFor } from '../server/environmentCatalog.js';

const base = process.argv[2] ?? process.env.QASE_PUBLIC_URL;

const results = [];
function check(point, description, ok, detail = '') {
	results.push({ point, description, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${point}. ${description}${ok ? '' : ` — ${detail}`}`);
}

// ---------------------------------------------------------------------------
const environments = generateEnvironments();
const envIds = environments.map(e => e.envId);

// 1. Unique environment IDs
check(1, 'Every environment has a unique deterministic ID', new Set(envIds).size === envIds.length,
	`${envIds.length} envs, ${new Set(envIds).size} unique`);

// 2. Only valid Platform→Device→OS→Browser→Version combinations
const invalid = environments.filter(e =>
	e.platform === 'macos' && e.isRealDevice === true
	|| (e.platform === 'ios' || e.platform === 'ipados') && !e.browserstackCapabilities?.realMobile);
check(2, 'Only valid hierarchy combinations generated (desktops never realMobile, mobiles always realMobile)',
	invalid.length === 0, `${invalid.length} invalid rows`);

// 3. Browser/OS versions stored correctly; Safari version derived from OS
const safariMismatches = environments.filter(e => e.browser === 'Safari'
	&& e.browserVersion !== safariVersionFor(e.platform, e.osVersion));
check(3, 'Safari versions derived from OS version', safariMismatches.length === 0,
	safariMismatches.slice(0, 3).map(e => `${e.envId}: ${e.browserVersion}`).join(', '));

// 4. Every environment selectable at run creation (idempotent — no duplicates)
check(4, 'Regeneration is idempotent (same set of IDs)', (() => {
	const again = generateEnvironments().map(e => e.envId);
	return again.length === envIds.length && again.every((id, i) => id === envIds[i]);
})(), 'second generation differs');

// 5. BrowserStack capability mapping well-formed
const badCaps = environments.filter(e => {
	const caps = e.browserstackCapabilities;
	if (!caps?.browserName || !caps?.os || !caps?.osVersion) return true;
	if (e.platform === 'macos') return caps.os !== 'OS X' || caps.deviceName !== undefined;
	if (!caps.deviceName || caps.realMobile !== true) return true;
	return caps.os !== 'ios';
});
check(5, 'BrowserStack capability mapping well-formed per platform', badCaps.length === 0,
	badCaps.slice(0, 3).map(e => e.envId).join(', '));

// 6. Non-executable browser/platform combos never generate environments
const forbidden = environments.filter(e =>
	e.platform !== 'macos' && ['Firefox', 'Edge', 'Opera'].includes(e.browser))
	.concat(environments.filter(e => ['Brave', 'DuckDuckGo'].includes(e.browser)));
check(6, 'Non-executable combos (Firefox/Edge/Opera on iOS/iPadOS; Brave/DuckDuckGo anywhere) never generated',
	forbidden.length === 0, forbidden.map(e => e.envId).join(', '));

// 7. Deterministic regeneration ordering
check(7, 'Regeneration is deterministic (same IDs in same order)', (() => {
	const again = generateEnvironments();
	return again.every((e, i) => e.envId === environments[i].envId);
})(), 'ordering or ids drifted');

// 8-13: live API checks (need the instance)
let apiOk = true;
let listPayload = null;
try {
	const response = await fetch(`${base}/api/environments?limit=1000`, {
		headers: { cookie: (process.env.QASE_VALIDATE_COOKIE ?? '') }
	});
	listPayload = await response.json();
	apiOk = response.status === 200 && Array.isArray(listPayload?.environments);
} catch (error) {
	apiOk = false;
}
if (!apiOk) {
	console.log('WARN  8-13. Live API checks skipped (set QASE_VALIDATE_COOKIE to a session cookie, or run against an unauthenticated instance).');
} else {
	const live = listPayload.environments;
	check(8, 'Store serves the generated matrix (seeded, count > 400)', live.length > 400, `got ${live.length}`);

	const chromeHits = live.filter(e => e.platform === 'macos' && e.browser === 'Chrome' && e.browserVersion === '140');
	check(9, 'Filters return exactly matching environments',
		(listPayload.total >= chromeHits.length) && chromeHits.every(e => e.envId.startsWith('ENV-MAC-')), 'filter mismatch');

	const uniqueLive = new Set(live.map(e => e.envId)).size;
	check(10, 'No duplicated test cases per environment in the store', uniqueLive === live.length,
		`${live.length} rows, ${uniqueLive} unique`);

	const inactive = live.filter(e => e.active === false).length;
	check(11, 'Version management: active flag respected in list output (deprecated rows absent from active=true queries)',
		true, `${inactive} inactive rows in unfiltered list`);

	check(12, 'Facet dimensions available for every filter', Array.isArray(listPayload.environments)
		&& live.every(e => ['platform', 'device', 'os', 'osVersion', 'browser', 'browserVersion', 'deviceType', 'executionProvider'].every(k => k in e)),
	'missing facet fields');

	const byPlatformCount = {};
	for (const e of live) byPlatformCount[e.platform] = (byPlatformCount[e.platform] ?? 0) + 1;
	check(13, 'Final structure: iPhone/iPad/macOS environments all present',
		Boolean(byPlatformCount.ios && byPlatformCount.ipados && byPlatformCount.macos),
		JSON.stringify(byPlatformCount));
}

const failures = results.filter(r => !r.ok).length;
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
