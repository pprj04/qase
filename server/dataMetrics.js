/**
 * Canonical metric semantics shared by collection APIs and dashboard totals.
 * All functions are pure so synthetic fixtures can verify them without
 * touching QASE's persistent stores.
 */

const NON_COMPLETED_STATUSES = new Set(['queued', 'running', 'cancelled', 'canceled', 'aborted', 'skipped']);

function count(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalizeSuiteName(value) {
	return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : '';
}

function normalizeTarget(value) {
	const target = String(value ?? '').trim();
	if (!target) return '';
	try {
		return new URL(target).host.toLocaleLowerCase();
	} catch {
		return target.toLocaleLowerCase();
	}
}

export function workflowMetrics(workflows = []) {
	const rows = Array.isArray(workflows) ? workflows : [];
	const targets = new Set(rows.map(row => normalizeTarget(row?.targetUrl)).filter(Boolean));
	return {
		total: rows.length,
		totalSteps: rows.reduce((sum, row) => sum + count(row?.stepCount ?? row?.steps?.length), 0),
		targets: targets.size
	};
}

export function testCaseMetrics(testCases = [], suites = []) {
	const rows = Array.isArray(testCases) ? testCases : [];
	const suiteNames = new Map(
		(Array.isArray(suites) ? suites : [])
			.map(suite => [suite?.id, normalizeSuiteName(suite?.name)])
			.filter(([id, name]) => id && name)
	);
	const referenced = new Set();
	for (const testCase of rows) {
		const name = suiteNames.get(testCase?.suiteId);
		if (name) referenced.add(name);
	}
	return {
		total: rows.length,
		suites: referenced.size,
		assignedToSuite: rows.filter(testCase => suiteNames.has(testCase?.suiteId)).length
	};
}

export function scheduleMetrics(schedules = []) {
	const rows = Array.isArray(schedules) ? schedules : [];
	return {
		total: rows.length,
		active: rows.filter(schedule => schedule?.enabled === true).length,
		testAssignments: rows.reduce((sum, schedule) => sum + (Array.isArray(schedule?.testCaseIds) ? schedule.testCaseIds.length : 0), 0)
	};
}

export function regressionExecutionCounts(run = {}) {
	const status = String(run?.status ?? '').toLocaleLowerCase();
	if (NON_COMPLETED_STATUSES.has(status)) {
		return { passed: 0, failed: 0, errored: 0, completed: 0 };
	}
	const passed = count(run?.passed);
	const failed = count(run?.failed);
	const errored = count(run?.errored);
	return { passed, failed, errored, completed: passed + failed + errored };
}

export function regressionMetrics(runs = []) {
	const rows = Array.isArray(runs) ? runs : [];
	const totals = rows.reduce((sum, run) => {
		const execution = regressionExecutionCounts(run);
		sum.passed += execution.passed;
		sum.failed += execution.failed;
		sum.errored += execution.errored;
		sum.completed += execution.completed;
		if (execution.completed > 0) sum.completedRuns += 1;
		return sum;
	}, { passed: 0, failed: 0, errored: 0, completed: 0, completedRuns: 0 });
	return {
		recordedRuns: rows.length,
		completedRuns: totals.completedRuns,
		completedExecutions: totals.completed,
		passed: totals.passed,
		failed: totals.failed,
		errored: totals.errored,
		passRate: totals.completed > 0 ? Math.round((totals.passed / totals.completed) * 100) : null
	};
}

export function regressionTrendPoints(runs = []) {
	return (Array.isArray(runs) ? runs : [])
		.map(run => {
			const execution = regressionExecutionCounts(run);
			return {
				ts: run?.ts,
				passed: execution.passed,
				failed: execution.failed,
				errored: execution.errored,
				flaky: count(run?.flaky),
				total: count(run?.total),
				completed: execution.completed,
				passRate: execution.completed > 0
					? Math.round((execution.passed / execution.completed) * 100)
					: null
			};
		});
}

export function findingMetrics(findings = []) {
	const rows = Array.isArray(findings) ? findings : [];
	const duplicates = rows.filter(finding => finding?.isDuplicate === true || Boolean(finding?.duplicateOf)).length;
	return {
		total: rows.length,
		canonical: rows.length - duplicates,
		duplicates
	};
}
