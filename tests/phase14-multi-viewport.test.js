/**
 * Phase 14 — Multi-Viewport / Responsive Testing tests
 *
 * Tests:
 * 1. VIEWPORT_PRESETS has all 4 presets with correct dimensions
 * 2. resolveViewport handles strings, objects, and defaults
 * 3. listViewportPresets returns array with keys
 * 4. Config has exploreViewports flag, defaults true
 * 5. testGen.js includes viewport in prompt and normalizes generated test cases
 * 6. replay.js expands multi-viewport test cases (via code inspection)
 * 7. junit.js includes viewport prefix in test names
 * 8. testCases.js has viewport/viewports fields in create/normalize/update/clone
 * 9. API: public config includes viewportPresets
 * 10. API: test case create accepts viewport fields
 */

import assert from 'node:assert';

const BASE = 'http://localhost:5173';

let passed = 0, failed = 0;

function ok(name, condition, detail = '') {
	if (condition) {
		console.log(`  ✓ ${name}`);
		passed++;
	} else {
		console.log(`  ✗ ${name} ${detail ? '— ' + detail : ''}`);
		failed++;
	}
}

console.log('\n── Phase 14: Multi-Viewport / Responsive Testing ──\n');

// ── Test 1: VIEWPORT_PRESETS ─────────────────────────────────────
{
	const { VIEWPORT_PRESETS } = await import('../server/config.js');
	ok('desktop preset exists', VIEWPORT_PRESETS.desktop && VIEWPORT_PRESETS.desktop.width === 1440);
	ok('tablet preset exists', VIEWPORT_PRESETS.tablet && VIEWPORT_PRESETS.tablet.width === 768);
	ok('mobile preset exists', VIEWPORT_PRESETS.mobile && VIEWPORT_PRESETS.mobile.width === 375);
	ok('mobile_small preset exists', VIEWPORT_PRESETS.mobile_small && VIEWPORT_PRESETS.mobile_small.width === 320);
	ok('all presets have labels', Object.values(VIEWPORT_PRESETS).every(v => v.label));
	ok('all presets have icons', Object.values(VIEWPORT_PRESETS).every(v => v.icon));
}

// ── Test 2: resolveViewport ──────────────────────────────────────
{
	const { resolveViewport } = await import('../server/config.js');
	const desktop = resolveViewport('desktop');
	ok('resolveViewport("desktop") returns preset', desktop.width === 1440 && desktop.height === 900);
	const mobile = resolveViewport({ width: 375, height: 812 });
	ok('resolveViewport(object) returns with width/height', mobile.width === 375);
	const def = resolveViewport(null);
	ok('resolveViewport(null) defaults to desktop', def.width === 1440);
	const invalid = resolveViewport('nonexistent');
	ok('resolveViewport(invalid) falls back to desktop', invalid.width === 1440);
}

// ── Test 3: listViewportPresets ──────────────────────────────────
{
	const { listViewportPresets } = await import('../server/config.js');
	const presets = listViewportPresets();
	ok('listViewportPresets returns array', Array.isArray(presets));
	ok('has 4 presets', presets.length === 4);
	ok('each preset has key', presets.every(p => p.key));
	ok('each preset has width/height', presets.every(p => p.width && p.height));
}

// ── Test 4: Config exploreViewports ──────────────────────────────
{
	const { getConfig, getPublicConfig } = await import('../server/config.js');
	const config = getConfig();
	ok('config has exploreViewports', 'exploreViewports' in config);
	ok('exploreViewports defaults true', config.exploreViewports === true);
	const pub = getPublicConfig();
	ok('public config has exploreViewports', 'exploreViewports' in pub);
	ok('public config has viewportPresets', Array.isArray(pub.viewportPresets) && pub.viewportPresets.length === 4);
}

// ── Test 5: testGen.js viewport support ──────────────────────────
{
	const { buildTestCasePrompt, parseTestCases } = await import('../server/testGen.js');
	const workflow = {
		name: 'Login flow', targetUrl: 'https://example.com',
		steps: [{ action: 'navigate', target: '/login', displayLabel: 'Navigate to login' }],
		viewport: { width: 375, height: 812, label: 'Mobile' }
	};
	const { system, user } = buildTestCasePrompt(workflow, []);

	ok('system prompt mentions viewport field', system.includes('viewport'));
	ok('system prompt mentions viewport presets', system.includes('tablet') && system.includes('mobile'));
	ok('user prompt includes workflow viewport', user.includes('Mobile') || user.includes('375'));

	// Test parsing of a viewport-aware test case
	const raw = JSON.stringify([{
		name: 'Login test', severity: 'high',
		steps: [{ action: 'navigate', target: '/login' }],
		assertions: [{ type: 'url_contains', expected: '/dashboard' }],
		viewport: 'mobile', viewports: ['tablet', 'desktop']
	}]);
	const parsed = parseTestCases(raw);
	ok('parsed test case has viewport', parsed[0].viewport === 'mobile');
	ok('parsed test case has viewports array', Array.isArray(parsed[0].viewports) && parsed[0].viewports.length === 2);
}

// ── Test 6: testGen normalizeTestCases includes viewport ─────────
{
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('../server/testGen.js', import.meta.url), 'utf8');
	ok('testGen normalizes viewport field', src.includes('viewport: vpKey'));
	ok('testGen validates viewport against presets', src.includes('VIEWPORT_PRESETS[tc.viewport]'));
	ok('testGen normalizes viewports array', src.includes('extraViewports'));
}

// ── Test 7: replay.js multi-viewport expansion ───────────────────
{
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('../server/replay.js', import.meta.url), 'utf8');
	ok('replay expands viewports[]', src.includes('Array.isArray(tc.viewports)') && src.includes('expanded.push'));
	ok('replay aggregates viewportResults', src.includes('viewportResults'));
	ok('replay sets overall fail if any viewport fails', src.includes("anyFail ? 'fail'"));
	ok('replay passes viewport to runTestCase', src.includes('entry.viewport'));
}

// ── Test 8: junit.js viewport prefix ─────────────────────────────
{
	const { buildJUnitXml } = await import('../server/junit.js');
	const summary = {
		total: 2,
		passed: 1,
		failed: 1,
		errored: 0,
		durationMs: 3000,
		results: [
			{ testCaseName: 'Login test', result: 'pass', durationMs: 1000, viewport: { label: 'Mobile', width: 375, height: 812 } },
			{ testCaseName: 'Nav test', result: 'fail', durationMs: 2000, error: 'Element not found' }
		]
	};
	const xml = buildJUnitXml(summary, { suiteName: 'test-suite' });
	ok('junit includes viewport prefix', xml.includes('[Mobile] Login test'));
	ok('junit handles no viewport gracefully', xml.includes('Nav test') && !xml.includes('[undefined]'));
}

// ── Test 9: testCases.js has viewport fields ─────────────────────
{
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('../server/testCases.js', import.meta.url), 'utf8');
	ok('testCases normalizes viewport', src.includes('tc.viewport = tc.viewport ??'));
	ok('testCases normalizes viewports', src.includes('tc.viewports = tc.viewports ??'));
	ok('testCases create includes viewport', src.includes('viewport: data.viewport'));
	ok('testCases create includes viewports', src.includes('viewports: Array.isArray(data.viewports)'));
	ok('testCases update includes viewport', src.includes('patch.viewport !== undefined'));
	ok('testCases clone includes viewport', src.includes('viewport: original.viewport'));
}

// ── Test 10: API — public config has viewportPresets ─────────────
{
	const res = await fetch(`${BASE}/api/config`);
	const config = await res.json();
	ok('GET /api/config returns viewportPresets', Array.isArray(config.viewportPresets));
	ok('config has exploreViewports', 'exploreViewports' in config);
}

// ── Test 11: API — test case create with viewport ────────────────
{
	const tcData = {
		name: 'Phase14 viewport test',
		severity: 'medium',
		steps: [{ action: 'navigate', target: '/test' }],
		assertions: [],
		viewport: 'mobile',
		viewports: ['tablet']
	};
	const res = await fetch(`${BASE}/api/test-cases`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(tcData)
	});
	if (!res.ok) {
		ok('POST /api/test-cases with viewport responds OK', false, `status=${res.status}`);
	} else {
		const tc = await res.json();
		ok('POST /api/test-cases with viewport responds OK', true);
		ok('created test case has viewport=mobile', tc.viewport === 'mobile', `got: ${tc.viewport}`);
		ok('created test case has viewports=[tablet]', JSON.stringify(tc.viewports) === JSON.stringify(['tablet']), `got: ${JSON.stringify(tc.viewports)}`);

		// Clean up
		await fetch(`${BASE}/api/test-cases/${tc.id}`, { method: 'DELETE' });
	}
}

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
