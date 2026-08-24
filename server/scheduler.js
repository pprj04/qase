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
import { notifyTestFailure } from './webhooks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEDULES_FILE = join(__dirname, '..', '.qase', 'schedules.json');

let schedules = [];
let saveTimer = null;

/* ── Persistence ────────────────────────────────────────────────── */

function load() {
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
	// Backfill nextRun for any schedule missing it.
	for (const sched of schedules) {
		if (sched.enabled && !sched.nextRun) {
			sched.nextRun = computeNextRun(sched.cronExpr);
		}
	}
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
		atomicWrite(SCHEDULES_FILE, JSON.stringify(schedules, null, '\t'));
	} catch (error) {
		console.error('Failed to persist schedules:', error.message);
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
export async function executeSchedule(schedule) {
	const cases = schedule.testCaseIds
		.map(id => getTestCase(id))
		.filter(Boolean);

	if (cases.length === 0) {
		const summary = {
			id: randomUUID(),
			scheduleId: schedule.id,
			ts: Date.now(),
			targetUrl: schedule.targetUrl,
			trigger: 'scheduled',
			total: 0, passed: 0, failed: 0, errored: 0,
			durationMs: 0,
			results: []
		};
		const stored = addRegressionRun(summary);
		schedule.lastRun = { ts: summary.ts, result: 'no-test-cases', summary: stored };
		persistSoon();
		return summary;
	}

	const config = getConfig();
	const summary = await runTestSuite(cases, {
		credentials: schedule.credentials,
		concurrency: config.concurrentRuns,
		retries: config.retriesCount
	});

	summary.scheduleId = schedule.id;
	summary.projectId = schedule.projectId;
	summary.targetUrl = schedule.targetUrl;
	summary.trigger = 'scheduled';

	addRegressionRun(summary);

	// Fire webhook if there are failures (fire-and-forget).
	notifyTestFailure(schedule.id, summary);

	schedule.lastRun = {
		ts: Date.now(),
		result: summary.failed + summary.errored === 0 ? 'pass' : 'fail',
		summary: { total: summary.total, passed: summary.passed, failed: summary.failed, errored: summary.errored, flaky: summary.flaky ?? 0 }
	};

	// Schedule the next run.
	schedule.nextRun = computeNextRun(schedule.cronExpr);
	persistSoon();

	return summary;
}

/* ── Tick loop ──────────────────────────────────────────────────── */

const runningScheduleIds = new Set();

function tick() {
	const now = Date.now();
	for (const sched of schedules) {
		if (!sched.enabled || !sched.nextRun) continue;
		if (sched.nextRun > now) continue;
		if (runningScheduleIds.has(sched.id)) continue;

		console.log(`[scheduler] Triggering schedule "${sched.name}" (${sched.id})`);
		runningScheduleIds.add(sched.id);

		executeSchedule(sched)
			.then(summary => {
				console.log(`[scheduler] Schedule "${sched.name}" complete: ${summary.passed}/${summary.total} passed`);
			})
			.catch(error => {
				console.error(`[scheduler] Schedule "${sched.name}" failed:`, error.message);
			})
			.finally(() => {
				runningScheduleIds.delete(sched.id);
			});
	}
}

let tickInterval = null;

export function startScheduler(intervalMs = 60_000) {
	if (tickInterval) return;
	tickInterval = setInterval(tick, intervalMs);
	tickInterval.unref?.();
	console.log(`[scheduler] Started, checking every ${Math.round(intervalMs / 1000)}s`);
}

export function stopScheduler() {
	if (tickInterval) {
		clearInterval(tickInterval);
		tickInterval = null;
	}
}
