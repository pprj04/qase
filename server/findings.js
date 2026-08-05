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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FINDINGS_FILE = join(__dirname, '..', '.qase', 'findings.json');
const MIGRATION_MARKER = join(__dirname, '..', '.qase', '.findings-migrated');

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_STATUSES = ['open', 'in_testing', 'resolved', 'closed'];

let findings = [];
let saveTimer = null;

function load() {
	try {
		if (existsSync(FINDINGS_FILE)) {
			findings = JSON.parse(readFileSync(FINDINGS_FILE, 'utf-8'));
		}
	} catch {
		findings = [];
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

load();

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
		tags: Array.isArray(data.tags) ? data.tags : []
	};
	findings.push(finding);
	persistSoon();
	return finding;
}

export function listFindings({ projectId, severity, status, category, assignee, sessionId, q } = {}) {
	return findings
		.filter(f => {
			if (projectId && f.projectId !== projectId) return false;
			if (severity && f.severity !== severity) return false;
			if (status && f.status !== status) return false;
			if (category && f.category !== category) return false;
			if (assignee && f.assignee !== assignee) return false;
			if (sessionId && f.sessionId !== sessionId) return false;
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
			evidence: finding.evidence
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
		}, {})
	};
}
