'use strict';

/**
 * Phase 17 — unit tests for the UX model (server/uxModel.js).
 * Run: node --test tests/phase17-ux-model.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
	UX_ISSUE_KINDS,
	REVIEW_STATES,
	aggregateChecks,
	buildIssuesFromChecks,
	buildUxAssessment,
	expectedForCheck,
	transitionReviewState,
} from '../server/uxModel.js';
import { CHECK_STATUS } from '../server/uxChecks.js';

const mk = (checkId, dimension, status, severity = 'none', extra = {}) => ({
	checkId, dimension, status, severity, detail: `${checkId} detail`, evidence: [], viewport: null, ...extra,
});

describe('aggregateChecks', () => {

	test('dimension score deducts by severity weights', () => {
		const dims = aggregateChecks([
			mk('c1', 'ACCESSIBILITY', CHECK_STATUS.ISSUE, 'high'),
			mk('c2', 'ACCESSIBILITY', CHECK_STATUS.PASS),
		]);
		assert.equal(dims.length, 1);
		// 100 - 15 = 85
		assert.equal(dims[0].score, 85);
	});

	test('repeated occurrences dampen via sqrt', () => {
		const dims = aggregateChecks([
			mk('c1', 'RESPONSIVENESS', CHECK_STATUS.ISSUE, 'high'),
			mk('c1', 'RESPONSIVENESS', CHECK_STATUS.ISSUE, 'high'),
			mk('c1', 'RESPONSIVENESS', CHECK_STATUS.ISSUE, 'high'),
			mk('c1', 'RESPONSIVENESS', CHECK_STATUS.ISSUE, 'high'),
		]);
		// 4 occurrences → factor 2 → 100 - 15*2 = 70
		assert.equal(dims[0].score, 70);
	});

	test('floor at 0', () => {
		const many = [];
		for (let i = 0; i < 10; i++) {
			many.push(mk('c' + i, 'FORM_USABILITY', CHECK_STATUS.ISSUE, 'critical'));
		}
		const dims = aggregateChecks(many);
		assert.equal(dims[0].score, 0);
	});

	test('UNVERIFIED checks do not deduct and lower confidence', () => {
		const dims = aggregateChecks([
			mk('c1', 'CLARITY', CHECK_STATUS.PASS),
			mk('c2', 'CLARITY', CHECK_STATUS.UNVERIFIED),
			mk('c3', 'CLARITY', CHECK_STATUS.UNVERIFIED),
		]);
		assert.equal(dims[0].score, 100);
		assert.equal(dims[0].evidenceCoverage, 0.33);   // rounded to 2dp
		assert.equal(dims[0].confidence, 0.33);
	});

	test('all UNVERIFIED → confidence 0, score 100, but not presented as fact', () => {
		const dims = aggregateChecks([
			mk('c1', 'FEEDBACK', CHECK_STATUS.UNVERIFIED),
			mk('c2', 'FEEDBACK', CHECK_STATUS.UNVERIFIED),
		]);
		assert.equal(dims[0].score, 100);
		assert.equal(dims[0].confidence, 0);
		assert.equal(dims[0].decisive, 0);
	});

	test('confidence clamped to [0.3, 0.95] when decisive data exists', () => {
		const low = aggregateChecks([mk('c1', 'D1', CHECK_STATUS.PASS), ...Array.from({ length: 9 }, (_, i) => mk('u' + i, 'D1', CHECK_STATUS.UNVERIFIED))]);
		assert.equal(low[0].confidence, 0.3);
	});
});

describe('buildIssuesFromChecks', () => {

	test('issues carry kind, evidence, review state; subjective dims require review', () => {
		const issues = buildIssuesFromChecks([
			mk('clarity_page_heading', 'CLARITY', CHECK_STATUS.ISSUE, 'low', { url: 'https://a.test', evidence: [{ kind: 'dom', detail: 'h1=0' }] }),
			mk('a11y_document_lang', 'ACCESSIBILITY', CHECK_STATUS.ISSUE, 'low', { url: 'https://a.test', evidence: [{ kind: 'dom', detail: 'lang empty' }] }),
		]);
		const clarity = issues.find(i => i.dimension === 'CLARITY');
		const a11y = issues.find(i => i.dimension === 'ACCESSIBILITY');
		assert.equal(clarity.reviewState, REVIEW_STATES.REVIEW_REQUIRED);
		assert.equal(a11y.kind, UX_ISSUE_KINDS.ACCESSIBILITY_ISSUE);
		assert.equal(a11y.reviewState, REVIEW_STATES.AUTO_VERIFIED);
		assert.ok(a11y.evidence.length > 0);
	});

	test('grouping across pages by checkId+url; occurrences counted', () => {
		const issues = buildIssuesFromChecks([
			mk('resp_horizontal_overflow', 'RESPONSIVENESS', CHECK_STATUS.ISSUE, 'high', { url: 'https://a.test/p', evidence: [{ kind: 'screenshot', detail: '812px' }] }),
			mk('resp_horizontal_overflow', 'RESPONSIVENESS', CHECK_STATUS.ISSUE, 'high', { url: 'https://a.test/p', evidence: [{ kind: 'dom', detail: 'table' }], viewport: { label: 'mobile', width: 375, height: 812 } }),
			mk('resp_horizontal_overflow', 'RESPONSIVENESS', CHECK_STATUS.ISSUE, 'high', { url: 'https://a.test/q', evidence: [{ kind: 'dom', detail: 'table' }] }),
		]);
		assert.equal(issues.length, 2);   // two distinct urls
		const first = issues.find(i => i.urls.includes('https://a.test/p'));
		assert.equal(first.occurrences, 2);
		// screenshot + dom evidence → 0.85
		assert.equal(first.confidence, 0.85);
	});

	test('console_errors become OBSERVATION kind, not UX_ISSUE', () => {
		const issues = buildIssuesFromChecks([
			mk('console_errors', 'ERROR_HANDLING', CHECK_STATUS.ISSUE, 'low', { url: 'https://a.test', evidence: [{ kind: 'console', detail: 'TypeError' }] }),
		]);
		assert.equal(issues[0].kind, UX_ISSUE_KINDS.OBSERVATION);
	});

	test('expected text only for known checks — unknown checkId expected=null', () => {
		assert.ok(expectedForCheck('a11y_document_lang'));
		assert.equal(expectedForCheck('made_up_check'), null);
	});
});

describe('review state transitions', () => {

	test('human can reject; system cannot leave REJECTED', () => {
		const r = transitionReviewState(REVIEW_STATES.AUTO_VERIFIED, REVIEW_STATES.REJECTED, 'human');
		assert.equal(r.reviewState, REVIEW_STATES.REJECTED);
		assert.throws(() => transitionReviewState(REVIEW_STATES.REJECTED, REVIEW_STATES.AUTO_VERIFIED, 'system'));
		assert.doesNotThrow(() => transitionReviewState(REVIEW_STATES.REJECTED, REVIEW_STATES.REVIEW_REQUIRED, 'human'));
	});

	test('invalid state rejected', () => {
		assert.throws(() => transitionReviewState(REVIEW_STATES.AUTO_VERIFIED, 'MAYBE', 'human'));
	});
});

describe('buildUxAssessment', () => {

	const sweep = {
		pages: {
			home: {
				url: 'https://a.test/',
				viewport: { width: 375, height: 812, label: 'mobile' },
				lang: '',
				docTitle: 'Home',
				dataCollection: { ok: true },
				nav: { navElementCount: 1 },
				headings: { h1: [{ text: 'Home' }], h2: [], h3plus: [], order: [{ level: 1, text: 'Home' }] },
				links: [{ href: '/a', text: 'A', emptyHref: false }],
				images: [{ src: '/x.png', alt: 'X' }],
				interactive: { elementsWithoutName: [], positiveTabIndex: [] },
				viewportMeta: { present: true },
				responsive: { scrollWidth: 812, clientWidth: 375, horizontalOverflow: true, overflowingSelectors: [], touchTargetsBelowMin: [], clippedText: [] },
				consoleErrors: [],
				deadEnd: { outboundLinks: 1 },
				forms: [],
			},
		},
		siteResults: [],
		sweepMeta: { pagesVisited: 1, okPages: 1, failedPages: 0, viewports: [{ label: 'mobile' }] },
	};

	test('full assessment: dimensions, issues, unverified areas, overall', () => {
		const a = buildUxAssessment(sweep);
		assert.ok(a.dimensions.length > 0);
		// mobile + horizontalOverflow=true → RESPONSIVENESS issue present
		const resp = a.dimensions.find(d => d.dimension === 'RESPONSIVENESS');
		assert.ok(resp.score < 100, 'responsiveness scored below 100');
		const issue = a.issues.find(i => i.dimension === 'RESPONSIVENESS');
		assert.ok(issue, 'responsiveness issue exists');
		assert.equal(issue.status, 'VERIFIED');
		assert.ok(Array.isArray(a.unverifiedAreas) && a.unverifiedAreas.length >= 0);
		assert.ok(a.overall.score != null && a.overall.confidence != null);
	});

	test('empty sweep produces null overall, zero dimensions, no fabricated issues', () => {
		const a = buildUxAssessment({ pages: {}, siteResults: [], sweepMeta: { pagesVisited: 0 } });
		assert.equal(a.overall.score, null);
		assert.equal(a.dimensions.length, 0);
		assert.equal(a.issues.length, 0);
	});

	test('accessibility issue kind distinct from ux issue kind', () => {
		const a = buildUxAssessment({
			pages: { p: { ...sweep.pages.home, lang: '', headings: { ...sweep.pages.home.headings, h1: [] } } },
			siteResults: [], sweepMeta: { pagesVisited: 1 },
		});
		const a11yIssues = a.issues.filter(i => i.kind === UX_ISSUE_KINDS.ACCESSIBILITY_ISSUE);
		const uxIssues = a.issues.filter(i => i.kind === UX_ISSUE_KINDS.UX_ISSUE);
		assert.ok(a11yIssues.length > 0, 'a11y issues exist (lang missing)');
		assert.ok(uxIssues.length > 0, 'ux issues exist (overflow)');
	});
});
