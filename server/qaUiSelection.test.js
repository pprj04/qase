import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('the QA launcher exposes a test-selection fieldset with bulk controls', () => {
	assert.match(html, /<fieldset[^>]+id="qa-tests-fieldset"[^>]*disabled/);
	assert.match(html, /<div class="sqa-option-grid" id="qa-test-options"><\/div>/);
	assert.match(html, /id="qa-select-all"[^>]*>Select all<\/button>/);
	assert.match(html, /id="qa-deselect-all"[^>]*>Deselect all<\/button>/);
	assert.match(html, /id="qa-tests-count"[^>]+aria-live="polite"/);
	assert.match(html, /id="qa-tests-state"[^>]+role="status"/);
	// Submit is the named control the customer asked to gate.
	assert.match(html, /id="qa-submit"[^>]*>Start testing<\/button>/);
	// Founder Mode and SQA (compliance) remain separate, untouched launchers.
	assert.match(html, /id="new-founder"[^>]+aria-label="Start Founder Mode review"/);
	assert.match(html, /id="new-sqa"[^>]+aria-label="Start quality review"/);
});

test('QA frontend defaults to standard tests selected and keeps security opt-in', () => {
	// Catalog comes from the authenticated API, cached like the SQA catalog.
	assert.match(app, /api\('\/qa\/catalog'\)/);
	// Safe DOM construction for the option tiles (sqa-option reused).
	const qaBlock = app.slice(app.indexOf('function qaTestOption'), app.indexOf('/* ── Settings'));
	assert.ok(qaBlock.length > 500, 'QA launcher block should be discoverable');
	assert.doesNotMatch(qaBlock, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/);
	assert.match(qaBlock, /const selectedByDefault = \(test\.category \?\? 'standard'\) !== 'security'/);
	assert.match(qaBlock, /input\.checked = selectedByDefault;\s*\n\s*input\.defaultChecked = selectedByDefault;/);
	assert.match(qaBlock, /name = 'qa-test'/);
	assert.match(qaBlock, /sqa-option\$\{isAvailable \? '' : ' is-unavailable'\}/);
	// Selection styles reuse the Studio grid, not new components.
	assert.match(styles, /\.qa-tests-toolbar/);
	assert.match(styles, /\.qa-tests-count/);
});

test('QA submit is disabled with no selection and selection survives configuration', () => {
	// Disabled at zero selected tests (or invalid URL, unloaded matrix, over-cap,
	// or while a run is starting).
	assert.match(app, /qaUi\.submit\.disabled = selected === 0 \|\| !urlValid \|\| !authorizationReady \|\| !matrixReady \|\| !withinCap \|\| qaUi\.submit\.dataset\.busy === 'true'/);
	// Guard on submit as well — defense in depth.
	assert.match(app, /if \(selectedTests\.length === 0\) \{\s*setQaFormError\('Select at least one test\.'\)/);
	// Bulk controls rewrite every checkbox.
	const qaLauncherBlock = app.slice(app.indexOf('const qaUi'), app.indexOf('async function openSqaStart') === -1 ? undefined : app.indexOf('async function openSqaStart'));
	assert.ok(qaLauncherBlock.includes('function closeQaStart'), 'launcher block should span the full dialog wiring');
	assert.match(qaLauncherBlock, /qaUi\.selectAll\.onclick[\s\S]*?input\.checked = true/);
	assert.match(qaLauncherBlock, /qaUi\.deselectAll\.onclick[\s\S]*?input\.checked = false/);
	// Selection is tracked outside the form reset path and survives device /
	// landscape / URL edits: only the device select and landscape checkbox are
	// touched on open, never the test grid.
	assert.match(app, /qaUi\.selectedTests = new Set\(qaCheckedTests\(\)\)/);
	assert.doesNotMatch(app, /openQaStart[\s\S]{0,600}qa-test-options[\s\S]{0,100}replaceChildren/);
	// The run request carries the selection (and the security authorization
	// gate payload when a security check is selected).
	assert.match(app, /body: JSON\.stringify\(\{[\s\S]*?device,[\s\S]*?deviceLandscape,[\s\S]*?engine,[\s\S]*?selectedTests,[\s\S]*?\.\.\.\(securityAuthorization \? \{ securityAuthorization \} : \{\}\)[\s\S]*?\}\)/);
});
