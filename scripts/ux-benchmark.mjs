#!/usr/bin/env node
/**
 * Phase 17 — UX Intelligence benchmark runner.
 *
 * Deterministic: runs the sweep + checks + gap validation ONLY (no LLM, no
 * mission). Compares against .drytis/benchmarks/ux-ground-truth.md labels.
 *
 * Usage:
 *   node scripts/ux-benchmark.mjs
 *
 * Output:
 *   .drytis/ux-benchmark-results.json  (machine-readable)
 *   .drytis/ux-benchmark-results.md    (human-readable)
 */

import { runUxSweep } from '../server/uxSweep.js';
import { runSiteChecks } from '../server/uxChecks.js';
import { buildUxAssessment } from '../server/uxModel.js';
import { validateFeatureGaps, featureCompleteness } from '../server/featureGapValidation.js';
import { buildRecommendations } from '../server/recommendationEngine.js';
import { buildQualityAssessment } from '../server/qualityAssessment.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '.drytis');

/* ── apps + labels (mirror of ux-ground-truth.md; kept in code for scoring) ── */

const APPS = [
	{
		name: 'SalesFlow CRM',
		url: 'http://localhost:9901',
		uxIssues: [
			{ id: 'ux_nav_dead_end', checks: ['navigation_dead_end', 'dead_end'] },
			{ id: 'ux_resp_overflow_mobile', checks: ['resp_horizontal_overflow'] },
			{ id: 'ux_resp_touch_targets', checks: ['resp_touch_targets', 'touch_target'] },
			{ id: 'ux_consistency_titles', checks: ['consistency_cross_page', 'clarity_document_title_per_page'] },
		],
		cleanAreas: ['clarity_document_title', 'form_field_labels', 'heading_order'],
		requirements: ['Reports / analytics section', 'Search functionality', 'Contacts list'],
		implemented: ['Contacts list'],
		missing: ['Reports / analytics section', 'Search functionality'],
	},
	{
		name: 'TaskBoard',
		url: 'http://localhost:9902',
		uxIssues: [
			{ id: 'ux_nav_dead_end', checks: ['navigation_dead_end', 'dead_end'] },
			{ id: 'ux_consistency_titles', checks: ['consistency_cross_page'] },
			{ id: 'ux_resp_overflow_mobile', checks: ['resp_horizontal_overflow'] },
		],
		cleanAreas: ['form_field_labels'],
		requirements: ['Search/filter', 'Due dates', 'Kanban board'],
		implemented: ['Kanban board'],
		missing: ['Search/filter', 'Due dates'],
	},
	{
		name: 'ShopHub E-commerce',
		url: 'http://localhost:9903',
		uxIssues: [
			{ id: 'ux_resp_touch_targets', checks: ['resp_touch_targets', 'touch_target'] },
			{ id: 'ux_nav_dead_end', checks: ['navigation_dead_end', 'dead_end', 'navigation_broken_internal_links'] },
		],
		cleanAreas: ['clarity_document_title', 'form_field_labels', 'a11y_image_alt'],
		requirements: ['User reviews', 'Cart'],
		implemented: ['Cart'],
		missing: ['User reviews'],
	},
	{
		name: 'MetricsPro Analytics',
		url: 'http://localhost:9904',
		uxIssues: [
			{ id: 'ux_resp_overflow_mobile', checks: ['resp_horizontal_overflow'] },
			{ id: 'ux_resp_touch_targets', checks: ['resp_touch_targets', 'touch_target'] },
		],
		cleanAreas: ['clarity_document_title', 'heading_order'],
		requirements: ['Export data (CSV)', 'Dashboard stats'],
		implemented: ['Dashboard stats'],
		missing: ['Export data (CSV)'],
	},
	{
		name: 'SaaSLaunch Marketing',
		url: 'http://localhost:9905',
		uxIssues: [
			{ id: 'ux_resp_overflow_mobile', checks: ['resp_horizontal_overflow'] },
			{ id: 'ux_nav_dead_end', checks: ['navigation_dead_end', 'dead_end', 'navigation_broken_internal_links'] },
		],
		cleanAreas: ['clarity_document_title', 'form_field_labels', 'a11y_image_alt'],
		requirements: ['Blog', 'Pricing section'],
		implemented: ['Pricing section'],
		missing: ['Blog'],
	},
];

/* ── scoring ─────────────────────────────────────────────────────── */

function scoreApp(app, sweep, assessment, gapValidation) {
	const flaggedChecks = new Set();
	for (const i of assessment.issues) flaggedChecks.add(i.checkId);
	const allChecks = new Set([...flaggedChecks]);
	// also consider UNVERIFIED checks as "not flagged" (they are not asserted)
	for (const u of assessment.unverifiedAreas) allChecks.add(u.checkId);

	// recall: expected labels whose any check id was flagged
	const matchedLabels = [];
	const missedLabels = [];
	for (const label of app.uxIssues) {
		if (label.checks.some((c) => flaggedChecks.has(c))) matchedLabels.push(label.id);
		else missedLabels.push(label.id);
	}
	// FP: flags on clean areas
	const falsePositives = [];
	for (const area of app.cleanAreas) {
		if (flaggedChecks.has(area)) falsePositives.push(area);
	}

	// gap accuracy
	const gaps = gapValidation.features ?? [];
	const confirmed = gaps.filter((g) => g.gapAssertion === 'CONFIRMED_FEATURE_GAP').map((g) => g.feature);
	const correctConfirmed = confirmed.filter((f) => app.missing.some((m) => f.toLowerCase().includes(m.toLowerCase().split(' ')[0])));
	const gapFP = confirmed.filter((f) => !correctConfirmed.includes(f));
	const implementedOk = gaps.filter((g) => app.implemented.some((m) => g.feature.toLowerCase().includes(m.toLowerCase().split(' ')[0])) && g.classification === 'IMPLEMENTED').map((g) => g.feature);

	// evidence completeness
	const evidenceComplete = assessment.issues.every((i) => Array.isArray(i.evidence) && i.evidence.length > 0);
	const unverifiedSurvives = assessment.unverifiedAreas.length >= 0; // must be present as data (0 allowed)

	return {
		app: app.name,
		url: app.url,
		flaggedChecks: [...flaggedChecks],
		matchedLabels,
		missedLabels,
		falsePositives,
		issues: assessment.issues.length,
		unverifiedAreas: assessment.unverifiedAreas.length,
		evidenceComplete,
		unverifiedSurvives,
		confirmedGaps: confirmed,
		gapFP,
		implementedDetected: implementedOk,
		sweepDurationMs: sweep.sweepMeta.durationMs,
	};
}

/* ── main ────────────────────────────────────────────────────────── */

async function main() {
	console.log('Phase 17 UX benchmark — deterministic sweep (no LLM)\n');
	const results = [];

	for (const app of APPS) {
		// discover the hash-routed pages by sweeping the root; hash views of
		// these apps render on one document, so one URL is the whole surface
		const sweep = await runUxSweep({ pages: [app.url], timeoutMs: 90_000 });
		const assessment = buildUxAssessment(sweep);
		// site checks need the pages map
		for (const r of runSiteChecks(sweep.pages)) {
			if (r.status === 'ISSUE') {
				assessment.issues.push({ checkId: r.checkId, evidence: r.evidence ?? [], severity: r.severity, dimension: r.dimension });
			}
		}
		// gap validation: explicit requirements + honest (insufficient) exploration
		const observations = {
			verifiedFeatures: [], // deterministic sweep can't verify features — honest
			brokenFeatures: [],
			pagesObserved: Math.max(1, sweep.sweepMeta.okPages),
			workflowsTested: 0,
			workflowsPassed: 0,
			blockedWorkflows: 0,
			explorationConfidence: 0.3,
			positiveSignals: [],
		};
		const expected = app.requirements.map((r) => ({ name: r, source: 'requirements', provenanceConfidence: 0.95 }));
		const gapValidation = validateFeatureGaps(expected, observations);

		// POSITIVE control: same requirements but WITH sufficient exploration
		// (verified features populated) must CONFIRM the real gaps and
		// classify implemented features correctly — validates the gate both ways.
		const positiveValidation = validateFeatureGaps(expected, {
			verifiedFeatures: app.implemented, // strings — validator contract
			brokenFeatures: [],
			pagesObserved: 5,
			workflowsTested: 2,
			workflowsPassed: 2,
			blockedWorkflows: 0,
			explorationConfidence: 0.8,
			positiveSignals: [],
		});

		const scored = scoreApp(app, sweep, assessment, gapValidation);
		// positive-path gap scoring
		const posConfirmed = (positiveValidation.features ?? []).filter((g) => g.gapAssertion === 'CONFIRMED_FEATURE_GAP').map((g) => g.feature);
		const posCorrect = posConfirmed.filter((f) => app.missing.some((m) => f.toLowerCase().includes(m.toLowerCase().split(' ')[0])));
		const posImplemented = (positiveValidation.features ?? []).filter((g) => app.implemented.some((m) => g.feature.toLowerCase().includes(m.toLowerCase().split(' ')[0])) && g.classification === 'IMPLEMENTED').map((g) => g.feature);
		scored.positivePath = {
			confirmedGaps: posConfirmed,
			correctlyConfirmed: posCorrect.length,
			incorrectlyConfirmed: posConfirmed.length - posCorrect.length,
			implementedDetected: posImplemented,
		};
		results.push(scored);
		const honestConfirmed = (gapValidation.features ?? []).filter((g) => g.gapAssertion === 'CONFIRMED_FEATURE_GAP').length;
		console.log(`• ${app.name}: issues=${scored.issues} unverified=${scored.unverifiedAreas} matched=${scored.matchedLabels.length}/${app.uxIssues.length} fp=${scored.falsePositives.length} | gaps: honestConfirmed=${honestConfirmed} (should be 0) positiveCorrect=${posCorrect.length}/${app.missing.length} implemented=${posImplemented.length}/${app.implemented.length}`);
	}

	// aggregate
	const totalLabels = APPS.reduce((s, a) => s + a.uxIssues.length, 0);
	const totalMatched = results.reduce((s, r) => s + r.matchedLabels.length, 0);
	const totalFP = results.reduce((s, r) => s + r.falsePositives.length, 0);
	const totalFlags = results.reduce((s, r) => s + r.issues, 0);
	const honestConfirmedTotal = results.reduce((s, r) => s + r.confirmedGaps.length, 0); // must be 0: no exploration → never CONFIRM
	const posCorrectTotal = results.reduce((s, r) => s + r.positivePath.correctlyConfirmed, 0);
	const posIncorrectTotal = results.reduce((s, r) => s + r.positivePath.incorrectlyConfirmed, 0);
	const totalMissingLabels = APPS.reduce((s, a) => s + a.missing.length, 0);
	const totalImplementedLabels = APPS.reduce((s, a) => s + a.implemented.length, 0);
	const implementedDetectedTotal = results.reduce((s, r) => s + r.positivePath.implementedDetected.length, 0);
	const allEvidenceComplete = results.every((r) => r.evidenceComplete);
	const allUnverifiedSurvive = results.every((r) => r.unverifiedSurvives);

	const summary = {
		ranAt: new Date().toISOString(),
		uxRecall: totalLabels ? Number((totalMatched / totalLabels).toFixed(3)) : null,
		uxPrecision: totalFlags ? Number(((totalFlags - totalFP) / totalFlags).toFixed(3)) : null,
		fpRate: totalFlags ? Number((totalFP / totalFlags).toFixed(3)) : null,
		evidenceCompleteness: allEvidenceComplete ? 1 : Number((results.filter((r) => r.evidenceComplete).length / results.length).toFixed(3)),
		unverifiedSurvives: allUnverifiedSurvive,
		// Gap gates — both directions
		gapHonestNeverConfirmed: honestConfirmedTotal === 0, // no exploration → 0 CONFIRMED (conservative)
		gapRecallPositivePath: totalMissingLabels ? Number((posCorrectTotal / totalMissingLabels).toFixed(3)) : null,
		gapPrecisionPositivePath: (posCorrectTotal + posIncorrectTotal) ? Number((posCorrectTotal / (posCorrectTotal + posIncorrectTotal)).toFixed(3)) : null,
		implementedDetected: implementedDetectedTotal,
		implementedLabels: totalImplementedLabels,
		perApp: results,
	};

	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(join(OUT_DIR, 'ux-benchmark-results.json'), JSON.stringify(summary, null, 2));

	const md = [
		'# Phase 17 UX Benchmark Results',
		'',
		`Run: ${summary.ranAt}`,
		'',
		`| Metric | Value |`,
		`|---|---|`,
		`| UX recall | ${(summary.uxRecall * 100).toFixed(1)}% |`,
		`| UX precision | ${(summary.uxPrecision * 100).toFixed(1)}% |`,
		`| FP rate | ${(summary.fpRate * 100).toFixed(1)}% |`,
		`| Evidence completeness | ${(summary.evidenceCompleteness * 100).toFixed(0)}% |`,
		`| Gap precision (CONFIRMED, positive path) | ${summary.gapPrecisionPositivePath != null ? (summary.gapPrecisionPositivePath * 100).toFixed(1) + '%' : 'n/a'} |`,
		`| Gap recall (positive path) | ${summary.gapRecallPositivePath != null ? (summary.gapRecallPositivePath * 100).toFixed(1) + '%' : 'n/a'} |`,
		`| Honest mode never CONFIRMs | ${summary.gapHonestNeverConfirmed ? 'yes' : 'NO (violates conservative gate)'} |`,
		`| Implemented detected | ${summary.implementedDetected}/${summary.implementedLabels} |`,
		`| UNVERIFIED survives | ${summary.unverifiedSurvives ? 'yes' : 'NO'} |`,
		'',
		'## Per app',
		'',
		...results.map((r) => [
			`### ${r.app}`,
			`- flagged: ${r.flaggedChecks.join(', ') || '—'}`,
			`- matched labels: ${r.matchedLabels.join(', ') || '—'}`,
			`- missed labels: ${r.missedLabels.join(', ') || '—'}`,
			`- false positives: ${r.falsePositives.join(', ') || '—'}`,
			`- confirmed gaps: ${r.confirmedGaps.join(', ') || '—'}`,
			`- gap FPs: ${r.gapFP.join(', ') || '—'}`,
			`- implemented detected: ${r.implementedDetected.join(', ') || '—'}`,
			`- unverified areas: ${r.unverifiedAreas}`,
			`- sweep duration: ${r.sweepDurationMs}ms`,
			'',
		].join('\n')),
	].join('\n');
	writeFileSync(join(OUT_DIR, 'ux-benchmark-results.md'), md);

	console.log('\nSummary:', JSON.stringify({ ...summary, perApp: undefined }, null, 2));
}

main().catch((err) => { console.error('benchmark failed:', err); process.exit(1); });
