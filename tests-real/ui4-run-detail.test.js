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
	credentialRequestSnapshot,
	currentFindingPresentation,
	evidenceScreenshotUrl,
	executionHealthPresentation,
	isCurrentCredentialRequest,
	isCurrentRunView,
	normalizeGeneratedReportMarkdown,
	reportPresentation,
	runMetricPresentation,
	runStreamLifecycleAction,
	runViewSnapshot,
	shouldRefreshRunOnReentry
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
	assert.match(form, /const sessionId = state\.sessionId/);
	assert.match(form, /api\(`\/sessions\/\$\{sessionId\}\/credentials`/);
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

test('UI-4.1: late successful Run A credential response is stale after switching to Run B', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 1, sessionId: 'run-a', credentialRequestVersion: 2, renderedQuestionKey: 'run-a:auth' };
	const snapshot = credentialRequestSnapshot(state, 'run-a');
	state.sessionId = 'run-b';
	state.runViewVersion += 1;
	state.renderedQuestionKey = 'run-b:auth';
	assert.equal(isCurrentCredentialRequest(state, snapshot, { formConnected: false, questionKey: 'run-a:auth' }), false);
	assert.match(app, /await api\(`\/sessions\/\$\{sessionId\}\/credentials`[^]*if \(!requestIsCurrent\(\)\) return;/);
});

test('UI-4.1: late rejected Run A credential response cannot show an error in Run B', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 4, sessionId: 'run-a', credentialRequestVersion: 7, renderedQuestionKey: 'run-a:auth' };
	const snapshot = credentialRequestSnapshot(state, 'run-a');
	state.sessionId = 'run-b';
	state.runViewVersion += 1;
	assert.equal(isCurrentCredentialRequest(state, snapshot, { formConnected: false, questionKey: 'run-a:auth' }), false);
	const form = app.slice(app.indexOf('function credentialForm'), app.indexOf('async function sendAnswer'));
	assert.match(form.slice(form.indexOf('} catch (caught)')), /if \(!requestIsCurrent\(\)\) return;/);
});

test('UI-4.1: Project A credential response is stale after switching to Project B', () => {
	const state = { projectId: 'project-a', projectVersion: 3, runViewVersion: 5, sessionId: 'run-a', credentialRequestVersion: 1, renderedQuestionKey: 'run-a:auth' };
	const snapshot = credentialRequestSnapshot(state, 'run-a');
	state.projectId = 'project-b';
	state.projectVersion += 1;
	assert.equal(isCurrentCredentialRequest(state, snapshot, { questionKey: 'run-a:auth' }), false);
});

test('UI-4.1 STALE CREDENTIAL RESPONSE GUARD: a remounted form invalidates the previous request token', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 1, sessionId: 'run-a', credentialRequestVersion: 10, renderedQuestionKey: 'run-a:auth' };
	const snapshot = credentialRequestSnapshot(state, 'run-a');
	state.credentialRequestVersion += 1;
	assert.equal(isCurrentCredentialRequest(state, snapshot, { questionKey: 'run-a:auth' }), false);
	assert.match(app, /state\.credentialRequestVersion \+= 1/);
});

test('UI-4.1: leaving Runs closes the current live subscription', () => {
	const state = { sessionId: 'run-a', session: { id: 'run-a' }, stream: {} };
	assert.equal(runStreamLifecycleAction(state, 'overview'), 'close');
	assert.match(app, /if \(page !== 'runs' && state\.sessionId\) \{[^]*state\.stream\?\.close\(\)/);
});

test('UI-4.1 SSE RECONNECT ON RETURN: returning to Runs opens one live subscription', () => {
	const state = { sessionId: 'run-a', session: { id: 'run-a' }, stream: undefined };
	assert.equal(runStreamLifecycleAction(state, 'runs'), 'open');
	assert.equal(shouldRefreshRunOnReentry(state, 'runs', false), true);
	assert.match(app, /if \(shouldRefreshRunOnReentry[^]*selectSession\(state\.sessionId, state\.projectVersion/);
});

test('UI-4.1: repeated Runs activation does not accumulate live subscriptions', () => {
	const state = { sessionId: 'run-a', session: { id: 'run-a' }, stream: {} };
	assert.equal(runStreamLifecycleAction(state, 'runs'), 'none');
	assert.equal(runStreamLifecycleAction(state, 'runs'), 'none');
});

test('UI-4.1: browser Back reconnects and Forward does not duplicate live updates', () => {
	const state = { sessionId: 'run-a', session: { id: 'run-a' }, stream: undefined };
	assert.equal(runStreamLifecycleAction(state, 'runs'), 'open');
	state.stream = {};
	assert.equal(runStreamLifecycleAction(state, 'runs'), 'none');
	assert.match(router, /window\.addEventListener\('popstate', \(\) => render\(parseRoute\(\)\)\)/);
});

test('UI-4.1: a late Run A SSE event remains invalid after returning on Run B', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 8, sessionId: 'run-a' };
	const snapshot = runViewSnapshot(state, 'run-a');
	state.sessionId = 'run-b';
	state.runViewVersion += 1;
	assert.equal(isCurrentRunView(state, snapshot), false);
	assert.match(app, /if \(data\.sessionId === snapshot\.sessionId\) \{\s*handleEvent\(data\);/);
});

test('UI-4.2 CREDENTIAL FORM RE-ENTRY RECOVERY: leave and return remounts an enabled challenge form', () => {
	const state = { sessionId: 'run-a', session: { id: 'run-a' }, stream: undefined };
	assert.equal(shouldRefreshRunOnReentry(state, 'overview', true), false);
	assert.equal(shouldRefreshRunOnReentry(state, 'runs', false), true);
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	assert.match(selection, /const session = await api\(`\/sessions\/\$\{id\}`\)/);
	assert.match(selection, /renderQuestion\(\)/);
	const form = app.slice(app.indexOf('function credentialForm'), app.indexOf('async function sendAnswer'));
	assert.doesNotMatch(form.slice(0, form.indexOf('form.onsubmit')), /\.disabled = true/);
});

test('UI-4.2: re-entry refresh does not depend on a stale in-memory session match', () => {
	const state = { sessionId: 'run-b', session: { id: 'run-a' }, stream: undefined };
	assert.equal(runStreamLifecycleAction(state, 'runs'), 'none');
	assert.equal(shouldRefreshRunOnReentry(state, 'runs', false), true);
	assert.match(app, /if \(shouldRefreshRunOnReentry\(state, page, wasRunRouteActive\)\)/);
});

test('UI-4.2: stale credential success cannot clear a remounted current challenge', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 2, sessionId: 'run-a', credentialRequestVersion: 4, renderedQuestionKey: 'run-a:auth' };
	const stale = credentialRequestSnapshot(state, 'run-a');
	state.runViewVersion += 1;
	state.credentialRequestVersion += 1;
	assert.equal(isCurrentCredentialRequest(state, stale, { formConnected: false, questionKey: 'run-a:auth' }), false);
	assert.match(app, /if \(!requestIsCurrent\(\)\) return;[^]*state\.session\.pendingQuestion = undefined/);
});

test('UI-4.2: stale credential failure cannot disable or annotate a remounted current challenge', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 2, sessionId: 'run-a', credentialRequestVersion: 4, renderedQuestionKey: 'run-a:auth' };
	const stale = credentialRequestSnapshot(state, 'run-a');
	state.credentialRequestVersion += 1;
	assert.equal(isCurrentCredentialRequest(state, stale, { formConnected: false, questionKey: 'run-a:auth' }), false);
	const form = app.slice(app.indexOf('function credentialForm'), app.indexOf('async function sendAnswer'));
	assert.match(form.slice(form.indexOf('} catch (caught)')), /if \(!requestIsCurrent\(\)\) return;[^]*errorNode\.textContent/);
});

test('UI-4.2: re-entry refresh renders a missed Awaiting Input or resumed Running transition', () => {
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	assert.match(selection, /state\.session = session;[^]*renderHeader\(\);[^]*renderQuestion\(\)/);
	assert.match(app, /canonicalRunPresentation\(state\.session/);
});

test('UI-4.2 RUN RE-ENTRY STATE REFRESH: re-entry renders missed Completed and Failed outcomes', () => {
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	assert.match(selection, /renderHeader\(\);[^]*renderExecutionHealth\(session\)/);
	assert.equal(canonicalRunPresentation({ executionOutcome: 'completed' }).label, 'Completed');
	assert.equal(canonicalRunPresentation({ executionOutcome: 'failed' }).label, 'Failed');
});

test('UI-4.2: re-entry refresh synchronizes missed finding-count changes', () => {
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	assert.match(selection, /renderFindings\(\);[^]*renderSessionFindings\(session\)/);
	assert.match(selection, /updateExecStats\(\)/);
});

test('UI-4.2: re-entry refresh exposes a report that became available while away', () => {
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	assert.match(selection, /renderReport\(\)/);
	assert.match(selection, /const session = await api\(`\/sessions\/\$\{id\}`\)/);
});

test('UI-4.2: authoritative refresh hands off to exactly one SSE subscription', () => {
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	assert.equal((selection.match(/connect\(id, snapshot\)/g) ?? []).length, 1);
	const routeLifecycle = app.slice(app.indexOf("window.addEventListener('routechange'"), app.indexOf('// Deep links select a run'));
	assert.doesNotMatch(routeLifecycle, /connect\(/);
	assert.match(routeLifecycle, /selectSession\(state\.sessionId, state\.projectVersion/);
});

test('UI-4.2: repeated leave and return activation remains refresh- and stream-leak free', () => {
	const state = { sessionId: 'run-a', session: { id: 'run-a' }, stream: undefined };
	assert.equal(shouldRefreshRunOnReentry(state, 'runs', false), true);
	state.stream = {};
	assert.equal(shouldRefreshRunOnReentry(state, 'runs', true), false);
	assert.equal(runStreamLifecycleAction(state, 'runs'), 'none');
});

test('UI-4.3 EVIDENCE RE-ENTRY REFRESH: returning to a run forces protected evidence reload', () => {
	const selection = app.slice(app.indexOf('async function selectSession'), app.indexOf('function renderHeader'));
	assert.match(selection, /loadSessionEvidence\(id, \{ force: forceEvidence \}\)/);
	const routeLifecycle = app.slice(app.indexOf("window.addEventListener('routechange'"), app.indexOf('// Deep links select a run'));
	assert.match(routeLifecycle, /selectSession\(state\.sessionId, state\.projectVersion, \{ forceEvidence: true \}\)/);
	assert.match(detail, /apiRaw\(`\/v1\/sessions\/\$\{sessionId\}\/evidence\?limit=200`\)/);
});

test('UI-4.3: evidence added while away replaces the cached evidence grid', () => {
	assert.match(detail, /if \(evState\.sessionId === sessionId && evState\.loaded && !force\)/);
	assert.match(detail, /evState\.items = items;[\s\S]*renderEvidenceGrid\(\)/);
	assert.match(app, /loadSessionEvidence\(id, \{ force: forceEvidence \}\)/);
});

test('UI-4.3: pruned or missing evidence is rechecked rather than trusted from the old view', () => {
	assert.match(detail, /evState\.artifactProbe\.clear\(\)/);
	assert.match(detail, /if \(!res\.ok\) throw new Error\(`evidence API \$\{res\.status\}`\)/);
	assert.match(detail, /textContent: '🖼 artifact unavailable'/);
});

test('UI-4.3: late Run A evidence response cannot overwrite Run B', () => {
	const state = { projectId: 'p1', projectVersion: 1, runViewVersion: 3, sessionId: 'run-a' };
	const snapshot = runViewSnapshot(state, 'run-a');
	state.sessionId = 'run-b';
	state.runViewVersion += 1;
	assert.equal(isCurrentRunView(state, snapshot), false);
	assert.match(detail, /const isCurrentRequest = \(\) => requestVersion === evState\.requestVersion && isCurrentRunView\(state, snapshot\)/);
	assert.match(detail, /if \(!isCurrentRequest\(\)\) return;/);
});

test('UI-4.3: late Project A evidence response cannot overwrite Project B', () => {
	const state = { projectId: 'project-a', projectVersion: 5, runViewVersion: 3, sessionId: 'run-a' };
	const snapshot = runViewSnapshot(state, 'run-a');
	state.projectId = 'project-b';
	state.projectVersion += 1;
	assert.equal(isCurrentRunView(state, snapshot), false);
	assert.match(detail, /const snapshot = runViewSnapshot\(state, sessionId\)/);
});

test('UI-4.3: repeated leave and return supersedes stale in-flight evidence requests safely', () => {
	assert.match(detail, /if \(evState\.loading && evState\.sessionId === sessionId && !force\) return;/);
	assert.match(detail, /const requestVersion = \+\+evState\.requestVersion/);
	assert.match(detail, /if \(isCurrentRequest\(\)\) evState\.loading = false/);
});

test('UI-4.3: ordinary same-view renders do not create uncontrolled evidence loads', () => {
	assert.equal(shouldRefreshRunOnReentry({ sessionId: 'run-a' }, 'runs', true), false);
	assert.match(detail, /if \(evState\.loading && evState\.sessionId === sessionId && !force\) return;/);
	assert.match(detail, /if \(evState\.sessionId === sessionId && evState\.loaded && !force\) \{/);
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
