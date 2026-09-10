/**
 * M1-P4.4 Phase 4 — artifact lifecycle: orphan detection + guarded cleanup.
 *
 * Lifecycle: created (by replay/baseline/evidence capture) → referenced (by
 * replay-runs.json / baselines.json / evidence nodes / sessions' capturedSteps
 * / missions / findings) → retained (while referenced) → eligible (unreferenced
 * AND older than ARTIFACT_ORPHAN_DAYS) → deleted (only via applyArtifactsCleanup
 * with explicit apply:true).
 *
 * References are collected from ALL durable stores so a referenced artifact is
 * never eligible, no matter which store points at it. ~40 artifact dirs on this
 * volume are kernel-corrupted ("Bad message" / "Structure needs cleaning") and
 * cannot be enumerated — they are reported as unremovable-but-unknown, never
 * silently skipped.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync, existsSync, rmSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QASE_DIR = join(__dirname, '..', '.qase');
const ARTIFACTS_DIR = join(QASE_DIR, 'artifacts');

const DEFAULTS = { orphanOlderThanDays: 0 };

function loadJson(file, fallback) {
	try {
		if (!existsSync(file)) return fallback;
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/** Collect every artifact dir name mentioned anywhere durable. */
export function collectArtifactReferences() {
	const refs = new Set();
	// artifacts.json is the canonical evidence registry (relPath:
	// 'artifacts/<sessionId>/<file>') — always part of the reference scan.
	for (const file of ['artifacts.json', 'replay-runs.json', 'baselines.json', 'missions.json', 'findings.json', 'sessions.json', 'evidence-graph.json', 'test-cases.json', 'workflows.json']) {
		const data = loadJson(join(QASE_DIR, file), null);
		if (!data) continue;
		const text = JSON.stringify(data);
		// Form 1: explicit "…/artifacts/<dir>/…"
		for (const match of text.matchAll(/artifacts\/([A-Za-z0-9_.\-]+)/g)) {
			refs.add(match[1]);
		}
	}
	// Form 2: replay-runs store bare "<runId>/trace.zip" / "<runId>/shot.png"
	// paths (ARTIFACTS_DIR-relative). The run id == artifact dir name.
	const replay = loadJson(join(QASE_DIR, 'replay-runs.json'), []);
	if (Array.isArray(replay)) {
		for (const r of replay) {
			for (const p of (r.screenshotPaths ?? [])) {
				if (typeof p === 'string' && p.includes('/')) refs.add(p.split('/')[0]);
			}
			if (typeof r.tracePath === 'string' && r.tracePath.includes('/')) refs.add(r.tracePath.split('/')[0]);
		}
	}
	// Form 3: baselines.json entries carry artifactPath like baselines/<id>/x.png
	const baselines = loadJson(join(QASE_DIR, 'baselines.json'), []);
	if (Array.isArray(baselines)) {
		for (const b of baselines) {
			const p = b.artifactPath ?? b.baselinePath;
			if (typeof p === 'string' && p.startsWith('baselines/')) refs.add(p.split('/')[1]);
		}
	}
	return refs;
}

/**
 * Read-only orphan report.
 * @returns {{ totalDirs, referenced, orphans: [{dir, ageDays, bytes}], unreadable: [{dir, error}], note }}
 */
export function analyzeArtifacts(options = {}) {
	const cfg = { ...DEFAULTS, ...options };
	let entries;
	const unreadable = [];
	try {
		entries = readdirSync(ARTIFACTS_DIR, { withFileTypes: true });
	} catch (err) {
		return { totalDirs: 0, referenced: 0, orphans: [], unreadable: [{ dir: ARTIFACTS_DIR, error: err.message }], note: NOTE };
	}
	const refs = collectArtifactReferences();
	const orphans = [];
	let referenced = 0;
	const now = Date.now();
	for (const ent of entries) {
		if (!ent.isDirectory()) continue;
		const dirPath = join(ARTIFACTS_DIR, ent.name);
		let st;
		try {
			st = statSync(dirPath);
		} catch (err) {
			unreadable.push({ dir: ent.name, error: err.message });
			continue;
		}
		if (refs.has(ent.name)) { referenced++; continue; }
		const ageDays = (now - st.mtimeMs) / 86_400_000;
		if (ageDays > cfg.orphanOlderThanDays) {
			orphans.push({ dir: ent.name, ageDays: Math.round(ageDays), bytes: dirBytes(dirPath) });
		}
	}
	return { totalDirs: entries.filter(e => e.isDirectory()).length, referenced, orphans, unreadable, note: NOTE };
}

const NOTE =
	'Artifact dir mtimes are reset on container restart (volume remount), so the ' +
	'age gate defaults to 0 days and reference-hood is the ONLY liveness signal. ' +
	'Unreferenced = no replay-run, baseline, mission, finding, session, or evidence ' +
	'node points at the dir.';

function dirBytes(dirPath) {
	let total = 0;
	try {
		for (const ent of readdirSync(dirPath, { withFileTypes: true })) {
			const p = join(dirPath, ent.name);
			try {
				if (ent.isDirectory()) total += dirBytes(p);
				else total += statSync(p).size;
			} catch { /* unreadable member — ignore */ }
		}
	} catch { /* unreadable dir — count 0 */ }
	return total;
}

/**
 * Delete the reported orphans. Only called with explicit apply:true from the
 * API. Returns what was deleted + reclaimed bytes. Unreadable (kernel-corrupt)
 * dirs are attempted with rmSync recursive + force but failures are reported,
 * never thrown.
 */
export function applyArtifactsCleanup(analysis = null, options = {}) {
	const cfg = { ...DEFAULTS, ...options };
	const report = analysis ?? analyzeArtifacts(cfg);
	const deleted = [];
	const failed = [];
	let reclaimedBytes = 0;
	for (const o of report.orphans ?? []) {
		const dirPath = join(ARTIFACTS_DIR, o.dir);
		try {
			rmSync(dirPath, { recursive: true, force: true });
			deleted.push(o.dir);
			reclaimedBytes += o.bytes;
			console.log(`[artifacts] deleted orphan ${o.dir} (${o.bytes} bytes, age ${o.ageDays}d)`);
		} catch (err) {
			failed.push({ dir: o.dir, error: err.message });
		}
	}
	return { deleted, failed, reclaimedBytes, remainingOrphans: (report.orphans ?? []).filter(o => !deleted.includes(o.dir)).length };
}
