/**
 * Aggregated metrics for the dashboard.
 *
 * Pulls from sessions (findings, status), regression runs (pass rate trends),
 * and test cases (coverage) to produce a single dashboard payload.
 */

import { listSessions } from './store.js';
import { listTestCases } from './testCases.js';
import { listRegressionRuns } from './regressionStore.js';
import { listFindings } from './findings.js';
import { listSuites } from './suites.js';
import { findingMetrics, regressionMetrics, regressionTrendPoints, testCaseMetrics } from './dataMetrics.js';
import { getFixValidationMetrics } from './fixValidation.js';
import { getUxMetrics } from './uxAssessment.js';
import { visibleList, accessContext } from './requestAccess.js';
import { isUserScoped } from './ownership.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const TREND_LIMIT = 20;

/**
 * Returns a dashboard payload aggregating metrics across all data sources.
 */
export function getDashboardMetrics({ projectId, sessionOwnerFilter, findingOwnerFilter } = {}) {
	const sessions = visibleList(listSessions({ projectId, ownerFilter: sessionOwnerFilter }));
	const testCases = visibleList(listTestCases({ projectId }));
	const suites = visibleList(listSuites({ projectId }));
	const regressionRuns = visibleList(listRegressionRuns({ projectId }));
	const findings = visibleList(listFindings({ projectId, ownerFilter: findingOwnerFilter }));

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

	/* ── Findings by severity (canonical findings store) ──────── */
	const findingsBySeverity = {};
	for (const sev of SEVERITIES) findingsBySeverity[sev] = 0;

	for (const finding of findings) {
		const sev = SEVERITIES.includes(finding.severity) ? finding.severity : 'info';
		findingsBySeverity[sev] = (findingsBySeverity[sev] ?? 0) + 1;
	}
	const findingSummary = findingMetrics(findings);

	/* ── Test cases ────────────────────────────────────────────── */
	const tcBySeverity = {};
	for (const sev of SEVERITIES) tcBySeverity[sev] = 0;
	for (const tc of testCases) {
		const sev = SEVERITIES.includes(tc.severity) ? tc.severity : 'medium';
		tcBySeverity[sev] = (tcBySeverity[sev] ?? 0) + 1;
	}
	const testSummary = testCaseMetrics(testCases, suites);

	/* ── Regression trend ──────────────────────────────────────── */
	const recentRuns = regressionRuns.slice(0, TREND_LIMIT).reverse();
	const regressionTrend = regressionTrendPoints(recentRuns);
	const regressionSummary = regressionMetrics(regressionRuns);

	return {
		sessions: {
			total: sessions.length,
			byStatus,
			totalFindings,
			avgFindings
		},
		findings: {
			...findingSummary,
			bySeverity: findingsBySeverity
		},
		testCases: {
			...testSummary,
			bySeverity: tcBySeverity
		},
		regression: {
			totalRuns: regressionSummary.recordedRuns,
			completedRuns: regressionSummary.completedRuns,
			totalTests: regressionSummary.completedExecutions,
			overallPassRate: regressionSummary.passRate,
			recentTrend: regressionTrend
		},
		// Phase 18 observability — fix-validation telemetry on the dashboard.
		fixValidations: isUserScoped(accessContext.getStore()) ? {} : getFixValidationMetrics(),
		// Phase 17 observability — UX assessment telemetry on the dashboard.
		uxAssessments: isUserScoped(accessContext.getStore()) ? {} : getUxMetrics(),
	};
}
