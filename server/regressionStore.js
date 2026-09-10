/**
 * Regression run history persistence.
 *
 * Stores the results of scheduled (and manual) regression runs so the
 * dashboard can show trends over time. Lives at `.qase/regression-runs.json`.
 *
 * Each entry is a lightweight summary — individual test case results are
 * embedded but screenshots are stripped to a count to keep the file small.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';
import { regressionMetrics, regressionTrendPoints } from './dataMetrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_FILE = join(__dirname, '..', '.qase', 'regression-runs.json');

const MAX_RUNS = 200;

let runs = [];
let saveTimer = null;
let pendingWrite = false;

function load() {
	try {
		if (existsSync(RUNS_FILE)) {
			runs = JSON.parse(readFileSync(RUNS_FILE, 'utf-8'));
		}
	} catch (err) {
		// M1-P4.4 Phase 5 — preserve damaged store for forensics, start empty.
		try {
			renameSync(RUNS_FILE, `${RUNS_FILE}.corrupt-${Date.now()}`);
			console.error(`[regression-runs] STORE CORRUPT: ${err.message}. File preserved — starting EMPTY.`);
		} catch {
			console.error(`[regression-runs] STORE CORRUPT: ${err.message} — starting EMPTY.`);
		}
	}
}

function persistSoon() {
	pendingWrite = true;
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		try {
			atomicWrite(RUNS_FILE, JSON.stringify(runs, null, '\t'));
			pendingWrite = false;
		} catch (error) {
			console.error('Failed to persist regression runs:', error.message);
		}
	}, 250);
}

/**
 * M1-P4.4 Phase 2 — graceful shutdown flush. Idempotent.
 */
export function flushRegressionRunsForShutdown() {
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	if (!pendingWrite) return { dirty: false, ok: true };
	try {
		atomicWrite(RUNS_FILE, JSON.stringify(runs, null, '\t'));
		pendingWrite = false;
		return { dirty: true, ok: true };
	} catch (err) {
		return { dirty: true, ok: false, error: err.message };
	}
}

load();

/** Immediately persist the in-memory runs array to disk. */
export function saveRegressionRunsRaw() {
	try {
		atomicWrite(RUNS_FILE, JSON.stringify(runs, null, '\t'));
	} catch (error) {
		console.error('Failed to persist regression runs:', error.message);
	}
}

/**
 * Backfill: assign defaultId to every regression run missing a projectId.
 * Returns the number updated.
 */
export function backfillProjectId(defaultId) {
	let count = 0;
	for (const rr of runs) {
		if (!rr.projectId) {
			rr.projectId = defaultId;
			count++;
		}
	}
	if (count > 0) saveRegressionRunsRaw();
	return count;
}

/**
 * Reassign: move all regression runs from fromProjectId to toProjectId.
 * Returns the number moved.
 */
export function reassignProjectId(fromProjectId, toProjectId) {
	let count = 0;
	for (const rr of runs) {
		if (rr.projectId === fromProjectId) {
			rr.projectId = toProjectId;
			count++;
		}
	}
	if (count > 0) saveRegressionRunsRaw();
	return count;
}

export function addRegressionRun(summary) {
	const entry = {
		id: summary.id ?? randomUUID(),
		scheduleId: summary.scheduleId ?? null,
		projectId: summary.projectId ?? undefined,
		ts: summary.ts ?? Date.now(),
		targetUrl: summary.targetUrl ?? '',
		trigger: summary.trigger ?? 'manual',
		total: summary.total ?? 0,
		passed: summary.passed ?? 0,
		failed: summary.failed ?? 0,
		errored: summary.errored ?? 0,
		flaky: summary.flaky ?? 0,
		durationMs: summary.durationMs ?? 0,
		results: (summary.results ?? []).map(r => ({
			testCaseId: r.testCaseId,
			testCaseName: r.testCaseName,
			result: r.result,
			durationMs: r.durationMs,
			stepCount: r.stepResults?.length ?? 0,
			assertionCount: r.assertionResults?.length ?? 0,
			error: r.error,
			viewport: r.viewport ?? null,
			viewportResults: r.viewportResults ?? null
		}))
	};

	runs.push(entry);
	if (runs.length > MAX_RUNS) {
		runs = runs.slice(-MAX_RUNS);
	}

	persistSoon();
	return entry;
}

export function listRegressionRuns({ projectId, scheduleId, targetUrl, limit } = {}) {
	let filtered = [...runs];
	if (projectId) filtered = filtered.filter(r => r.projectId === projectId);
	if (scheduleId) filtered = filtered.filter(r => r.scheduleId === scheduleId);
	if (targetUrl) filtered = filtered.filter(r => r.targetUrl === targetUrl);
	filtered.sort((a, b) => b.ts - a.ts);
	if (limit) {
		filtered = filtered.slice(0, limit);
	}
	return filtered;
}

export function getRegressionRun(id) {
	return runs.find(r => r.id === id);
}

/**
 * Returns a trend summary: last N runs with pass/fail counts for charting.
 */
export function getTrend({ projectId, scheduleId, targetUrl, limit = 20 } = {}) {
	const history = listRegressionRuns({ projectId, scheduleId, targetUrl, limit });
	return regressionTrendPoints(history.reverse());
}

/** Trend rows and their matching aggregate, calculated from one snapshot. */
export function getTrendSnapshot({ projectId, scheduleId, targetUrl, limit = 20 } = {}) {
	const history = listRegressionRuns({ projectId, scheduleId, targetUrl, limit });
	return {
		items: regressionTrendPoints([...history].reverse()),
		metrics: regressionMetrics(history)
	};
}
