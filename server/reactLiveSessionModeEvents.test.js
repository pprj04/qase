import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/**
 * The reducer lives inside liveSession.tsx alongside React context code.
 * Extract the PURE section (LiveSession types + LiveAction + liveReducer) by
 * slicing between known markers, stub the imports, compile to plain JS, and
 * import it. This keeps the test honest: it exercises the real source text.
 */
const source = readFileSync(join(root, 'src/state/liveSession.tsx'), 'utf8');
const start = source.indexOf('export interface LiveSession {');
const endMarker = 'interface LiveContextValue';
const end = source.indexOf(endMarker);
assert.ok(start > 0 && end > start, 'liveSession.tsx reducer markers not found');
const slice = source
	.slice(start, end)
	// Rewrite the two type-only imports referenced by the slice.
	.replace('import type { RunSummary } from \'./sessionStore\';', '');

const dir = mkdtempSync(join(tmpdir(), 'qase-reducer-'));
writeFileSync(join(dir, 'reducer.ts'), `
type SessionMessage = { id: string; role: string; [key: string]: unknown };
type SessionActivity = { id: string; label?: string; detail?: string; status?: string; [key: string]: unknown };
type Finding = { id: string; title?: string; severity?: string; [key: string]: unknown };
type ConnectionState = 'connecting' | 'connected' | 'reconnecting';
${slice}
`);
const out = join(dir, 'out');
execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--strict', 'false', '--skipLibCheck', '--outDir', out, join(dir, 'reducer.ts')], { stdio: 'pipe', cwd: root });
const { liveReducer } = await import(`file://${join(out, 'reducer.js')}`);

const baseSession = { id: 'run-1', status: 'idle', messages: [], deltas: {}, thinkingText: '', thinkingAction: '', findings: [], pendingQuestion: undefined };

test('sqa event stores the assessment and only finalizes on the final flag', () => {
	let state = { session: { ...baseSession }, connection: 'connected', skewMs: 0 };
	state = liveReducer(state, { type: 'sqa', assessment: { verdict: 'blocked' }, final: false, ts: 1 });
	assert.equal(state.session.mode, 'sqa');
	assert.equal(state.session.sqa.assessment.verdict, 'blocked');
	assert.equal(state.session.sqa.finalizedAt, undefined);

	state = liveReducer(state, { type: 'sqa', assessment: { verdict: 'pass' }, final: true, ts: Date.UTC(2026, 0, 1) });
	assert.equal(state.session.sqa.finalizedAt, '2026-01-01T00:00:00.000Z');

	// A subsequent non-final event clears finalization again (legacy parity).
	state = liveReducer(state, { type: 'sqa', assessment: { verdict: 'blocked' }, final: false, ts: 2 });
	assert.equal(state.session.sqa.finalizedAt, undefined);
});

test('founder events update mode, scope, observations, and finalization', () => {
	let state = { session: { ...baseSession }, connection: 'connected', skewMs: 0 };
	state = liveReducer(state, { type: 'founder.created', schemaVersion: 2, categories: ['icp', 'positioning'] });
	assert.equal(state.session.mode, 'founder');
	assert.deepEqual(state.session.founder.scope.categories, ['icp', 'positioning']);

	state = liveReducer(state, { type: 'founder.target_bound', targetUrl: 'https://example.com', authorizedTargetUrl: 'https://example.com', title: 'Example' });
	assert.equal(state.session.targetUrl, 'https://example.com');
	assert.equal(state.session.founder.scope.target.url, 'https://example.com');

	state = liveReducer(state, { type: 'founder.observation', observation: { id: 'obs-1', title: 'Slow onboarding' } });
	assert.equal(state.session.founder.observations.length, 1);
	// Upsert by id — never duplicates.
	state = liveReducer(state, { type: 'founder.observation', observation: { id: 'obs-1', title: 'Slow onboarding (updated)' } });
	assert.equal(state.session.founder.observations.length, 1);
	assert.equal(state.session.founder.observations[0].title, 'Slow onboarding (updated)');

	state = liveReducer(state, { type: 'founder.finalized', report: { generatedAt: '2026-02-02T00:00:00.000Z' }, ts: 3 });
	assert.equal(state.session.founder.report.generatedAt, '2026-02-02T00:00:00.000Z');
	assert.equal(state.session.founder.finalizedAt, '2026-02-02T00:00:00.000Z');
});

test('snapshot carries sqa/founder/activities through to the session', () => {
	const state = liveReducer(
		{ session: undefined, connection: 'connected', skewMs: 0 },
		{ type: 'session/snapshot', session: { id: 'run-9', status: 'done', mode: 'sqa', sqa: { finalizedAt: '2026-03-03T00:00:00.000Z', assessment: { verdict: 'pass' } }, activities: [{ id: 'a1' }], feedback: { rating: 'up' } } },
	);
	assert.equal(state.session.mode, 'sqa');
	assert.equal(state.session.sqa.finalizedAt, '2026-03-03T00:00:00.000Z');
	assert.equal(state.session.activities.length, 1);
	assert.equal(state.session.feedback.rating, 'up');
});
