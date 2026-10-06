import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportMarkdown, buildMatrixSectionMarkdown } from './report.js';

/** Minimal session shape for report generation. */
function sessionWith(overrides = {}) {
	return {
		id: 'run-1',
		title: 'Login workflow',
		targetUrl: 'https://example.test/login',
		createdAt: '2027-02-10T10:00:00.000Z',
		todos: [],
		findings: [],
		report: { verdict: 'pass', summary: 'ok' },
		...overrides
	};
}

test('buildMatrixSectionMarkdown: empty without session.matrixCoverage (non-matrix sessions unchanged)', () => {
	assert.equal(buildMatrixSectionMarkdown(sessionWith()), '');
	const markdown = buildReportMarkdown(sessionWith());
	assert.equal(markdown.includes('## Matrix coverage'), false);
});

test('buildMatrixSectionMarkdown: renders counts from the injected coverage snapshot', () => {
	const session = sessionWith({
		matrixRunId: 'matrix-1',
		matrixCoverage: {
			execution: {
				profilesRequested: 36, profilesExecuted: 34, passed: 31, failed: 3,
				notRun: 1, unavailable: 0, notSupported: 1, blocked: 0, error: 0
			},
			deviceCategories: [
				{ label: 'iPhone', requested: 6, executed: 6, covered: true, gapReason: null },
				{ label: 'Android tablets', requested: 6, executed: 0, covered: false, gapReason: 'NOT_SUPPORTED' }
			],
			browsers: [
				{ browser: 'chrome', requested: 6, executed: 6, covered: true, gapReason: null },
				{ browser: 'duckduckgo', requested: 6, executed: 0, covered: false,
					gapReason: 'DuckDuckGo is a mobile-only browser with no Playwright build.' }
			]
		}
	});
	const section = buildMatrixSectionMarkdown(session);
	assert.match(section, /Profiles requested 36 · executed 34 · passed 31 · failed 3/);
	assert.match(section, /not supported 1/);
	assert.match(section, /✓ iPhone — 6\/6 executed/);
	assert.match(section, /⚠ Android tablets — 0\/6 executed/);
	assert.match(section, /⚠ duckduckgo — 0\/6 executed — DuckDuckGo is a mobile-only browser with no Playwright build\./);
	// Full report embeds the section for matrix sessions only.
	const markdown = buildReportMarkdown(session);
	assert.match(markdown, /## Matrix coverage/);
	// Without the injection the same session type renders no section.
	assert.equal(buildReportMarkdown(sessionWith({ matrixRunId: 'matrix-1' })).includes('## Matrix coverage'), false);
});

test('buildMatrixSectionMarkdown: never implies a pass for unexecuted browsers', () => {
	const section = buildMatrixSectionMarkdown(sessionWith({
		matrixCoverage: {
			execution: { profilesRequested: 2, profilesExecuted: 0, passed: 0, failed: 0, notRun: 1, unavailable: 0, notSupported: 1, blocked: 0, error: 0 },
			deviceCategories: [],
			browsers: [{ browser: 'duckduckgo', requested: 2, executed: 0, covered: false, gapReason: 'runner unavailable' }]
		}
	}));
	assert.match(section, /executed 0 · passed 0/);
	assert.doesNotMatch(section, /✓/);
});
