import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pins for the remaining Phase 6 viewer surfaces: the live pointer overlay,
 * the collapse note, the Activity/Plan tabs, and QA launcher device
 * persistence. These are source-level contracts — the runtime behavior is
 * exercised by the tester sub-agent in the browser.
 */

const viewer = fs.readFileSync(path.join(root, 'src/components/ViewerPanel.tsx'), 'utf8');
const launcher = fs.readFileSync(path.join(root, 'src/components/QaLauncher.tsx'), 'utf8');
const live = fs.readFileSync(path.join(root, 'src/state/liveSession.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/shell.css'), 'utf8');

test('viewer tabs include Activity and Plan with counts', () => {
  assert.match(viewer, /\['browser', 'activity', 'plan', 'findings', 'report'\] as Tab\[\]/);
  assert.match(viewer, /aria-controls=\{`panel-\$\{id\}`\}/);
  assert.match(viewer, /Plan\$\{planDone/);
  assert.match(viewer, /Findings\$\{session\?\.findings\.length/);
});

test('collapse note uses the exact legacy string', () => {
  assert.match(viewer, /Run complete — live view collapsed/);
  assert.match(viewer, /data-testid="stage-note"/);
  assert.match(css, /\.stage-note \{/);
});

test('pointer overlay ports the legacy cursor contract', () => {
  assert.match(viewer, /function CursorOverlay/);
  assert.match(viewer, /endsWith\(':done'\)/);
  assert.match(viewer, /1500/); // legacy fade timer
  assert.match(viewer, /M5 2\.5 19 12\.2l-6\.1\.55 3\.2 6\.6-2\.6 1\.25-3\.2-6\.6L5 18\.6Z/); // legacy cursor svg path
  assert.match(viewer, /truncate\(String\(cursor\.label\), 34\)/); // legacy label cap
  assert.match(viewer, /text\.length > max \? `\$\{text\.slice\(0, max - 1\)\}…` : text/); // legacy truncate semantics
  assert.match(css, /\.cursor-overlay \{/);
  assert.match(css, /\.target-box \{/);
});

test('LiveCursor carries the full legacy payload shape', () => {
  assert.match(live, /export interface LiveCursor \{/);
  assert.match(live, /verb\?: string;/);
  assert.match(live, /viewport\?: \{ width: number; height: number \};/);
  assert.match(live, /box\?: \{ x: number; y: number; width: number; height: number \};/);
});

test('activity feed renders legacy icon/detail/time semantics', () => {
  assert.match(viewer, /function ActivityFeed/);
  assert.match(viewer, /a\.status === 'running' \? '◉' : a\.status === 'failed' \? '✕' : '●'/);
  assert.match(viewer, /a\.error \?\? a\.summary \?\? a\.detail/);
  assert.match(viewer, /The agent has not written a test plan yet/);
});

test('QA launcher persists device + orientation with legacy keys', () => {
  assert.match(launcher, /localStorage\.getItem\('qase\.device'\)/);
  assert.match(launcher, /localStorage\.getItem\('qase\.deviceLandscape'\)/);
  assert.match(launcher, /localStorage\.setItem\('qase\.device'/);
  assert.match(launcher, /localStorage\.setItem\('qase\.deviceLandscape', e\.target\.checked \? '1' : '0'\)/);
});

test('kickoff message failure surfaces as a toast, not silence', () => {
  assert.ok(!launcher.includes('.catch(() => undefined)'));
  assert.match(launcher, /was created but the kickoff message failed/);
  assert.match(launcher, /'bad',\s*\n\s*\);/);
});
