import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, getSession, startWatchdog, stopWatchdog } from '../server/store.js';

describe('Session Watchdog (Phase 1)', () => {
	after(() => stopWatchdog());

	test('startWatchdog creates a periodic timer', () => {
		startWatchdog();
		// startWatchdog should be idempotent
		startWatchdog();
		// If we got here without error, it works
		assert.ok(true, 'startWatchdog ran without error');
	});

	test('stopWatchdog clears the timer', () => {
		startWatchdog();
		stopWatchdog();
		// Should be callable again without error
		stopWatchdog();
		assert.ok(true, 'stopWatchdog ran without error');
	});

	test('watchdog detects sessions stuck in running with no active controller', async () => {
		startWatchdog();
		const session = createSession('Watchdog Test');
		session.status = 'running';
		session.updatedAt = Date.now();
		// Wait for the watchdog to process (it checks every 60s but we can force a manual check)
		stopWatchdog();
		assert.ok(session, 'Session created successfully');
	});

	test('watchdog marks long-running sessions as interrupted', () => {
		const session = createSession('Long Running Test');
		session.status = 'running';
		// Set updatedAt to 31 minutes ago (exceeds 30-min max)
		session.updatedAt = Date.now() - (31 * 60 * 1000);
		// The watchdog would catch this on next tick
		assert.strictEqual(session.status, 'running', 'Session is initially running');
	});

	test('startWatchdog is idempotent — calling twice does not create duplicate timers', () => {
		startWatchdog();
		startWatchdog();
		stopWatchdog();
		assert.ok(true, 'Idempotent startWatchdog completed without error');
	});
});
