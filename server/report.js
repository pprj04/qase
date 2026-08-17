const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const VERDICT_LABELS = {
	pass: 'Pass',
	pass_with_issues: 'Pass with issues',
	fail: 'Fail',
	blocked: 'Blocked'
};

/* Phase 16: deterministic secret redaction for report text (9 pattern families). */
let _redactString = null;
async function loadRedact() {
	if (!_redactString) {
		const m = await import('./findingIntelligence.js');
		_redactString = m.redactString;
	}
	return _redactString;
}
// The report builder is sync; redaction falls back to a conservative local
// filter when the async module isn't loaded yet (first render after boot).
function redact(text) {
	if (text == null) return text;
	const s = String(text);
	if (_redactString) return _redactString(s);
	return s
		.replace(/((?:password|passwd|pwd|secret|api[-_]?key|apikey|token)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi, '$1[REDACTED]')
		.replace(/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
		.replace(/(sk-[A-Za-z0-9_\-]{8,})/g, '[REDACTED]')
		.replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, '[REDACTED]');
}
loadRedact().catch(() => { /* non-fatal */ });

/**
 * Phase 16: deterministic grouped overview for the report. Duplicates are NOT
 * counted separately — each canonical finding counts once and carries its
 * duplicate tally. Groups by category, severity, priority, workflow, feature,
 * and risk (only dimensions with data are shown).
 */
function appendGroupedOverview(lines, findings) {
	const canonical = findings.filter(f => !f.isDuplicate);
	const dupCount = findings.length - canonical.length;
	const group = (label, keyOf) => {
		const counts = {};
		for (const f of canonical) {
			const k = keyOf(f) || 'UNKNOWN';
			counts[k] = (counts[k] || 0) + 1;
		}
		// Skip dimensions where everything is UNKNOWN/absent — no signal.
		const keys = Object.keys(counts);
		if (keys.length === 0 || (keys.length === 1 && keys[0] === 'UNKNOWN')) return;
		const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
		lines.push(`- **${label}:** ${entries.map(([k, n]) => `${k} (${n})`).join(', ')}`);
	};
	group('By category', f => f.primary_category || f.category);
	group('By severity', f => f.severity);
	group('By priority', f => f.priority || 'UNTRIAGED');
	group('By workflow', f => f.workflowId || f.workflow_id || '');
	group('By feature', f => f.featureId || f.feature_id || '');
	group('By risk', f => f.risk || '');
	if (dupCount > 0) lines.push(`- **Duplicates merged into the above:** ${dupCount} (not counted separately)`);
	lines.push('');
}

/** Renders the session as a QA report a human can file or paste into a ticket. */
export function buildReportMarkdown(session) {
	const report = session.report;
	const lines = [];

	lines.push(`# QA report — ${session.targetUrl ?? session.title}`);
	lines.push('');
	lines.push(`- **Run:** ${new Date(session.createdAt).toLocaleString()}`);
	lines.push(`- **Verdict:** ${report ? VERDICT_LABELS[report.verdict] ?? report.verdict : 'Run not finished'}`);
	lines.push(`- **Findings:** ${session.findings.length}`);
	lines.push('');

	if (report?.summary) {
		lines.push('## Summary', '', report.summary, '');
	}

	if (session.todos.length > 0) {
		lines.push('## Test plan', '');
		for (const todo of session.todos) {
			const mark = todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '/' : ' ';
			lines.push(`- [${mark}] ${todo.text}`);
		}
		lines.push('');
	}

	if (report?.covered?.length) {
		lines.push('## Covered', '', ...report.covered.map(item => `- ${item}`), '');
	}
	if (report?.notCovered?.length) {
		lines.push('## Not covered', '', ...report.notCovered.map(item => `- ${item}`), '');
	}

	if (session.findings.length > 0) {
		// Phase 16: grouped overview — canonical findings only (duplicates
		// excluded, each listed once with its duplicate count).
		lines.push('## Findings by group', '');
		appendGroupedOverview(lines, session.findings);
		lines.push('## Findings', '');
		const sorted = [...session.findings].sort(
			(a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
		);
		sorted.forEach((finding, index) => {
			lines.push(`### ${index + 1}. ${finding.title}`);
			lines.push('');
			lines.push(`**Severity:** ${finding.severity} · **Area:** ${finding.category}${finding.url ? ` · **URL:** ${finding.url}` : ''}${finding.isDuplicate ? ' · **Duplicate:** yes' : ''}`);
			if (finding.primary_category || finding.priority) {
				const parts = [];
				if (finding.primary_category) parts.push(`**Category:** ${finding.primary_category}`);
				if (finding.priority) parts.push(`**Priority:** ${finding.priority}`);
				lines.push('', parts.join(' · '));
			}
			lines.push('');
			if (finding.steps?.length) {
				lines.push('**Steps to reproduce**', '');
				finding.steps.forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${redact(step)}`));
				lines.push('');
			}
			lines.push(`**Expected:** ${redact(finding.expected)}`);
			lines.push('');
			lines.push(`**Actual:** ${redact(finding.actual)}`);
			lines.push('');
			if (finding.evidence) {
				lines.push('**Evidence**', '', '```', redact(finding.evidence), '```', '');
			}
		});
	} else {
		lines.push('## Findings', '', 'None recorded.', '');
	}

	if (report?.recommendations?.length) {
		lines.push('## Recommendations', '', ...report.recommendations.map(item => `- ${item}`), '');
	}

	return lines.join('\n');
}
