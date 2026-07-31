/**
 * Dev Intelligence Report Builder (Phase 13)
 *
 * Assembles a full markdown document from per-finding intelligence
 * and the app-level improvement report.
 */

/**
 * Builds the full dev intelligence markdown report.
 *
 * @param {object} session        — the QA session
 * @param {object} devIntelligence — { results: [...], appReport: {...} }
 * @returns {string} markdown document
 */
export function buildDevReportMarkdown(session, devIntelligence) {
	const { results = [], appReport = null } = devIntelligence || {};
	const findings = session.findings ?? [];
	const lines = [];

	// ── Header ────────────────────────────────────────────────────
	lines.push('# Developer Intelligence Report');
	lines.push('');
	lines.push(`**App:** ${session.targetUrl ?? 'Unknown'}`);
	lines.push(`**Session:** ${session.id ?? 'Unknown'}`);
	lines.push(`**Date:** ${new Date().toISOString()}`);
	lines.push(`**Findings analysed:** ${results.length}`);
	lines.push('');
	lines.push('---');
	lines.push('');

	// ── Executive Summary ─────────────────────────────────────────
	if (appReport?.priority?.length) {
		lines.push('## Priority Actions');
		lines.push('');
		appReport.priority.forEach((item, i) => {
			lines.push(`${i + 1}. **${item.action}**`);
			lines.push(`   - *Rationale:* ${item.rationale}`);
			lines.push(`   - *Impact:* ${item.impact}`);
		});
		lines.push('');
		lines.push('---');
		lines.push('');
	}

	// ── Per-Finding Intelligence Table ────────────────────────────
	lines.push('## Findings Analysis');
	lines.push('');
	lines.push('| # | Severity | Title | Root Cause | Fix Approach | Area | Complexity |');
	lines.push('|---|----------|-------|------------|--------------|------|------------|');

	results.forEach((r, i) => {
		const f = r.finding;
		const intel = r.intelligence;
		const title = (f.title ?? '').replace(/\|/g, '\\|').slice(0, 50);
		const cause = intel ? (intel.rootCause ?? '').replace(/\|/g, '\\|').slice(0, 60) : '—';
		const fix = intel ? (intel.fixApproach ?? '').replace(/\|/g, '\\|').slice(0, 60) : '—';
		const area = intel?.affectedArea ?? '—';
		const complexity = intel?.estimatedComplexity ?? '—';
		lines.push(`| ${i + 1} | ${f.severity} | ${title} | ${cause} | ${fix} | ${area} | ${complexity} |`);
	});

	lines.push('');
	lines.push('---');
	lines.push('');

	// ── Improvement Categories ────────────────────────────────────
	if (appReport) {
		for (const [key, label] of [
			['ux', 'UX Issues'],
			['accessibility', 'Accessibility'],
			['performance', 'Performance'],
			['security', 'Security']
		]) {
			const items = appReport[key];
			if (items?.length) {
				lines.push(`## ${label}`);
				lines.push('');
				items.forEach((item, i) => {
					lines.push(`### ${i + 1}. ${item.issue}`);
					lines.push(`- **Impact:** ${item.impact}`);
					lines.push(`- **Recommendation:** ${item.recommendation}`);
					lines.push('');
				});
			}
		}

		// Recurring patterns.
		if (appReport.patterns?.length) {
			lines.push('## Recurring Patterns');
			lines.push('');
			appReport.patterns.forEach(p => {
				lines.push(`- **${p.pattern}** (${p.occurrences} occurrences): ${p.recommendation}`);
			});
			lines.push('');
		}
	}

	lines.push('---');
	lines.push('');

	// ── Detailed Per-Finding ──────────────────────────────────────
	lines.push('## Detailed Findings');
	lines.push('');

	results.forEach((r, i) => {
		const f = r.finding;
		const intel = r.intelligence;
		lines.push(`### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`);
		lines.push('');
		lines.push(`**Category:** ${f.category}`);
		if (f.url) lines.push(`**URL:** ${f.url}`);
		lines.push('');
		if (f.steps?.length) {
			lines.push('**Steps to reproduce:**');
			f.steps.forEach((s, j) => lines.push(`${j + 1}. ${s}`));
			lines.push('');
		}
		lines.push(`**Expected:** ${f.expected}`);
		lines.push(`**Actual:** ${f.actual}`);
		lines.push('');

		if (f.evidence) {
			lines.push('**Evidence:**');
			lines.push('```');
			lines.push(f.evidence);
			lines.push('```');
			lines.push('');
		}

		if (intel) {
			lines.push('**Root Cause:**');
			lines.push(intel.rootCause);
			lines.push('');
			lines.push('**Fix Approach:**');
			lines.push(intel.fixApproach);
			lines.push('');
			lines.push(`**Affected Area:** ${intel.affectedArea} | **Complexity:** ${intel.estimatedComplexity} | **Confidence:** ${(intel.confidence * 100).toFixed(0)}%`);
		} else if (r.status === 'failed') {
			lines.push(`*Analysis failed: ${r.error}*`);
		}
		lines.push('');
	});

	return lines.join('\n');
}
