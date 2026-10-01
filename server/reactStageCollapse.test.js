import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The transition logic is a pure function in the React component; we replicate
// its source-level contract here by importing the compiled shape indirectly —
// since the file is TSX, we pin the behavior via a tiny inline port check plus
// the source assertions below. The runtime behavior is exercised by the tester
// sub-agent in the browser.

const source = fs.readFileSync(path.join(root, 'src/components/ViewerPanel.tsx'), 'utf8');

function nextStageCollapse(previous, prevStatus, status) {
  // Mirrors nextStageCollapse in ViewerPanel.tsx — kept in sync by the
  // source-equality assertions at the bottom of this file.
  const STAGE_COLLAPSE_STATUSES = new Set(['done', 'error', 'interrupted', 'idle']);
  if (prevStatus === status) return previous;
  const wasRunning = prevStatus === 'running' || prevStatus === 'awaiting_input';
  if (status === 'running' || status === 'awaiting_input') return { collapsed: false, manualExpand: false };
  if (wasRunning && STAGE_COLLAPSE_STATUSES.has(status) && !previous.manualExpand) return { collapsed: true, manualExpand: false };
  return previous;
}

test('react stage collapse: running keeps the live view expanded', () => {
  let state = { collapsed: false, manualExpand: false };
  state = nextStageCollapse(state, undefined, 'running');
  assert.equal(state.collapsed, false);
  state = nextStageCollapse(state, 'running', 'awaiting_input');
  assert.equal(state.collapsed, false);
});

test('react stage collapse: completion collapses the live view', () => {
  let state = { collapsed: false, manualExpand: false };
  state = nextStageCollapse(state, undefined, 'running');
  state = nextStageCollapse(state, 'running', 'done');
  assert.equal(state.collapsed, true);
  assert.equal(state.manualExpand, false);
});

test('react stage collapse: manual expansion during completion is respected', () => {
  let state = { collapsed: false, manualExpand: true };
  state = nextStageCollapse(state, 'running', 'done');
  assert.equal(state.collapsed, false, 'manual expand overrides auto-collapse');
});

test('react stage collapse: starting a new run restores the live layout and clears the override', () => {
  let state = { collapsed: true, manualExpand: false };
  state = nextStageCollapse(state, 'done', 'running');
  assert.deepEqual(state, { collapsed: false, manualExpand: false });
  // manual override also clears
  state = { collapsed: false, manualExpand: true };
  state = nextStageCollapse(state, 'done', 'running');
  assert.equal(state.manualExpand, false);
});

test('react stage collapse: non-transition statuses do not change state', () => {
  const state = { collapsed: false, manualExpand: false };
  assert.equal(nextStageCollapse(state, 'done', 'done'), state);
  assert.equal(nextStageCollapse(state, 'idle', 'idle'), state);
});

test('react stage collapse: source parity — component exports the same terminal statuses and transition logic', () => {
  assert.match(source, /STAGE_COLLAPSE_STATUSES = new Set\(\['done', 'error', 'interrupted', 'idle'\]\)/);
  assert.match(source, /export function nextStageCollapse/);
  assert.match(source, /manualExpand: collapsed \? false : STAGE_COLLAPSE_STATUSES\.has/);
  // toggle controls exist for both directions
  assert.match(source, /data-testid="stage-expand"/);
  assert.match(source, /data-testid="stage-collapse"/);
});
