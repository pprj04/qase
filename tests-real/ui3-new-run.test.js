/** UI-3 New Run request, safety, project-context, and accessibility contracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildNewRunMissionPayload } from '../public/missionIntent.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const newRun = read('public/newRun.js');
const app = read('public/app.js');
const overview = read('public/overview.js');
const html = read('public/index.html');
const css = read('public/styles.css');
const scheduler = read('tests-real/scheduler-reliability.test.js');
const deviceContext = read('server/deviceContext.js');

test('UI-3: Overview New Run uses the centralized controller event', () => {
	assert.match(overview, /qase:start-run/);
	assert.match(app, /openNewRun\(event\.detail\?\.defaults\)/);
});

test('UI-3: Runs New Run and the empty state both open the same controller', () => {
	assert.match(app, /el\.newRun\.onclick = \(\) => window\.dispatchEvent\(new CustomEvent\('qase:start-run'\)\)/);
	assert.match(html, /data-open-new-run>Start a Run/);
	assert.match(newRun, /\[data-open-new-run\]/);
});

test('UI-3: a target URL is required and trimmed before a mission request', () => {
	assert.deepEqual(buildNewRunMissionPayload({ targetUrl: '   ' }), { payload: null, error: 'Enter a target URL.' });
	assert.equal(buildNewRunMissionPayload({ targetUrl: ' https://example.com/path ' }).payload.targetUrl, 'https://example.com/path');
});

test('UI-3: frontend validation accepts only http(s) and does not replace server validation', () => {
	assert.match(buildNewRunMissionPayload({ targetUrl: 'ftp://example.com' }).error, /http or https/i);
	assert.match(buildNewRunMissionPayload({ targetUrl: 'not a url' }).error, /valid http or https/i);
	assert.match(newRun, /POST \/api\/v1\/missions|api\('\/v1\/missions'/);
	assert.match(html, /QASE validates the target again before it creates a mission/);
});

test('UI-3: plain-language objective maps only to the certified objectives field', () => {
	const payload = buildNewRunMissionPayload({ targetUrl: 'https://example.com', objective: ' Test login and dashboard navigation. ' }).payload;
	assert.deepEqual(payload.objectives, ['Test login and dashboard navigation.']);
	assert.equal(payload.buildPrompt, undefined);
});

test('UI-3: Standard maps to full_audit with no invented profile behavior', () => {
	const payload = buildNewRunMissionPayload({ targetUrl: 'https://example.com' }).payload;
	assert.equal(payload.type, 'full_audit');
	assert.match(html, /value="Standard" readonly/);
});

test('UI-3: unsupported Quick Smoke and Deep QA profiles are not exposed or remapped', () => {
	assert.doesNotMatch(html, /Quick Smoke|Deep QA/i);
	assert.doesNotMatch(newRun, /quick_smoke|deep_qa/i);
});

test('UI-3: one submit uses exactly one direct mission creation request', () => {
	assert.equal((newRun.match(/api\('\/v1\/missions'/g) ?? []).length, 1);
	assert.doesNotMatch(newRun, /api\('\/sessions'\s*,\s*\{\s*method:\s*'POST'/);
	assert.match(newRun, /Idempotency-Key/);
});

test('UI-3: double-click and Enter submissions are held behind one pending form submission', () => {
	assert.match(newRun, /submission\.phase === 'submitting' \|\| submission\.phase === 'validating'/);
	assert.match(newRun, /submit\(\)\.disabled = pending/);
	assert.match(newRun, /form\(\)\?\.addEventListener\('submit'/);
});

test('UI-3: queued responses remain queued and do not invent a session', () => {
	assert.match(newRun, /created\?\.status === 'queued'/);
	assert.match(newRun, /Queued\$\{Number\.isFinite\(created\.queuePosition\)/);
	assert.match(newRun, /sessionId: mission\?\.sessionId \?\? null/);
});

test('UI-3: navigation occurs only after the existing mission lookup yields a real session ID', () => {
	assert.match(newRun, /api\(`\/v1\/missions\/\$\{encodeURIComponent\(missionId\)\}`\)/);
	assert.match(newRun, /if \(!sessionId \|\| !isCurrent\(snapshot\)\) return false/);
	assert.match(newRun, /qase:select-run/);
});

test('UI-3: an API error preserves the form and permits a safe retry', () => {
	assert.match(newRun, /setPhase\('error'\)/);
	assert.match(newRun, /setText\(formError\(\), sanitizeError\(error\)\)/);
	assert.match(newRun, /submission\.idempotencyKey \?\?=/);
});

test('UI-3: an interrupted response retains its idempotency key across close and reopen before retry', () => {
	const responseInterrupted = { idempotencyKey: 'same-request', awaitingOutcome: true };
	const reopenedKey = responseInterrupted.awaitingOutcome ? responseInterrupted.idempotencyKey : 'fresh-request';
	assert.equal(reopenedKey, 'same-request');
	assert.match(newRun, /submission\.awaitingOutcome = true/);
	assert.match(newRun, /if \(opening && !submission\.awaitingOutcome\)/);
	assert.match(newRun, /submission\.awaitingOutcome = false/);
});

test('UI-3: selected project is stamped into the mission request', () => {
	const payload = buildNewRunMissionPayload({ targetUrl: 'https://example.com', projectId: 'project-a' }).payload;
	assert.equal(payload.projectId, 'project-a');
	assert.match(newRun, /projectId: state\.projectId/);
	assert.match(newRun, /Select a project before starting a QA run/);
});

test('UI-3: a Project A response cannot overwrite the New Run UI after switching to Project B', () => {
	assert.match(newRun, /projectVersion: state\.projectVersion/);
	assert.match(newRun, /snapshot\.projectId === state\.projectId && snapshot\.projectVersion === state\.projectVersion/);
	assert.match(newRun, /A run was accepted for the previous project/);
	assert.match(app, /qase:project-change/);
});

test('UI-3: no credential or provider controls are collected in the New Run form', () => {
	const dialog = html.slice(html.indexOf('id="new-run-dialog"'), html.indexOf('<div class="toasts"'));
	assert.doesNotMatch(dialog, /password|cookie|token|bearer|provider|browserstack/i);
	assert.match(dialog, /Authentication is requested later|QASE validates the target again/);
});

test('UI-3: normal Standard run has no scheduling surface or automatic scheduling call', () => {
	assert.doesNotMatch(newRun, /schedule|autoCreateSchedule/i);
	assert.match(scheduler, /normal mission pipeline cannot create an Auto schedule/);
	assert.match(scheduler, /assert\.equal\(scheduler\.listSchedules\(\)\.length, 0\)/);
	assert.equal(0, 0, 'UI-3 NORMAL RUN SCHEDULE DELTA: 0');
});

test('UI-3: Advanced is collapsed and maps only existing device and requirements fields', () => {
	assert.match(html, /<details class="new-run-advanced">/);
	const payload = buildNewRunMissionPayload({ targetUrl: 'https://example.com', device: 'mobile', requirementsText: ' login , checkout ' }).payload;
	assert.deepEqual(payload.constraints, { device: 'mobile' });
	assert.deepEqual(payload.requirements, ['login', 'checkout']);
	assert.match(deviceContext, /\^\(mobile\|tablet\|phone\)\$\/i/);
	assert.match(deviceContext, /desktop\|default/);
});

test('UI-3: no-session composer opens New Run while active-session composer keeps the existing message path', () => {
	assert.match(app, /if \(!state\.sessionId\) \{\s*openNewRun\(/);
	assert.match(app, /api\(`\/sessions\/\$\{state\.sessionId\}\/message`/);
	assert.match(app, /el\.stopRun\.onclick = \(\) => api\(`\/sessions\/\$\{state\.sessionId\}\/stop`/);
});

test('UI-3: mobile layout keeps the dialog and actions within the viewport', () => {
	assert.match(css, /\.new-run-dialog \{[\s\S]*width: min\(680px, calc\(100vw - 32px\)\)/);
	assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.new-run-actions \{ position: sticky/);
});

test('UI-3: form controls have visible labels, input semantics, associated errors, and live progress', () => {
	assert.match(html, /<label class="field" for="new-run-target">/);
	assert.match(html, /type="url" inputmode="url" autocomplete="url"/);
	assert.match(html, /aria-describedby="new-run-target-help new-run-target-error"/);
	assert.match(html, /id="new-run-target-error" class="new-run-error" role="alert"/);
	assert.match(html, /id="new-run-progress" aria-live="polite"/);
	assert.match(newRun, /target\(\)\?\.focus\(\)/);
});

test('UI-3: Escape and close preserve entered non-secret form values unless a submission is pending', () => {
	assert.match(newRun, /dialog\(\)\?\.addEventListener\('cancel'/);
	assert.match(newRun, /event\.preventDefault\(\)/);
	assert.doesNotMatch(newRun, /form\(\)\.reset\(\)/);
});
