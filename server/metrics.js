/**
 * Aggregated metrics for the dashboard.
 *
 * Pulls from sessions (findings, status), regression runs (pass rate trends),
 * and test cases (coverage) to produce a single dashboard payload.
 */

import { listSessions, getSession } from './store.js';
import { listTestCases } from './testCases.js';
import { listRegressionRuns } from './regressionStore.js';
import { getFixValidationMetrics } from './fixValidation.js';
import { getUxMetrics } from './uxAssessment.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const TREND_LIMIT = 20;

/**
 * Returns a dashboard payload aggregating metrics across all data sources.
 */
export function getDashboardMetrics({ projectId } = {}) {
	const sessions = listSessions({ projectId });
	const testCases = listTestCases({ projectId });
	const regressionRuns = listRegressionRuns({ projectId, limit: 100 });

	/* ── Sessions ──────────────────────────────────────────────── */
	const byStatus = {};
	let totalFindings = 0;

	for (const s of sessions) {
		byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
		totalFindings += s.findingCount ?? 0;
	}

	const avgFindings = sessions.length > 0
		? Math.round((totalFindings / sessions.length) * 10) / 10
		: 0;

	/* ── Findings by severity (from full session objects) ──────── */
	const findingsBySeverity = {};
	for (const sev of SEVERITIES) findingsBySeverity[sev] = 0;

	// listSessions returns lightweight summaries without findings;
	// getSession returns the full session with findings array.
	for (const s of sessions) {
		const full = getSession(s.id);
		if (full?.findings) {
			for (const finding of full.findings) {
				const sev = SEVERITIES.includes(finding.severity) ? finding.severity : 'info';
				findingsBySeverity[sev] = (findingsBySeverity[sev] ?? 0) + 1;
			}
		}
	}

	// If no findings found in sessions, count from findingCount as "unspecified"
	const reportFindings = Object.values(findingsBySeverity).reduce((a, b) => a + b, 0);
	if (reportFindings === 0 && totalFindings > 0) {
		findingsBySeverity.unspecified = totalFindings;
	}

	/* ── Test cases ────────────────────────────────────────────── */
	const tcBySeverity = {};
	for (const sev of SEVERITIES) tcBySeverity[sev] = 0;
	for (const tc of testCases) {
		const sev = SEVERITIES.includes(tc.severity) ? tc.severity : 'medium';
		tcBySeverity[sev] = (tcBySeverity[sev] ?? 0) + 1;
	}

	/* ── Regression trend ──────────────────────────────────────── */
	const recentRuns = regressionRuns.slice(0, TREND_LIMIT).reverse();
	const regressionTrend = recentRuns.map(r => ({
		ts: r.ts,
		passed: r.passed,
		failed: r.failed,
		errored: r.errored,
		flaky: r.flaky ?? 0,
		total: r.total,
		passRate: r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0
	}));

	const totalRegressionTests = regressionRuns.reduce((sum, r) => sum + (r.total ?? 0), 0);
	const totalRegressionPassed = regressionRuns.reduce((sum, r) => sum + (r.passed ?? 0), 0);
	const overallPassRate = totalRegressionTests > 0
		? Math.round((totalRegressionPassed / totalRegressionTests) * 100)
		: 0;

	return {
		sessions: {
			total: sessions.length,
			byStatus,
			totalFindings,
			avgFindings
		},
		findings: {
			total: totalFindings,
			bySeverity: findingsBySeverity
		},
		testCases: {
			total: testCases.length,
			bySeverity: tcBySeverity
		},
		regression: {
			totalRuns: regressionRuns.length,
			totalTests: totalRegressionTests,
			overallPassRate,
			recentTrend: regressionTrend
		},
		// Phase 18 observability — fix-validation telemetry on the dashboard.
		fixValidations: getFixValidationMetrics(),
		// Phase 17 observability — UX assessment telemetry on the dashboard.
		uxAssessments: getUxMetrics(),
	};
}
