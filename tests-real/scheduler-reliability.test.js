import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scheduler stores are module-relative. Run from a full isolated source copy
// so this suite can never read or mutate the developer/production .qase data.
const root = resolve(import.meta.dirname, '..');
const isolated = mkdtempSync(join(root, 'artifacts', 'scheduler-reliability-'));
for (const entry of ['server', 'package.json']) cpSync(join(root, entry), join(isolated, entry), { recursive: true });
mkdirSync(join(isolated, '.qase'));
process.chdir(isolated);

const schedulerUrl = pathToFileURL(join(isolated, 'server', 'scheduler.js')).href;
const capabilitiesUrl = pathToFileURL(join(isolated, 'server', 'capabilities.js')).href;
const scheduler = await import(schedulerUrl);
const { createDefaultRegistry, Orchestrator } = await import(capabilitiesUrl);
const storeFile = join(isolated, '.qase', 'schedules.json');
const baseNow = Date.now();

function dueSchedule(index, overrides = {}) {
	const offset = Number.isFinite(Number(index)) ? Number(index) : 0;
	return {
		id: `schedule-${index}`,
		name: `Explicit schedule ${index}`,
		targetUrl: 'https://example.com',
		testCaseIds: [`case-${index}`],
		cronExpr: '* * * * *',
		credentials: {},
		enabled: true,
		lastRun: undefined,
		nextRun: baseNow - 60_000 - offset,
		createdAt: baseNow - 120_000,
		updatedAt: baseNow - 120_000,
		...overrides
	};
}

function successfulSummary() {
	return { total: 1, passed: 1, failed: 0, errored: 0, results: [] };
}

function readSchedules() {
	return JSON.parse(readFileSync(storeFile, 'utf8'));
}

test('P0 scheduler reliability hardening', async t => {
	await t.test('normal mission pipeline cannot create an Auto schedule', async () => {
		scheduler.__configureSchedulerForTests({ schedules: [], config: { schedulerConcurrency: 1 }, now: () => baseNow });
		const capability = createDefaultRegistry().get('schedule_create');
		assert.equal(capability.enabled({ autoCreateSchedule: true }, {}), false);
		await capability.execute({ id: 'normal-mission', targetUrl: 'https://example.com' });
		assert.equal(scheduler.listSchedules().length, 0);
	});

	await t.test('normal orchestrated run leaves recurring schedules unchanged', async () => {
		scheduler.__configureSchedulerForTests({ schedules: [], config: { schedulerConcurrency: 1 }, now: () => baseNow });
		const registry = createDefaultRegistry();
		const orchestrator = new Orchestrator(registry);
		await orchestrator.execute(
			{ id: 'normal-run', targetUrl: 'https://example.com' },
			{ autoCreateSchedule: true },
			{ capabilityFilter: id => id === 'schedule_create' }
		);
		assert.equal(scheduler.listSchedules().length, 0);
	});

	await t.test('explicit schedule creation remains enabled', () => {
		scheduler.__configureSchedulerForTests({ schedules: [], config: { schedulerConcurrency: 1 }, now: () => baseNow });
		const created = scheduler.createSchedule({ name: 'User-created schedule', cronExpr: '0 9 * * *', enabled: true });
		assert.equal(created.name, 'User-created schedule');
		assert.equal(created.enabled, true);
		assert.ok(Number.isFinite(created.nextRun));
		assert.equal(scheduler.listSchedules().length, 1);
	});

	await t.test('many due schedules never exceed the configured dispatch cap', async () => {
		let active = 0;
		let maxActive = 0;
		const releases = [];
		const calls = [];
		scheduler.__configureSchedulerForTests({
			schedules: Array.from({ length: 8 }, (_, index) => dueSchedule(index)),
			config: { schedulerConcurrency: 2, schedulerExecutionTimeoutMinutes: 60 },
			now: () => baseNow,
			execute: async schedule => {
				calls.push(schedule.id);
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise(resolve => releases.push(resolve));
				active--;
				return successfulSummary();
			}
		});
		const tick = scheduler.runSchedulerTick();
		assert.deepEqual({ started: tick.started, deferred: tick.deferred }, { started: 2, deferred: 6 });
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(calls.length, 2);
		assert.equal(maxActive, 2);
		assert.equal(scheduler.schedulerStats().active, 2);
		for (const release of releases) release();
		await scheduler.__waitForSchedulerIdleForTests();
	});

	await t.test('excess due schedules remain persisted as deferred', () => {
		const persisted = readSchedules();
		assert.equal(persisted.filter(item => item.schedulerState?.status === 'deferred').length, 6);
		assert.equal(persisted.filter(item => item.schedulerState?.reason === 'scheduler_concurrency_limit').length, 6);
		assert.equal(persisted.filter(item => item.schedulerState?.status === 'completed').length, 2);
	});

	await t.test('simultaneous ticks cannot double-claim an occurrence or exceed capacity', async () => {
		let calls = 0;
		let release;
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('tick-race')],
			config: { schedulerConcurrency: 1, schedulerExecutionTimeoutMinutes: 60 },
			now: () => baseNow,
			execute: async () => {
				calls++;
				await new Promise(resolve => { release = resolve; });
				return successfulSummary();
			}
		});
		const first = scheduler.runSchedulerTick();
		const second = scheduler.runSchedulerTick();
		assert.equal(first.started, 1);
		assert.equal(second.started, 0);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(calls, 1);
		assert.equal(scheduler.schedulerStats().active, 1);
		release();
		await scheduler.__waitForSchedulerIdleForTests();
	});

	await t.test('malformed concurrency settings clamp to a safe bounded value', () => {
		for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'invalid']) {
			scheduler.__configureSchedulerForTests({ schedules: [], config: { schedulerConcurrency: value } });
			assert.equal(scheduler.schedulerStats().concurrency, 1);
		}
		scheduler.__configureSchedulerForTests({ schedules: [], config: { schedulerConcurrency: 999 } });
		assert.equal(scheduler.schedulerStats().concurrency, 10);
	});

	await t.test('browser execution cannot start when the occurrence claim is not durable', async () => {
		let calls = 0;
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('persist-failure')],
			config: { schedulerConcurrency: 1 },
			now: () => baseNow,
			persistSchedules: () => false,
			execute: async () => { calls++; return successfulSummary(); }
		});
		assert.throws(
			() => scheduler.runSchedulerTick(),
			error => error?.code === 'SCHEDULER_PERSISTENCE_FAILED'
		);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(calls, 0);
		assert.equal(scheduler.schedulerStats().active, 0);
		assert.equal(scheduler.listSchedules()[0].schedulerState.reason, 'scheduler_persistence_failed');
	});

	await t.test('manual execution also refuses to start without durable admission state', async () => {
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('manual-persist-failure', { testCaseIds: [] })],
			config: { schedulerConcurrency: 1 },
			now: () => baseNow,
			persistSchedules: () => false
		});
		await assert.rejects(
			() => scheduler.executeSchedule(scheduler.listSchedules()[0]),
			error => error?.code === 'SCHEDULER_PERSISTENCE_FAILED'
		);
		assert.equal(scheduler.schedulerStats().active, 0);
		assert.equal(scheduler.listSchedules()[0].manualExecutionState.reason, 'scheduler_persistence_failed');
	});

	await t.test('interactive mission load defers all scheduled browser work', () => {
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('interactive')],
			config: { schedulerConcurrency: 2 },
			now: () => baseNow,
			activeMissionCount: () => 1,
			execute: async () => successfulSummary()
		});
		const tick = scheduler.runSchedulerTick();
		assert.equal(tick.started, 0);
		assert.equal(tick.deferred, 1);
		assert.equal(scheduler.listSchedules()[0].schedulerState.reason, 'active_interactive_execution');
	});

	await t.test('explicit schedule run is truthfully deferred when capacity is unavailable', async () => {
		const schedule = dueSchedule('manual');
		scheduler.__configureSchedulerForTests({
			schedules: [schedule],
			config: { schedulerConcurrency: 1 },
			now: () => baseNow,
			activeMissionCount: () => 1
		});
		await assert.rejects(
			() => scheduler.executeSchedule(scheduler.listSchedules()[0]),
			error => error?.code === 'SCHEDULE_EXECUTION_DEFERRED'
		);
		assert.equal(scheduler.listSchedules()[0].manualExecutionState.status, 'deferred');
		assert.equal(scheduler.listSchedules()[0].manualExecutionState.reason, 'active_interactive_execution');
	});

	await t.test('restart with many overdue schedules launches only the bounded catch-up batch', async () => {
		scheduler.__configureSchedulerForTests({
			schedules: Array.from({ length: 9 }, (_, index) => dueSchedule(`restart-bulk-${index}`)),
			persist: true,
			config: { schedulerConcurrency: 2 },
			now: () => baseNow
		});
		const restarted = await import(`${schedulerUrl}?bulk-restart=${Date.now()}`);
		const releases = [];
		restarted.__configureSchedulerForTests({
			config: { schedulerConcurrency: 2, schedulerExecutionTimeoutMinutes: 60 },
			now: () => baseNow,
			execute: async () => {
				await new Promise(resolve => releases.push(resolve));
				return successfulSummary();
			}
		});
		const tick = restarted.runSchedulerTick();
		assert.equal(tick.started, 2);
		assert.equal(tick.deferred, 7);
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(restarted.schedulerStats().active, 2);
		for (const release of releases) release();
		await restarted.__waitForSchedulerIdleForTests();
	});

	await t.test('restart does not dispatch the same claimed overdue occurrence twice', async () => {
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('restart')],
			persist: true,
			config: { schedulerConcurrency: 1, schedulerExecutionTimeoutMinutes: 60 },
			now: () => baseNow,
			execute: async () => new Promise(() => {})
		});
		const first = scheduler.runSchedulerTick();
		assert.equal(first.started, 1);
		const claimed = readSchedules()[0];
		assert.equal(claimed.schedulerState.status, 'running');
		assert.ok(claimed.nextRun > baseNow);

		const restarted = await import(`${schedulerUrl}?restart=${Date.now()}`);
		let restartCalls = 0;
		restarted.__configureSchedulerForTests({
			config: { schedulerConcurrency: 1 },
			now: () => baseNow,
			execute: async () => { restartCalls++; return successfulSummary(); }
		});
		const afterRestart = restarted.runSchedulerTick();
		assert.equal(afterRestart.started, 0);
		assert.equal(restartCalls, 0);
		assert.equal(restarted.listSchedules()[0].schedulerState.reason, 'scheduler_restart_interrupted');
	});

	await t.test('failed execution advances nextRun and cannot immediately retry', async () => {
		let calls = 0;
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('failure')],
			config: { schedulerConcurrency: 1, schedulerExecutionTimeoutMinutes: 60 },
			now: () => baseNow,
			execute: async () => { calls++; throw new Error('injected runtime unavailable'); }
		});
		scheduler.runSchedulerTick();
		await scheduler.__waitForSchedulerIdleForTests();
		const failed = scheduler.listSchedules()[0];
		assert.equal(failed.schedulerState.status, 'failed');
		assert.equal(failed.lastRun.result, 'failed');
		assert.ok(failed.nextRun > baseNow);
		assert.equal(scheduler.runSchedulerTick().started, 0);
		assert.equal(calls, 1);
	});

	await t.test('errored replay summary records failed rather than completed', async () => {
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('errored-summary')],
			config: { schedulerConcurrency: 1 },
			now: () => baseNow,
			execute: async () => ({ total: 1, passed: 0, failed: 0, errored: 1, results: [] })
		});
		scheduler.runSchedulerTick();
		await scheduler.__waitForSchedulerIdleForTests();
		const failed = scheduler.listSchedules()[0];
		assert.equal(failed.schedulerState.status, 'failed');
		assert.equal(failed.schedulerState.result, 'failed');
		assert.equal(failed.schedulerState.reason, 'scheduled_execution_failed');
	});

	await t.test('stuck execution times out and releases its scheduler slot', async () => {
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('timeout')],
			config: { schedulerConcurrency: 1 },
			now: () => baseNow,
			timeoutMs: 25,
			execute: async () => new Promise(() => {})
		});
		scheduler.runSchedulerTick();
		await scheduler.__waitForSchedulerIdleForTests();
		const timedOut = scheduler.listSchedules()[0];
		assert.equal(timedOut.schedulerState.status, 'failed');
		assert.equal(timedOut.schedulerState.reason, 'scheduler_execution_timeout');
		assert.equal(scheduler.schedulerStats().active, 0);
	});

	await t.test('claimed occurrence and terminal scheduler state persist atomically', async () => {
		scheduler.__configureSchedulerForTests({
			schedules: [dueSchedule('persist')],
			persist: true,
			config: { schedulerConcurrency: 1 },
			now: () => baseNow,
			execute: async () => successfulSummary()
		});
		scheduler.runSchedulerTick();
		await scheduler.__waitForSchedulerIdleForTests();
		const persisted = readSchedules()[0];
		assert.equal(persisted.schedulerState.status, 'completed');
		assert.ok(persisted.nextRun > baseNow);
		assert.equal(persisted.schedulerState.occurrenceAt, baseNow - 60_000);
	});
});
