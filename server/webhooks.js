/**
 * Fire-and-forget webhook notifications.
 *
 * Sends JSON payloads to QASE_WEBHOOK_URL (if configured) when notable events
 * happen: a QA report is finished, or a regression/replay run has failures.
 *
 * Delivery is async and never throws — failures are logged to stderr.
 */

const WEBHOOK_TIMEOUT_MS = 5_000;

function getWebhookUrl() {
	return process.env.QASE_WEBHOOK_URL?.trim() || '';
}

/**
 * Sends a JSON payload to the configured webhook URL.
 * Fire-and-forget: never throws, logs errors to stderr.
 */
async function fire(event, payload) {
	const url = getWebhookUrl();
	if (!url) return;

	const body = JSON.stringify({ event, ts: Date.now(), ...payload });

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			signal: controller.signal
		});

		clearTimeout(timer);

		if (!res.ok) {
			console.error(`[webhook] ${event} → ${url} responded ${res.status}`);
		}
	} catch (error) {
		console.error(`[webhook] ${event} delivery failed:`, error.message);
	}
}

/**
 * Notifies that a QA report was finished by the agent.
 * @param {object} session — the full session object (with report + findings)
 */
export function notifyReport(session) {
	const report = session.report;
	if (!report) return;

	return fire('qa_report', {
		session: {
			id: session.id,
			title: session.title,
			targetUrl: session.targetUrl,
			verdict: report.verdict,
			findingCount: report.findings ?? session.findings.length,
			bySeverity: report.bySeverity ?? {}
		},
		findings: session.findings.map(f => ({
			title: f.title,
			severity: f.severity,
			category: f.category,
			url: f.url,
			expected: f.expected,
			actual: f.actual
		}))
	});
}

/**
 * Notifies that a regression/replay run had failures.
 * @param {string} scheduleId
 * @param {object} summary — run summary from runTestSuite
 */
export function notifyTestFailure(scheduleId, summary) {
	if (!summary || summary.failed + (summary.errored ?? 0) === 0) return;

	return fire('test_failure', {
		scheduleId,
		targetUrl: summary.targetUrl ?? '',
		passed: summary.passed ?? 0,
		failed: summary.failed ?? 0,
		errored: summary.errored ?? 0,
		total: summary.total ?? 0,
		durationMs: summary.durationMs ?? 0,
		failedTests: (summary.results ?? [])
			.filter(r => r.result !== 'pass')
			.map(r => ({
				testCaseId: r.testCaseId,
				testCaseName: r.testCaseName,
				result: r.result,
				error: r.error
			}))
	});
}
