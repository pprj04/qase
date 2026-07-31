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
