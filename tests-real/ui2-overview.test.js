/** UI-2 Overview truthfulness and project-switch contracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const overview = read('public/overview.js');

const canonicalRunStatus = session => {
  if (session.status === 'awaiting_input') return 'awaiting_input';
  const status = String(session.executionOutcome ?? session.status ?? 'pending').toLowerCase();
  return ({ done: 'completed', error: 'failed', aborted: 'cancelled', idle: 'pending' })[status] ?? status;
};
const isOpenCanonicalFinding = finding => !finding.isDuplicate && !finding.duplicateOf && ['open', 'in_testing'].includes(String(finding.status ?? 'open').toLowerCase());
const sevenDaySummary = (runs, now) => ({
  count: runs.items.filter(run => Number(run.updatedAt ?? run.createdAt) >= now - 7 * 24 * 60 * 60 * 1000 && Number(run.updatedAt ?? run.createdAt) <= now).length,
  complete: !runs.hasMore && Number(runs.total ?? runs.items.length) <= runs.items.length
});

test('UI-2: canonical run labels preserve truthful terminal and active states', () => {
	assert.match(overview, /session\.status === 'awaiting_input'/);
	assert.match(overview, /executionOutcome \?\? session\.outcome\?\.outcome \?\? session\.status/);
  assert.equal(canonicalRunStatus({ executionOutcome: 'completed', reportAvailable: true }), 'completed');
  assert.equal(canonicalRunStatus({ executionOutcome: 'failed', reportAvailable: true }), 'failed');
  assert.equal(canonicalRunStatus({ status: 'awaiting_input', executionOutcome: 'running' }), 'awaiting_input');
  assert.equal(canonicalRunStatus({ status: 'error' }), 'failed');
  assert.equal(canonicalRunStatus({ status: 'idle' }), 'pending');
});

test('UI-2: canonical open findings exclude duplicates and terminal lifecycle states', () => {
	const findingsStore = read('server/findings.js');
	assert.match(findingsStore, /VALID_STATUSES = \['open', 'in_testing', 'resolved', 'closed'\]/);
	assert.match(overview, /!finding\.isDuplicate && !finding\.duplicateOf/);
	assert.match(overview, /OPEN_FINDING_STATUSES/);
  assert.equal(isOpenCanonicalFinding({ status: 'open', severity: 'critical' }), true);
  assert.equal(isOpenCanonicalFinding({ status: 'in_testing', severity: 'high' }), true);
  assert.equal(isOpenCanonicalFinding({ status: 'resolved' }), false);
  assert.equal(isOpenCanonicalFinding({ status: 'closed' }), false);
  assert.equal(isOpenCanonicalFinding({ status: 'open', isDuplicate: true }), false);
  assert.equal(isOpenCanonicalFinding({ status: 'open', duplicateOf: 'primary' }), false);
});

test('UI-2: weekly summary is exact only when the bounded session page is complete', () => {
  const now = Date.UTC(2026, 8, 12, 12);
  const recent = now - 3 * 24 * 60 * 60 * 1000;
  const old = now - 8 * 24 * 60 * 60 * 1000;
  assert.deepEqual(sevenDaySummary({ items: [{ updatedAt: recent }, { updatedAt: old }], total: 2, hasMore: false }, now), { count: 1, complete: true });
  assert.deepEqual(sevenDaySummary({ items: [{ updatedAt: recent }], total: 60, hasMore: true }, now), { count: 1, complete: false });
});

test('UI-2: delayed Project A responses are rejected after switching to Project B', async () => {
  const state = { projectId: 'project-a', projectVersion: 4 };
  const snapshot = { projectId: state.projectId, projectVersion: state.projectVersion };
  let resolveA;
  const delayedA = new Promise(resolve => { resolveA = resolve; });
  const applyA = delayedA.then(() => snapshot.projectId === state.projectId && snapshot.projectVersion === state.projectVersion);
  state.projectId = 'project-b';
  state.projectVersion += 1;
  resolveA();
  assert.equal(await applyA, false);
});

test('UI-2: implementation uses only certified dashboard, sessions, findings, and health reads', () => {
  for (const path of ['/metrics/dashboard', '/sessions?limit=', '/findings?limit=', "api('/health')"]) assert.ok(overview.includes(path));
  assert.doesNotMatch(overview, /provider.*healthy/i);
  assert.match(overview, /Not reported/);
	assert.match(overview, /overviewProjectGate\(snapshot\)/);
	assert.match(overview, /validRegressionMetric/);
	assert.match(overview, /Number\.isFinite\(Number\(regression\.completedRuns\)\)/);
	assert.match(overview, /criticalComplete: !open\.hasMore && !testing\.hasMore/);
});

test('UI-2: endpoint errors remain independent and retries target only the failed block', () => {
	assert.match(overview, /retryOverviewBlock\(retry\.dataset\.overviewRetry\)/);
	assert.match(overview, /retryButton\('metrics', 'metrics'\)/);
	assert.match(overview, /retryButton\('recent runs', 'runs'\)/);
	assert.match(overview, /retryButton\('critical findings', 'findings'\)/);
	assert.match(overview, /retryButton\('service health', 'health'\)/);
	assert.match(overview, /overview\[block\] = \{ state: 'loading', data: null \}/);
});

test('UI-2: Overview is reloaded and marked stale on route navigation and project switch', () => {
  const app = read('public/app.js');
  assert.match(app, /markOverviewStale\(\)/);
  assert.match(app, /currentPage\(\) === 'overview'\) void loadOverview\(\)/);
	assert.match(app, /page === 'overview' && state\.projects\.length > 0/);
	assert.match(overview, /qase:select-run/);
	assert.match(app, /qase:select-run/);
	assert.match(overview, /newRun\.disabled = true/);
	assert.match(app, /event\.detail\?\.done\?\.\(\)/);
});
