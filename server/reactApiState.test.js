import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('phase 2: api client ports the legacy contract exactly', () => {
  const client = read('src/api/client.ts');
  // CSRF cookie name + header, same-origin credentials, 401 reload semantics
  assert.match(client, /qase_csrf/);
  assert.match(client, /X-CSRF-Token/);
  assert.match(client, /credentials:\s*'same-origin'/);
  assert.match(client, /status === 401/);
  assert.match(client, /window\.location\.reload/);
  assert.match(client, /path\.startsWith\('\/auth\/'\)/);
  // {error} JSON parsing with text fallback
  assert.match(client, /JSON\.parse\(text\)\.error/);
  // 204 → undefined on api()
  assert.match(client, /status === 204 \? undefined : response\.json\(\)/);
});

test('phase 2: sse layer covers every legacy event type', () => {
  const sse = read('src/api/sse.ts');
  const eventTypes = [
    'frame', 'cursor', 'message', 'message_delta', 'message_done',
    'activity', 'todos', 'context', 'usage', 'finding', 'report',
    'sqa', 'founder.created', 'founder.target_bound',
    'founder.observation', 'founder.finalized', 'question', 'status',
    'browser', 'session',
  ];
  for (const type of eventTypes) {
    assert.ok(sse.includes(`'${type}'`), `SSE covers event type '${type}'`);
  }
  // Snapshot resync with revision guard (port of legacy connect())
  assert.match(sse, /revision !== eventRevision/);
  assert.match(sse, /setTimeout\(resync, 250\)/);
  assert.match(sse, /setTimeout\(resync, 1000\)/);
  // EventSource endpoint
  assert.match(sse, /\/api\/sessions\/\$\{sessionId\}\/events/);
  // connection lifecycle surfaced
  assert.match(sse, /onConnectionChange/);
});

test('phase 2: session store implements server-authoritative timers', () => {
  const store = read('src/state/sessionStore.tsx');
  // skew correction from serverNow
  assert.match(store, /skewMs/);
  assert.match(store, /serverNow - Date\.now\(\)/);
  // elapsedSecondsOf port: pause freezing + pausedSeconds exclusion
  assert.match(store, /pausedSeconds/);
  assert.match(store, /Math\.max\(0, Math\.floor/);
  // run list fetch + delete with fallback selection
  assert.match(store, /api<RunSummary\[\]>\('\/sessions'\)/);
  assert.match(store, /method: 'DELETE'/);
  assert.match(store, /remaining\[0\]/);
  // 1s tick for live timers
  assert.match(store, /setInterval/);
  // terminal status triggers list refresh
  assert.match(store, /event\.status !== 'running'/);
});

test('phase 2: run list renders live badges (engine, mode, device, tokens, progress)', () => {
  const runList = read('src/components/RunList.tsx');
  assert.match(runList, /run-engine-pill/);
  assert.match(runList, /run-mode-badge/);
  assert.match(runList, /run-device-pill/);
  assert.match(runList, /run-badge--tokens/);
  assert.match(runList, /run-progress-bar/);
  assert.match(runList, /role="progressbar"/);
  // delete with confirmation affordance
  assert.match(runList, /Delete this run\?/);
  assert.match(runList, /aria-label=\{`Delete run/);
});

test('phase 2: App wires store into shell (run list + connection status)', () => {
  const app = read('src/App.tsx');
  assert.match(app, /SessionStoreProvider/);
  assert.match(app, /<RunList \/>/);
  assert.match(app, /connLabel/);
  assert.match(app, /run.*in progress/);
});
