import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile('public/app.js', 'utf8');
const html = await readFile('public/index.html', 'utf8');
const styles = await readFile('public/styles.css', 'utf8');

const STAGE_BLOCK = /\/\* ── Post-run layout[\s\S]*?function toggleStageCollapse\(\) \{[\s\S]*?\n\}/;

test('post-run stage collapse block exists in the frontend source', () => {
	assert.match(app, STAGE_BLOCK);
});

test('only terminal statuses collapse the browser view; live statuses keep it expanded', () => {
	assert.match(app, /STAGE_COLLAPSE_STATUSES = new Set\(\['done', 'error', 'interrupted', 'idle'\]\)/);
	// A run in progress (or paused for user input) restores the full live view and
	// clears the manual expansion override for the session.
	assert.match(
		app,
		/if \(status === 'running' \|\| status === 'awaiting_input'\) \{[\s\S]*?state\.stageExpanded\.delete\(state\.sessionId\);[\s\S]*?renderStageCollapse\(\);/
	);
});

test('manual expansion is respected — render only collapses when the session is not in the override set', () => {
	assert.match(
		app,
		/const collapsed = STAGE_COLLAPSE_STATUSES\.has\(state\.session\?\.status \?\? 'idle'\)[\s\S]*?&& !state\.stageExpanded\.has\(state\.sessionId\);/
	);
	// toggleStageCollapse adds/removes the session from the override set rather than
	// toggling a global flag, so later status syncs of the same run cannot re-collapse
	// a view the user expanded.
	assert.match(app, /function toggleStageCollapse\(\) \{[\s\S]*?state\.stageExpanded\.add\(state\.sessionId\);[\s\S]*?state\.stageExpanded\.delete\(state\.sessionId\);[\s\S]*?\}/);
});

test('expand/collapse control is a real button with accessible state', () => {
	assert.match(html, /<button id="stage-toggle" class="btn btn-sm" hidden aria-expanded="true"/);
	assert.match(html, /id="stage-note"[^>]*>Run complete — live view collapsed<\/div>/);
	assert.match(app, /el\.stageToggle\.textContent = collapsed \? 'Expand' : 'Collapse';/);
	assert.match(app, /el\.stageToggle\.setAttribute\('aria-expanded', String\(!collapsed\)\);/);
	// The button only appears once a frame exists (no collapsing an empty stage).
	assert.match(app, /el\.stageToggle\.hidden = !stageHasContent\(\);/);
});

test('toggling preserves browser state — the frame is never unmounted or reset', () => {
	// The collapse is pure CSS class toggling on the viewer; the frame element and
	// its overlay children are static in index.html and never re-created by the
	// collapse code path.
	const collapseBlock = app.match(STAGE_BLOCK)?.[0] ?? '';
	assert.ok(collapseBlock, 'stage collapse block must exist');
	for (const forbidden of ['stageInner.innerHTML', 'frame.remove()', 'frame.src', 'location.reload']) {
		assert.ok(!collapseBlock.includes(forbidden), `collapse path must not touch ${forbidden}`);
	}
	assert.match(html, /<img id="frame" alt="Live view of the site under test">/);
});

test('collapsed layout frees the grid rows for findings and report', () => {
	const collapsedBlocks = styles.match(/\.viewer\.stage-collapsed \{[^}]*\}/g) ?? [];
	// Both the Studio-aligned rules and the legacy diagnostics block must define the
	// compact layout so no viewport regresses to the tall stage.
	assert.ok(collapsedBlocks.length >= 2, `expected collapsed viewer rules in both style blocks, found ${collapsedBlocks.length}`);
	for (const block of collapsedBlocks) {
		assert.match(block, /grid-template-rows:/);
	}
	// The expanded layout keeps a generous minmax stage so live testing is usable
	// (responsive variants use different pixel sizes but always keep a minmax stage row).
	// Units vary by theme block (#14074/#14102 redesign uses fr/dvh tracks; the
	// legacy block uses %) — the invariant is a minmax stage row, not the unit.
	const viewerBlocks = styles.match(/\.viewer \{[^}]*grid-template-rows[^}]*\}/g) ?? [];
	assert.ok(viewerBlocks.length >= 2, 'expanded viewer rules must exist in both style blocks');
	for (const block of viewerBlocks) {
		assert.match(block, /minmax\(\d+px, [\d.]+(?:%|fr|dvh|vh)\)/);
	}
	// Studio consistency: the toggle reuses the existing button classes.
	assert.match(html, /id="stage-toggle" class="btn btn-sm"/);
});

test('the collapsed strip is clickable and re-expandable, and the hint note renders only while collapsed', () => {
	assert.match(app, /el\.stage\.addEventListener\('click'[\s\S]*?toggleStageCollapse\(\);/);
	assert.match(app, /el\.stageNote\.hidden = !collapsed;/);
});
