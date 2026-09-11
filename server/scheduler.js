/**
 * Cron-style scheduler for regression test suites.
 *
 * Schedules are persisted to `.qase/schedules.json`. On boot the server
 * starts a tick loop (every 60s) that checks each enabled schedule and
 * triggers a run if its next-run time has passed.
 *
 * The actual test execution is delegated to replay.js's runTestSuite().
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CronExpressionParser } from 'cron-parser';
import { atomicWrite } from './atomicWrite.js';
import { getTestCase } from './testCases.js';
import { runTestSuite } from './replay.js';
import { getConfig } from './config.js';
import { addRegressionRun } from './regressionStore.js';
import { resolvedOwner } from './requestAccess.js';
import { notifyTestFailure } from './webhooks.js';
import { governorStats } from './missionGovernor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEDULES_FILE = join(__dirname, '..', '.qase', 'schedules.json');

let schedules = [];
let saveTimer = null;
let testHooks = null;

/* ── Persistence ────────────────────────────────────────────────── */

function load() {
	let changed = false;
	try {
		if (existsSync(SCHEDULES_FILE)) {
			schedules = JSON.parse(readFileSync(SCHEDULES_FILE, 'utf-8'));
		}
	} catch (err) {
		// M1-P4.4 Phase 5 — preserve damaged store for forensics, start empty.
		try {
			renameSync(SCHEDULES_FILE, `${SCHEDULES_FILE}.corrupt-${Date.now()}`);
			console.error(`[schedules] STORE CORRUPT: ${err.message}. File preserved — starting EMPTY.`);
		} catch {
			console.error(`[schedules] STORE CORRUPT: ${err.message} — starting EMPTY.`);
		}
		schedules = [];
	}
	const now = Date.now();
	// A process restart can leave a persisted dispatch marked running. The
	// occurrence was claimed and nextRun advanced before execution began, so
	// never replay it. Record the interruption truthfully and retain the next
	// future occurrence.
	for (const sched of schedules) {
		if (sched.schedulerState?.status === 'running') {
			sched.schedulerState = {
				...sched.schedulerState,
				status: 'failed',
				reason: 'scheduler_restart_interrupted',
				finishedAt: now
			};
			sched.lastRun = {
				ts: now,
				occurrenceAt: sched.schedulerState.occurrenceAt ?? null,
				result: 'failed',
				reason: 'scheduler_restart_interrupted'
			};
			sched.updatedAt = now;
			changed = true;
		}
		if (sched.manualExecutionState?.status === 'running') {
			sched.manualExecutionState = {
				...sched.manualExecutionState,
				status: 'failed',
				reason: 'scheduler_restart_interrupted',
				finishedAt: now
			};
			sched.updatedAt = now;
			changed = true;
		}
		// Backfill nextRun for any enabled schedule missing it.
		if (sched.enabled && !sched.nextRun) {
			sched.nextRun = computeNextRun(sched.cronExpr, new Date(now));
			changed = true;
		}
	}
	if (changed) saveSchedulesRaw();
}

function persistSoon() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		try {
			atomicWrite(SCHEDULES_FILE, JSON.stringify(schedules, null, '\t'));
		} catch (error) {
			console.error('Failed to persist schedules:', error.message);
		}
	}, 250);
}

load();

/** Immediately persist the in-memory schedules array to disk. */
export function saveSchedulesRaw() {
	try {
		if (testHooks?.persistSchedules) return testHooks.persistSchedules(schedules) !== false;
		atomicWrite(SCHEDULES_FILE, JSON.stringify(schedules, null, '\t'));
		return true;
	} catch (error) {
		console.error('Failed to persist schedules:', error.message);
		return false;
	}
}

/**
 * M1-P4.4 Phase 2 — graceful shutdown flush. Schedules persist IMMEDIATELY
 * (no debounce) on every mutation, so this is always clean; kept for uniform
 * registry semantics.
 */
export function flushSchedulesForShutdown() {
	return { dirty: false, ok: true };
}

/**
 * Backfill: assign defaultId to every schedule missing a projectId.
 * Returns the number updated.
 */
export function backfillProjectId(defaultId) {
	let count = 0;
	for (const sch of schedules) {
		if (!sch.projectId) {
			sch.projectId = defaultId;
			count++;
		}
	}
	if (count > 0) saveSchedulesRaw();
	return count;
}

/**
 * Reassign: move all schedules from fromProjectId to toProjectId.
 * Returns the number moved.
 */
export function reassignProjectId(fromProjectId, toProjectId) {
	let count = 0;
	for (const sch of schedules) {
		if (sch.projectId === fromProjectId) {
			sch.projectId = toProjectId;
			count++;
		}
	}
	if (count > 0) saveSchedulesRaw();
	return count;
}

/* ── Cron helpers ───────────────────────────────────────────────── */

function computeNextRun(cronExpr, from = new Date()) {
	try {
		const interval = CronExpressionParser.parse(cronExpr, { currentDate: from });
		return interval.next().getTime();
	} catch {
		return undefined;
	}
}

export function validateCron(cronExpr) {
	try {
		CronExpressionParser.parse(cronExpr);
		return true;
	} catch {
		return false;
	}
}

/* ── CRUD ───────────────────────────────────────────────────────── */

export function createSchedule(data) {
	const cron = data.cronExpr ?? '0 9 * * 1'; // default: Mon 9am
	if (!validateCron(cron)) {
		throw new Error(`Invalid cron expression: ${cron}`);
	}
	const schedule = {
		id: randomUUID(),
		ownerUserId: data.ownerUserId ?? null,
		projectId: data.projectId ?? undefined,
		name: data.name ?? 'Untitled schedule',
		targetUrl: data.targetUrl ?? '',
		testCaseIds: Array.isArray(data.testCaseIds) ? data.testCaseIds : [],
		cronExpr: cron,
		credentials: data.credentials ?? {},
		enabled: data.enabled !== false,
		lastRun: undefined,
		nextRun: computeNextRun(cron),
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
	schedules.push(schedule);
	persistSoon();
	return schedule;
}

export function listSchedules({ projectId } = {}) {
	return [...schedules]
		.filter(s => !projectId || s.projectId === projectId)
		.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function getSchedule(id) {
	return schedules.find(s => s.id === id);
}

export function updateSchedule(id, patch) {
	const sched = schedules.find(s => s.id === id);
	if (!sched) return undefined;

	if (typeof patch.name === 'string') sched.name = patch.name;
	if (typeof patch.targetUrl === 'string') sched.targetUrl = patch.targetUrl;
	if (typeof patch.projectId === 'string') sched.projectId = patch.projectId;
	if (typeof patch.cronExpr === 'string') {
		if (!validateCron(patch.cronExpr)) {
			throw new Error(`Invalid cron expression: ${patch.cronExpr}`);
		}
		sched.cronExpr = patch.cronExpr;
	}
	if (Array.isArray(patch.testCaseIds)) sched.testCaseIds = patch.testCaseIds;
	if (patch.credentials !== undefined) sched.credentials = patch.credentials;
	if (typeof patch.enabled === 'boolean') sched.enabled = patch.enabled;

	// Recompute next run if cron or enabled state changed.
	if (sched.enabled) {
		sched.nextRun = computeNextRun(sched.cronExpr);
	} else {
		sched.nextRun = undefined;
	}
	if (sched.schedulerState?.status === 'deferred') sched.schedulerState = undefined;

	sched.updatedAt = Date.now();
	persistSoon();
	return sched;
}

export function deleteSchedule(id) {
	const index = schedules.findIndex(s => s.id === id);
	if (index === -1) return false;
	schedules.splice(index, 1);
	persistSoon();
	return true;
}

/* ── Execution ──────────────────────────────────────────────────── */

/**
 * Runs a schedule's test cases and stores the result.
 * Called from the tick loop (scheduled) or the API (manual trigger).
 */
async function executeScheduleCore(schedule, options = {}) {
	const trigger = options.trigger ?? 'manual';
	const dispatchToken = options.dispatchToken ?? null;
	const stateField = options.stateField ?? 'schedulerState';
	const mayFinalize = () => !dispatchToken
		|| (schedule[stateField]?.dispatchToken === dispatchToken && schedule[stateField]?.status === 'running');
	const cases = schedule.testCaseIds
		.map(id => getTestCase(id))
		.filter(Boolean);
	// Background execution has no HTTP context: enforce the stored owner too.
	if (schedule.ownerUserId && cases.some(tc => resolvedOwner(tc) !== schedule.ownerUserId)) throw new Error('Schedule references a test case owned by another user.');

	if (cases.length === 0) {
		const summary = {
			id: randomUUID(),
			ownerUserId: schedule.ownerUserId ?? null,
			scheduleId: schedule.id,
			ts: Date.now(),
			targetUrl: schedule.targetUrl,
			trigger,
			total: 0, passed: 0, failed: 0, errored: 0,
			durationMs: 0,
			results: []
		};
		if (mayFinalize()) {
			const stored = addRegressionRun(summary);
			schedule.lastRun = { ts: summary.ts, result: 'no-test-cases', summary: stored };
			persistSoon();
		}
		return summary;
	}

	const config = getConfig();
	const summary = await runTestSuite(cases, {
		credentials: schedule.credentials,
		// Every schedule execution represents one bounded browser-load slot.
		// Cases run serially so schedulerConcurrency remains a hard bound even
		// for an explicit POST /schedules/:id/run.
		concurrency: 1,
		retries: config.retriesCount
	});

	summary.scheduleId = schedule.id;
	summary.ownerUserId = schedule.ownerUserId ?? null;
	summary.projectId = schedule.projectId;
	summary.targetUrl = schedule.targetUrl;
	summary.trigger = trigger;

	if (mayFinalize()) {
		addRegressionRun(summary);
		// Fire webhook if there are failures (fire-and-forget).
		notifyTestFailure(schedule.id, summary);
		schedule.lastRun = {
			ts: Date.now(),
			result: summary.failed + summary.errored === 0 ? 'pass' : 'fail',
			summary: { total: summary.total, passed: summary.passed, failed: summary.failed, errored: summary.errored, flaky: summary.flaky ?? 0 }
		};
		persistSoon();
	}

	return summary;
}

/**
 * Explicit/manual schedule execution uses the same admission bound as cron
 * dispatch. It fails fast with a truthful deferred state when interactive
 * missions or other schedule runs already consume the safe capacity.
 */
export async function executeSchedule(schedule, options = {}) {
	if (options.admitted === true) return executeScheduleCore(schedule, options);
	const requestedAt = nowMs();
	const missionLoad = activeMissionCount();
	const atCapacity = runningScheduleIds.size >= schedulerConcurrencyLimit();
	if (missionLoad > 0 || atCapacity || runningScheduleIds.has(schedule.id)) {
		const reason = missionLoad > 0 ? 'active_interactive_execution' : 'scheduler_concurrency_limit';
		schedule.manualExecutionState = { status: 'deferred', reason, requestedAt };
		schedule.updatedAt = requestedAt;
		saveSchedulesRaw();
		const error = new Error('Schedule execution deferred because safe execution capacity is unavailable.');
		error.code = 'SCHEDULE_EXECUTION_DEFERRED';
		throw error;
	}

	const dispatchToken = `manual:${schedule.id}:${randomUUID()}`;
	schedule.manualExecutionState = { status: 'running', dispatchToken, startedAt: requestedAt };
	schedule.updatedAt = requestedAt;
	runningScheduleIds.add(schedule.id);
	if (!saveSchedulesRaw()) {
		runningScheduleIds.delete(schedule.id);
		schedule.manualExecutionState = {
			...schedule.manualExecutionState,
			status: 'failed',
			reason: 'scheduler_persistence_failed',
			finishedAt: requestedAt
		};
		const error = new Error('Schedule execution was not started because its running state could not be persisted.');
		error.code = 'SCHEDULER_PERSISTENCE_FAILED';
		throw error;
	}
	try {
		const summary = await withExecutionTimeout(
			executeScheduleCore(schedule, { trigger: 'manual', dispatchToken, stateField: 'manualExecutionState' }),
			schedulerTimeoutMs()
		);
		if (schedule.manualExecutionState?.dispatchToken === dispatchToken) {
			const succeeded = summary.total > 0 && summary.failed + summary.errored === 0;
			schedule.manualExecutionState = {
				...schedule.manualExecutionState,
				status: succeeded ? 'completed' : 'failed',
				finishedAt: nowMs(),
				result: succeeded ? 'pass' : 'failed',
				...(succeeded ? {} : { reason: summary.total > 0 ? 'scheduled_execution_failed' : 'no_test_cases' })
			};
			saveSchedulesRaw();
		}
		return summary;
	} catch (error) {
		if (schedule.manualExecutionState?.dispatchToken === dispatchToken) {
			const finishedAt = nowMs();
			schedule.manualExecutionState = {
				...schedule.manualExecutionState,
				status: 'failed',
				finishedAt,
				reason: error?.code === 'SCHEDULER_EXECUTION_TIMEOUT'
					? 'scheduler_execution_timeout'
					: 'scheduled_execution_failed'
			};
			schedule.lastRun = { ts: finishedAt, result: 'failed', reason: schedule.manualExecutionState.reason };
			saveSchedulesRaw();
		}
		throw error;
	} finally {
		runningScheduleIds.delete(schedule.id);
	}
}

/* ── Tick loop ──────────────────────────────────────────────────── */

const runningScheduleIds = new Set();
const runningPromises = new Map();
const executionTimeouts = new Set();

function schedulerConfig() {
	return testHooks?.config ?? getConfig();
}

function schedulerConcurrencyLimit() {
	const value = Number(schedulerConfig().schedulerConcurrency);
	return Number.isFinite(value) && value >= 1 ? Math.min(10, Math.floor(value)) : 1;
}

function schedulerTimeoutMs() {
	if (Number.isFinite(testHooks?.timeoutMs) && testHooks.timeoutMs > 0) return testHooks.timeoutMs;
	const minutes = Number(schedulerConfig().schedulerExecutionTimeoutMinutes);
	return (Number.isFinite(minutes) && minutes >= 1 ? minutes : 60) * 60_000;
}

function nowMs() {
	return testHooks?.now?.() ?? Date.now();
}

function activeMissionCount() {
	if (testHooks?.activeMissionCount) return Math.max(0, Number(testHooks.activeMissionCount()) || 0);
	try {
		return Math.max(0, Number(governorStats().activeCount) || 0);
	} catch {
		return 0;
	}
}

function markDeferred(schedule, occurrenceAt, now, reason) {
	if (schedule.schedulerState?.status === 'deferred'
		&& schedule.schedulerState?.occurrenceAt === occurrenceAt
		&& schedule.schedulerState?.reason === reason) return false;
	schedule.schedulerState = {
		status: 'deferred',
		occurrenceAt,
		reason,
		deferredAt: now
	};
	schedule.updatedAt = now;
	return true;
}

function withExecutionTimeout(promise, timeoutMs) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => {
			executionTimeouts.delete(timer);
			const error = new Error(`Scheduled execution exceeded ${timeoutMs}ms`);
			error.code = 'SCHEDULER_EXECUTION_TIMEOUT';
			reject(error);
		}, timeoutMs);
		executionTimeouts.add(timer);
	});
	return Promise.race([promise, timeout]).finally(() => {
		clearTimeout(timer);
		executionTimeouts.delete(timer);
	});
}

function dispatchSchedule(schedule, occurrenceAt, now) {
	const dispatchToken = `${schedule.id}:${occurrenceAt}:${randomUUID()}`;
	// Claim the occurrence and advance directly to the first future cron time
	// before launching any browser. The synchronous atomic write prevents the
	// same occurrence from being dispatched again after a restart.
	schedule.nextRun = computeNextRun(schedule.cronExpr, new Date(now));
	schedule.schedulerState = {
		status: 'running',
		occurrenceAt,
		dispatchToken,
		startedAt: now
	};
	schedule.updatedAt = now;
	runningScheduleIds.add(schedule.id);
	if (!saveSchedulesRaw()) {
		// Never launch browser work without a durable occurrence claim. Keep the
		// in-memory nextRun advanced to avoid a tight retry loop in this process;
		// after restart the last durable file remains authoritative and due.
		runningScheduleIds.delete(schedule.id);
		schedule.schedulerState = {
			...schedule.schedulerState,
			status: 'failed',
			reason: 'scheduler_persistence_failed',
			finishedAt: now
		};
		const error = new Error('Scheduled execution was not started because its occurrence claim could not be persisted.');
		error.code = 'SCHEDULER_PERSISTENCE_FAILED';
		throw error;
	}

	const executor = testHooks?.execute ?? executeSchedule;
	const work = withExecutionTimeout(
		Promise.resolve().then(() => executor(schedule, { trigger: 'scheduled', occurrenceAt, dispatchToken, admitted: true })),
		schedulerTimeoutMs()
	)
		.then(summary => {
			if (schedule.schedulerState?.dispatchToken !== dispatchToken) return summary;
			const succeeded = summary.total > 0 && summary.failed + summary.errored === 0;
			schedule.schedulerState = {
				...schedule.schedulerState,
				status: succeeded ? 'completed' : 'failed',
				finishedAt: nowMs(),
				result: succeeded ? 'pass' : 'failed',
				...(succeeded ? {} : { reason: summary.total > 0 ? 'scheduled_execution_failed' : 'no_test_cases' })
			};
			saveSchedulesRaw();
			if (succeeded) {
				console.log(`[scheduler] Schedule "${schedule.name}" complete: ${summary.passed}/${summary.total} passed`);
			} else {
				console.error(`[scheduler] Schedule "${schedule.name}" failed: ${summary.failed} failed, ${summary.errored} errored of ${summary.total}`);
			}
			return summary;
		})
		.catch(error => {
			if (schedule.schedulerState?.dispatchToken === dispatchToken) {
				const finishedAt = nowMs();
				schedule.schedulerState = {
					...schedule.schedulerState,
					status: 'failed',
					finishedAt,
					reason: error?.code === 'SCHEDULER_EXECUTION_TIMEOUT'
						? 'scheduler_execution_timeout'
						: 'scheduled_execution_failed'
				};
				schedule.lastRun = {
					ts: finishedAt,
					occurrenceAt,
					result: 'failed',
					reason: schedule.schedulerState.reason
				};
				saveSchedulesRaw();
			}
			console.error(`[scheduler] Schedule "${schedule.name}" failed:`, error?.message ?? error);
		})
		.finally(() => {
			runningScheduleIds.delete(schedule.id);
			runningPromises.delete(schedule.id);
		});
	runningPromises.set(schedule.id, work);
}

export function runSchedulerTick() {
	const now = nowMs();
	const due = schedules
		.filter(schedule => schedule.enabled && Number.isFinite(Number(schedule.nextRun)) && Number(schedule.nextRun) <= now)
		.sort((a, b) => Number(a.nextRun) - Number(b.nextRun) || String(a.id).localeCompare(String(b.id)));
	const missionLoad = activeMissionCount();
	let slots = missionLoad > 0 ? 0 : Math.max(0, schedulerConcurrencyLimit() - runningScheduleIds.size);
	let started = 0;
	let deferred = 0;
	let dirty = false;

	for (const schedule of due) {
		if (runningScheduleIds.has(schedule.id)) continue;
		const occurrenceAt = Number(schedule.nextRun);
		if (slots <= 0) {
			const reason = missionLoad > 0 ? 'active_interactive_execution' : 'scheduler_concurrency_limit';
			dirty = markDeferred(schedule, occurrenceAt, now, reason) || dirty;
			deferred++;
			continue;
		}
		console.log(`[scheduler] Triggering schedule "${schedule.name}" (${schedule.id}) occurrence ${occurrenceAt}`);
		dispatchSchedule(schedule, occurrenceAt, now);
		slots--;
		started++;
	}
	if (dirty) saveSchedulesRaw();
	return { due: due.length, started, deferred, active: runningScheduleIds.size, missionLoad };
}

let tickInterval = null;

export function startScheduler(intervalMs = 60_000) {
	if (tickInterval) return;
	tickInterval = setInterval(runSchedulerTick, intervalMs);
	tickInterval.unref?.();
	console.log(`[scheduler] Started, checking every ${Math.round(intervalMs / 1000)}s`);
}

export function stopScheduler() {
	if (tickInterval) {
		clearInterval(tickInterval);
		tickInterval = null;
	}
}

export function schedulerStats() {
	return {
		concurrency: schedulerConcurrencyLimit(),
		active: runningScheduleIds.size,
		deferred: schedules.filter(schedule => schedule.schedulerState?.status === 'deferred').length,
		running: [...runningScheduleIds]
	};
}

/** Test-only hooks. Tests run this module from an isolated source copy. */
export function __configureSchedulerForTests(options = null) {
	stopScheduler();
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	for (const timer of executionTimeouts) clearTimeout(timer);
	executionTimeouts.clear();
	runningScheduleIds.clear();
	runningPromises.clear();
	testHooks = options;
	if (Array.isArray(options?.schedules)) schedules = structuredClone(options.schedules);
	if (options?.persist) saveSchedulesRaw();
}

export async function __waitForSchedulerIdleForTests() {
	await Promise.allSettled([...runningPromises.values()]);
}
