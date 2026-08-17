'use strict';

/**
 * Phase 18 — Validation Executor core.
 *
 * (File split from validationExecutor.js so index.js's import path stays
 * stable; validationExecutor.js re-exports the public surface.)
 */

import {
	aggregateAttempts,
	assessEvidenceSufficiency,
	classifyFixStatus,
	classifyRegressions,
	computeValidationConfidence,
	detectPartialFix,
} from './fixStatusEngine.js';
import {
	appendAttempt,
	completeRun,
	failRun,
	getRun,
	transitionRun,
} from './fixValidation.js';
import { createEvidence, linkEvidenceToFinding, EVIDENCE_TYPES } from './evidenceGraph.js';
import { redactString } from './findingIntelligence.js';
import { runTestCase } from './replay.js';
import { VALIDATION_RUN_STATUSES } from './fixStatusEngine.js';

/** Attempts per validation (spec §10 configurable). */
export const VALIDATION_ATTEMPTS = Number(process.env.QASE_FIX_VALIDATION_ATTEMPTS || 2);

/** Max regression cases selected / executed per run. */
const REGRESSION_SELECT_MAX = 6;
const REGRESSION_BUDGET = 2;

/** Trivial viewport deltas that do NOT count as environment mismatch. */
function viewportEquivalent(a, b) {
	if (!a || !b) return a === b;
	return Number(a.width) === Number(a.width ? a.width : b.width) === Number(b.width);
}

/** Record an evidence node into the graph AND the run's evidence list. */
function recordEvidence(run, phase, type, { title, description = '', artifactPath = null, url = null }) {
	const node = createEvidence({
		type,
		source: 'fix_validation',
		target: url,
		observation: redactString(String(title || '')).slice(0, 300),
		payload: redactString(String(description || '')).slice(0, 1200),
		metadata: {
			validationId: run.id,
			findingId: run.findingId,
			phase,
			...(artifactPath ? { artifactPath } : {}),
		},
	});
	if (node?.id) {
		try { linkEvidenceToFinding(node.id, run.findingId); } catch { /* best-effort */ }
	}
	run.evidence[phase].push({
		kind: type,
		ts: Date.now(),
		title: redactString(String(title || '')).slice(0, 300),
		description: redactString(String(description || '')).slice(0, 800),
		...(node?.id ? { evidenceNodeId: node.id } : {}),
		...(artifactPath ? { artifactPath } : {}),
	});
}

/** Human field label → resilient Playwright selector (label/name/placeholder/aria). */
function labelToSelector(label) {
	const l = String(label).trim();
	const slug = l.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	const words = l.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const camel = words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
	return [
		`[name="${slug}"]`,
		`#${slug}Input`,
		`#${slug}`,
		`#name-${slug}`,
		`input[id="${camel}Input"]`,
		`input[placeholder*="${l}" i]`,
		`input[aria-label*="${l}" i]`,
	].join(', ');
}

/** Human step string → replay step object. Returns null when unconvertible. */
function stepToReplay(raw) {
	const s = String(raw || '').trim();
	if (!s) return null;
	// "Go to <url>" / "Navigate to <url>" / bare URL
	const nav = s.match(/^(?:go to|navigate to|open)\s+(https?:\/\/\S+)$/i) || s.match(/^(https?:\/\/\S+)$/);
	if (nav) return { action: 'navigate', target: nav[1] };
	// "Click 'X'" / 'Click "X"' / "Click X"
	const click = s.match(/^click\s+["'“](.+?)["'”]$/i) || s.match(/^click\s+(.+)$/i);
	if (click) {
		const t = click[1].trim();
		return { action: 'click', target: t.startsWith('#') || t.includes('[') || t.includes('>>') || t.includes('text=') ? t : `text=${t}` };
	}
	// "Enter Name: QA User" / "Type Email: x@y.z" / "Fill <label> with <value>"
	const fill = s.match(/^(?:enter|type|fill(?:\s+in)?(?:\s+the)?)\s+(.+?)\s*(?::|with)\s+(.+)$/i);
	if (fill) return { action: 'fill', target: labelToSelector(fill[1].trim()), value: fill[2].trim() };
	// "Reload the page" / "Refresh"
	if (/^reload\b|^refresh\b/i.test(s)) return { action: 'reload' };
	// "Wait for X"
	const wait = s.match(/^wait\s+(?:for\s+)?(.+)$/i);
	if (wait) return { action: 'wait', target: wait[1].trim() };
	return null;
}

/** Extract a checkable artifact (name/quote) from a natural-language expected text. */
function expectedAnchor(finding) {
	const text = String(finding.expected || '');
	if (!text) return null;
	// Quoted strings are the strongest anchor ("E2E User" / "Bench User").
	const quoted = text.match(/["'“]([^"'”]{2,60})["'”]/);
	if (quoted) return quoted[1];
	// "Enter Name: X" style value echoes.
	const labeled = text.match(/\b(?:name|user|email|contact)\s+([\w .-]{2,40})\b/i);
	if (labeled) return labeled[1].trim();
	return null;
}

/**
 * Build the validation test case from the finding's OWN steps (spec §4 —
 * never an unrelated new test). Unconvertible steps are recorded as gaps.
 * The final assertion set encodes the finding's EXPECTED behavior, so the
 * replay can only "pass" when the expected state is actually observed.
 */
export function buildValidationTestCase(finding) {
	const steps = (finding.steps || []).map(stepToReplay);
	const converted = steps.filter(Boolean);
	const gaps = (finding.steps || []).filter((_, i) => !steps[i]);
	const url = finding.url || (finding.steps || []).map(s => (s.match(/https?:\/\/\S+/) || [])[1]).find(Boolean) || null;
	const assertions = [];
	if (url) assertions.push({ type: 'url_contains', target: url.replace(/^https?:\/\/[^/]+/, '') || '/' });
	const anchor = expectedAnchor(finding);
	if (anchor) assertions.push({ type: 'element_visible', target: `text=${anchor}` });
	assertions.push({ type: 'no_console_errors' });
	assertions.push({ type: 'no_failed_requests' });
	return {
		id: `fxv-tc-${finding.id}`,
		name: `Fix validation: ${(finding.title || 'finding').slice(0, 80)}`,
		targetUrl: url,
		steps: converted,
		assertions,
		viewport: finding.viewport || 'desktop',
		_generatedFrom: { originalSteps: (finding.steps || []).length, converted: converted.length, gaps },
	};
}

/** Environment deltas vs the original finding (spec §5). */
function computeEnvironmentDeltas(run, finding) {
	const deltas = [];
	const plan = run.plan || {};
	const cmp = (field, current, original) => {
		if (current === original) return;
		if (field === 'viewport' && viewportEquivalent(current, original)) {
			deltas.push({ field, from: original, to: current, trivial: true });
			return;
		}
		deltas.push({ field, from: original ?? null, to: current ?? null });
	};
	cmp('url', plan.url ?? null, finding.url ?? null);
	cmp('viewport', plan.viewport ?? null, finding.viewport ?? null);
	cmp('device', plan.device ?? null, finding.device ?? null);
	cmp('browser', plan.browser ?? null, null);
	return deltas;
}

/** Risk-based targeted regression selection (spec §11). */
function selectRegressionSet(finding) {
	const cases = [];
	try {
		const all = (typeof globalThis.__qaseListTestCases === 'function' ? globalThis.__qaseListTestCases() : []);
		for (const tc of all) {
			if ((tc.findingIds || []).includes(finding.id)) cases.push({ tc, reason: 'linked_to_finding' });
			else if (finding.workflowId && tc.workflowId === finding.workflowId) cases.push({ tc, reason: 'same_workflow' });
			else if (finding.featureId && tc.featureId === finding.featureId) cases.push({ tc, reason: 'same_feature' });
		}
	} catch { /* no regression cases available */ }
	return cases.slice(0, REGRESSION_SELECT_MAX);
}

/** BEFORE/AFTER comparison builder (spec §6). */
function buildComparison(run, finalAttempt, regressionResults) {
	const of = run.originalFinding || {};
	const after = {
		expected: of.expected ?? null,
		actual: finalAttempt ? (finalAttempt.expectedObserved ? 'expected behavior observed' : (finalAttempt.originalFailureReproduced ? 'original failure still occurs' : 'undetermined')) : 'no attempt executed',
		evidenceCount: (run.evidence?.after || []).length,
		workflowOutcome: finalAttempt?.expectedObserved === true ? 'expected behavior observed' : (finalAttempt?.originalFailureReproduced === true ? 'original failure reproduced' : 'inconclusive'),
		console: finalAttempt?.assertions?.some(a => a.type === 'no_console_errors' && a.passed) ? 'no errors' : 'errors present',
		network: finalAttempt?.assertions?.some(a => a.type === 'no_failed_requests' && a.passed) ? 'no failures' : 'failures present',
	};
	return {
		findingId: run.findingId,
		validationId: run.id,
		before: {
			expected: of.expected ?? null,
			actual: of.actual ?? null,
			evidenceCount: (run.evidence?.before || []).length,
			workflowOutcome: 'original failure recorded',
		},
		after,
		verdicts: {
			behaviorChanged: after.workflowOutcome !== 'original failure recorded',
			expectedAchieved: finalAttempt?.expectedObserved === true,
			originalFailureReproduced: finalAttempt?.originalFailureReproduced === true,
			relatedFailuresIntroduced: (regressionResults || []).some(r => r.passed === false),
		},
	};
}

/** Main entry — executes a validation run to completion. Never rejects. */
export async function executeValidation(runId, { getFinding } = {}) {
	const t0 = Date.now();
	const run = getRun(runId);
	if (!run) return null;
	try {
		transitionRun(run.id, { status: VALIDATION_RUN_STATUSES.RUNNING }, 'executor started');
		const finding = typeof getFinding === 'function' ? getFinding(run.findingId) : null;

		// ── BEFORE evidence (from the immutable snapshot) ──
		const tEv = Date.now();
		const of = run.originalFinding || finding || {};
		recordEvidence(run, 'before', EVIDENCE_TYPES.OBSERVATION, {
			title: `Original finding: ${of.title || run.findingId}`,
			description: `Expected: ${of.expected ?? 'n/a'} | Actual: ${of.actual ?? 'n/a'}`,
		});
		run.timings.evidenceBeforeMs = Date.now() - tEv;

		run.environmentDeltas = finding ? computeEnvironmentDeltas(run, finding) : [];

		// ── Attempts (replay the finding's own steps) ──
		const testCase = buildValidationTestCase(of);
		const tAtt = Date.now();
		const attemptRecords = [];
		let finalAttempt = null;
		for (let i = 1; i <= VALIDATION_ATTEMPTS; i++) {
			const at = Date.now();
			let res = null;
			try {
				res = await runTestCase(testCase, { attempt: i, viewport: testCase.viewport });
			} catch (err) {
				res = { result: 'error', error: String(err?.message || err) };
			}
			const executed = !res.error && res.result !== 'error';
			const assertions = (res.assertionResults || []).map(a => ({ type: a.type, passed: a.passed, actual: a.actual ?? null, expected: a.expected ?? null }));
			const expectedObserved = executed && assertions.filter(a => a.type !== 'no_console_errors' && a.type !== 'no_failed_requests').every(a => a.passed) && res.result === 'pass';
			const originalFailureReproduced = executed ? !expectedObserved : null;
			const sufficiency = assessEvidenceSufficiency({
				executed,
				expectedObserved,
				stateCaptured: executed,
				networkCaptured: executed,
				visualCaptured: executed,
				viewportPreserved: true,
			}, of.category || of.primaryCategory || 'functional');
			const record = {
				attempt: i,
				executed,
				result: res.result,
				succeeded: executed && expectedObserved,
				originalFailureReproduced,
				expectedObserved,
				sufficiency: sufficiency.sufficient,
				missingEvidence: sufficiency.missing,
				durationMs: Date.now() - at,
				error: res.error ? redactString(String(res.error)) : null,
				assertions,
				steps: (res.stepResults || []).map(s => ({ action: s.action, status: s.status })),
			};
			attemptRecords.push(record);
			appendAttempt(run.id, record);
			recordEvidence(run, 'after', res.result === 'fail' || res.result === 'error' ? EVIDENCE_TYPES.SCREENSHOT : EVIDENCE_TYPES.STEP_OUTCOME, {
				title: `Attempt ${i}: ${expectedObserved ? 'expected behavior observed' : 'original path still failing'}`,
				description: assertions.map(a => `${a.passed ? '✅' : '❌'} ${a.type}`).join(' | ').slice(0, 300),
			});
			if ((res.screenshots || []).length > 0) {
				recordEvidence(run, 'after', EVIDENCE_TYPES.SCREENSHOT, {
					title: `Attempt ${i} failure screenshot`,
					description: String((res.screenshots[0] || {}).label || ''),
					artifactPath: (res.screenshots[0] || {}).artifactPath ?? (res.screenshotPaths || [])[0] ?? null,
				});
			}
			finalAttempt = record;
		}
		run.timings.attemptsMs = Date.now() - tAtt;

		// ── Targeted regression ──
		const tReg = Date.now();
		const regressionResults = [];
		const selected = finding ? selectRegressionSet(finding) : [];
		for (const { tc } of selected.slice(0, REGRESSION_BUDGET)) {
			try {
				const res = await runTestCase(tc, { attempt: 1 });
				const passed = res.result === 'pass';
				const verified = res.result !== 'error' && !res.flaky;
				regressionResults.push({ id: tc.id, name: tc.name, passed, verified });
				if (!passed) {
					recordEvidence(run, 'after', EVIDENCE_TYPES.ASSERTION, {
						title: `Regression check failed: ${tc.name}`,
						description: redactString(String(res.error || 'assertion failed')).slice(0, 300),
					});
				}
			} catch (err) {
				regressionResults.push({ id: tc.id, name: tc.name, passed: false, verified: false, error: String(err?.message || err).slice(0, 200) });
			}
		}
		run.timings.regressionMs = Date.now() - tReg;

		// ── Derive status (deterministic; no LLM) ──
		const subConditions = (of.subConditions || []).map(s => ({
			id: s.id, label: s.label,
			fixed: s.id === 'core' ? (finalAttempt?.originalFailureReproduced === false) : (s.fixed ?? null),
		}));
		const outcome = {
			originalFailureReproduced: finalAttempt?.originalFailureReproduced ?? null,
			expectedObserved: finalAttempt?.expectedObserved ?? null,
			subConditions,
			attempts: attemptRecords.map(a => ({ succeeded: a.succeeded, sufficient: a.sufficiency, executed: a.executed })),
			regressions: regressionResults,
			evidenceSufficient: finalAttempt?.sufficiency === true,
			environmentMismatch: (run.environmentDeltas || []).some(d => !d.trivial),
		};
		const classified = classifyFixStatus(outcome);
		const agg = aggregateAttempts(outcome.attempts);
		const validationConfidence = computeValidationConfidence({
			samePath: testCase._generatedFrom.converted > 0,
			sameEnvironment: outcome.environmentMismatch === false,
			repeatedSuccess: agg.executed >= 2 && agg.allSucceeded,
			expectedReached: outcome.expectedObserved === true,
			originalAbsent: outcome.originalFailureReproduced === false,
			originalFailureReproduced: outcome.originalFailureReproduced === true,
			repeatedReproduction: agg.executed >= 2 && agg.allFailed,
			consoleClean: finalAttempt?.assertions?.some(a => a.type === 'no_console_errors' && a.passed) ?? false,
			networkOk: finalAttempt?.assertions?.some(a => a.type === 'no_failed_requests' && a.passed) ?? false,
			regressionPassed: !classifyRegressions(regressionResults).hasVerifiedRegression,
			evidenceComplete: outcome.evidenceSufficient,
			attemptsStable: !agg.mixed,
		});

		const comparison = buildComparison(run, finalAttempt, regressionResults);
		const knowledgeWriter = globalThis.__qasePhase18KnowledgeWriter;
		completeRun(run.id, {
			fixStatus: classified.status,
			fixStatusReason: classified.reason,
			validationConfidence,
			confidenceSignals: null,
			partialFix: detectPartialFix(subConditions),
			regressions: classifyRegressions(regressionResults),
			comparison,
			timings: { ...run.timings, totalMs: Date.now() - t0 },
		}, (completed) => {
			if (typeof knowledgeWriter === 'function') knowledgeWriter(completed, of);
		});
		return getRun(run.id);
	} catch (err) {
		failRun(run.id, err?.message || String(err));
		return getRun(run.id);
	}
}
