/**
 * Visual regression baseline management.
 *
 * Baselines are stored per test case, keyed by screenshot position label.
 * Each baseline stores:
 *   - testCaseId
 *   - label (e.g. "step-0", "assert-1", "final")
 *   - artifactPath (relative path under .qase/artifacts/)
 *   - ts (when it was set)
 *   - approvedBy (manual / auto)
 *
 * Persistence: `.qase/baselines.json`
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_FILE = join(__dirname, '..', '.qase', 'baselines.json');
const ARTIFACTS_DIR = join(__dirname, '..', '.qase', 'artifacts');
const BASELINE_DIR = join(ARTIFACTS_DIR, 'baselines');

let baselines = [];
let saveTimer = null;

function load() {
	try {
		if (existsSync(STORE_FILE)) {
			baselines = JSON.parse(readFileSync(STORE_FILE, 'utf-8'));
		}
	} catch {
		baselines = [];
	}
}

function persistSoon() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		try {
			mkdirSync(dirname(STORE_FILE), { recursive: true });
			writeFileSync(STORE_FILE, JSON.stringify(baselines, null, '\t'));
		} catch (error) {
			console.error('Failed to persist baselines:', error.message);
		}
	}, 250);
}

load();

/* ── Baseline CRUD ─────────────────────────────────────────────── */

/**
 * Sets a baseline screenshot for a test case at a given label position.
 * Copies the source screenshot file to the baseline directory.
 *
 * @param {string} testCaseId
 * @param {string} label - position key (e.g. "step-0", "assert-1")
 * @param {string} sourcePath - relative artifact path (e.g. "<runId>/step-0.jpeg")
 * @param {object} meta - { approvedBy: 'auto'|'manual', ts: number }
 * @returns {object} the stored baseline entry
 */
export function setBaseline(testCaseId, label, sourcePath, meta = {}) {
	// Security: validate sourcePath to prevent path traversal.
	// Only allow alphanumeric, dash, underscore, forward slash, and dot.
	// Reject ".." segments.
	if (!/^[\w.\-\/]+$/.test(sourcePath) || sourcePath.includes('..')) {
		throw new Error('Invalid artifact path');
	}
	// Validate testCaseId and label too.
	if (!/^[\w.\-]+$/.test(testCaseId)) {
		throw new Error('Invalid test case ID');
	}
	if (!/^[\w.\-]+$/.test(label)) {
		throw new Error('Invalid baseline label');
	}

	// Resolve and verify the source path stays within ARTIFACTS_DIR.
	const sourceAbs = join(ARTIFACTS_DIR, sourcePath);
	const resolvedSource = resolve(sourceAbs);
	if (!resolvedSource.startsWith(resolve(ARTIFACTS_DIR))) {
		throw new Error('Invalid artifact path');
	}

	const baselineRelDir = join('baselines', testCaseId);
	const baselineAbsDir = join(ARTIFACTS_DIR, baselineRelDir);
	mkdirSync(baselineAbsDir, { recursive: true });

	const ext = sourcePath.match(/\.(\w+)$/)?.[1] || 'jpeg';
	const filename = `${label}.${ext}`;
	const baselinePath = join(baselineRelDir, filename);

	try {
		copyFileSync(sourceAbs, join(ARTIFACTS_DIR, baselinePath));
	} catch (error) {
		console.error('[baselines] Failed to copy baseline:', error.message);
	}

	// Upsert: replace if one exists for this testCaseId + label.
	const existingIdx = baselines.findIndex(
		b => b.testCaseId === testCaseId && b.label === label
	);

	const entry = {
		id: existingIdx >= 0 ? baselines[existingIdx].id : randomUUID(),
		testCaseId,
		label,
		artifactPath: baselinePath,
		ts: meta.ts ?? Date.now(),
		approvedBy: meta.approvedBy ?? 'auto'
	};

	if (existingIdx >= 0) {
		baselines[existingIdx] = entry;
	} else {
		baselines.push(entry);
	}

	persistSoon();
	return entry;
}

/**
 * Retrieves all baselines for a test case.
 * @param {string} testCaseId
 * @returns {array} baseline entries
 */
export function getBaselines(testCaseId) {
	return baselines.filter(b => b.testCaseId === testCaseId);
}

/**
 * Retrieves a single baseline by test case + label.
 * @param {string} testCaseId
 * @param {string} label
 * @returns {object|null}
 */
export function getBaseline(testCaseId, label) {
	return baselines.find(b => b.testCaseId === testCaseId && b.label === label) || null;
}

/**
 * Removes all baselines for a test case (used on test case deletion).
 * @param {string} testCaseId
 */
export function deleteBaselines(testCaseId) {
	baselines = baselines.filter(b => b.testCaseId !== testCaseId);
	persistSoon();
}

/**
 * Promotes all screenshots from a run to baselines for the test case.
 * Called by the "Approve Baseline" endpoint.
 *
 * @param {string} testCaseId
 * @param {array} screenshots - array of { label, artifactPath } from the run result
 * @returns {array} the baseline entries that were set
 */
export function approveBaseline(testCaseId, screenshots) {
	const results = [];
	for (const ss of screenshots) {
		if (ss.artifactPath) {
			results.push(setBaseline(testCaseId, ss.label, ss.artifactPath, {
				approvedBy: 'manual',
				ts: Date.now()
			}));
		}
	}
	return results;
}

/**
 * Auto-captures baselines from a passing test run (called when a test passes
 * and no baseline exists yet for that label).
 *
 * @param {string} testCaseId
 * @param {array} screenshots - array of { label, artifactPath } from the run result
 */
export function autoCaptureBaselines(testCaseId, screenshots) {
	for (const ss of screenshots) {
		if (ss.artifactPath && !getBaseline(testCaseId, ss.label)) {
			setBaseline(testCaseId, ss.label, ss.artifactPath, {
				approvedBy: 'auto',
				ts: Date.now()
			});
		}
	}
}

/* ── Project scoping (Phase 7) ──────────────────────────────────── */

export function backfillProjectId(_projectId) {
	// Baselines are scoped by testCaseId, which is already project-scoped.
	// No additional projectId field needed on baselines.
}

export function reassignProjectId(_fromProjectId, _toProjectId) {
	// Same as above — baselines are test-case-scoped.
}

export function saveBaselinesRaw() {
	// Used by projects.js reassignment flow — baselines follow their test case.
}

export function getBaselineDir() {
	return BASELINE_DIR;
}
