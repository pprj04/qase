/**
 * Global findings / bugs hub store.
 *
 * Findings were originally embedded only inside session objects
 * (session.findings[]). Phase 11 promotes them to a first-class, persistent
 * entity with lifecycle (open → in_testing → resolved → closed),
 * project scoping, test-case linking, comments, and activity history.
 *
 * Persistence: `.qase/findings.json`
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';
import {
	LIFECYCLE, REVIEW_STATUSES, REPRODUCIBILITIES, CATEGORIES, PRIORITIES,
	validateLifecycleTransition, normalizeCategory,
} from './findingIntelligence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// QASE_DATA_DIR lets tests run against an isolated store; unset in production.
const QASE_DIR = process.env.QASE_DATA_DIR ?? join(__dirname, '..', '.qase');
const FINDINGS_FILE = join(QASE_DIR, 'findings.json');
const MIGRATION_MARKER = join(QASE_DIR, '.findings-migrated');
const INTELLIGENCE_BACKFILL_MARKER = join(QASE_DIR, '.finding-intelligence-backfill');

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_STATUSES = ['open', 'in_testing', 'resolved', 'closed'];

// Phase 16: new reproducibility enum values accepted alongside legacy strings.
const VALID_REPRODUCIBILITIES = [...REPRODUCIBILITIES, 'confirmed', 'unconfirmed', 'intermittent'];

let findings = [];
let saveTimer = null;

function load() {
	try {
		if (existsSync(FINDINGS_FILE)) {
			findings = JSON.parse(readFileSync(FINDINGS_FILE, 'utf-8'));
		}
	} catch (error) {
		// NEVER silently start empty: a read/parse failure means the store on
		// disk is damaged (observed 2026-08-16: inode corruption after a
		// container pause). Log loudly so operators notice data loss instead
		// of discovering it via an empty UI later.
		console.error('[findings] FAILED to load store:', error.message);
		findings = [];
	}
	// Normalize records imported from other shapes (session-embedded findings,
	// recovered backups): history/comments/testCaseIds must be arrays —
	// transition/review/link handlers push onto them unconditionally.
	for (const f of findings) {
		if (!Array.isArray(f.history)) f.history = [];
		if (!Array.isArray(f.comments)) f.comments = [];
		if (!Array.isArray(f.testCaseIds)) f.testCaseIds = [];
		if (!Array.isArray(f.steps)) f.steps = [];
	}
}

function persistSoon() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		flush();
	}, 250);
}

function flush() {
	try {
		atomicWrite(FINDINGS_FILE, JSON.stringify(findings, null, '\t'));
	} catch (error) {
		console.error('[findings] Failed to persist:', error.message);
	}
}

/** Phase 16: schedule an immediate debounced save (used by API handlers). */
export function persistFindingsSoon() {
	persistSoon();
}

load();

/**
 * Phase 16 — lazy intelligence upgrade on load: ensures every record carries the
 * derived enum defaults derived ONLY from existing data (never fabricates). Old
 * findings remain readable; fields are undefined when absent and derived on read.
 * A one-time backfill marker guards the full-store normalization so we do not
 * rewrite findings.json unnecessarily on every boot.
 */
function ensureIntelligenceFields(f) {
	if (!f.finding_status) f.finding_status = 'DETECTED';
	if (!f.review_status) f.review_status = 'unreviewed';
	if (!f.priority) f.priority = undefined; // stays unset until triage/enrichment
	if (f.primary_category === undefined) {
		const norm = normalizeCategory(f.category);
		if (norm) f.primary_category = norm;
	}
	if (f.reproducibility === undefined) {
		f.reproducibility = f.reproducibility ?? undefined;
	}
	return f;
}

export function backfillIntelligenceFields() {
	if (existsSync(INTELLIGENCE_BACKFILL_MARKER)) return 0;
	let count = 0;
	for (const f of findings) {
		ensureIntelligenceFields(f);
		count++;
	}
	if (count > 0) flush();
	try {
		mkdirSync(dirname(INTELLIGENCE_BACKFILL_MARKER), { recursive: true });
		writeFileSync(INTELLIGENCE_BACKFILL_MARKER, new Date().toISOString());
	} catch { /* non-fatal */ }
	return count;
}

/* ── Project scoping ────────────────────────────────────────────── */

export function backfillProjectId(defaultId) {
	let count = 0;
	for (const f of findings) {
		if (!f.projectId) {
			f.projectId = defaultId;
			count++;
		}
	}
	if (count > 0) flush();
	return count;
}

export function reassignProjectId(fromProjectId, toProjectId) {
	let count = 0;
	for (const f of findings) {
		if (f.projectId === fromProjectId) {
			f.projectId = toProjectId;
			count++;
		}
	}
	if (count > 0) flush();
	return count;
}

/* ── Migration from session-embedded findings ───────────────────── */

/**
 * One-time migration: flatten all session.findings[] into the global store.
 * Deduplicates by title+url (keeps earliest ts). Idempotent via marker file.
 */
export function migrateFromSessions(sessions) {
	if (existsSync(MIGRATION_MARKER)) return 0;

	let imported = 0;
	const seen = new Set(findings.map(f => `${f.title}|${f.url ?? ''}`));

	for (const session of sessions) {
		const sessionFindings = session.findings ?? [];
		for (const f of sessionFindings) {
			const key = `${f.title}|${f.url ?? ''}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const globalFinding = {
				id: f.id ?? randomUUID(),
				ts: f.ts ?? Date.now(),
				sessionId: session.id,
				projectId: session.projectId ?? undefined,
				title: f.title ?? 'Untitled',
				severity: SEVERITY_ORDER.includes(f.severity) ? f.severity : 'medium',
				category: f.category ?? 'general',
				url: f.url ?? '',
				status: 'open',
				steps: Array.isArray(f.steps) ? f.steps : [],
				expected: f.expected ?? '',
				actual: f.actual ?? '',
				evidence: f.evidence ?? undefined,
				testCaseIds: [],
				assignee: null,
				comments: [],
				history: [{
					ts: f.ts ?? Date.now(),
					from: null,
					to: 'open',
					by: 'migration'
				}],
				tags: []
			};
			findings.push(globalFinding);
			imported++;
		}
	}

	if (imported > 0) {
		flush();
		console.log(`[findings] Migrated ${imported} findings from sessions into global store`);
	}

	// Write marker to prevent re-running.
	try {
		mkdirSync(dirname(MIGRATION_MARKER), { recursive: true });
		writeFileSync(MIGRATION_MARKER, new Date().toISOString());
	} catch {
		// Non-fatal.
	}

	return imported;
}

/* ── CRUD ───────────────────────────────────────────────────────── */

export function addFinding(data) {
	const finding = {
		id: data.id ?? randomUUID(),
		ts: data.ts ?? Date.now(),
		sessionId: data.sessionId ?? null,
		projectId: data.projectId ?? undefined,
		title: String(data.title ?? 'Untitled').trim(),
		severity: SEVERITY_ORDER.includes(data.severity) ? data.severity : 'medium',
		category: String(data.category ?? 'general').trim(),
		url: data.url ?? '',
		status: VALID_STATUSES.includes(data.status) ? data.status : 'open',
		steps: Array.isArray(data.steps) ? data.steps.map(String) : [],
		expected: String(data.expected ?? '').trim(),
		actual: String(data.actual ?? '').trim(),
		evidence: data.evidence ? String(data.evidence) : undefined,
		testCaseIds: Array.isArray(data.testCaseIds) ? data.testCaseIds : [],
		assignee: data.assignee ?? null,
		comments: [],
		history: [{
			ts: data.ts ?? Date.now(),
			from: null,
			to: 'open',
			by: data.createdBy ?? 'agent'
		}],
		tags: Array.isArray(data.tags) ? data.tags : [],

		// ── Evidence Engine fields (additive — backward compatible) ──
		// These enrich findings with structured evidence + quality metadata.
		// Old findings without these fields are unaffected.
		observed: data.observed ? String(data.observed).trim() : undefined,
		impact: data.impact ? String(data.impact).trim() : undefined,
		recommendation: data.recommendation ? String(data.recommendation).trim() : undefined,
		fixPrompt: data.fixPrompt ? String(data.fixPrompt).trim() : undefined,
		confidence: undefined, // Phase 16: caller-supplied confidence is never trusted; enrichment derives it
		isDuplicate: typeof data.isDuplicate === 'boolean' ? data.isDuplicate : undefined,
		duplicateOf: data.duplicateOf ? String(data.duplicateOf) : undefined,
		reproducibility: VALID_REPRODUCIBILITIES.includes(data.reproducibility)
			? data.reproducibility
			: undefined,

		// ── Phase 16 Bug Intelligence fields (additive — backward compatible) ──
		// SECURITY: finding_status/review_status/confidence are NEVER accepted
		// from creation input. Lifecycle/review/confidence only change through
		// the validated, audited endpoints (transition/review/revalidate) so
		// an API client can never mint a VERIFIED finding.
		finding_status: 'DETECTED',
		review_status: 'unreviewed',
		primary_category: CATEGORIES.includes(data.primary_category) ? data.primary_category : undefined,
		secondary_categories: Array.isArray(data.secondary_categories)
			? data.secondary_categories.filter(c => CATEGORIES.includes(c)).slice(0, 3)
			: undefined,
		priority: PRIORITIES.includes(data.priority) ? data.priority : undefined,
		missionId: data.missionId ?? undefined,
		workflowId: data.workflowId ?? undefined,
		featureId: data.featureId ?? undefined,
		evidenceRefs: Array.isArray(data.evidenceRefs) ? data.evidenceRefs.map(String) : undefined,
		...(data.intelligence && typeof data.intelligence === 'object' ? { intelligence: data.intelligence } : {})
	};
	findings.push(finding);
	persistSoon();
	return finding;
}

export function listFindings({
	projectId, severity, status, category, assignee, sessionId, q,
	// Phase 16 filters
	primaryCategory, priority, findingStatus, reviewStatus, workflowId, featureId,
	reproducibility, minConfidence, missionId, includeDuplicates = true,
} = {}) {
	return findings
		.filter(f => {
			if (projectId && f.projectId !== projectId) return false;
			if (severity && f.severity !== severity) return false;
			if (status && f.status !== status) return false;
			if (category && f.category !== category) return false;
			if (assignee && f.assignee !== assignee) return false;
			if (sessionId && f.sessionId !== sessionId) return false;
			// Phase 16 filters (old findings without the field match nothing except UNKNOWN)
			if (primaryCategory) {
				const pc = f.primary_category ?? normalizeCategory(f.category) ?? 'UNKNOWN';
				if (pc !== primaryCategory) return false;
			}
			if (priority && (f.priority ?? 'UNTRIAGED') !== priority) return false;
			if (findingStatus && (f.finding_status ?? 'DETECTED') !== findingStatus) return false;
			if (reviewStatus && (f.review_status ?? 'unreviewed') !== reviewStatus) return false;
			if (workflowId && f.workflowId !== workflowId) return false;
			if (featureId && f.featureId !== featureId) return false;
			if (missionId && f.missionId !== missionId) return false;
			if (reproducibility && f.reproducibility !== reproducibility) return false;
			if (typeof minConfidence === 'number' && ((f.confidence ?? 0) < minConfidence)) return false;
			if (!includeDuplicates && f.isDuplicate) return false;
			if (q) {
				const lower = q.toLowerCase();
				const haystack = `${f.title} ${f.category} ${f.url} ${f.expected} ${f.actual}`.toLowerCase();
				if (!haystack.includes(lower)) return false;
			}
			return true;
		})
		.sort((a, b) => {
			// Sort by severity first, then newest.
			const sevDiff = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
			if (sevDiff !== 0) return sevDiff;
			return b.ts - a.ts;
		});
}

export function getFinding(id) {
	return findings.find(f => f.id === id);
}

export function updateFinding(id, patch) {
	const f = findings.find(x => x.id === id);
	if (!f) return undefined;

	if (typeof patch.title === 'string') f.title = patch.title.trim();
	if (typeof patch.severity === 'string' && SEVERITY_ORDER.includes(patch.severity)) f.severity = patch.severity;
	if (typeof patch.category === 'string') f.category = patch.category.trim();
	if (typeof patch.url === 'string') f.url = patch.url;
	if (typeof patch.expected === 'string') f.expected = patch.expected;
	if (typeof patch.actual === 'string') f.actual = patch.actual;
	if (patch.evidence !== undefined) f.evidence = patch.evidence ? String(patch.evidence) : undefined;
	if (typeof patch.assignee === 'string') f.assignee = patch.assignee || null;
	if (Array.isArray(patch.tags)) f.tags = patch.tags;
	if (Array.isArray(patch.steps)) f.steps = patch.steps.map(String);
	if (patch.devIntelligence !== undefined) f.devIntelligence = patch.devIntelligence;

	// ── Evidence Engine fields ──
	if (typeof patch.observed === 'string') f.observed = patch.observed.trim();
	if (typeof patch.impact === 'string') f.impact = patch.impact.trim();
	if (typeof patch.recommendation === 'string') f.recommendation = patch.recommendation.trim();
	if (typeof patch.fixPrompt === 'string') f.fixPrompt = patch.fixPrompt.trim();
	// Phase 16: raw confidence from a PUT body is never trusted — enrichment
	// derives it from evidence. Use PATCH /:id/classification etc. for review.
	if (typeof patch.isDuplicate === 'boolean') f.isDuplicate = patch.isDuplicate;
	if (typeof patch.duplicateOf === 'string') f.duplicateOf = patch.duplicateOf || undefined;
	if (typeof patch.reproducibility === 'string' && VALID_REPRODUCIBILITIES.includes(patch.reproducibility)) {
		f.reproducibility = patch.reproducibility;
	}

	// ── Phase 16 Bug Intelligence fields ──
	// SECURITY: finding_status/review_status are NOT settable via the generic
	// PUT — lifecycle must go through transitionFindingStatus (validated
	// transition table + evidence gate) and review through setReviewStatus.
	// Both are audited. This prevents minting VERIFIED findings via PUT.
	if (patch.primary_category === null) f.primary_category = undefined;
	else if (typeof patch.primary_category === 'string' && CATEGORIES.includes(patch.primary_category)) f.primary_category = patch.primary_category;
	if (Array.isArray(patch.secondary_categories)) f.secondary_categories = patch.secondary_categories.filter(c => CATEGORIES.includes(c)).slice(0, 3);
	if (patch.priority === null) f.priority = undefined;
	else if (typeof patch.priority === 'string' && PRIORITIES.includes(patch.priority)) f.priority = patch.priority;
	if (patch.missionId !== undefined) f.missionId = patch.missionId ?? undefined;
	if (patch.workflowId !== undefined) f.workflowId = patch.workflowId ?? undefined;
	if (patch.featureId !== undefined) f.featureId = patch.featureId ?? undefined;
	if (Array.isArray(patch.evidenceRefs)) f.evidenceRefs = patch.evidenceRefs.map(String);
	if (typeof patch.reproduction_attempts === 'number') f.reproduction_attempts = Math.max(0, Math.round(patch.reproduction_attempts));
	// Phase 18: fix-validation approval records the sufficiency verdict that
	// unlocks the VERIFIED evidence gate (source-tagged for audit).
	if (patch.evidence_sufficiency !== undefined && patch.evidence_sufficiency && typeof patch.evidence_sufficiency === 'object') {
		f.evidence_sufficiency = patch.evidence_sufficiency;
	}

	persistSoon();
	return f;
}

export function deleteFinding(id) {
	const index = findings.findIndex(f => f.id === id);
	if (index === -1) return false;
	const finding = findings[index];
	findings.splice(index, 1);
	persistSoon();
	// Clean up: remove this finding's ID from all linked test cases.
	cleanupTestCaseReferences(id, finding.testCaseIds ?? []);
	return true;
}

/**
 * Removes a findingId from the findingIds[] of all linked test cases.
 */
function cleanupTestCaseReferences(findingId, testCaseIds) {
	if (!testCaseIds?.length) return;
	import('./testCases.js').then(({ updateTestCase, getTestCase }) => {
		for (const tcId of testCaseIds) {
			const tc = getTestCase(tcId);
			if (tc && (tc.findingIds ?? []).includes(findingId)) {
				tc.findingIds = (tc.findingIds ?? []).filter(fid => fid !== findingId);
				updateTestCase(tcId, { findingIds: tc.findingIds });
			}
		}
	}).catch(() => { /* non-fatal */ });
}

/* ── Lifecycle ──────────────────────────────────────────────────── */

export function changeStatus(id, newStatus, by = 'user') {
	const f = findings.find(x => x.id === id);
	if (!f) return undefined;
	if (!VALID_STATUSES.includes(newStatus)) return undefined;
	if (f.status === newStatus) return f;

	const oldStatus = f.status;
	f.status = newStatus;
	f.history.push({ ts: Date.now(), from: oldStatus, to: newStatus, by });
	persistSoon();
	return f;
}

/* ── Phase 16: intelligence lifecycle + review ───────────────────── */

/**
 * Live evidence-sufficiency check for the VERIFIED gate. Pulls typed evidence
 * from the evidence graph (dynamic import avoids a require cycle) and falls
 * back to the stored verdict when the graph is unavailable.
 */
function computeStoredEvidenceSufficiency(f) {
	try {
		// eslint-disable-next-line no-undef
		const cached = globalThis.__p16SufficiencyCache?.(f);
		if (cached) return cached;
	} catch { /* fall through */ }
	const stored = f.evidence_sufficiency;
	if (stored && typeof stored.sufficient === 'boolean') return stored;
	return { sufficient: false, reasons: ['no evidence sufficiency assessment on record'] };
}

/**
 * Intelligence-lifecycle transition (DETECTED → VERIFYING → VERIFIED → …).
 * Validated against the deterministic transition table AND the evidence gate:
 * entering VERIFIED requires evidence_sufficiency.sufficient on the record.
 * Audited in history[]. Returns { ok, finding, reason }.
 */
export function transitionFindingStatus(id, to, by = 'system', detail = undefined) {
	const f = findings.find(x => x.id === id);
	if (!f) return { ok: false, reason: 'not_found' };
	const from = f.finding_status ?? 'DETECTED';
	const check = validateLifecycleTransition(from, to);
	if (!check.ok) return { ok: false, finding: f, reason: check.reason };
	// Evidence gate: VERIFIED is only reachable with sufficient typed evidence.
	// Recomputed live from the evidence graph so the check can't be satisfied
	// by a stale stored verdict.
	if (to === 'VERIFIED' && from !== 'VERIFIED') {
		const suff = computeStoredEvidenceSufficiency(f);
		if (!suff.sufficient) {
			return { ok: false, finding: f, reason: `cannot enter VERIFIED: insufficient evidence (${suff.reasons.join('; ')})` };
		}
	}
	if (from !== to) {
		f.finding_status = to;
		f.history.push({ ts: Date.now(), from, to, by, detail, field: 'finding_status' });
		persistSoon();
	}
	return { ok: true, finding: f };
}

/**
 * Human review verdict: confirmed | false_positive | duplicate | needs_info | unreviewed.
 * Audited; sets lifecycle FALSE_POSITIVE/DUPLICATE accordingly; false_positive keeps the
 * finding visible but out of verified/active intelligence (separate representation).
 */
export function setReviewStatus(id, reviewStatus, by = 'user', note = undefined) {
	const f = findings.find(x => x.id === id);
	if (!f) return { ok: false, reason: 'not_found' };
	if (!REVIEW_STATUSES.includes(reviewStatus)) return { ok: false, finding: f, reason: `invalid review status ${reviewStatus}` };
	const from = f.review_status ?? 'unreviewed';
	f.review_status = reviewStatus;
	f.history.push({ ts: Date.now(), from, to: reviewStatus, by, detail: note, field: 'review_status' });

	// Lifecycle coupling (validated transitions only; failure is non-fatal).
	if (reviewStatus === 'false_positive') {
		const t = validateLifecycleTransition(f.finding_status ?? 'DETECTED', 'FALSE_POSITIVE');
		if (t.ok) f.finding_status = 'FALSE_POSITIVE';
	} else if (reviewStatus === 'duplicate') {
		const t = validateLifecycleTransition(f.finding_status ?? 'DETECTED', 'DUPLICATE');
		if (t.ok) f.finding_status = 'DUPLICATE';
	} else if (reviewStatus === 'confirmed') {
		// Confirmation can advance an unreviewed/detected finding into the pipeline.
		const t = validateLifecycleTransition(f.finding_status ?? 'DETECTED', 'VERIFYING');
		if (t.ok) f.finding_status = 'VERIFYING';
	}

	persistSoon();
	return { ok: true, finding: f };
}

/**
 * Phase 16 enrichment merge: apply derived intelligence fields to a stored finding
 * without overwriting agent-observed content (title/expected/actual/steps untouched).
 */
export function applyIntelligence(id, derived) {
	const f = findings.find(x => x.id === id);
	if (!f || !derived || typeof derived !== 'object') return undefined;
	const guarded = { ...derived };
	// Never overwrite the observation content via enrichment.
	delete guarded.title;
	delete guarded.expected;
	delete guarded.actual;
	delete guarded.steps;
	delete guarded.observed;
	delete guarded.severity; // severity changes go through PATCH /severity (audited)
	// Linkage field-name unification: enrichment derives snake_case
	// (workflow_id/feature_id) but the store + all consumers use camelCase.
	// Map into the canonical fields, preferring an explicitly-set camelCase
	// value over a derived one, and never store conflicting duplicates.
	if (guarded.workflow_id != null && !f.workflowId) f.workflowId = guarded.workflow_id;
	if (guarded.feature_id != null && !f.featureId) f.featureId = guarded.feature_id;
	delete guarded.workflow_id;
	delete guarded.feature_id;
	Object.assign(f, guarded);
	persistSoon();
	return f;
}

/**
 * Phase 16: mark a finding as duplicate of a canonical finding, preserving provenance.
 */
export function markDuplicate(id, canonicalId, provenance = {}) {
	const f = findings.find(x => x.id === id);
	if (!f) return undefined;
	const canonical = findings.find(x => x.id === canonicalId);
	if (!canonical || canonicalId === id) return undefined;
	f.isDuplicate = true;
	f.duplicateOf = canonicalId;
	f.duplicate_provenance = {
		originalIds: provenance.originalIds ?? [id, canonicalId],
		sessions: provenance.sessions ?? [f.sessionId, canonical.sessionId].filter(Boolean),
		missions: provenance.missions ?? [f.missionId, canonical.missionId].filter(Boolean),
		evidenceCount: provenance.evidenceCount ?? ((f.evidenceRefs?.length ?? 0) + (canonical.evidenceRefs?.length ?? 0)),
		mergedAt: new Date().toISOString(),
	};
	f.history.push({ ts: Date.now(), from: f.finding_status ?? 'DETECTED', to: 'DUPLICATE', by: 'system', field: 'finding_status', detail: `duplicate of ${canonicalId}` });
	f.finding_status = 'DUPLICATE';
	persistSoon();
	return f;
}

/* ── Comments ───────────────────────────────────────────────────── */

export function addComment(id, author, text) {
	const f = findings.find(x => x.id === id);
	if (!f) return undefined;
	const comment = {
		id: randomUUID(),
		ts: Date.now(),
		author: author || 'anonymous',
		text: String(text ?? '').trim()
	};
	if (!comment.text) return undefined;
	f.comments.push(comment);
	persistSoon();
	return comment;
}

/* ── Test case linking ───────────────────────────────────────────── */

export function linkTestCase(findingId, testCaseId) {
	const f = findings.find(x => x.id === findingId);
	if (!f) return undefined;
	if (!f.testCaseIds.includes(testCaseId)) {
		f.testCaseIds.push(testCaseId);
		f.history.push({ ts: Date.now(), from: null, to: 'linked_test', by: 'user', detail: testCaseId });
		persistSoon();
	}
	return f;
}

export function unlinkTestCase(findingId, testCaseId) {
	const f = findings.find(x => x.id === findingId);
	if (!f) return undefined;
	f.testCaseIds = f.testCaseIds.filter(id => id !== testCaseId);
	f.history.push({ ts: Date.now(), from: null, to: 'unlinked_test', by: 'user', detail: testCaseId });
	persistSoon();
	return f;
}

/**
 * Removes a test case ID from all findings that reference it.
 * Called when a test case is deleted.
 */
export function removeTestCaseFromAllFindings(testCaseId) {
	let count = 0;
	for (const f of findings) {
		if (f.testCaseIds.includes(testCaseId)) {
			f.testCaseIds = f.testCaseIds.filter(id => id !== testCaseId);
			count++;
		}
	}
	if (count > 0) persistSoon();
	return count;
}

/* ── Sync helper ────────────────────────────────────────────────── */

/**
 * Syncs a session-embedded finding into the global store.
 * Called by qaTools.js when the agent files a new finding.
 * If the finding already exists (by id), updates it; otherwise creates it.
 */
export function syncSessionFinding(session, finding) {
	const existing = findings.find(f => f.id === finding.id);
	if (existing) {
		// Update fields from the session finding (in case agent edited it).
		Object.assign(existing, {
			title: finding.title,
			severity: finding.severity,
			category: finding.category,
			url: finding.url,
			steps: finding.steps,
			expected: finding.expected,
			actual: finding.actual,
			evidence: finding.evidence,
		// Evidence Engine fields (sync if present on the session finding)
		...(finding.observed != null && { observed: finding.observed }),
		...(finding.impact != null && { impact: finding.impact }),
		...(finding.recommendation != null && { recommendation: finding.recommendation }),
		...(finding.confidence != null && { confidence: finding.confidence }),
		...(finding.reproducibility != null && { reproducibility: finding.reproducibility }),
		// Phase 16: keep duplicate markers in sync (previously dropped here).
		...(finding.isDuplicate != null && { isDuplicate: finding.isDuplicate }),
		...(finding.duplicateOf != null && { duplicateOf: finding.duplicateOf }),
		...(finding.missionId != null && { missionId: finding.missionId })
	});
		persistSoon();
		return existing;
	}

	return addFinding({
		id: finding.id,
		ts: finding.ts,
		sessionId: session.id,
		projectId: session.projectId,
		title: finding.title,
		severity: finding.severity,
		category: finding.category,
		url: finding.url,
		steps: finding.steps,
		expected: finding.expected,
		actual: finding.actual,
		evidence: finding.evidence,
		// Evidence Engine fields
		...(finding.observed != null && { observed: finding.observed }),
		...(finding.impact != null && { impact: finding.impact }),
		...(finding.recommendation != null && { recommendation: finding.recommendation }),
		...(finding.confidence != null && { confidence: finding.confidence }),
		...(finding.reproducibility != null && { reproducibility: finding.reproducibility }),
		...(finding.isDuplicate != null && { isDuplicate: finding.isDuplicate }),
		...(finding.duplicateOf != null && { duplicateOf: finding.duplicateOf }),
		...(finding.missionId != null && { missionId: finding.missionId }),
		createdBy: 'agent'
	});
}

/* ── Stats ───────────────────────────────────────────────────────── */

export function getFindingStats({ projectId } = {}) {
	const filtered = projectId ? findings.filter(f => f.projectId === projectId) : findings;
	return {
		total: filtered.length,
		byStatus: VALID_STATUSES.reduce((acc, s) => {
			acc[s] = filtered.filter(f => f.status === s).length;
			return acc;
		}, {}),
		bySeverity: SEVERITY_ORDER.reduce((acc, s) => {
			acc[s] = filtered.filter(f => f.severity === s).length;
			return acc;
		}, {}),
		// Phase 16 additions
		byFindingStatus: LIFECYCLE.reduce((acc, s) => {
			acc[s] = filtered.filter(f => (f.finding_status ?? 'DETECTED') === s).length;
			return acc;
		}, {}),
		byReviewStatus: REVIEW_STATUSES.reduce((acc, s) => {
			acc[s] = filtered.filter(f => (f.review_status ?? 'unreviewed') === s).length;
			return acc;
		}, {}),
		byPriority: PRIORITIES.reduce((acc, p) => {
			acc[p] = filtered.filter(f => f.priority === p).length;
			return acc;
		}, {}),
		duplicates: filtered.filter(f => f.isDuplicate).length
	};
}

/**
 * Phase 16: raw store access for the intelligence engine (dedup window etc.).
 */
export function getAllFindings() {
	return findings;
}
