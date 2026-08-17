/**
 * Export converters for individual findings (bugs hub).
 *
 * Unlike exporters.js (which takes a session and exports all its findings),
 * these operate on individual finding objects for the Bugs Hub.
 *
 * Phase 16: all exported text fields pass through deterministic secret
 * redaction (defense-in-depth on top of ingestion-time redaction).
 */
import { redactString } from './findingIntelligence.js';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

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
	critical: 1,
	high: 2,
	medium: 3,
	low: 4,
	info: 4
};

function buildFindingBody(finding) {
	const lines = [];

	if (finding.url) lines.push(`**URL:** ${redactString(String(finding.url))}`);
	if (finding.category) lines.push(`**Category:** ${finding.category}`);
	if (finding.status) lines.push(`**Status:** ${finding.status}`);
	lines.push('');

	if (finding.steps?.length) {
		lines.push('**Steps to reproduce:**');
		finding.steps.forEach((step, i) => lines.push(`${i + 1}. ${redactString(String(step))}`));
		lines.push('');
	}

	lines.push(`**Expected:** ${redactString(String(finding.expected ?? ''))}`);
	lines.push(`**Actual:** ${redactString(String(finding.actual ?? ''))}`);

	if (finding.observed) {
		lines.push('', `**Observed:** ${redactString(String(finding.observed))}`);
	}
	if (finding.evidence) {
		lines.push('', '**Evidence:**', '```', redactString(String(finding.evidence)), '```');
	}

	return lines.join('\n');
}

export function exportFindingGitHub(finding) {
	return {
		title: `[${finding.severity.toUpperCase()}] ${finding.title}`,
		body: buildFindingBody(finding),
		labels: [
			'bug',
			GITHUB_SEVERITY_LABELS[finding.severity] ?? finding.severity,
			finding.category,
			finding.status
		].filter(Boolean)
	};
}

export function exportFindingJira(finding) {
	return {
		fields: {
			project: { key: 'QA' },
			summary: finding.title,
			description: buildFindingBody(finding),
			issuetype: { name: 'Bug' },
			priority: { name: JIRA_SEVERITY_PRIORITY[finding.severity] ?? 'Medium' },
			labels: [finding.category, finding.severity, finding.status].filter(Boolean)
		}
	};
}

export function exportFindingLinear(finding) {
	return {
		title: finding.title,
		description: buildFindingBody(finding),
		priority: LINEAR_PRIORITY[finding.severity] ?? 3,
		labels: [finding.severity, finding.category, finding.status].filter(Boolean)
	};
}

export function exportFindingsBulkGitHub(findingsList) {
	return findingsList.map(exportFindingGitHub);
}

export function exportFindingsBulkJira(findingsList) {
	return findingsList.map(exportFindingJira);
}

export function exportFindingsBulkLinear(findingsList) {
	return findingsList.map(exportFindingLinear);
}

export function exportFindingsBulkMarkdown(findingsList) {
	const sorted = [...findingsList].sort(
		(a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
	);

	const lines = [
		'# Bug Report',
		'',
		`Generated: ${new Date().toISOString()}`,
		`Total bugs: ${sorted.length}`,
		'',
		'---',
		''
	];

	sorted.forEach((f, i) => {
		lines.push(`## ${i + 1}. ${f.title}`);
		lines.push('');
		lines.push(`**Severity:** ${f.severity} | **Status:** ${f.status} | **Category:** ${f.category}`);
		if (f.primary_category) lines.push(`**Intelligence category:** ${f.primary_category}${f.priority ? ` | **Priority:** ${f.priority}` : ''}`);
		if (f.url) lines.push(`**URL:** ${redactString(String(f.url))}`);
		if (f.assignee) lines.push(`**Assignee:** ${f.assignee}`);
		lines.push('');
		if (f.steps?.length) {
			lines.push('**Steps to reproduce:**');
			f.steps.forEach((step, j) => lines.push(`${j + 1}. ${redactString(String(step))}`));
			lines.push('');
		}
		lines.push(`**Expected:** ${redactString(String(f.expected ?? ''))}`);
		lines.push(`**Actual:** ${redactString(String(f.actual ?? ''))}`);
		if (f.evidence) {
			lines.push('', '**Evidence:**', '```', redactString(String(f.evidence)), '```');
		}
		lines.push('', '---', '');
	});

	return lines.join('\n');
}
