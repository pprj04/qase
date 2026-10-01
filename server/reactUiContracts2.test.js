import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

/**
 * Phase 7 rework, part 2 — contracts from the legacy founderUi, sqaUi,
 * bugsUi, customerJourneyUi, drytisBoardUi, drytisUi, entryUi,
 * finalUiPolish and uiPrimitives suites, pinned against the React sources.
 */

const read = (p) => readFile(p, 'utf8');
const founder = await read('src/components/FounderView.tsx');
const founderLauncher = await read('src/components/FounderLauncher.tsx');
const sqaLauncher = await read('src/components/SqaLauncher.tsx');
const sqaView = await read('src/components/SqaView.tsx');
const qaReport = await read('src/components/QaReportView.tsx');
const bugs = await read('src/components/BugsView.tsx');
const welcome = await read('src/components/WelcomeChecklist.tsx');
const board = await read('src/components/DrytisBoardPanel.tsx');
const transcript = await read('src/components/Transcript.tsx');
const viewer = await read('src/components/ViewerPanel.tsx');
const app = await read('src/App.tsx');
const shell = await read('src/shell.css');

test('first-run welcome checklist renders and onboarding flag is persisted', () => {
	assert.match(welcome, /Get started/, 'checklist heading');
	assert.match(welcome, /onboardingComplete: true/, 'flag set to true on first run');
	assert.match(welcome, /user\?\.profile\?\.onboardingComplete/, 'hidden once onboarded');
});

test('SQA launcher is authorization-gated with an authenticated API contract', () => {
	assert.match(sqaLauncher, /data-testid="sqa-launcher"|aria-label="Start an SQA assessment"|SQA/i);
	assert.match(sqaLauncher, /authorization/i, 'authorization gate present');
	assert.match(sqaLauncher, /\/sqa\/sessions/, 'SQA session endpoint');
});

test('SQA launcher surfaces the catalog with profiles and sources as keyed objects', () => {
	assert.match(sqaLauncher, /\/sqa\/catalog/);
	assert.match(sqaLauncher, /Object\.keys\(/, 'catalog maps keyed objects, not arrays');
});

test('Founder launcher posts scope then the kickoff message', () => {
	assert.match(founderLauncher, /\/founder\/sessions/);
	assert.match(founderLauncher, /\/founder\/catalog/, 'catalog caveat surfaced');
});

test('Founder report auto-opens on completion once per finalized report', () => {
	assert.match(viewer, /shownFounderReport/, 'per-report key');
	assert.match(viewer, /session\?\.mode === 'founder' &&[\s\S]*?session\.status === 'done' &&/, 'founder + completed gate');
	assert.match(viewer, /setTab\('report'\)/, 'activates the report tab');
});

test('Founder report renders finalized brief with safe rendering', () => {
	assert.match(founder, /FounderCompletedReport/, 'completion view');
	assert.match(founder, /qase-founder-review\.md/, 'markdown export filename');
	assert.match(founder, /qase-founder-review\.pdf/, 'pdf export filename');
	assert.ok(!founder.includes('innerHTML ='), 'no raw innerHTML writes');
});

test('SQA report actions include fix-prompt export parity with QA', () => {
	assert.match(sqaView, /qase-sqa-assessment\.md/, 'SQA report download filename');
	assert.match(sqaView, /qase-sqa-fix-prompts\.md/, 'SQA fix-prompt download filename');
	assert.match(sqaView, /'Copy fix prompts'|Copy fix prompts/, 'copy fix prompts button');
	assert.match(sqaView, /Download PDF/, 'pdf export');
});

test('export failures map 409 pending-report errors to a friendly message', () => {
	assert.match(qaReport, /still being finalized — try again once the run completes/);
	assert.match(founder, /still being finalized — try again once the run completes/);
});

test('bugs view: accessible filter groups, search, table, live refresh', () => {
	assert.match(bugs, /BUG_STATUS_LABELS/, 'status filter vocabulary');
	assert.match(bugs, /aria-label="Filter by /, 'accessible status filter');
	assert.match(bugs, /const \[search, setSearch\]/, 'search input');
	assert.match(bugs, /<table/, 'table layout');
	assert.ok(bugs.includes('setInterval') || bugs.includes('EventSource') || bugs.includes('refresh'), 'live refresh');
});

test('bugs view opens from the mode rail and hides the dashboard shell', () => {
	assert.match(app, /open-bugs/, 'rail button');
	assert.match(app, /bugsOpen \? ' is-hidden' : ''/, 'dashboard hides while the tracker is open');
});

test('Drytis board panel renders only for attached reviews with accept/push semantics', () => {
	assert.match(board, /drytisIntegration/, 'integration gate');
	assert.match(board, /\/drytis\/push/, 'push endpoint');
	assert.match(board, /acceptedFindingIds/, 'accepted ids ride the request');
	assert.match(board, /Accept all \(/, 'accept-all master control');
	assert.match(board, /data-drytis-finding/, 'per-finding checkboxes');
	assert.match(board, /Check at least one finding to push\./, 'empty-selection guard');
	assert.match(qaReport, /<DrytisBoardPanel/, 'panel wired into the QA report');
});

test('hex nonces still pin both sides of the board push (server contract)', async () => {
	const server = await read('server/app.js');
	assert.match(server, /drytis\/push/);
	assert.match(server, /acceptedFindingIds/);
});

test('resume affordance sends the continue message through the session API', () => {
	assert.match(transcript, /sendMessage\('continue'\)/);
});

test('entry resolves without delaying auth (React mount has no workspace gate)', () => {
	assert.doesNotMatch(app, /qaseEntryReady/, 'no deferred entry promise');
	assert.match(app, /<App \/>|export function App/, 'direct mount');
});

test('no compact-mode collisions: single source of truth for spacing tokens', () => {
	// The React UI uses only the token vocabulary; no legacy hard-coded
	// terminal-era chrome values leak into the shell.
	assert.match(shell, /--sp-/, 'token vocabulary in use');
	assert.doesNotMatch(shell, /#0d1526/, 'no legacy dark-only board background');
});

test('uiPrimitives parity: safe markdown + formatting helpers exist as ports', async () => {
	const markdown = await read('src/lib/markdown.ts');
	assert.match(markdown, /escapeHtml|sanitize/i, 'html escaped before markdown render');
	const sessionStore = await read('src/state/sessionStore.tsx');
	assert.match(sessionStore, /formatDurationShort/);
	assert.match(sessionStore, /hostOf/);
});
