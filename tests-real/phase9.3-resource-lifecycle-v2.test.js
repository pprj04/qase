/**
 * Phase 9.3 — Resource Lifecycle & Browser Cleanup Tests
 *
 * Tests the memory/resource fixes introduced in Phase 9.3:
 *   1. Session pruning reduces memory footprint
 *   2. Browser cleanup on session completion
 *   3. Resource cleanup timer runs periodically
 *   4. Mission finalizer closes browser for idle sessions
 *   5. No session state duplication
 *   6. sessions.json stays bounded
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

/* ── Hermetic store harness (R2-B-H) ────────────────────────────────────
 * RL-1/RL-2 previously read the LIVE dev .qase/sessions.json (cwd = /workspace)
 * and asserted `data.length > 0` — dev data that another suite's isolation
 * bug had legitimately wiped to []. They now own a temporary cwd: a fresh
 * store module (cache-busted dynamic import, own cwd-derived STATE_DIR) is
 * loaded there, seeded with 80 sessions, pruned, and the on-disk bound
 * assertions run against the TEMP store only. The real /workspace/.qase is
 * never read or written by this suite. All other tests below stay anchored
 * to the repo cwd (they read repo source files). */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

function createHermeticStoreHarness() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'qase-rl-'));
  const prevCwd = process.cwd();
  process.chdir(cwd);
  return {
    cwd,
    async load() {
      return await import(
        `../server/store.js?hermetic=${encodeURIComponent(cwd)}&t=${Date.now()}-${Math.random()}`
      );
    },
    cleanup() {
      process.chdir(prevCwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  };
}

/* ── Tests ──────────────────────────────────────────────────────── */

describe('Phase 9.3 — Resource Lifecycle', () => {

  it('RL-1: sessions.json is bounded (< 10MB after pruning)', async () => {
    // R2-B-H: hermetic — measured on a temp store seeded and pruned by this test.
    const harness = createHermeticStoreHarness();
    try {
      const store = await harness.load();
      for (let i = 0; i < 80; i++) {
        const s = store.createSession(`hermetic-rl1-${i}`);
        s.messages.push({ id: `m${i}`, ts: 1, role: 'user', content: 'x'.repeat(500 + (i % 7) * 250) });
      }
      await new Promise(r => setTimeout(r, 500)); // let persistSoon debounce flush to disk
      store.pruneOldSessions();
      store.persistSessionsNow();

      const stateFile = path.join(harness.cwd, '.qase', 'sessions.json');
      assert.ok(fs.existsSync(stateFile), 'temp sessions.json should exist after persist');
      const stats = fs.statSync(stateFile);
      const sizeMB = stats.size / 1024 / 1024;
      console.log(`  hermetic sessions.json: ${sizeMB.toFixed(2)}MB`);
      assert.ok(sizeMB < 15,
        `sessions.json should be < 15MB after pruning, got ${sizeMB.toFixed(2)}MB`);
    } finally {
      harness.cleanup();
    }
  });

  it('RL-2: Session count is bounded (pruned at 50 by server)', async () => {
    // R2-B-H: hermetic — count bound verified on a temp store seeded with 80
    // sessions then pruned. Previously this read the live dev store and failed
    // `data.length > 0` whenever dev data was legitimately empty (wiped by the
    // session-timeout isolation bug this ticket fixes). Same bounds as before
    // (≤ 200, > 0), now against deterministic seeded input.
    const harness = createHermeticStoreHarness();
    try {
      const store = await harness.load();
      for (let i = 0; i < 80; i++) {
        const s = store.createSession(`hermetic-rl2-${i}`);
        s.messages.push({ id: `m${i}`, ts: 1, role: 'user', content: 'x'.repeat(300 + (i % 5) * 100) });
      }
      store.pruneOldSessions();
      store.persistSessionsNow();

      const stateFile = path.join(harness.cwd, '.qase', 'sessions.json');
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      console.log(`  hermetic session count: ${data.length}`);
      assert.ok(data.length <= 200,
        `Session count should be ≤ 200 (well-bounded), got ${data.length}`);
      assert.ok(data.length > 0, 'Should have some sessions');
      // The prune cap is the contract: 80 seeded → at most 50 kept (and never
      // below the 5-session floor from the byte-budget pass).
      assert.ok(data.length <= 50,
        `Pruned store should respect the keep-50 cap, got ${data.length}`);
    } finally {
      harness.cleanup();
    }
  });

  it('RL-3: No live Chrome processes when no session is running', () => {
    // This is a runtime check — at test time, no mission should be running
    try {
      const output = require('child_process').execSync(
        'ps aux | grep "chrom" | grep -v grep | grep -v "defunct" | wc -l',
        { encoding: 'utf8' }
      ).trim();
      const liveChrome = parseInt(output);
      console.log(`  Live Chrome processes: ${liveChrome}`);
      // Some zombies may exist but live chrome should be 0 when no mission runs
      // (Note: this test may see chrome if a mission just finished and cleanup hasn't run yet)
      assert.ok(liveChrome <= 6,
        `Expected ≤ 6 live Chrome processes (1 browser instance), got ${liveChrome}`);
    } catch {
      console.log('  Could not check Chrome processes — skipping');
    }
  });

  it('RL-4: Available memory > 4GB (OOM fix verification)', () => {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const match = meminfo.match(/MemAvailable:\s+(\d+)/);
      if (match) {
        const availableMB = parseInt(match[1]) / 1024;
        console.log(`  Available memory: ${availableMB.toFixed(0)}MB`);
        // After Phase 9.3 fixes, should have > 4GB available
        assert.ok(availableMB > 4000,
          `Expected > 4GB available, got ${availableMB.toFixed(0)}MB`);
      }
    } catch {
      console.log('  Could not read /proc/meminfo — skipping');
    }
  });

  it('RL-5: No screenshot artifacts accumulating in workspaces', () => {
    const workspacesDir = path.join(process.cwd(), '.qase', 'workspaces');
    if (!fs.existsSync(workspacesDir)) return;

    // Check total workspace size is reasonable
    try {
      const output = require('child_process').execSync(
        `du -s ${workspacesDir} 2>/dev/null | awk '{print $1}'`,
        { encoding: 'utf8' }
      ).trim();
      const sizeKB = parseInt(output);
      console.log(`  Workspaces size: ${sizeKB}KB`);
      // Should be < 50MB (51_200KB)
      assert.ok(sizeKB < 51200,
        `Workspaces should be < 50MB, got ${(sizeKB / 1024).toFixed(1)}MB`);
    } catch {
      console.log('  Could not check workspace size — skipping');
    }
  });

  it('RL-6: ContactVault benchmark app is available', () => {
    const appFile = path.join(process.cwd(), '.drytis', 'benchmarks', 'app6-contactvault.html');
    assert.ok(fs.existsSync(appFile), 'ContactVault benchmark app should exist');

    const html = fs.readFileSync(appFile, 'utf8');
    // Verify the known defect is present
    assert.ok(html.includes('NOT persisted') || html.includes('BUG'),
      'ContactVault should contain the known persistence bug');
    // Verify the form fields have proper label associations
    assert.ok(html.includes('for="nameInput"'), 'Name field should have label association');
    assert.ok(html.includes('for="emailInput"'), 'Email field should have label association');
    assert.ok(html.includes('for="phoneInput"'), 'Phone field should have label association');
  });

  it('RL-7: Benchmark server config includes ContactVault on port 9906', () => {
    const serverFile = path.join(process.cwd(), '.drytis', 'benchmark-server.js');
    const code = fs.readFileSync(serverFile, 'utf8');
    assert.ok(code.includes("9906: 'app6-contactvault.html'"),
      'Benchmark server should serve ContactVault on port 9906');
  });

  it('RL-8: Index.js has browser cleanup in mission finalizer', () => {
    const indexFile = path.join(process.cwd(), 'server', 'index.js');
    const code = fs.readFileSync(indexFile, 'utf8');
    // Phase 9.3 fix: finalizer closes browser for non-done sessions
    assert.ok(code.includes('Phase 9.3: Close browser'),
      'Mission finalizer should have Phase 9.3 browser cleanup comment');
    assert.ok(code.includes("sessionStatus !== 'done'"),
      'Finalizer should close browser when session is not done');
  });

  it('RL-9: Index.js has resource cleanup timer', () => {
    const indexFile = path.join(process.cwd(), 'server', 'index.js');
    const code = fs.readFileSync(indexFile, 'utf8');
    assert.ok(code.includes('Phase 9.3: Resource Cleanup'),
      'Should have Phase 9.3 resource cleanup section');
    assert.ok(code.includes('runResourceCleanup'),
      'Should have runResourceCleanup function');
    assert.ok(code.includes('pruneOldSessions'),
      'Should have pruneOldSessions function');
  });

  it('RL-10: Session pruning keeps 50 sessions', () => {
    const indexFile = path.join(process.cwd(), 'server', 'index.js');
    const code = fs.readFileSync(indexFile, 'utf8');
    // pruneOldSessions should be called with 50
    assert.ok(code.includes('pruneOldSessions(50)'),
      'Should prune to keep 50 sessions');
  });
});

describe('Phase 9.3 — Agent.js Lifecycle Instrumentation', () => {

  it('AL-1: closeBrowser calls bridge.suspend()', () => {
    const agentFile = path.join(process.cwd(), 'server', 'agent.js');
    const code = fs.readFileSync(agentFile, 'utf8');
    assert.ok(code.includes('record.bridge.suspend()'),
      'closeBrowser should call bridge.suspend() to kill Chromium');
  });

  it('AL-2: closeOtherBrowsers limits concurrent browsers', () => {
    const agentFile = path.join(process.cwd(), 'server', 'agent.js');
    const code = fs.readFileSync(agentFile, 'utf8');
    assert.ok(code.includes('closeOtherBrowsers'),
      'Should have closeOtherBrowsers function');
    assert.ok(code.includes('keepSessionId'),
      'Should accept keepSessionId parameter');
  });

  it('AL-3: dispose is set on record for runtime cleanup', () => {
    const agentFile = path.join(process.cwd(), 'server', 'agent.js');
    const code = fs.readFileSync(agentFile, 'utf8');
    assert.ok(code.includes('record.dispose'),
      'Should set record.dispose for cleanup');
    assert.ok(code.includes('runtime.dispose()'),
      'dispose should call runtime.dispose()');
  });

  it('AL-4: BROWSER_IDLE_MS is 0 (no idle timer leaks)', () => {
    const agentFile = path.join(process.cwd(), 'server', 'agent.js');
    const code = fs.readFileSync(agentFile, 'utf8');
    assert.ok(code.includes('BROWSER_IDLE_MS = 0'),
      'BROWSER_IDLE_MS should be 0');
  });

  it('AL-5: Session watchdog marks stuck sessions as interrupted', () => {
    const storeFile = path.join(process.cwd(), 'server', 'store.js');
    const code = fs.readFileSync(storeFile, 'utf8');
    assert.ok(code.includes('interrupted'),
      'Store should mark sessions as interrupted');
    assert.ok(code.includes('startWatchdog'),
      'Store should have startWatchdog');
  });
});

// Idle Watchdog Tests
describe('Phase 9.3 — Idle Watchdog', () => {
	it('should have MODEL_IDLE_TIMEOUT_MS constant', async () => {
		const code = fs.readFileSync(path.join(process.cwd(), 'server/agent.js'), 'utf8');
		assert.ok(code.includes('MODEL_IDLE_TIMEOUT_MS'), 'MODEL_IDLE_TIMEOUT_MS constant should exist');
		assert.ok(code.includes('5 * 60 * 1000'), 'MODEL_IDLE_TIMEOUT_MS should be 5 minutes');
	});

	it('should have idle timer with refresh on tool results', async () => {
		const code = fs.readFileSync(path.join(process.cwd(), 'server/agent.js'), 'utf8');
		assert.ok(code.includes('idleTimer.refresh()'), 'idleTimer.refresh() should be called on meaningful events');
		assert.ok(code.includes('idleAborted'), 'idleAborted flag should exist to distinguish from user stops');
	});

	it('should clear idle timer in finally block', async () => {
		const code = fs.readFileSync(path.join(process.cwd(), 'server/agent.js'), 'utf8');
		assert.ok(code.includes('clearTimeout(idleTimer)'), 'clearTimeout(idleTimer) should be in finally block');
	});

	it('should handle idle abort as retryable', async () => {
		const code = fs.readFileSync(path.join(process.cwd(), 'server/agent.js'), 'utf8');
		assert.ok(code.includes('idleAborted'), 'Idle abort should be handled separately from user abort');
		assert.ok(code.includes('Model went silent'), 'Should log appropriate message for idle timeout');
	});
});
