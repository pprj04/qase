import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('react deep link: RUN_ID_PATTERN matches the canonical run-id contract', () => {
  const react = read('src/lib/runDeepLink.ts');
  // Canonical shape: v1-v8 UUID, case-insensitive (pinned independently of
  // the legacy file, which was removed in Phase 7).
  assert.match(react, /export const RUN_ID_PATTERN = \/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i/);
});

test('react deep link: URL param is consumed unconditionally (valid or stale)', () => {
  const react = read('src/lib/runDeepLink.ts');
  // consumeRunParam strips ?run= regardless of validity — pins the fix that
  // invalid ids left a stale param in the address bar.
  assert.match(react, /export function consumeRunParam/);
  assert.doesNotMatch(react, /if \(requested\) \{\s*consumeRunParam/, 'consume must not be conditional on validity');
  const app = read('src/App.tsx');
  assert.match(app, /consumeRunParam\(\);/, 'App calls consume unconditionally after reading');
});

test('react feedback panel: handles the bare-array /feedback response', () => {
  const panel = read('src/components/AdminFeedbackPanel.tsx');
  // The server responds with response.json(rows) — a bare array. Pin the
  // normalization that was initially missed (rendered empty state forever).
  assert.match(panel, /Array\.isArray\(feedbackPage\) \? feedbackPage : feedbackPage\.records \?\? \[\]/);
  // 403 from a non-admin hides the panel entirely (legacy parity).
  assert.match(panel, /status === 403\) setAllowed\(false\)/);
});

test('react feedback panel: category and status catalogues match the server contract', () => {
  const panel = read('src/components/AdminFeedbackPanel.tsx');
  const store = read('server/feedbackStore.js');
  for (const value of ['test_accuracy', 'test_coverage', 'execution_speed', 'results', 'ui_ux', 'automation_quality', 'error_handling', 'ease_of_use', 'overall', 'other']) {
    assert.ok(store.includes(value), `server knows category ${value}`);
    assert.ok(panel.includes(`value: '${value}'`), `panel offers category ${value}`);
  }
  for (const value of ['new', 'reviewed', 'in_progress', 'resolved', 'closed']) {
    assert.ok(panel.includes(`value: '${value}'`), `panel offers status ${value}`);
  }
});

test('react bugs view: optimistic status change rolls back on failure', () => {
  const view = read('src/components/BugsView.tsx');
  assert.match(view, /const previous = row\.status;/, 'previous status captured before optimistic update');
  assert.match(view, /r\.id === row\.id \? \{ \.\.\.r, status: next \} : r/, 'optimistic patch applied first');
  assert.match(view, /status: previous \} : r/, 'rollback restores previous on error');
  // BUG_STATUS_LABELS vocabulary (legacy tracker contract).
  assert.match(view, /open: 'Open',/, 'status label open');
  assert.match(view, /in_progress: 'In progress',/, 'status label in_progress');
  assert.match(view, /fixed: 'Fixed',/, 'status label fixed');
  assert.match(view, /wont_fix: "Won't fix",/, 'status label wont_fix');
});

test('react error boundary: resetKey clears a caught error so a reopened dialog retries', () => {
  const boundary = read('src/components/ErrorBoundary.tsx');
  assert.match(boundary, /resetKey/, 'resetKey prop exists');
  assert.match(boundary, /prev\.resetKey !== this\.props\.resetKey/, 'error clears when the key changes');
  const app = read('src/App.tsx');
  assert.match(app, /label="QA launcher"> resetKey=\{launcherOpen\}/, 'launchers keyed on their open flag');
});

test('react launcher kickoff: start failures surface a toast, not a dead dialog error', () => {
  for (const file of ['src/components/SqaLauncher.tsx', 'src/components/FounderLauncher.tsx']) {
    const source = read(file);
    assert.match(source, /toast\(/, `${file}: toast called`);
    assert.match(source, /could not start/, `${file}: failure message mentions the failed start`);
    // The setError-on-closed-dialog path is gone (dialog is closed by then).
    assert.doesNotMatch(source, /setError\([`'"][^`'"]*could not start/, `${file}: no dead-dialog error`);
  }
});
