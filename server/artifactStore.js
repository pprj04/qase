/**
 * R6-T2 — Screenshot artifact persistence.
 *
 * Persists REAL screenshot bytes to disk and records a typed artifact
 * registry entry that existing evidence nodes reference by ID. This is NOT a
 * parallel evidence system: the evidence graph (R6-T1) stays the source of
 * truth for linkage; this module is the byte-store + deterministic registry
 * the graph points INTO.
 *
 * Storage conventions (reuses the replay artifact seam's dir):
 *   <QASE_DATA_DIR|cwd/.qase>/artifacts/<sessionId>/shot-<seq>-<ts>.jpeg
 *   <QASE_DATA_DIR|cwd/.qase>/artifacts.json          (atomic registry)
 *
 * Artifact ID: deterministic "art_<sha1(sessionId|seq|ts|byteLen)>" —
 * collision-free per (session, step) without a central counter, and stable
 * for tests. Registry rows never contain filesystem paths in API-visible
 * projections (the retrieval route resolves relPath internally).
 *
 * Lifecycle: artifacts live under the session's artifact directory; the
 * existing storeHygiene dry-run/guarded-apply pattern is the eventual home of
 * long-term retention (R6-T3 policy decision). This module exposes count/size
 * facts so hygiene can reason about them without owning bytes yet.
 *
 * Failure semantics: every write attempt is RECORDED with an explicit status —
 * persisted | write_failed — plus captureAttempted on the caller's side. A
 * registry row whose bytes are missing/corrupt reads back status:'missing' —
 * never a silent success. All failures throw nothing; they return honest
 * results the evidence path stamps onto the step outcome.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
	readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync, rmSync, renameSync
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// QASE_DATA_DIR honored exactly like findings.js / evidenceGraph.js (R2-B-H
// test-isolation contract): tests redirect the whole .qase tree to a temp dir.
const dataDir = () => process.env.QASE_DATA_DIR ?? join(__dirname, '..', '.qase');

const ARTIFACTS_DIRNAME = 'artifacts';
const REGISTRY_FILE = () => join(dataDir(), 'artifacts.json');

/** In-memory registry: artifactId → row (boot: file → memory; writes: both). */
let registry = new Map();

/* R6-T2 — registry save-failure visibility (same convention as the R6-T1
 * evidence-graph save health: counted, never silent, surfaced via
 * getArtifactSaveHealth() for diagnostics). */
let saveFailures = 0;
let lastSaveError = null;
let lastSaveErrorAt = null;

function loadRegistry() {
	try {
		if (existsSync(REGISTRY_FILE())) {
			const raw = JSON.parse(readFileSync(REGISTRY_FILE(), 'utf-8'));
			registry = new Map(Array.isArray(raw) ? raw.map(r => [r.id, r]) : []);
		}
	} catch (err) {
		// Corrupt registry: keep the damaged file for forensics (the store
		// convention), start empty — reads then truthfully report missing
		// rather than fabricating entries.
		try {
			const corrupt = `${REGISTRY_FILE()}.corrupt-${Date.now()}`;
			writeFileSync(corrupt, readFileSync(REGISTRY_FILE()));
			unlinkSync(REGISTRY_FILE());
			console.error(`[artifact-store] registry corrupt — quarantined to ${corrupt}: ${err.message}`);
		} catch {}
		registry = new Map();
	}
}
loadRegistry();

function persistRegistry() {
	const rows = [...registry.values()];
	try {
		atomicWrite(REGISTRY_FILE(), JSON.stringify(rows, null, 2));
	} catch (err) {
		saveFailures += 1;
		lastSaveError = String(err?.message ?? err);
		lastSaveErrorAt = Date.now();
		console.error(`[artifact-store] registry write failed: ${lastSaveError}`);
	}
}

/** sha1-based deterministic artifact ID (no path material, no secrets). */
function artifactIdFor(sessionId, seq, ts, byteLen) {
	return 'art_' + createHash('sha1')
		.update(`${sessionId}|${seq}|${ts}|${byteLen}`)
		.digest('hex')
		.slice(0, 16);
}

const seqOf = sessionId => {
	let max = 0;
	for (const row of registry.values()) {
		if (row.sessionId === sessionId && row.seq > max) max = row.seq;
	}
	return max + 1;
};

/**
 * Persist one screenshot capture. Returns a TRUTHFUL result object:
 *   { attempted, persisted, artifactId?, relPath?, mimeType, bytes,
 *     status: 'persisted'|'write_failed'|'not_attempted',
 *     error?, capturedAt }
 *
 * `input.base64` is the raw screenshot (SDK screenshot results carry base64,
 * same as the bridge frame stream / replay saveScreenshot).
 */
export function persistScreenshotArtifact(input = {}) {
	const {
		sessionId, missionId = null, ownerUserId = null, stepId = null,
		toolCallId = null, base64 = null, mimeType = 'image/jpeg',
		url = null, title = null, capturedAt = Date.now()
	} = input;

	if (!sessionId || typeof base64 !== 'string' || base64.length === 0) {
		// Not even attempted — the caller records attempted=true on its side;
		// this result says plainly nothing was persisted and why.
		return {
			attempted: false, persisted: false, status: 'not_attempted',
			error: 'screenshot bytes absent', mimeType, bytes: 0, capturedAt
		};
	}

	const seq = seqOf(sessionId);
	const buf = Buffer.from(base64, 'base64');
	const byteLen = buf.length;
	const artifactId = artifactIdFor(sessionId, seq, capturedAt, byteLen);
	const relDir = join(ARTIFACTS_DIRNAME, sessionId);
	const relPath = join(relDir, `shot-${seq}-${capturedAt}.jpeg`);
	const absPath = join(dataDir(), relPath);

	const row = {
		id: artifactId,
		sessionId,
		missionId,
		ownerUserId,
		stepId,
		toolCallId,
		mimeType,
		bytes: byteLen,
		relPath, // internal only — never projected by the API surface
		url,
		title,
		capturedAt,
		createdAt: Date.now(),
		createdBy: 'agent'
	};

	// Write bytes first: a registry row must never claim an artifact that
	// isn't on disk (the inverse — bytes without a row — is detectable and
	// reported by verification below).
	try {
		mkdirSync(dirname(absPath), { recursive: true });
		const tmp = `${absPath}.tmp`;
		writeFileSync(tmp, buf);
		// rename for atomicity (same convention as atomicWrite; done inline
		// because the buffer, not a string, is the payload)
		renameSync(tmp, absPath);
	} catch (err) {
		const failedRow = { ...row, status: 'write_failed', error: String(err?.message ?? err) };
		registry.set(artifactId, failedRow);
		persistRegistry();
		return {
			attempted: true, persisted: false, status: 'write_failed',
			artifactId, mimeType, bytes: byteLen,
			error: failedRow.error, capturedAt
		};
	}

	registry.set(artifactId, row);
	persistRegistry();
	return {
		attempted: true, persisted: true, status: 'persisted',
		artifactId, mimeType, bytes: byteLen, capturedAt
	};
}

/**
 * Resolve an artifact for retrieval. Returns null when the id is unknown, the
 * bytes are gone, or the stored file is corrupt/truncated. The route layer
 * converts null → 404 (identical body for missing vs unauthorized — F4 rule).
 */
export function getArtifact(artifactId) {
	const row = registry.get(artifactId);
	if (!row || row.status === 'write_failed') return null;
	const absPath = join(dataDir(), row.relPath);
	if (!existsSync(absPath)) return null;
	let stat;
	try {
		stat = statSync(absPath);
	} catch {
		return null;
	}
	if (!Number.isFinite(row.bytes) || stat.size !== row.bytes) {
		// Registry says N bytes, disk disagrees → corrupt/truncated artifact.
		return null;
	}
	try {
		const bytes = readFileSync(absPath);
		if (bytes.length !== row.bytes) return null;
		return {
			id: row.id, sessionId: row.sessionId, missionId: row.missionId,
			ownerUserId: row.ownerUserId, stepId: row.stepId, toolCallId: row.toolCallId,
			mimeType: row.mimeType, bytes: row.bytes, byteLength: bytes.length,
			url: row.url, title: row.title, capturedAt: row.capturedAt,
			data: bytes
		};
	} catch {
		return null;
	}
}

/** API-safe projection — no filesystem paths, no owner internals. */
export function artifactRef(row) {
	if (!row) return null;
	return {
		id: row.id, sessionId: row.sessionId, missionId: row.missionId,
		stepId: row.stepId, toolCallId: row.toolCallId, mimeType: row.mimeType,
		bytes: row.bytes, url: row.url, title: row.title, capturedAt: row.capturedAt,
		...(row.status ? { status: row.status } : {})
	};
}

export function listArtifacts({ sessionId, missionId } = {}) {
	let rows = [...registry.values()];
	if (sessionId) rows = rows.filter(r => r.sessionId === sessionId);
	if (missionId) rows = rows.filter(r => r.missionId === missionId);
	return rows.map(artifactRef);
}

export function getArtifactSaveHealth() {
	return { saveFailures, lastSaveError, lastSaveErrorAt };
}

/**
 * R6-T3 — raw registry rows for the retention analyzer (internal shape,
 * includes relPath; NEVER projected to API clients).
 */
export function listArtifactRows() {
	return [...registry.values()];
}

/**
 * R6-T3 — ordered single-artifact deletion used by the retention executor.
 * Order: bytes file FIRST, then registry row + atomic persist. Crash between
 * the two leaves a row whose getArtifact() truthfully returns null (missing
 * bytes — R6-T2 semantics); the next cycle re-claims it. Returns
 * {deleted:true} only when the row is gone; failures carry the error.
 */
export function deleteArtifactById(artifactId) {
	const row = registry.get(artifactId);
	if (!row) return { deleted: false, error: 'no such artifact row' };
	try {
		const absPath = join(dataDir(), row.relPath);
		if (existsSync(absPath)) unlinkSync(absPath);
	} catch (err) {
		// Bytes deletion failed — keep the row (truthful: artifact still
		// registered) and report. NEVER delete the reference first.
		return { deleted: false, error: `bytes unlink failed: ${err.message}` };
	}
	registry.delete(artifactId);
	persistRegistry();
	return { deleted: true };
}

export function artifactStoreStats() {
	let totalBytes = 0;
	const sessions = new Set();
	for (const row of registry.values()) {
		if (row.status === 'write_failed') continue;
		totalBytes += Number.isFinite(row.bytes) ? row.bytes : 0;
		sessions.add(row.sessionId);
	}
	return { artifacts: registry.size, sessions: sessions.size, totalBytes };
}

/**
 * Session-scoped artifact cleanup — called ONLY from the existing terminal
 * session-cleanup seam (deleteSession path), never opportunistically. A
 * completed run keeps its artifacts until its session record is actually
 * deleted; there is no time-based eviction here (that is the R6-T3 retention
 * policy decision — deliberately not invented in this ticket).
 */
export function removeArtifactsForSession(sessionId) {
	const rows = [...registry.values()].filter(r => r.sessionId === sessionId);
	if (rows.length === 0) return { removed: 0 };
	let removed = 0;
	for (const row of rows) {
		try {
			const absPath = join(dataDir(), row.relPath);
			if (existsSync(absPath)) unlinkSync(absPath);
		} catch {}
		registry.delete(row.id);
		removed += 1;
	}
	persistRegistry();
	// Best-effort prune of the now-empty session dir.
	try { rmSync(join(dataDir(), ARTIFACTS_DIRNAME, sessionId), { recursive: true, force: true }); } catch {}
	return { removed };
}

/** Test seam: drop in-memory state + registry file (never touches real .qase
 * — tests point QASE_DATA_DIR at a temp dir first). */
export function _clearForTesting() {
	registry = new Map();
	saveFailures = 0;
	lastSaveError = null;
	lastSaveErrorAt = null;
	try { unlinkSync(REGISTRY_FILE()); } catch {}
}
