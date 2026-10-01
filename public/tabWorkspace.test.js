import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/* UI Fix Phase 1 — regression guards for the center tab workspace features
 * that are otherwise browser-verified only: plan status chips and the
 * report export bar. Source-contract tests (same pattern as the existing
 * server/*Ui.test.js suites). */

test('plan items carry readable status chips mapped to the run vocabulary', async () => {
	const app = await readFile('public/app.js', 'utf8');
	const renderTodos = app.slice(app.indexOf('function renderTodos'), app.indexOf('const SEVERITY_ORDER'));
	assert.match(renderTodos, /todo-chip/);
	for (const [status, label] of [['completed', 'Passed'], ['in_progress', 'Running'], ['failed', 'Failed'], ['blocked', 'Blocked']]) {
		assert.match(renderTodos, new RegExp(`${status}: '${label}'`), `missing ${status} → ${label}`);
	}
	assert.match(renderTodos, /\?\? 'Queued'/, 'pending falls back to Queued');
	// Chips are textContent-built (XSS-safe), never innerHTML.
	const chipBlock = renderTodos.slice(renderTodos.indexOf('todo-chip'), renderTodos.indexOf('todo-text'));
	assert.ok(!chipBlock.includes('innerHTML'), 'chip must not use innerHTML');
});

test('report tab exposes an Export report action only when a report exists', async () => {
	const app = await readFile('public/app.js', 'utf8');
	const renderReport = app.slice(app.indexOf('function renderReport()'), app.indexOf('function renderBugs'));
	assert.ok(renderReport.indexOf("if (!report)") < renderReport.indexOf('report-export-bar'), 'export bar must come after the no-report early return');
	assert.match(renderReport, /Export report/);
	assert.match(renderReport, /URL\.revokeObjectURL/);
	assert.match(renderReport, /application\/json/);
});

test('activity feed auto-scroll honours a single toggle source', async () => {
	const app = await readFile('public/app.js', 'utf8');
	assert.match(app, /function feedAutoScrolls\(feed\) \{\s*\n\treturn autoScrollState\.activity;/);
	assert.match(app, /const autoScrollState = \{ activity: true \};/);
});
