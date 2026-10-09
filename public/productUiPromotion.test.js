import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [markup, app, mode, workspaceStyles, embedStyles] = await Promise.all([
	readFile(new URL('./index.html', import.meta.url), 'utf8'),
	readFile(new URL('./app.js', import.meta.url), 'utf8'),
	readFile(new URL('./studioMode.js', import.meta.url), 'utf8'),
	readFile(new URL('./studio-workspace.css', import.meta.url), 'utf8'),
	readFile(new URL('./studio-embed.css', import.meta.url), 'utf8')
]);

test('default Qase owns the shared product workspace', () => {
	assert.match(markup, /<body class="cli-theme studio-workspace" data-has-run="false">/);
	assert.match(workspaceStyles, /body\.studio-workspace\[data-run-status="running"\] \.app/);
	assert.match(workspaceStyles, /body\.studio-workspace\[data-run-status="done"\] \.app/);
	assert.match(workspaceStyles, /body\.studio-workspace:is\(\[data-run-status="running"\], \[data-run-status="done"\]\) \.app/);
});

test('customer navigation collapse works outside the Studio wrapper', () => {
	assert.match(mode, /sidebarPreferenceKey = 'qase\.sidebar'/);
	assert.match(mode, /document\.documentElement\.dataset\.qaseSidebar = sidebarPreference/);
	assert.ok(mode.indexOf("dataset.qaseSidebar = sidebarPreference") < mode.indexOf('if (enabled) {'));
	assert.match(workspaceStyles, /html\[data-qase-sidebar="collapsed"\] body\.studio-workspace \.app/);
});

test('normal customer surfaces keep technical duplicates out of the permanent layout', () => {
	for (const id of ['#token-chip', '#live-pill', '#execution-target-block', '#ldv-exec', '#ldv-change-device']) {
		assert.match(workspaceStyles, new RegExp(id.replace('#', '#')));
	}
	assert.match(markup, /<summary>Run details<\/summary>/);
	assert.match(app, /Model usage: \$\{usage\}/);
});

test('default empty state is concise and has one desktop primary launcher', () => {
	assert.match(markup, /<h2>Test a website<\/h2>/);
	assert.doesNotMatch(markup, /class="empty-note"/);
	assert.match(workspaceStyles, /\.empty-actions #empty-start \{ display: none/);
	assert.match(workspaceStyles, /data-has-run="false"\] \.viewer :is\(#tabs, \.tab-body\)/);
	assert.match(app, /state\.sessionId && \(session\.targetUrl \|\| session\.title\)/);
	assert.match(app, /dataset\.hasRun = String\(hasRun\)/);
	assert.match(app, /statusChip\.hidden = !hasRun/);
	assert.doesNotMatch(app, /checklist\.append/);
});

test('the Studio stylesheet remains a host wrapper', () => {
	assert.match(embedStyles, /\.studio-host-rail/);
	assert.match(embedStyles, /\.studio-context/);
	assert.match(embedStyles, /\.studio-tool-workspace/);
	assert.doesNotMatch(embedStyles, /#execution-target-block/);
	assert.doesNotMatch(embedStyles, /\.welcome-checklist/);
});

test('customer preview and statuses use plain language', () => {
	assert.match(markup, /id="ldv-title">Preview<\/span>/);
	for (const label of ['Running', 'Complete', 'Needs attention']) assert.match(app, new RegExp(`'${label}'`));
	assert.match(app, /hasSavedPreview \? 'Saved'/);
	assert.match(app, /completed \? 'Complete' : 'Idle'/);
	assert.doesNotMatch(app.slice(app.indexOf('const statusMap = {'), app.indexOf('const liveLabel =')), /●|◆|✕/);
});

test('the workspace exposes one polished theme action', () => {
	assert.match(markup, /id="theme-toggle"[^>]+aria-label="Switch to dark theme"/);
	assert.match(markup, /id="theme-toggle-text">Light</);
	assert.doesNotMatch(markup, /id="theme-select"/);
	assert.match(app, /themeStore\.applied\(\) === 'dark' \? 'light' : 'dark'/);
});

test('the customer sidebar stays focused and collapses cleanly', () => {
	for (const removedId of ['sidebar-view-report', 'sidebar-retest', 'perf-panel', 'perf-restore']) {
		assert.doesNotMatch(markup, new RegExp(`id="${removedId}"`));
	}
	assert.match(app, /age\.className = 'run-age'/);
	assert.match(workspaceStyles, /grid-template-columns: 64px/);
	assert.match(workspaceStyles, /data-qase-sidebar="collapsed"[^}]+\.brand-mark \{ display: none/);
});
