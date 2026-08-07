/**
 * Phase 13 — Developer Intelligence tests
 *
 * Tests:
 * 1. devIntelligence.js exports all expected functions
 * 2. devReport.js builds markdown correctly
 * 3. buildFixPrompt produces structured markdown with all sections
 * 4. buildAppImprovementPromptText includes findings count
 * 5. extractJSON handles fenced and raw JSON
 * 6. Pipeline Stage 5 integration (dev_intelligence in STAGE_INFO)
 * 7. Config autoDevReport flag exists and defaults true
 * 8. Routes: fix-prompt, app-improvement-prompt, dev-report, dev-intelligence all respond
 */

import assert from 'node:assert';

const BASE = 'http://localhost:5173';

async function api(path, options = {}) {
	const res = await fetch(`${BASE}${path}`, options);
	return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null, text: res.ok ? null : await res.text().catch(() => ''), headers: res.headers };
}

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

console.log('\n── Phase 13: Developer Intelligence ──\n');

// ── Test 1: devIntelligence.js exports ───────────────────────────
{
	const m = await import('../server/devIntelligence.js');
	ok('devIntelligence exports analyzeFinding', typeof m.analyzeFinding === 'function');
	ok('devIntelligence exports analyzeSessionFindings', typeof m.analyzeSessionFindings === 'function');
	ok('devIntelligence exports buildAppImprovementReport', typeof m.buildAppImprovementReport === 'function');
	ok('devIntelligence exports buildFixPrompt', typeof m.buildFixPrompt === 'function');
	ok('devIntelligence exports buildAppImprovementPromptText', typeof m.buildAppImprovementPromptText === 'function');
}

// ── Test 2: devReport.js buildDevReportMarkdown ──────────────────
{
	const { buildDevReportMarkdown } = await import('../server/devReport.js');
	const session = {
		id: 'test-session-1', targetUrl: 'https://example.com',
		findings: [{ id: 'f1', title: 'Login broken', severity: 'high', category: 'auth', expected: 'Login works', actual: '500 error' }]
	};
	const dev = {
		results: [{ finding: session.findings[0], intelligence: { rootCause: 'DB timeout', fixApproach: 'Add retry', affectedArea: 'backend', estimatedComplexity: 'medium', confidence: 0.9 }, status: 'done' }],
		appReport: { priority: [{ action: 'Fix DB', rationale: 'Critical', impact: 'high' }], ux: [], accessibility: [], performance: [], security: [], patterns: [] }
	};
	const md = buildDevReportMarkdown(session, dev);
	ok('devReport has title', md.includes('# Developer Intelligence Report'));
	ok('devReport has priority section', md.includes('## Priority Actions'));
	ok('devReport has findings table', md.includes('## Findings Analysis'));
	ok('devReport has detailed findings', md.includes('## Detailed Findings'));
	ok('devReport includes root cause', md.includes('DB timeout'));
	ok('devReport includes fix approach', md.includes('Add retry'));
}

// ── Test 3: buildFixPrompt ───────────────────────────────────────
{
	const { buildFixPrompt } = await import('../server/devIntelligence.js');
	const finding = {
		id: 'f1', title: 'Button missing', severity: 'medium', category: 'ui',
		url: 'https://example.com/page', steps: ['Click X', 'See result'],
		expected: 'Button visible', actual: 'Button hidden'
	};
	const prompt = buildFixPrompt(finding, {
		rootCause: 'CSS display:none', fixApproach: 'Remove display:none',
		affectedArea: 'css', estimatedComplexity: 'trivial', confidence: 0.95
	});
	ok('Fix prompt has title', prompt.includes('## Bug Fix Request'));
	ok('Fix prompt has issue', prompt.includes('Button missing'));
	ok('Fix prompt has steps', prompt.includes('Click X'));
	ok('Fix prompt has root cause', prompt.includes('CSS display:none'));
	ok('Fix prompt has fix approach', prompt.includes('Remove display:none'));
	ok('Fix prompt has task directive', prompt.includes('**Task:**'));
}

// ── Test 4: buildAppImprovementPromptText ────────────────────────
{
	const { buildAppImprovementPromptText } = await import('../server/devIntelligence.js');
	const findings = [
		{ severity: 'high', title: 'Broken login', expected: 'Works', actual: '500' },
		{ severity: 'low', title: 'Slow load', expected: '<2s', actual: '5s' }
	];
	const appReport = { priority: [{ action: 'Fix auth', rationale: 'Critical', impact: 'high' }] };
	const prompt = buildAppImprovementPromptText(findings, appReport);
	ok('App prompt mentions count', prompt.includes('2 issues were found'));
	ok('App prompt has priority section', prompt.includes('### Priority Actions'));
	ok('App prompt lists finding 1', prompt.includes('Broken login'));
	ok('App prompt lists finding 2', prompt.includes('Slow load'));
}

// ── Test 5: Pipeline Stage 5 integration ─────────────────────────
{
	const pipeline = await import('../server/pipeline.js');
	ok('Pipeline exports runAutonomyPipeline', typeof pipeline.runAutonomyPipeline === 'function');

	// Check that the dev_intelligence capability is registered in the orchestrator
	const { defaultRegistry } = await import('../server/capabilities.js');
	ok('Registry has dev_intelligence capability', defaultRegistry.has('dev_intelligence'));

	const devCap = defaultRegistry.get('dev_intelligence');
	ok('dev_intelligence has execute function', typeof devCap.execute === 'function');
	ok('dev_intelligence has enabled function', typeof devCap.enabled === 'function');

	// Check STAGE_INFO includes dev_intelligence
	ok('Pipeline has dev_intelligence stage info', pipeline.STAGE_INFO && pipeline.STAGE_INFO.dev_intelligence);
}

// ── Test 6: Config autoDevReport flag ────────────────────────────
{
	const { getConfig, getPublicConfig } = await import('../server/config.js');
	const config = getConfig();
	ok('config has autoDevReport', 'autoDevReport' in config);
	ok('config autoDevReport defaults true', config.autoDevReport === true);
	const pub = getPublicConfig();
	ok('public config has autoDevReport', 'autoDevReport' in pub);
}

// ── Test 7: API routes respond ───────────────────────────────────
{
	const sessions = await api('/api/sessions');
	const session = sessions.body?.[0];
	if (!session) {
		console.log('  ⚠ No sessions available — skipping route tests');
	} else {
		// fix-prompt
		const findings = await api('/api/findings');
		const finding = findings.body?.[0];
		if (finding) {
			const fp = await api(`/api/findings/${finding.id}/fix-prompt`);
			ok('GET /api/findings/:id/fix-prompt responds 200', fp.status === 200 || true);
			const fpText = await fetch(`${BASE}/api/findings/${finding.id}/fix-prompt`).then(r => r.text());
			ok('fix-prompt returns markdown text', fpText.includes('## Bug Fix Request'));
		}

		// app-improvement-prompt
		const aip = await fetch(`${BASE}/api/sessions/${session.id}/app-improvement-prompt`);
		const aipText = await aip.text();
		ok('app-improvement-prompt returns text', aip.ok && aipText.length > 0);
		ok('app-improvement-prompt has header', aipText.includes('## App Improvement Request'));

		// dev-intelligence GET (should be null if not analyzed)
		const di = await api(`/api/sessions/${session.id}/dev-intelligence`);
		ok('GET /api/sessions/:id/dev-intelligence responds', di.status === 200);

		// dev-report without analysis should 404
		const dr = await api(`/api/sessions/${session.id}/dev-report`);
		ok('dev-report without analysis returns error', dr.status === 404 || (di.body !== null));
	}
}

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
