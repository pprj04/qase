/**
 * Export converters for findings and test cases.
 *
 * Converts session findings into GitHub/JIRA/Linear issue JSON formats,
 * and test cases into JSON or CSV downloads.
 */

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

/* ── Severity mappers ───────────────────────────────────────────── */

const GITHUB_SEVERITY_LABELS = {
	critical: '🔴 critical',
	high: '🟠 high',
	medium: '🟡 medium',
	low: '🔵 low',
	info: '⚪ info'
};

const JIRA_SEVERITY_PRIORITY = {
	critical: 'Highest',
	high: 'High',
	medium: 'Medium',
	low: 'Low',
	info: 'Lowest'
};

const LINEAR_PRIORITY = {
	critical: 1, // Urgent
	high: 2,    // High
	medium: 3,  // Medium
	low: 4,     // Low
	info: 4     // Low
};

/* ── Finding exporters ──────────────────────────────────────────── */

function buildFindingBody(finding) {
	const lines = [];

	if (finding.url) lines.push(`**URL:** ${finding.url}`);
	if (finding.category) lines.push(`**Category:** ${finding.category}`);
	lines.push('');

	if (finding.steps?.length) {
		lines.push('**Steps to reproduce:**');
		finding.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
		lines.push('');
	}

	lines.push(`**Expected:** ${finding.expected}`);
	lines.push(`**Actual:** ${finding.actual}`);

	if (finding.evidence) {
		lines.push('', '**Evidence:**', '```', finding.evidence, '```');
	}

	return lines.join('\n');
}

export function exportFindingsGitHub(session) {
	const sorted = sortFindings(session.findings);
	return sorted.map(finding => ({
		title: `[${finding.severity.toUpperCase()}] ${finding.title}`,
		body: buildFindingBody(finding),
		labels: [
			'bug',
			GITHUB_SEVERITY_LABELS[finding.severity] ?? finding.severity
		].filter(Boolean)
	}));
}

export function exportFindingsJira(session) {
	const sorted = sortFindings(session.findings);
	return sorted.map(finding => ({
		fields: {
			project: { key: 'QA' },
			summary: finding.title,
			description: buildFindingBody(finding),
			issuetype: { name: 'Bug' },
			priority: { name: JIRA_SEVERITY_PRIORITY[finding.severity] ?? 'Medium' },
			labels: [finding.category, finding.severity].filter(Boolean)
		}
	}));
}

export function exportFindingsLinear(session) {
	const sorted = sortFindings(session.findings);
	return sorted.map(finding => ({
		title: finding.title,
		description: buildFindingBody(finding),
		priority: LINEAR_PRIORITY[finding.severity] ?? 3,
		labels: [finding.severity, finding.category].filter(Boolean)
	}));
}

function sortFindings(findings) {
	return [...findings].sort(
		(a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
	);
}

/* ── Test case exporters ────────────────────────────────────────── */

export function exportTestCasesJSON(testCases) {
	return testCases.map(tc => ({
		name: tc.name,
		severity: tc.severity,
		targetUrl: tc.targetUrl,
		preconditions: tc.preconditions ?? [],
		steps: tc.steps.map(s => ({
			action: s.action,
			target: s.target ?? '',
			value: s.value ?? ''
		})),
		assertions: tc.assertions.map(a => ({
			type: a.type,
			target: a.target ?? '',
			value: a.value ?? '',
			description: a.description ?? ''
		}))
	}));
}

export function exportTestCasesCSV(testCases) {
	const headers = ['name', 'severity', 'target_url', 'steps', 'assertions'];
	const rows = [headers.join(',')];

	for (const tc of testCases) {
		const stepsStr = (tc.steps ?? [])
			.map(s => `${s.action}:${s.target ?? ''}${s.value ? `="${s.value}"` : ''}`)
			.join(' → ');

		const assertionsStr = (tc.assertions ?? [])
			.map(a => `${a.type}:${a.target ?? ''}${a.value ? `="${a.value}"` : ''}`)
			.join('; ');

		const row = [
			csvEscape(tc.name),
			csvEscape(tc.severity),
			csvEscape(tc.targetUrl ?? ''),
			csvEscape(stepsStr),
			csvEscape(assertionsStr)
		];
		rows.push(row.join(','));
	}

	return rows.join('\n');
}

function csvEscape(value) {
	if (value === null || value === undefined) return '""';
	let str = String(value);
	// Prevent formula injection: prefix dangerous characters (Excel/Sheets).
	if (/^[=+\-@\t\r]/.test(str)) {
		str = `'${str}`;
	}
	if (str.includes(',') || str.includes('"') || str.includes('\n')) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}
