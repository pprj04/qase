/**
 * P1 direct-path SPA routing contract.
 *
 * An isolated required-auth server proves direct browser routes receive only
 * the shell, while API and missing-static URLs keep their original contracts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MACHINE_TOKEN = 'routing-machine-token';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function boot() {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'qase-p1-routing-'));
  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      QASE_DATA_DIR: dataDir,
      QASE_AUTH_MODE: 'required',
      QASE_API_TOKEN: MACHINE_TOKEN,
      QASE_ENABLE_DEMO: 'false'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const base = 'http://127.0.0.1:' + port;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error('routing server exited: ' + stderr.slice(-500));
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    await delay(100);
    if (attempt === 79) throw new Error('routing server did not start: ' + stderr.slice(-500));
  }

  return {
    base,
    async close() {
      if (child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        try { child.kill('SIGTERM'); } catch {}
        await Promise.race([exited, delay(2_000)]);
        if (child.exitCode === null) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }
      try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
    }
  };
}

async function get(base, path, { token } = {}) {
  const response = await fetch(base + path, {
    redirect: 'manual',
    headers: token ? { Authorization: 'Bearer ' + token } : {}
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text: await response.text()
  };
}

test('P1 routing: known direct paths serve the shell without bypassing required API auth', async t => {
  const server = await boot();
  t.after(() => server.close());

  for (const path of ['/', '/tests', '/bugs', '/workflows', '/schedules', '/runs', '/runs/route-test-id']) {
    const result = await get(server.base, path);
    assert.equal(result.status, 200, path + ' should serve the SPA shell');
    assert.match(result.contentType, /^text\/html\b/i);
    assert.match(result.text, /id="page-runs"/);
    assert.match(result.text, /src="\/app\.js"/);
    assert.doesNotMatch(result.text, /api[_-]?key|authorization:\s*bearer/i);
  }

  const protectedConfig = await get(server.base, '/api/config');
  assert.equal(protectedConfig.status, 401);
  assert.match(protectedConfig.contentType, /application\/json/i);
});

test('P1 routing: API and missing-static routes are never swallowed by the SPA fallback', async t => {
  const server = await boot();
  t.after(() => server.close());

  const health = await get(server.base, '/api/health');
  assert.equal(health.status, 200);
  assert.match(health.contentType, /application\/json/i);
  assert.match(health.text, /"status"\s*:\s*"ok"/i);

  const openapi = await get(server.base, '/openapi.json');
  assert.equal(openapi.status, 200);
  assert.match(openapi.contentType, /application\/json/i);
  assert.match(openapi.text, /"openapi"/);

  const unknownApi = await get(server.base, '/api/not-a-real-route', { token: MACHINE_TOKEN });
  assert.equal(unknownApi.status, 404);
  assert.match(unknownApi.contentType, /application\/json/i);
  assert.doesNotMatch(unknownApi.text, /id="page-runs"/);

  const missingStatic = await get(server.base, '/missing-asset.js');
  assert.equal(missingStatic.status, 404);
  assert.doesNotMatch(missingStatic.text, /id="page-runs"/);
});
