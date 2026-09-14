const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

const VERDICT_LABELS = {
	pass: 'Pass',
	pass_with_issues: 'Pass with issues',
	fail: 'Fail',
	blocked: 'Blocked'
};

/** A deterministic completion reply, grounded in the saved QA results. */
export function buildQaChatReport(session) {
	const report = session.report;
	const brief = (value, limit) => {
		const text = String(value ?? '').replace(/\s+/g, ' ').trim();
		return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
	};
	const findings = [...(session.findings ?? [])].sort((a, b) =>
		SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
	const lines = [`**QA report — ${VERDICT_LABELS[report.verdict] ?? report.verdict}**`];
	if (report.summary) lines.push(brief(report.summary, 350));
	if (report.covered?.length) {
		lines.push(`Tested: ${report.covered.slice(0, 4).map(item => brief(item, 60)).join(', ')}${report.covered.length > 4 ? ` (+${report.covered.length - 4} more areas)` : ''}.`);
	}
	if (findings.length) {
		lines.push(`**${findings.length} finding${findings.length === 1 ? '' : 's'}:**`, ...findings.slice(0, 5).map(finding =>
			`- **${String(finding.severity).toUpperCase()}:** ${brief(finding.title, 140)}${finding.actual ? ` — ${brief(finding.actual, 180)}` : ''}`));
		if (findings.length > 5) lines.push(`${findings.length - 5} more findings in the Findings tab.`);
	} else {
		lines.push(report.verdict === 'blocked'
			? 'No findings recorded; testing was blocked.'
			: 'No issues found in the checks performed.');
	}
	if (report.notCovered?.length) {
		lines.push(`Not covered: ${report.notCovered.slice(0, 3).map(item => brief(item, 120)).join('; ')}${report.notCovered.length > 3 ? ` (+${report.notCovered.length - 3} more; see Report)` : ''}.`);
	}
	if (report.recommendations?.length) lines.push(`Next: ${brief(report.recommendations[0], 180)}`);
	lines.push('Full details and reproduction steps are in the Report and Findings tabs.');
	return lines.join('\n\n').replace(/\n\n- /g, '\n- ');
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
		lines.push('## Findings', '');
		const sorted = [...session.findings].sort(
			(a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
		);
		sorted.forEach((finding, index) => {
			lines.push(`### ${index + 1}. ${finding.title}`);
			lines.push('');
			lines.push(`**Severity:** ${finding.severity} · **Area:** ${finding.category}${finding.url ? ` · **URL:** ${finding.url}` : ''}`);
			lines.push('');
			if (finding.steps?.length) {
				lines.push('**Steps to reproduce**', '');
				finding.steps.forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${step}`));
				lines.push('');
			}
			lines.push(`**Expected:** ${finding.expected}`);
			lines.push('');
			lines.push(`**Actual:** ${finding.actual}`);
			lines.push('');
			if (finding.evidence) {
				lines.push('**Evidence**', '', '```', finding.evidence, '```', '');
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
