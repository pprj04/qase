import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

/**
 * Phase 7 rework of the legacy UI pinning tests. The React UI at src/ is now
 * the served application; these tests pin the SAME behavioral contracts that
 * the legacy suite guaranteed (engine pills, security gate sequencing, QA
 * selection, model selector, status surfaces) against the React sources.
 *
 * Contract map (legacy test file → tests here):
 *   engineTitleAndAllowlist → enginePills + browserPolicy
 *   securityGateUi, securitySelectionUi, qaUiSelection → launcher tests
 *   modelSelectorUi → settings tests
 *   statusChipUi → status surface tests
 *   stageCollapseUi → viewer tests (also see reactStageCollapse.test.js)
 */

const read = (p) => readFile(p, 'utf8');
const qa = await read('src/components/QaLauncher.tsx');
const sqa = await read('src/components/SqaLauncher.tsx');
const founder = await read('src/components/FounderLauncher.tsx');
const settings = await read('src/components/SettingsDialog.tsx');
const runList = await read('src/components/RunList.tsx');
const transcript = await read('src/components/Transcript.tsx');
const appSrc = await read('src/App.tsx');
const viewer = await read('src/components/ViewerPanel.tsx');

test('all three launchers gate on model readiness before creating a session', () => {
	const launchers = [['QA', qa], ['SQA', sqa], ['Founder', founder]];
	for (const [name, src] of launchers) {
		assert.match(src, /useModelConfig\(\)/, `${name} launcher reads model config`);
		assert.match(src, /modelStatus\.ready !== true/, `${name} launcher blocks submit when not ready`);
	}
});

test('demo site is discoverable from the QA launcher', () => {
	assert.match(qa, /data-testid="qa-demo-fill"/, 'launcher demo fill button');
	assert.match(qa, /\/demo/, 'demo URL');
	assert.match(qa, /demo@qase\.dev \/ demo1234/, 'demo credentials surfaced');
});

test('QA launcher exposes a test-selection fieldset with bulk controls', () => {
	assert.match(qa, /fieldset className="qa-fieldset"/);
	assert.match(qa, /data-testid="qa-select-all"/, 'Select all control');
	assert.match(qa, /Select all/);
	// Defaults to all tests selected once the catalog loads.
	assert.match(qa, /setSelectedTests\(new Set\(\(cat\.tests \?\? \[\]\)\.map\(\(t\) => t\.id\)\)\)/);
});

test('QA submit blocks with no selection and requires authorization for security checks', () => {
	assert.match(qa, /Select at least one test\./);
	assert.match(qa, /securitySelected && !securityAuthorized/, 'gate condition');
	assert.match(qa, /Confirm the target is an explicitly authorized, isolated test environment/);
	assert.match(qa, /securityAuthorization: true/, 'confirmed authorization rides the run request');
	// Unavailable engines are disabled, never selectable.
	assert.match(qa, /disabled=\{!available\}/);
	assert.match(qa, /is-disabled/);
});

test('settings exposes an endpoint-backed model selector with a custom fallback', () => {
	assert.match(settings, /CUSTOM_MODEL_VALUE/, 'custom sentinel option');
	// The select is populated from the endpoint probe (legacy fillModelOptions).
	assert.match(settings, /result\.models/, 'models arrive from the probe endpoint');
	assert.match(settings, /modelValue === CUSTOM_MODEL_VALUE/, 'custom selection resolves to the typed value');
});

test('run list title carries an engine chip for non-chromium runs', () => {
	assert.match(runList, /run\.engine && run\.engine !== 'chromium'/, 'non-chromium gate');
	assert.match(runList, /run-engine-pill/, 'chip class reused');
});

test('chat header shows the engine tag for non-chromium runs', () => {
	assert.match(transcript, /session\.engine && session\.engine !== 'chromium'/, 'non-chromium gate');
	assert.match(transcript, /run-engine-pill/, 'chip class reused');
});

test('LIVE pill only while a run is actively working', () => {
	assert.match(transcript, /running && <span className="live-pill"/);
});

test('interrupted or errored runs expose a resume affordance', () => {
	assert.match(transcript, /session\.status === 'interrupted' \|\| session\.status === 'error'/);
	assert.match(transcript, /sendMessage\('continue'\)/, 'resume sends the continue message');
	assert.match(transcript, /data-testid="resume-run"/);
});

test('stage collapse semantics hold in the React viewer', () => {
	assert.match(viewer, /STAGE_COLLAPSE_STATUSES = new Set\(\['done', 'error', 'interrupted', 'idle'\]\)/);
	assert.match(viewer, /status === 'running' \|\| status === 'awaiting_input'/);
});

test('browser policy treats the own public origin as allowed (server contract unchanged)', () => {
	// The allowlist policy is enforced server-side; pin that the React client
	// never constructs a target from anything but user input (no baked URL).
	assert.doesNotMatch(appSrc, /https?:\/\/qase[^'"]*drytis\.dev/);
});
