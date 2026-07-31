/**
 * JUnit XML report builder.
 *
 * Produces JUnit-compatible XML from regression run summaries and
 * individual test results. This format is consumed by CI systems
 * (GitHub Actions, Jenkins, GitLab CI) for test result visualization.
 *
 * Spec reference: https://llg.cubic.org/docs/junit/
 */

/**
 * Escapes XML special characters in a string.
 */
function escapeXml(str) {
	if (str == null) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Builds JUnit XML from a test suite run summary.
 *
 * @param {object} summary - Run summary from runTestSuite() or regressionStore.
 *   { total, passed, failed, errored, durationMs, results: [...] }
 * @param {object} [opts]
 * @param {string} [opts.suiteName] - Override the <testsuite name="..."> attribute.
 * @returns {string} JUnit XML document.
 */
export function buildJUnitXml(summary, opts = {}) {
	const suiteName = opts.suiteName ?? 'Qase Test Suite';
	const results = summary.results ?? [];
	const tests = summary.total ?? results.length;
	const failures = summary.failed ?? 0;
	const errors = summary.errored ?? 0;
	const skipped = 0; // no skip concept yet
	const time = ((summary.durationMs ?? 0) / 1000).toFixed(3);

	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${time}">`
	];

	for (const result of results) {
		const vp = result.viewport;
		const vpPrefix = vp && vp.label ? `[${vp.label}] ` : '';
		const name = escapeXml(vpPrefix + (result.testCaseName ?? 'Unknown test'));
		const className = escapeXml(opts.suiteName ?? 'qase');
		const testTime = ((result.durationMs ?? 0) / 1000).toFixed(3);

		lines.push(`  <testcase name="${name}" classname="${className}" time="${testTime}">`);

		if (result.result === 'fail') {
			const msg = escapeXml(result.error ?? 'Test failed');
			lines.push(`    <failure message="${msg}">${msg}</failure>`);
		}

		if (result.result === 'error') {
			const msg = escapeXml(result.error ?? 'Test errored');
			lines.push(`    <error message="${msg}">${msg}</error>`);
		}

		// system-out: screenshot count, flaky note, and step/assertion summary
		const sysOutParts = [];
		if (result.flaky) {
			sysOutParts.push(`Flaky: passed on attempt ${result.attempt ?? 2}`);
		}
		if (result.screenshotCount > 0 || (result.screenshots?.length ?? 0) > 0) {
			const count = result.screenshotCount ?? result.screenshots?.length ?? 0;
			sysOutParts.push(`Screenshots captured: ${count}`);
		}
		if (result.stepResults?.length > 0) {
			const stepSummary = result.stepResults
				.map((s, i) => `  ${i + 1}. [${s.status}] ${s.action}`)
				.join('\n');
			sysOutParts.push(`Steps:\n${stepSummary}`);
		}
		if (sysOutParts.length > 0) {
			lines.push(`    <system-out>${escapeXml(sysOutParts.join('\n'))}</system-out>`);
		}

		lines.push('  </testcase>');
	}

	lines.push('</testsuite>');
	return lines.join('\n');
}
