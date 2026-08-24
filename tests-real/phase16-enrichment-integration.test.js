'use strict';

/**
 * Phase 16 — enrichment integration tests (module level, isolated store).
 * Verifies the enrichment orchestrator + findings store lifecycle wiring:
 * enrichment merges, duplicate provenance, lifecycle table enforcement,
 * review coupling, filters, and the evidence gate.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'qase-p16-it-'));
mkdirSync(DATA_DIR, { recursive: true });
process.env.QASE_DATA_DIR = DATA_DIR;

// Import AFTER env var is set — stores resolve the data dir at module load.
const { enrichSessionFindings, reenrichFinding } = await import('../server/findingEnrichment.js');
const {
	addFinding, getFinding, markDuplicate, transitionFindingStatus, setReviewStatus,
	listFindings, applyIntelligence, getFindingStats,
} = await import('../server/findings.js');
const { groupFindings } = await import('../server/findingIntelligence.js');

describe('Phase 16 enrichment + store integration', () => {

	test('applyIntelligence merges derived fields but guards observation fields', () => {
		const f = addFinding({
			title: 'Integration: search returns no results', severity: 'medium', category: 'search',
			url: 'https://it.test/search', expected: 'Results listed', actual: 'Empty state shown',
		});
		const derived = {
			title: 'SHOULD NOT APPLY', severity: 'critical', primary_category: 'FUNCTIONAL',
			confidence: 0.42, confidence_reason: { level: 'MEDIUM', signals: { x: true }, contributions: [] },
			priority: 'P2', priority_rationale: 'test', workflow_id: 'wf1', page: '/search',
		};
		const updated = applyIntelligence(f.id, derived);
		assert.equal(updated.title, 'Integration: search returns no results');
		assert.equal(updated.severity, 'medium', 'severity guarded from enrichment');
		assert.equal(updated.primary_category, 'FUNCTIONAL');
		assert.equal(updated.confidence, 0.42);
		assert.equal(updated.priority, 'P2');
		// Linkage is normalized to the canonical camelCase field the store
		// and all consumers (filters, UI, grouping, affected-*) read.
		assert.equal(updated.workflowId, 'wf1');
		assert.equal(updated.workflow_id, undefined, 'snake_case copy not stored');
	});

	test('markDuplicate stores provenance and sets lifecycle DUPLICATE', () => {
		const a = addFinding({ title: 'Dup base A', severity: 'high', url: 'https://it.test/d' });
		const b = addFinding({ title: 'Dup base B', severity: 'high', url: 'https://it.test/d' });
		const merged = markDuplicate(b.id, a.id, { evidenceCount: 4 });
		assert.equal(merged.isDuplicate, true);
		assert.equal(merged.duplicateOf, a.id);
		assert.ok(merged.duplicate_provenance);
		assert.deepEqual(merged.duplicate_provenance.originalIds.slice().sort(), [a.id, b.id].slice().sort());
		assert.equal(merged.finding_status, 'DUPLICATE');

		const grouped = groupFindings([a, b], 'category');
		assert.equal(grouped.duplicatesExcluded, 1);
		assert.equal(grouped.canonicalCount, 1);
		assert.equal(grouped.duplicateCount, 1);
	});

	test('transitionFindingStatus enforces the transition table (evidence gate)', () => {
		const f = addFinding({ title: 'Lifecycle target', severity: 'low', url: 'https://it.test/l' });
		assert.equal(f.finding_status ?? 'DETECTED', 'DETECTED');

		const jump = transitionFindingStatus(f.id, 'VERIFIED');
		assert.equal(jump.ok, false);
		assert.match(jump.reason, /evidence|invalid/i);

		const step1 = transitionFindingStatus(f.id, 'VERIFYING');
		assert.ok(step1.ok, 'DETECTED → VERIFYING allowed');
		// Evidence gate: VERIFYING → VERIFIED is REJECTED without sufficient
		// typed evidence on record (this finding has none).
		const step2 = transitionFindingStatus(f.id, 'VERIFIED');
		assert.equal(step2.ok, false, 'VERIFYING → VERIFIED blocked by evidence gate');
		assert.match(step2.reason, /insufficient evidence/);
		// With sufficient evidence recorded, the same transition succeeds.
		const store = getFinding(f.id);
		store.evidence_sufficiency = { sufficient: true, required: { minItems: 1 }, present: { count: 2, types: ['screenshot', 'console'], sources: ['agent'] }, reasons: [] };
		const step2b = transitionFindingStatus(f.id, 'VERIFIED');
		assert.ok(step2b.ok, 'VERIFYING → VERIFIED allowed with sufficient evidence');
		const back = transitionFindingStatus(f.id, 'DETECTED');
		assert.equal(back.ok, false, 'no arbitrary backwards jump');
	});

	test('setReviewStatus false_positive/duplicate/confirmed couple lifecycle and audit', () => {
		const f = addFinding({ title: 'FP target', severity: 'low', url: 'https://it.test/fp' });
		const r = setReviewStatus(f.id, 'false_positive', 'tester', 'not a bug');
		assert.equal(r.ok, true);
		const after = getFinding(f.id);
		assert.equal(after.review_status, 'false_positive');
		assert.equal(after.finding_status, 'FALSE_POSITIVE');
		assert.ok(after.history.some(h => h.field === 'review_status' && h.to === 'false_positive'));

		// invalid verdict rejected
		const bad = setReviewStatus(f.id, 'definitely-a-bug', 'tester');
		assert.equal(bad.ok, false);
	});

	test('reenrichFinding derives explainable intelligence from an evidence-less record', async () => {
		const f = addFinding({
			title: 'Reenrich me', severity: 'medium', category: 'forms', url: 'https://it.test/r',
			expected: 'Saved', actual: 'Spinner forever',
		});
		const derived = await reenrichFinding(f.id);
		assert.ok(derived);
		assert.ok(derived.primary_category, 'category always set');
		assert.equal(typeof derived.confidence, 'number');
		assert.ok(derived.confidence_reason);
		assert.notEqual(derived.finding_status, 'VERIFIED', 'no evidence → never VERIFIED');
		const stored = getFinding(f.id);
		assert.equal(stored.primary_category, derived.primary_category);
	});

	test('enrichSessionFindings runs end-to-end on isolated store; exact twins deduplicate', async () => {
		const s = 'sess-it-p16';
		const f1 = addFinding({ sessionId: s, title: 'Session finding one', severity: 'high', category: 'forms', url: 'https://it.test/s', expected: 'x', actual: 'y', reproducibility: 'confirmed' });
		const f2 = addFinding({ sessionId: s, title: 'Session finding two', severity: 'low', category: 'nav', url: 'https://it.test/s2', expected: 'x', actual: 'y' });
		const res = await enrichSessionFindings(s);
		assert.ok(res.enriched >= 2, `enriched=${res.enriched}`);
		for (const id of [f1.id, f2.id]) {
			const f = getFinding(id);
			assert.ok(f.primary_category, 'category derived');
			assert.ok(f.confidence_reason, 'confidence explainable');
			assert.ok(f.dev_summary, 'dev summary present');
		}

		// Exact twins → deterministic duplicate marking with provenance.
		const d1 = addFinding({ sessionId: s, title: 'Dupe twin', severity: 'medium', category: 'forms', url: 'https://it.test/twin', expected: '1', actual: '2', ts: Date.now() - 2000 });
		const d2 = addFinding({ sessionId: s, title: 'Dupe twin', severity: 'medium', category: 'forms', url: 'https://it.test/twin', expected: '1', actual: '2' });
		await enrichSessionFindings(s);
		const a1 = getFinding(d1.id);
		const a2 = getFinding(d2.id);
		const marked = [a1, a2].filter(x => x.isDuplicate);
		assert.equal(marked.length, 1, `exactly one twin marked duplicate (d1=${a1.isDuplicate} d2=${a2.isDuplicate})`);
		assert.ok(marked[0].duplicateOf, 'canonical referenced');
		const canonicalId = marked[0].duplicateOf;
		assert.ok([d1.id, d2.id].includes(canonicalId), 'canonical is the other twin');
	}, { timeout: 60000 });

	test('listFindings filters for Phase 16 dimensions + stats', () => {
		const a = addFinding({ title: 'Filter target', severity: 'critical', primary_category: 'SECURITY', priority: 'P0', url: 'https://it.test/f' });
		assert.ok(listFindings({ primaryCategory: 'SECURITY' }).some(x => x.id === a.id));
		assert.ok(listFindings({ priority: 'P0' }).some(x => x.id === a.id));
		assert.ok(listFindings({ includeDuplicates: false }).every(x => !x.isDuplicate));
		const stats = getFindingStats();
		assert.ok(stats.byPriority && 'P0' in stats.byPriority);
		assert.ok(stats.byReviewStatus && 'unreviewed' in stats.byReviewStatus);
	});

	test('old-shape finding (pre-Phase16 fields absent) stays readable and upgradeable', () => {
		// Simulate a legacy record written by the old store.
		const legacy = {
			id: 'legacy-1', ts: 1, title: 'Legacy finding', severity: 'low', category: 'whatever',
			url: 'https://it.test/legacy', status: 'open', steps: [], expected: 'a', actual: 'b',
			testCaseIds: [], comments: [], history: [], tags: [],
		};
		const added = addFinding(legacy);
		assert.equal(added.title, 'Legacy finding');
		assert.equal(added.finding_status, 'DETECTED', 'default lifecycle applied');
		assert.equal(added.review_status, 'unreviewed', 'default review applied');
		const derived = {
			primary_category: 'UNKNOWN', confidence: 0.05,
			confidence_reason: { level: 'LOW', signals: {}, contributions: [] },
		};
		applyIntelligence(added.id, derived);
		const reread = getFinding(added.id);
		assert.equal(reread.primary_category, 'UNKNOWN');
		assert.equal(reread.title, 'Legacy finding', 'observation preserved');
	});
});

// Cleanup after all tests in this file finish (node:test runs files in isolation).
process.on('exit', () => {
	try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
});
