import { computeEvidenceCoverage, getFindingEvidence } from './evidenceGraph.js';
import { evaluateCoverageSufficiency, findingHasReproduction, relevantBrowserEvidence } from './coverageSafety.js';

export function isConfirmedFinding(finding) {
	return findingHasReproduction(finding) && getFindingEvidence(finding.id).some(e => relevantBrowserEvidence(finding,e));
}

/**
 * Developer Intelligence (Phase 13)
 *
 * Transforms raw QA findings into dev-consumable intelligence:
 *   - Per-finding root cause analysis and fix suggestions
 *   - AI-ready improvement prompts (copy-paste for Copilot/Cursor/Claude)
 *   - App-level improvement report (UX, accessibility, performance, security)
 *
 * All LLM calls use the execution model tier via the existing callLLM helper.
 */

import { callLLM } from './testGen.js';
import { getFinding, updateFinding, listFindings } from './findings.js';

/* ── JSON Extraction ────────────────────────────────────────────── */

function extractJSON(raw) {
	if (typeof raw !== 'string') throw new Error('LLM response is not a string.');
	let text = raw.trim();
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) text = fence[1].trim();
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
	return JSON.parse(text);
}

/* ── Per-Finding Analysis ───────────────────────────────────────── */

/**
 * Analyses a single finding via LLM and caches the result on the finding object.
 */
export async function analyzeFinding(finding, context = {}, force = false) {
	if (!force && finding.devIntelligence) {
		return finding.devIntelligence;
	}

	const system = `You are a senior software engineer analysing a bug report from an automated QA agent.
Return ONLY a valid JSON object with exactly these fields:
{"rootCause":"<1-3 sentences>","fixApproach":"<concrete steps>","affectedArea":"<frontend|backend|database|config|css|api|unknown>","estimatedComplexity":"<trivial|low|medium|high>","confidence":<0-1>}
Be specific and actionable.`;

	const parts = [
		`Title: ${finding.title}`,
		`Severity: ${finding.severity}`,
		`Category: ${finding.category}`,
		finding.url ? `URL: ${finding.url}` : '',
		finding.steps?.length ? `Steps:\n${finding.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}` : '',
		`Expected: ${finding.expected}`,
		`Actual: ${finding.actual}`,
		finding.evidence ? `Evidence: ${finding.evidence}` : ''
	].filter(Boolean).join('\n');

	const user = `Analyse this bug:\n\n${parts}\n\nRespond with ONLY a JSON object.`;
	const raw = await callLLM(system, user);
	const parsed = extractJSON(raw);

	const intelligence = {
		rootCause: String(parsed.rootCause ?? 'Unable to determine root cause.'),
		fixApproach: String(parsed.fixApproach ?? 'No fix approach available.'),
		affectedArea: String(parsed.affectedArea ?? 'unknown'),
		estimatedComplexity: String(parsed.estimatedComplexity ?? 'medium'),
		confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
		analyzedAt: Date.now()
	};

	if (finding.id) {
		updateFinding(finding.id, { devIntelligence: intelligence });
	}

	return intelligence;
}

/**
 * Batch-analyses all findings in a session.
 */
export async function analyzeSessionFindings(findings, context = {}) {
	const results = [];
	for (const finding of findings) {
		try {
			const intelligence = await analyzeFinding(finding, context);
			results.push({ finding, intelligence, status: 'done' });
		} catch (error) {
			results.push({ finding, intelligence: null, status: 'failed', error: error.message });
		}
	}

	let appReport = null;
	if (findings.length >= 2) {
		try {
			appReport = await buildAppImprovementReport(findings, context);
		} catch (error) {
			console.error('[devIntelligence] App report failed:', error.message);
		}
	}

	return { results, appReport };
}

/* ── App-Level Improvement Report ───────────────────────────────── */

const EMPTY_REPORT = { ux: [], accessibility: [], performance: [], security: [], patterns: [], priority: [] };

export async function buildAppImprovementReport(findings, context = {}) {
	if (!findings?.length) return EMPTY_REPORT;

	const system = `You are a senior engineering consultant reviewing QA findings. Return ONLY a JSON object:
{"ux":[{"issue":"","impact":"","recommendation":""}],"accessibility":[],"performance":[],"security":[],"patterns":[{"pattern":"","occurrences":0,"recommendation":""}],"priority":[{"action":"","rationale":"","impact":"<high|medium|low>"}]}
Each array 0-5 items. Only include categories with real issues. Priority ranked most impactful first.`;

	const findingsSummary = findings.map((f, i) =>
		`${i + 1}. [${f.severity}] ${f.title} (${f.category})\n   Expected: ${f.expected}\n   Actual: ${f.actual}`
	).join('\n\n');

	const user = `Analyse these ${findings.length} findings from testing ${context.targetUrl ?? 'a web app'}:\n\n${findingsSummary}\n\nRespond with ONLY a JSON object.`;
	const raw = await callLLM(system, user);
	const parsed = extractJSON(raw);

	return {
		ux: Array.isArray(parsed.ux) ? parsed.ux : [],
		accessibility: Array.isArray(parsed.accessibility) ? parsed.accessibility : [],
		performance: Array.isArray(parsed.performance) ? parsed.performance : [],
		security: Array.isArray(parsed.security) ? parsed.security : [],
		patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
		priority: Array.isArray(parsed.priority) ? parsed.priority : []
	};
}

/* ── AI-Ready Fix Prompts ───────────────────────────────────────── */

export function buildFixPrompt(finding, intelligence = null) {
	const lines = [
		'## Bug Fix Request',
		'',
		`**Issue:** ${finding.title}`,
		`**Severity:** ${finding.severity}`,
		`**Category:** ${finding.category}`,
		finding.url ? `**URL:** ${finding.url}` : '',
		''
	].filter(l => l !== '');

	if (finding.steps?.length) {
		lines.push('**Steps to Reproduce:**');
		finding.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
		lines.push('');
	}

	lines.push(`**Expected:** ${finding.expected}`);
	lines.push(`**Actual:** ${finding.actual}`);
	lines.push('');

	if (finding.evidence) {
		lines.push('**Evidence:**', '```', finding.evidence, '```', '');
	}

	if (intelligence) {
		lines.push('**Root Cause Analysis:**', intelligence.rootCause, '');
		lines.push('**Suggested Fix Approach:**', intelligence.fixApproach, '');
		lines.push(`**Affected Area:** ${intelligence.affectedArea}`);
		lines.push(`**Estimated Complexity:** ${intelligence.estimatedComplexity}`, '');
	}

	lines.push('**Task:** Implement the fix following the approach above. Add or update tests to cover this scenario and prevent regression.');
	return lines.join('\n');
}

export function buildAppImprovementPromptText(findings, appReport = null) {
	const lines = ['## App Improvement Request', '',
		`Based on automated QA testing, ${findings.length} issue${findings.length === 1 ? '' : 's'} were found.`, ''];

	if (appReport?.priority?.length) {
		lines.push('### Priority Actions');
		appReport.priority.forEach((item, i) => {
			lines.push(`${i + 1}. **${item.action}** — ${item.rationale} (Impact: ${item.impact})`);
		});
		lines.push('');
	}

	lines.push('### Issues Found');
	findings.forEach((f, i) => {
		lines.push(`${i + 1}. [${f.severity}] ${f.title}`);
		lines.push(`   Expected: ${f.expected}`);
		lines.push(`   Actual: ${f.actual}`);
	});
	lines.push('');
	lines.push('**Task:** Review these issues, prioritise by impact, and implement fixes. Add tests to prevent regression.');
	return lines.join('\n');
}

/* ── Quality Scoring (per-finding + aggregate) ─────────────────── */

const SEVERITY_WEIGHTS = {
	critical: 25,
	high: 15,
	medium: 8,
	low: 3,
	info: 1
};

/**
 * Scores a single finding's quality in-place — confidence, duplicate
 * detection, reproducibility. Returns the quality metadata object.
 *
 * This runs INLINE (during evidence collection), not as a downstream
 * triage step. The finding's confidence/reproducibility fields may
 * already be set by the agent — this function fills in gaps.
 *
 * @param {object} finding
 * @param {object[]} allFindings — for duplicate detection
 * @returns {{ confidence: number, isDuplicate: boolean, duplicateOf: string|null, reproducibility: string }}
 */
export function scoreFindingQuality(finding, allFindings = []) {
	// Confidence: use agent-provided value, or derive from evidence richness.
	let confidence = finding.confidence;
	if (typeof confidence !== 'number') {
		let score = 0;
		if (finding.expected && finding.actual) score += 0.3;
		if (finding.steps?.length >= 2) score += 0.25;
		if (finding.evidence) score += 0.25;
		if (finding.observed) score += 0.1;
		if (finding.recommendation) score += 0.1;
		confidence = Math.min(1, score);
	}

	// Duplicate detection: compare title+url against all other findings.
	// Only mark LATER findings as duplicates — the first occurrence is the original.
	let isDuplicate = false;
	let duplicateOf = null;
	const normalizeTitle = (t) => String(t ?? '').toLowerCase().trim().replace(/[^a-z0-9]/g, '').slice(0, 40);
	const myKey = normalizeTitle(finding.title);
	if (myKey && allFindings.length > 1) {
		const myIndex = allFindings.findIndex(f => f.id === finding.id);
		for (let i = 0; i < myIndex; i++) {
			const other = allFindings[i];
			const otherKey = normalizeTitle(other.title);
			if (otherKey === myKey && (other.url ?? '') === (finding.url ?? '')) {
				isDuplicate = true;
				duplicateOf = other.id;
				break;
			}
		}
	}

	// Reproducibility: use agent-provided value, or derive from steps.
	let reproducibility = finding.reproducibility;
	if (!reproducibility) {
		reproducibility = finding.steps?.length >= 2 ? 'confirmed' : 'unconfirmed';
	}

	return { confidence, isDuplicate, duplicateOf, reproducibility };
}

/**
 * Calculates an aggregate quality score (0-100) for a set of findings.
 *
 * Starts from 100 and deducts based on severity, confidence-weighted.
 * Duplicates and info-level findings have minimal impact.
 *
 * Returns both the internal score AND a product-facing assessment
 * (releaseReady, confidence, risk, criticalIssues, recommendations).
 *
 * @param {object[]} findings
 * @returns {{ score, verdict, releaseReady, confidence, risk, criticalIssues, recommendations, breakdown }}
 */
export function calculateMissionQuality(findings = [], context = {}) {
	const coverage = evaluateCoverageSufficiency(context);
	const suggestions = findings.filter(f => !isConfirmedFinding(f));
	findings = findings.filter(isConfirmedFinding);
	const common = { coverage, confirmedFindings: findings.length, speculativeFindings: suggestions.length };
	if (!coverage.sufficient) return { ...common, score:null, verdict:coverage.verdict, releaseReady:false, confidence:0, risk:'unknown', criticalIssues:[], recommendations:[], breakdown:{}, scoringModel:'v3-coverage' };
	if (!findings.length) {
		return {
			...common,
			score: 100, verdict: 'pass', releaseReady: true,
			confidence: null, risk: 'low',
			criticalIssues: [], recommendations: [],
			breakdown: {}, scoringModel: 'v2'
		};
	}

	const breakdown = { critical: 0, high: 0, medium: 0, low: 0, info: 0, duplicates: 0 };

	for (const f of findings) {
		const isDup = f.isDuplicate === true;
		if (isDup) breakdown.duplicates++;
		else breakdown[f.severity] = (breakdown[f.severity] ?? 0) + 1;
	}

	// Phase 9: Capped logarithmic scoring model
	// Instead of linear deduction (which collapses to 0), we use:
	//   deduction = MAX_DEDUCTION × (1 - e^(-λ × weightedIssues))
	// This gives diminishing returns on each additional issue.
	const MAX_DEDUCTION = 92;          // Max possible deduction (floor = 8, not 0)
	const LAMBDA = 0.035;              // Decay rate — controls curve shape
	const CRITICAL_FLOOR = 15;         // Any critical finding floors the score

	// Weight each finding
	let weightedIssues = 0;
	for (const f of findings) {
		const weight = SEVERITY_WEIGHTS[f.severity] ?? SEVERITY_WEIGHTS.medium;
		const confidence = typeof f.confidence === 'number' ? f.confidence : 0.5;
		const isDup = f.isDuplicate === true;
		weightedIssues += isDup ? weight * 0.05 * confidence : weight * confidence;
	}

	// Logarithmic deduction
	let totalDeduction = MAX_DEDUCTION * (1 - Math.exp(-LAMBDA * weightedIssues));

	// Apply critical floor
	if (breakdown.critical > 0) {
		totalDeduction = Math.max(totalDeduction, 100 - CRITICAL_FLOOR);
	}

	// Workflow success rate factor (Phase 9)
	if (context.workflowSuccessFactor != null) {
		// If workflows passed well, give a small boost (up to +5)
		const wfBoost = Math.round(context.workflowSuccessFactor * 5);
		totalDeduction = Math.max(0, totalDeduction - wfBoost);
	}

	const score = Math.max(0, Math.round(100 - totalDeduction));

	let verdict, releaseReady;
	if (score >= 85 && !breakdown.critical && !breakdown.high) {
		verdict = 'pass';
		releaseReady = true;
	} else if (score >= 60 && !breakdown.critical && !breakdown.high) {
		verdict = 'pass_with_issues';
		releaseReady = true;
	} else {
		verdict = 'fail';
		releaseReady = false;
	}

	// ── Product-facing quality fields ──
	// These give a product owner actionable decision-making context.

	// Confidence: average of finding confidences, penalized by duplicate ratio.
	const uniqueFindings = findings.filter(f => f.isDuplicate !== true);
	const avgConfidence = uniqueFindings.length > 0
		? uniqueFindings.reduce((sum, f) => sum + (typeof f.confidence === 'number' ? f.confidence : 0.5), 0) / uniqueFindings.length
		: 1.0;

	// Risk: derived from critical/high counts + score.
	let risk;
	if (breakdown.critical > 0 || breakdown.high >= 3) risk = 'high';
	else if (breakdown.high > 0 || breakdown.medium >= 3) risk = 'medium';
	else risk = 'low';

	// Critical issues: list of critical + high findings (non-duplicate).
	const criticalIssues = findings
		.filter(f => f.isDuplicate !== true && ['critical', 'high'].includes(f.severity))
		.map(f => ({
			title: f.title,
			severity: f.severity,
			impact: f.impact || f.actual || null,
			recommendation: f.recommendation || f.devIntelligence?.fixApproach || null
		}));

	// Recommendations: top 3 priority actions for the product owner.
	const recommendations = [];
	const severityOrder = ['critical', 'high', 'medium', 'low'];
	const sorted = [...uniqueFindings].sort((a, b) =>
		severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
	);
	for (const f of sorted.slice(0, 3)) {
		recommendations.push({
			priority: f.severity,
			action: f.recommendation || f.devIntelligence?.fixApproach || `Fix: ${f.title}`,
			issue: f.title
		});
	}

	// Evidence coverage: what percentage of findings are backed by evidence
	let evidenceCoverage = null;
	try {
		evidenceCoverage = computeEvidenceCoverage(findings);
	} catch {
		// Evidence graph may not be loaded in all contexts
	}

	return {
		...common,
		score,
		verdict,
		releaseReady,
		confidence: Math.round(avgConfidence * 100) / 100,
		risk,
		criticalIssues,
		recommendations,
		breakdown,
		evidenceCoverage,
		scoringModel: 'v2'
	};
}

/* ── Continuous Validation Loop ────────────────────────────────── */

/**
 * Compares two iterations' findings to determine what was fixed,
 * what remains, and what's new. This is the core of the re-validation
 * loop: validate → improve → validate again → compare → approve.
 *
 * Findings are matched by normalized title + URL to identify the same
 * issue across iterations.
 *
 * @param {object[]} prevFindings — findings from the previous iteration
 * @param {object[]} currentFindings — findings from the current iteration
 * @returns {{ fixed, remaining, newRegressions, scoreDelta, trend, approveRecommended }}
 */
export function compareIterations(prevFindings = [], currentFindings = []) {
	const normalize = (title, url) =>
		String(title ?? '').toLowerCase().trim().replace(/[^a-z0-9]/g, '').slice(0, 50)
		+ '|' + String(url ?? '').toLowerCase().trim();

	// Build lookup of previous findings by their match key.
	const prevMap = new Map();
	for (const f of prevFindings) {
		const key = normalize(f.title, f.url);
		if (!prevMap.has(key)) prevMap.set(key, f);
	}

	// Build lookup of current findings.
	const currMap = new Map();
	for (const f of currentFindings) {
		const key = normalize(f.title, f.url);
		if (!currMap.has(key)) currMap.set(key, f);
	}

	// Fixed: in previous but not in current.
	const fixed = [];
	for (const [key, prevF] of prevMap) {
		if (!currMap.has(key)) {
			fixed.push({
				title: prevF.title,
				severity: prevF.severity,
				wasResolved: true
			});
		}
	}

	// Remaining: in both previous and current.
	const remaining = [];
	for (const [key, currF] of currMap) {
		if (prevMap.has(key)) {
			remaining.push({
				title: currF.title,
				severity: currF.severity,
				impact: currF.impact || null
			});
		}
	}

	// New regressions: in current but not in previous.
	const newRegressions = [];
	for (const [key, currF] of currMap) {
		if (!prevMap.has(key)) {
			newRegressions.push({
				title: currF.title,
				severity: currF.severity,
				impact: currF.impact || null
			});
		}
	}

	// Score delta
	const prevScore = calculateMissionQuality(prevFindings).score;
	const currScore = calculateMissionQuality(currentFindings).score;
	const scoreDelta = currScore - prevScore;

	// Trend
	let trend;
	if (scoreDelta > 5) trend = 'improving';
	else if (scoreDelta < -5) trend = 'declining';
	else trend = 'stable';

	// Approve recommendation
	const currQuality = calculateMissionQuality(currentFindings);
	const approveRecommended = currQuality.releaseReady && trend !== 'declining' && newRegressions.filter(r => r.severity === 'critical').length === 0;

	return {
		fixed,
		remaining,
		newRegressions,
		fixedCount: fixed.length,
		remainingCount: remaining.length,
		newRegressionCount: newRegressions.length,
		prevScore,
		currentScore: currScore,
		scoreDelta,
		trend,
		approveRecommended
	};
}

/* ── AI Studio Integration Contract ─────────────────────────────── */

/**
 * Builds a structured improvement prompt that AI Studio (or a developer)
 * can consume to regenerate/fix the application.
 *
 * This is the key deliverable that closes the loop:
 *   AI Studio → Generate → Qase → Validate → THIS → AI Studio → Regenerate
 *
 * @param {object} mission — the mission object
 * @param {object[]} findings — findings from the mission
 * @param {object} [qualityResult] — from calculateMissionQuality
 * @returns {{ verdict, qualityScore, findings: [], improvementPrompt, regressionReady }}
 */
export function buildImprovementPrompt(mission, findings = [], qualityResult = null) {
	const quality = qualityResult || mission.quality || calculateMissionQuality(findings,{mission});
	const suggestions = findings.filter(f => !isConfirmedFinding(f));
	findings = findings.filter(isConfirmedFinding);

	// Per-finding structured output with fix prompts.
	const structuredFindings = findings.map(f => ({
		id: f.id,
		confirmation: 'confirmed',
		evidenceIds: getFindingEvidence(f.id).map(e => e.id),
		title: f.title,
		severity: f.severity,
		category: f.category,
		observed: f.observed || f.actual,
		expected: f.expected,
		impact: f.impact || `${f.severity} severity issue in ${f.category}`,
		evidence: f.evidence || null,
		recommendation: f.recommendation || f.devIntelligence?.fixApproach || null,
		fixPrompt: f.fixPrompt || buildPerFindingFixPrompt(f),
		confidence: f.confidence ?? 0.5,
		reproducibility: f.reproducibility || 'unconfirmed',
		isDuplicate: f.isDuplicate || false
	}));

	// Aggregate improvement prompt — a single prompt AI Studio can feed back.
	const improvementPrompt = buildAggregateImprovementPrompt(mission, structuredFindings, quality);

	return {
		executionStatus: mission.status,
		qualityVerdict: quality.verdict,
		coverage: quality.coverage,
		confirmedFindings: findings.length,
		speculativeFindings: suggestions.length,
		suggestions: suggestions.map(f => ({ id:f.id,title:f.title,confirmation:'suggestion',reason:'Not supported by reproduction and linked browser evidence.' })),
		verdict: quality.verdict,
		qualityScore: quality.score,
		findings: structuredFindings,
		improvementPrompt,
		regressionReady: quality.releaseReady
	};
}

/**
 * Builds a single fix-prompt string for a finding, suitable for
 * feeding to AI Studio / Copilot / Cursor.
 */
function buildPerFindingFixPrompt(f) {
	const parts = [`Fix: ${f.title}`];
	if (f.expected) parts.push(`Expected behavior: ${f.expected}`);
	if (f.actual) parts.push(`Current behavior: ${f.actual}`);
	if (f.steps?.length) {
		parts.push(`Reproduction: ${f.steps.join(' → ')}`);
	}
	if (f.devIntelligence?.fixApproach) {
		parts.push(`Suggested approach: ${f.devIntelligence.fixApproach}`);
	}
	return parts.join('. ');
}

/**
 * Builds the aggregate improvement prompt — the single string that
 * AI Studio feeds back to its generation model to regenerate the app
 * with fixes applied.
 */
function buildAggregateImprovementPrompt(mission, findings, quality) {
	const lines = [
		`# Improvement Request for ${mission.targetUrl || 'application'}`,
		'',
		`## Quality Assessment`,
		`Score: ${quality.score}/100 — Verdict: ${quality.verdict}`,
		'',
		`## Issues to Fix (${findings.filter(f => !f.isDuplicate).length} unique, ${findings.filter(f => f.isDuplicate).length} duplicates)`,
		''
	];

	// Sort by severity for priority.
	const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
	const sorted = [...findings].filter(f => !f.isDuplicate).sort((a, b) =>
		severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
	);

	for (const f of sorted) {
		lines.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
		if (f.observed) lines.push(`- **Observed:** ${f.observed}`);
		if (f.expected) lines.push(`- **Expected:** ${f.expected}`);
		if (f.impact) lines.push(`- **Impact:** ${f.impact}`);
		if (f.recommendation) lines.push(`- **Fix:** ${f.recommendation}`);
		lines.push(`- **Prompt:** ${f.fixPrompt}`);
		lines.push('');
	}

	lines.push('## Instructions');
	lines.push('Apply all fixes listed above. Prioritize critical and high severity issues first.');
	lines.push('After fixing, regenerate the application for validation testing.');
	if (quality.releaseReady) {
		lines.push('');
		lines.push('Note: This application passed quality validation with minor issues.');
	}

	return lines.join('\n');
}
