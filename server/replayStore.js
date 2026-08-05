/**
 * Replay run history persistence.
 *
 * Stores the results of test case replay runs so users can see history
 * and trends over time. Lives at `.qase/replay-runs.json`.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_FILE = join(__dirname, '..', '.qase', 'replay-runs.json');

const MAX_RUNS_PER_TEST = 50;

let runs = [];
let saveTimer = null;

function load() {
	try {
		if (existsSync(RUNS_FILE)) {
			runs = JSON.parse(readFileSync(RUNS_FILE, 'utf-8'));
		}
	} catch {
		runs = [];
	}
}

function persistSoon() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		try {
			atomicWrite(RUNS_FILE, JSON.stringify(runs, null, '\t'));
		} catch (error) {
			console.error('Failed to persist replay runs:', error.message);
		}
	}, 250);
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

export function getRun(id) {
	return runs.find(r => r.id === id);
}
