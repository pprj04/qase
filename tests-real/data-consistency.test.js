import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	findingMetrics, regressionMetrics, regressionTrendPoints,
	scheduleMetrics, testCaseMetrics, workflowMetrics
} from '../server/dataMetrics.js';
import { paginateList } from '../server/pagination.js';
import { projectRegressionRun, projectTrendPoint } from '../server/pulseProjection.js';
import { parseMetricCollection, parseRegressionTrend } from '../public/metricResponses.js';

test('workflows: zero rows produce zero totals', () => {
	assert.deepEqual(workflowMetrics([]), { total: 0, totalSteps: 0, targets: 0 });
});

test('workflows: summary counts workflows, steps, and distinct targets', () => {
	const rows = [
		{ stepCount: 2, targetUrl: 'https://a.test' },
		{ stepCount: 3, targetUrl: 'https://a.test/another/path' },
		{ stepCount: 1, targetUrl: 'https://b.test' }
	];
	assert.deepEqual(workflowMetrics(rows), { total: 3, totalSteps: 6, targets: 2 });
});

test('workflows: pagination retains the scoped total', () => {
	const rows = Array.from({ length: 73 }, (_, id) => ({ id }));
	const { body } = paginateList(rows, { limit: '25', offset: '25' });
	assert.equal(body.items.length, 25);
	assert.equal(body.total, workflowMetrics(rows).total);
});

test('workflows: project filtering drives both list and summary scope', () => {
	const rows = [{ projectId: 'a' }, { projectId: 'a' }, { projectId: 'b' }];
	const scoped = rows.filter(row => row.projectId === 'a');
	assert.equal(workflowMetrics(scoped).total, scoped.length);
});

test('workflows: search filtering drives both visible list and summary', () => {
	const rows = [{ name: 'Login' }, { name: 'Checkout' }];
	const scoped = rows.filter(row => row.name.toLowerCase().includes('login'));
	assert.equal(workflowMetrics(scoped).total, 1);
});

test('tests: no referenced suites produces zero', () => {
	assert.equal(testCaseMetrics([{ id: 't1', suiteId: null }], []).suites, 0);
});

test('tests: one referenced suite counts once', () => {
	assert.equal(testCaseMetrics([{ suiteId: 's1' }], [{ id: 's1', name: 'Auth' }]).suites, 1);
});

test('tests: duplicate normalized suite names count once', () => {
	const tests = [{ suiteId: 's1' }, { suiteId: 's2' }];
	const suites = [{ id: 's1', name: ' Auth ' }, { id: 's2', name: 'auth' }];
	assert.equal(testCaseMetrics(tests, suites).suites, 1);
});

test('tests: multiple distinct suite names count separately', () => {
	const tests = [{ suiteId: 's1' }, { suiteId: 's2' }];
	const suites = [{ id: 's1', name: 'Auth' }, { id: 's2', name: 'Checkout' }];
	assert.equal(testCaseMetrics(tests, suites).suites, 2);
});

test('tests: empty, whitespace, null, and orphan suites are excluded', () => {
	const tests = [{ suiteId: 's1' }, { suiteId: 's2' }, { suiteId: 'missing' }];
	const suites = [{ id: 's1', name: ' ' }, { id: 's2', name: null }];
	assert.equal(testCaseMetrics(tests, suites).suites, 0);
});

test('tests: suite metric is independent of the rendered 25-card page', () => {
	const tests = Array.from({ length: 60 }, (_, i) => ({ suiteId: i < 30 ? 's1' : 's2' }));
	const suites = [{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }];
	assert.equal(testCaseMetrics(tests, suites).suites, 2);
	assert.equal(testCaseMetrics(tests.slice(0, 25), suites).suites, 1);
});

test('tests: project/filter scope controls total and suite count together', () => {
	const tests = [{ projectId: 'a', suiteId: 's1' }, { projectId: 'b', suiteId: 's2' }];
	const suites = [{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }];
	assert.deepEqual(testCaseMetrics(tests.filter(row => row.projectId === 'a'), suites), {
		total: 1, suites: 1, assignedToSuite: 1
	});
});

test('schedules: zero rows produce truthful zero counts', () => {
	assert.deepEqual(scheduleMetrics([]), { total: 0, active: 0, testAssignments: 0 });
});

test('schedules: active means enabled is exactly true', () => {
	const rows = [{ enabled: true }, { enabled: false }, { enabled: true }, {}];
	assert.equal(scheduleMetrics(rows).active, 2);
});

test('schedules: test assignments sum across the scoped schedules', () => {
	const rows = [{ testCaseIds: ['a', 'b'] }, { testCaseIds: ['c'] }];
	assert.equal(scheduleMetrics(rows).testAssignments, 3);
});

test('regression: zero executions have no pass-rate value', () => {
	assert.equal(regressionMetrics([]).passRate, null);
	assert.equal(regressionTrendPoints([{ total: 0 }])[0].passRate, null);
});

test('regression: all completed executions passing is 100%', () => {
	assert.equal(regressionMetrics([{ passed: 4, failed: 0, errored: 0 }]).passRate, 100);
});

test('regression: all completed executions failing is 0%', () => {
	assert.equal(regressionMetrics([{ passed: 0, failed: 4, errored: 0 }]).passRate, 0);
});

test('regression: mixed pass, fail, and provider error use one denominator', () => {
	const summary = regressionMetrics([{ passed: 2, failed: 1, errored: 1 }]);
	assert.equal(summary.completedExecutions, 4);
	assert.equal(summary.passRate, 50);
});

test('regression: queued, running, cancelled, and skipped rows do not enter the denominator', () => {
	const rows = ['queued', 'running', 'cancelled', 'skipped'].map(status => ({ status, passed: 8, total: 8 }));
	assert.equal(regressionMetrics(rows).completedExecutions, 0);
	assert.equal(regressionMetrics(rows).passRate, null);
});

test('regression: trend points and summary use the same calculation', () => {
	const rows = [{ ts: 1, passed: 1, failed: 1 }, { ts: 2, passed: 3, errored: 1 }];
	const points = regressionTrendPoints(rows);
	assert.deepEqual(points.map(point => point.passRate), [50, 75]);
	assert.equal(regressionMetrics(rows).passRate, 67);
});

test('regression: v2 projections preserve no-data and use completed executions', () => {
	assert.equal(projectTrendPoint({ ts: 1, total: 9, passed: 0, failed: 0, errored: 0, passRate: null }).pass_rate, null);
	const run = projectRegressionRun({ ts: 1, total: 9, passed: 2, failed: 1, errored: 1 });
	assert.equal(run.completed, 4);
	assert.equal(run.pass_rate, 50);
});

test('regression: adding a completed run refreshes the aggregate', () => {
	const rows = [{ passed: 1, failed: 1 }];
	assert.equal(regressionMetrics(rows).passRate, 50);
	rows.push({ passed: 2 });
	assert.equal(regressionMetrics(rows).passRate, 75);
});

test('findings: canonical and duplicate totals reconcile', () => {
	assert.deepEqual(findingMetrics([
		{ id: 'a' },
		{ id: 'b', isDuplicate: true },
		{ id: 'c', duplicateOf: 'a' }
	]), { total: 3, canonical: 1, duplicates: 2 });
});

test('findings: bounded page length is distinct from the scoped total', () => {
	const rows = Array.from({ length: 61 }, (_, id) => ({ id }));
	const { body } = paginateList(rows, { limit: '25' });
	assert.equal(body.items.length, 25);
	assert.equal(body.total, findingMetrics(rows).total);
});

test('error safety: malformed collection metrics are rejected', () => {
	assert.throws(() => parseMetricCollection({ items: [], total: 1, metrics: { total: 0 } }, 'test'), /invalid/);
	assert.throws(() => parseMetricCollection({ total: 0, metrics: { total: 0 } }, 'test'), /invalid/);
});

test('error safety: malformed trend metrics are rejected instead of becoming 0%', () => {
	assert.throws(() => parseRegressionTrend({ items: [] }), /invalid/);
	assert.throws(() => parseRegressionTrend({ items: [], metrics: {} }), /invalid/);
});
