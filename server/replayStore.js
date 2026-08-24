/**
 * Replay run history persistence.
 *
 * Stores the results of test case replay runs so users can see history
 * and trends over time. Lives at `.qase/replay-runs.json`.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_FILE = join(__dirname, '..', '.qase', 'replay-runs.json');

const MAX_RUNS_PER_TEST = 50;

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
			console.error(`[replay-runs] STORE CORRUPT: ${err.message}. File preserved — starting EMPTY.`);
		} catch {
			console.error(`[replay-runs] STORE CORRUPT: ${err.message} — starting EMPTY.`);
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
			console.error('Failed to persist replay runs:', error.message);
		}
	}, 250);
}

/**
 * M1-P4.4 Phase 2 — graceful shutdown flush. Idempotent.
 */
export function flushReplayRunsForShutdown() {
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

export function addRun(result) {
	// Store a lightweight copy — strip base64 dataUrls, keep file paths.
	// Extract artifact paths from the screenshots array if available.
	const screenshotPaths = (result.screenshotPaths ?? [])
		.length > 0
		? result.screenshotPaths
		: (result.screenshots ?? [])
			.map(s => s.artifactPath)
			.filter(Boolean);

	const entry = {
		id: result.id ?? randomUUID(),
		testCaseId: result.testCaseId,
		testCaseName: result.testCaseName,
		ts: result.ts ?? Date.now(),
		result: result.result,
		flaky: result.flaky ?? false,
		attempt: result.attempt ?? 1,
		durationMs: result.durationMs,
		stepResults: result.stepResults,
		assertionResults: result.assertionResults,
		screenshotPaths,
		screenshotCount: (result.screenshots ?? []).length,
		tracePath: result.tracePath ?? undefined,
		error: result.error
	};

	runs.push(entry);

	// Cap history per test case to prevent unbounded growth.
	const forTestCase = runs.filter(r => r.testCaseId === entry.testCaseId);
	if (forTestCase.length > MAX_RUNS_PER_TEST) {
		const toRemove = forTestCase.length - MAX_RUNS_PER_TEST;
		let removed = 0;
		runs = runs.filter(r => {
			if (removed < toRemove && r.testCaseId === entry.testCaseId) {
				removed++;
				return false;
			}
			return true;
		});
	}

	persistSoon();
	return entry;
}

export function listRuns(testCaseId) {
	return runs
		.filter(r => !testCaseId || r.testCaseId === testCaseId)
		.sort((a, b) => b.ts - a.ts);
}

/**
 * M1-P4.4 Phase 3 — retention prune: remove runs by id (store-hygiene
 * cleanup). Returns the ids that were actually removed.
 */
export function pruneRunsByIds(ids) {
	if (!Array.isArray(ids) || ids.length === 0) return [];
	const remove = new Set(ids);
	const before = runs.length;
	runs = runs.filter(r => !remove.has(r.id));
	const removedIds = runs.length === before ? [] : [...remove].filter(id => !runs.some(r => r.id === id));
	if (removedIds.length > 0) persistSoon();
	return removedIds;
}

export function getRun(id) {
	return runs.find(r => r.id === id);
}
