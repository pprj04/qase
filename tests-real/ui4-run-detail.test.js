/** UI-4 Run Detail truthfulness, continuation, stale-state, and layout contracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	authenticationChallengePresentation,
	buildCredentialFields,
	browserHistoryPresentation,
	canonicalRunPresentation,
	currentFindingPresentation,
	evidenceScreenshotUrl,
	executionHealthPresentation,
	isCurrentRunView,
	normalizeGeneratedReportMarkdown,
	reportPresentation,
	runMetricPresentation,
	runViewSnapshot
} from '../public/runDetail.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const app = read('public/app.js');
const detail = read('public/executionDetail.js');
const html = read('public/index.html');
const css = read('public/styles.css');
const router = read('public/router.js');
const server = read('server/index.js');

test('UI-4: queued run uses the canonical Queued presentation', () => {
	assert.deepEqual(canonicalRunPresentation({ executionOutcome: 'queued' }), { key: 'queued', label: 'Queued' });
});

test('UI-4: running run uses the canonical Running presentation', () => {
	assert.equal(canonicalRunPresentation({ executionOutcome: 'running' }).label, 'Running');
});

test('UI-4: awaiting input outranks a stale running outcome', () => {
	assert.equal(canonicalRunPresentation({ status: 'awaiting_input', executionOutcome: 'running' }).key, 'awaiting_input');
	assert.equal(canonicalRunPresentation({ status: 'waiting_for_input', executionOutcome: 'running' }).label, 'Awaiting Input');
});

test('UI-4: completed run uses the canonical Completed presentation', () => {
	assert.equal(canonicalRunPresentation({ executionOutcome: 'completed' }).label, 'Completed');
});

test('UI-4: timeout and incomplete canonical facts present as Partial', () => {
	assert.equal(canonicalRunPresentation({ executionOutcome: 'timeout' }).key, 'partial');
	assert.equal(canonicalRunPresentation({ executionOutcome: 'incomplete' }).label, 'Partial');
});

test('UI-4: blocked run remains Blocked even when a report exists', () => {
	assert.equal(canonicalRunPresentation({ executionOutcome: 'blocked', reportAvailable: true }).label, 'Blocked');
});

test('UI-4: failed run remains Failed even when a report exists', () => {
	assert.equal(canonicalRunPresentation({ executionOutcome: 'failed', reportAvailable: true }).label, 'Failed');
});

test('UI-4: cancellation aliases present as Cancelled', () => {
	for (const status of ['cancelled', 'canceled', 'aborted', 'stopped']) {
		assert.equal(canonicalRunPresentation({ executionOutcome: status }).key, 'cancelled');
	}
});

test('UI-4: interrupted and unknown historical states never become success', () => {
	assert.equal(canonicalRunPresentation({ status: 'interrupted' }).label, 'Interrupted');
	assert.equal(canonicalRunPresentation({ status: 'interrupted', interruptedReason: 'Process restarted', executionOutcome: 'failed' }).label, 'Interrupted');
	assert.equal(canonicalRunPresentation({ status: 'legacy_unknown', report: {} }).key, 'interrupted');
});

test('UI-4 CANONICAL OUTCOME PRESENTATION: canonical outcome wins over legacy terminal status', () => {
	assert.equal(canonicalRunPresentation({ executionOutcome: 'failed', status: 'done' }).key, 'failed');
	assert.doesNotMatch(html.slice(html.indexOf('id="page-runs"'), html.indexOf('id="page-tests"')), />DONE</i);
});

test('UI-4: report availability is independent from failed execution', () => {
	const view = reportPresentation({ executionOutcome: 'failed', reportAvailable: true });
	assert.equal(view.available, true);
	assert.equal(view.execution.key, 'failed');
});

test('UI-4: completed execution may truthfully have no report', () => {
	const view = reportPresentation({ executionOutcome: 'completed', reportAvailable: false });
	assert.equal(view.available, false);
	assert.equal(view.execution.key, 'completed');
});

test('UI-4 REPORT/OUTCOME INDEPENDENCE: report rendering states execution separately', () => {
	assert.match(app, /Report available — execution failed/);
	assert.match(app, /Execution: \$\{reportState\.execution\.label\}/);
	assert.doesNotMatch(app, /reportAvailable[^\n]*(?:executionOutcome\s*=\s*['"]completed|status\s*=\s*['"]done)/);
});

test('UI-4: generated report fallback uses the certified current execution outcome', () => {
	const source = '# Qase report\n- **Execution outcome:** failed\n- **Report:** available';
	const normalized = normalizeGeneratedReportMarkdown(source, { executionOutcome: 'partial' });
	assert.match(normalized, /Execution outcome:\*\* Partial/);
	assert.doesNotMatch(normalized, /Execution outcome:\*\* failed/i);
	assert.match(app, /normalizeGeneratedReportMarkdown\(markdownText, session\)/);
	assert.match(app, /Report available — execution \$\{reportState\.execution\.label\.toLowerCase\(\)\}/);
});

test('UI-4 CURRENT FINDING COUNT TRUTHFULNESS: certified current count is authoritative', () => {
	assert.deepEqual(currentFindingPresentation({ findingCount: 6, findings: [] }), { value: 6, semantics: 'canonical_current', canonical: true });
	assert.equal(runMetricPresentation({ findingCount: 6 }).findings.value, 6);
});

test('UI-4: historical finding fallback excludes duplicates', () => {
	const view = currentFindingPresentation({ findings: [{ id: 'a' }, { id: 'dup', duplicateOf: 'a' }, { id: 'b' }] });
	assert.equal(view.value, 2);
	assert.equal(view.canonical, false);
});

test('UI-4: report snapshot and current finding counts remain distinct', () => {
	const view = reportPresentation({ findingCount: 7, findingSnapshotCount: 7, reportAvailable: true, report: { findingsSnapshotCount: 4 } });
	assert.deepEqual([view.currentFindingCount, view.snapshotFindingCount, view.snapshotDiffers], [7, 4, true]);
	assert.match(app, /Report snapshot:/);
});

test('UI-4: execution health renders only the four certified run components', () => {
	const view = executionHealthPresentation({ executionHealth: { overall: 'healthy', components: { provider: 'healthy', worker: 'degraded', browser: 'failed', target: 'pending' } } });
	assert.deepEqual(view.components.map(item => item.name), ['provider', 'worker', 'browser', 'target']);
	assert.deepEqual(view.components.map(item => item.label), ['Healthy', 'Degraded', 'Unavailable', 'Not reported']);
});

test('UI-4: execution health redacts secret-like diagnostics and raw trace lines', () => {
	const view = executionHealthPresentation({ executionHealth: { lastIssue: { summary: 'token=abc123\n at privateFunction (secret.js:1)' } } });
	assert.equal(view.reason, 'token=[redacted]');
	assert.doesNotMatch(view.reason, /abc123|privateFunction/);
});

test('UI-4: live frame has precedence in browser presentation', () => {
	assert.equal(browserHistoryPresentation({ frame: { base64: 'x' } }, { items: [] }).key, 'live');
});

test('UI-4 LIVE/HISTORICAL BROWSER TRUTHFULNESS: persisted screenshot replaces disconnected live view', () => {
	const item = { metadata: { artifact: { id: 'shot-1' }, screenshotPersisted: true } };
	const view = browserHistoryPresentation({ executionOutcome: 'completed' }, { loaded: true, items: [item] });
	assert.equal(view.key, 'persisted');
	assert.match(view.title, /Live browser disconnected/);
	assert.equal(view.imageUrl, '/api/v1/artifacts/shot-1/content');
});

test('UI-4: protected evidence helpers never create a direct filesystem URL', () => {
	assert.equal(evidenceScreenshotUrl({ metadata: { artifact: { id: 'a/b' } } }), '/api/v1/artifacts/a%2Fb/content');
	assert.equal(evidenceScreenshotUrl({ metadata: { artifactPath: 'run/shot.png' } }), '/api/artifacts/run/shot.png');
});

test('UI-4: browser has not started only after evidence confirms no history', () => {
	const pending = browserHistoryPresentation({ executionOutcome: 'queued' }, { loaded: false, items: [] });
	const confirmed = browserHistoryPresentation({ executionOutcome: 'blocked' }, { loaded: true, items: [] });
	assert.match(pending.detail, /Waiting/);
	assert.equal(confirmed.detail, 'No screenshot evidence captured.');
});

test('UI-4: evidence loading and error have explicit non-success states', () => {
	assert.equal(browserHistoryPresentation({}, { loading: true }).key, 'loading');
	assert.equal(browserHistoryPresentation({}, { error: { message: 'store unavailable' } }).key, 'unavailable');
});

test('UI-4: browser dependency failure presents a truthful blocked reason', () => {
	const view = browserHistoryPresentation({ executionOutcome: 'blocked', executionHealth: { components: { browser: 'blocked' }, lastIssue: { summary: 'Chromium dependency missing' } } });
	assert.equal(view.key, 'blocked');
	assert.match(view.detail, /dependency missing/i);
});

test('UI-4: general pending question stays a normal Awaiting Input prompt', () => {
	assert.deepEqual(authenticationChallengePresentation({ question: 'Which account should be tested?' }, 'https://app.test'), { kind: 'question', title: 'Awaiting Input', host: null, fields: [] });
});

test('UI-4: Authentication Required uses only a safely parsed target host', () => {
	const safe = authenticationChallengePresentation({ credentialLike: true, question: 'Enter username and password' }, 'https://login.example.test/path');
	assert.equal(safe.title, 'Authentication required for login.example.test');
	assert.deepEqual(safe.fields, ['username', 'password']);
	const unsafe = authenticationChallengePresentation({ credentialLike: true, question: 'Use https://made-up.invalid password' }, 'javascript:alert(1)');
	assert.equal(unsafe.title, 'Authentication required');
});

test('UI-4 CREDENTIAL REDACTION: only requested vault placeholders are built', () => {
	const fields = buildCredentialFields({ username: ' user@example.test ', password: 'p@ss', otp: '012345', role: 'admin' }, ['username', 'password']);
	assert.deepEqual(fields, { QA_USERNAME: 'user@example.test', QA_PASSWORD: 'p@ss' });
	assert.equal(fields.QA_OTP, undefined);
	assert.equal(fields.role, undefined);
});

test('UI-4: secret inputs are labelled, non-persistent, and associated with errors', () => {
	assert.match(app, /addField\('password', 'Password', 'password', 'off'\)/);
	assert.match(app, /addField\('otp', 'One-time code', 'password', 'off', 'numeric'\)/);
	assert.match(app, /aria-describedby.*credential-security-note credential-error/);
	assert.doesNotMatch(app.slice(app.indexOf('function credentialForm'), app.indexOf('async function sendAnswer')), /localStorage|console\.(?:log|info|debug)/);
});

test('UI-4 AUTH CONTINUATION SAME SESSION: credentials post to the current session only', () => {
	const form = app.slice(app.indexOf('function credentialForm'), app.indexOf('async function sendAnswer'));
	assert.match(form, /api\(`\/sessions\/\$\{state\.sessionId\}\/credentials`/);
	assert.doesNotMatch(form, /\/sessions['"`].*method:\s*['"]POST|\/v1\/missions/);
	assert.match(server, /app\.post\('\/api\/sessions\/:id\/credentials', requireApiToken/);
});

test('UI-4: rejected credential submission retains values and re-enables controls', () => {
	const form = app.slice(app.indexOf('function credentialForm'), app.indexOf('async function sendAnswer'));
	const caught = form.slice(form.indexOf('} catch (caught)'));
	assert.match(caught, /control\.disabled = false/);
	assert.doesNotMatch(caught, /control\.value = ''/);
	assert.match(caught, /errorNode\.textContent/);
});

test('UI-4: successful credential submission clears values and resumes the same run', () => {
	const form = app.slice(app.indexOf('function credentialForm'), app.indexOf('async function sendAnswer'));
	assert.match(form, /control\.value = ''/);
	assert.match(form, /This run is continuing in the same session/);
});

test('UI-4: Stop is a single guarded action with pending feedback', () => {
	assert.equal((app.match(/el\.stopRun\.onclick\s*=/g) ?? []).length, 1);
	assert.match(app, /function beginStopRequest\(\)/);
	assert.match(app, /el\.stopRun\.disabled = true/);
	assert.match(app, /el\.stopRun\.textContent = 'Stopping…'/);
	assert.match(app, /api\(`\/sessions\/\$\{state\.sessionId\}\/stop`/);
});

test('UI-4 STALE SSE/RUN GUARD: switched-run streams and events cannot overwrite current state', () => {
	const state = { projectId: 'p1', projectVersion: 2, runViewVersion: 3, sessionId: 'run-a' };
	const snapshot = runViewSnapshot(state, 'run-a');
	assert.equal(isCurrentRunView(state, snapshot), true);
	state.sessionId = 'run-b';
	state.runViewVersion += 1;
	assert.equal(isCurrentRunView(state, snapshot), false);
	assert.match(app, /state\.stream\?\.close\(\)/);
	assert.match(app, /if \(!isCurrentRunView\(state, snapshot\)\) \{ stream\.close\(\); return; \}/);
});

test('UI-4: project-switch generation invalidates session, lazy-detail, and evidence responses', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 1, sessionId: 'r1' };
	const snapshot = runViewSnapshot(state, 'r1');
	state.projectId = 'p2';
	state.projectVersion += 1;
	assert.equal(isCurrentRunView(state, snapshot), false);
	assert.match(detail, /isCurrentRunView\(state, snapshot\)/);
	assert.match(app, /state\.runViewVersion \+= 1/);
});

test('UI-4: direct, refresh, internal, and history /runs/:id routing uses the existing router', () => {
	assert.match(router, /route\.name === 'runs' && route\.parts\[1\]/);
	assert.match(app, /setRunRoute\(id\)/);
	assert.match(app, /window\.addEventListener\('popstate', followRunRoute\)/);
	assert.equal(server.includes('runs(?:\\/[^/]+)?'), true);
});

test('UI-4: foreign run IDs retain the server non-disclosing owned-resource lookup', () => {
	assert.match(server, /cross-user request gets the same 404 as a missing session/);
	assert.match(server, /requireOwnedResource\(request, response, 'session', request\.params\.id, getSession\)/);
	assert.match(server, /app\.get\('\/api\/sessions\/:id\/events', requireApiToken/);
});

test('UI-4: run detail has exactly five accessible context tabs', () => {
	const runPage = html.slice(html.indexOf('id="page-runs"'), html.indexOf('id="page-tests"'));
	const labels = [...runPage.matchAll(/role="tab"[^>]*>([^<]+)/g)].map(match => match[1].trim());
	assert.deepEqual(labels, ['Activity', 'Application Analysis', 'Evidence', 'Findings', 'Report']);
	assert.match(app, /ArrowLeft.*ArrowRight.*Home.*End/);
});

test('UI-4: the browser and details replace the permanent three-column workspace', () => {
	assert.match(css, /#page-runs \.run-workspace-grid \{[\s\S]*grid-template-columns: minmax\(0, 1\.65fr\) minmax\(360px, 1fr\)/);
	assert.match(css, /#page-runs \.run-picker-drawer \{[\s\S]*position: fixed/);
});

test('UI-4: mobile layout exposes Browser and Details without horizontal page overflow', () => {
	assert.match(html, /data-run-segment="browser"[^>]*>Browser/);
	assert.match(html, /data-run-segment="details"[^>]*>Details/);
	assert.match(css, /@media \(max-width: 700px\)[\s\S]*data-mobile-segment="browser"[\s\S]*data-mobile-segment="details"/);
	assert.match(css, /#page-runs \{[^}]*overflow-x: hidden/);
	assert.match(css, /#page-runs \.cred-actions \.btn \{ min-height: 44px/);
});

test('UI-4: active updates use restrained live regions and new questions switch mobile details once', () => {
	assert.match(html, /id="question-slot" aria-live="polite"/);
	assert.match(html, /id="activity-feed" aria-live="polite"/);
	assert.doesNotMatch(html, /aria-live="assertive"/);
	assert.match(app, /if \(isNewQuestion && window\.matchMedia/);
});

test('UI-4: persisted browser evidence survives completion of parallel detail loads', () => {
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	const parallelLoads = selection.indexOf('await Promise.allSettled');
	assert.ok(parallelLoads > 0);
	assert.match(selection.slice(0, parallelLoads), /renderBrowserHistory\(session\);[\s\S]*if \(session\.frame\) applyFrame\(session\.frame\)/);
	assert.doesNotMatch(selection.slice(parallelLoads), /el\.frame\.removeAttribute\('src'\)/);
});
