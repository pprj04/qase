'use strict';

/**
 * Phase 17 — unit tests for the UX check catalog (server/uxChecks.js).
 * Run: node --test tests/phase17-ux-checks.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
	runPageChecks,
	runSiteChecks,
	CHECK_STATUS,
	PAGE_CHECKS,
	UX_DIMENSIONS,
	ERROR_EXPERIENCE_KINDS,
} from '../server/uxChecks.js';

/* ── fixtures ───────────────────────────────────────────────────── */

const goodPage = () => ({
	url: 'https://app.test/dashboard',
	title: 'Dashboard — App',
	viewport: { width: 1440, height: 900, label: 'desktop' },
	nav: { navElementCount: 1, uniqueDestinations: 8 },
	headings: { h1: [{ text: 'Dashboard' }], h2: [{ text: 'Stats' }], h3plus: [], order: [{ level: 1, text: 'Dashboard' }, { level: 2, text: 'Stats' }] },
	forms: [],
	buttons: [{ text: 'Save', accessibleName: 'Save', type: 'submit' }],
	links: [{ href: '/settings', text: 'Settings', internal: true, emptyHref: false }],
	images: [{ src: '/logo.png', alt: 'App logo', decorative: false }],
	lang: 'en',
	docTitle: 'Dashboard — App',
	viewportMeta: { present: true, width: 'device-width', userScalable: null },
	responsive: { scrollWidth: 1440, clientWidth: 1440, horizontalOverflow: false, overflowingSelectors: [], touchTargetsBelowMin: [], clippedText: [] },
	consoleErrors: [],
	errorStates: [],
	feedback: {},
	interactive: { elementsWithoutName: [], positiveTabIndex: [], focusableCount: 20 },
	deadEnd: { outboundLinks: 8, hasNav: true },
	dataCollection: { ok: true },
});

const mobileViewport = { width: 375, height: 812, label: 'mobile' };

/* ── catalog integrity ──────────────────────────────────────────── */

describe('uxChecks catalog', () => {

	test('every page check returns valid status enum', () => {
		const results = runPageChecks(goodPage());
		assert.ok(results.length > 0);
		for (const r of results) {
			assert.ok(Object.values(CHECK_STATUS).includes(r.status), `bad status ${r.status} on ${r.checkId}`);
			assert.ok(UX_DIMENSIONS.includes(r.dimension), `bad dimension ${r.dimension} on ${r.checkId}`);
			if (r.status === CHECK_STATUS.ISSUE) {
				assert.ok(r.evidence.length > 0, `ISSUE without evidence: ${r.checkId}`);
				assert.ok(r.severity !== 'none', `ISSUE without severity: ${r.checkId}`);
			}
		}
	});

	test('dataCollection failure marks all checks UNVERIFIED, never ISSUE', () => {
		const results = runPageChecks({ url: 'x', dataCollection: { ok: false, error: 'timeout' } });
		assert.ok(results.length === PAGE_CHECKS.length);
		for (const r of results) {
			assert.equal(r.status, CHECK_STATUS.UNVERIFIED);
			assert.equal(r.severity, 'none');
		}
	});

	test('missing data yields UNVERIFIED, not ISSUE (uncertainty preserved)', () => {
		const minimal = { url: 'https://app.test/', dataCollection: { ok: true }, viewport: { width: 1440, height: 900 } };
		const results = runPageChecks(minimal);
		for (const r of results) {
			assert.notEqual(r.status, CHECK_STATUS.ISSUE, `${r.checkId} flagged ISSUE on empty page data`);
		}
	});
});

/* ── NAVIGATION ─────────────────────────────────────────────────── */

describe('navigation checks', () => {

	test('dead end page flagged medium', () => {
		const pd = { ...goodPage(), deadEnd: { outboundLinks: 0, hasNav: false }, links: [] };
		const r = runPageChecks(pd).find(r => r.checkId === 'navigation_dead_end');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'medium');
	});

	test('empty href links flagged high', () => {
		const pd = { ...goodPage(), links: [{ href: '', text: 'Go', emptyHref: true }] };
		const r = runPageChecks(pd).find(r => r.checkId === 'navigation_broken_internal_links');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'high');
	});

	test('nav absent with no links at all = dead-end ISSUE; nav absent with links = UNVERIFIED', () => {
		const noNavWithLinks = { ...goodPage(), nav: { navElementCount: 0, uniqueDestinations: 3 } };
		const r1 = runPageChecks(noNavWithLinks).find(r => r.checkId === 'nav_presence');
		assert.equal(r1.status, 'UNVERIFIED');

		const noNavNoLinks = { ...goodPage(), nav: { navElementCount: 0 }, links: [], deadEnd: { outboundLinks: 0, hasNav: false } };
		const r2 = runPageChecks(noNavNoLinks).find(r => r.checkId === 'nav_presence');
		assert.equal(r2.status, 'ISSUE');
	});
});

/* ── CLARITY ────────────────────────────────────────────────────── */

describe('clarity checks', () => {

	test('missing doc title flagged low', () => {
		const pd = { ...goodPage(), docTitle: '' };
		const r = runPageChecks(pd).find(r => r.checkId === 'clarity_document_title');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'low');
	});

	test('multiple h1 flagged low; no headings at all UNVERIFIED', () => {
		const two = { ...goodPage(), headings: { ...goodPage().headings, h1: [{ text: 'A' }, { text: 'B' }] } };
		const r1 = runPageChecks(two).find(r => r.checkId === 'clarity_page_heading');
		assert.equal(r1.status, 'ISSUE');

		const none = { ...goodPage(), headings: { h1: [], h2: [], h3plus: [], order: [] } };
		const r2 = runPageChecks(none).find(r => r.checkId === 'clarity_page_heading');
		assert.equal(r2.status, 'UNVERIFIED');
	});
});

/* ── CONSISTENCY (site-level) ───────────────────────────────────── */

describe('consistency check', () => {

	test('identical titles across pages flagged', () => {
		const pages = {
			a: { ...goodPage(), docTitle: 'App' },
			b: { ...goodPage(), docTitle: 'App' },
		};
		const r = runSiteChecks(pages)[0];
		assert.equal(r.status, 'ISSUE');
	});

	test('nav on some pages flagged', () => {
		const pages = {
			a: goodPage(),
			b: { ...goodPage(), nav: { navElementCount: 0 }, deadEnd: { outboundLinks: 2 } },
		};
		const r = runSiteChecks(pages)[0];
		assert.equal(r.status, 'ISSUE');
	});

	test('single page => UNVERIFIED', () => {
		const r = runSiteChecks({ a: goodPage() })[0];
		assert.equal(r.status, 'UNVERIFIED');
	});
});

/* ── FEEDBACK ───────────────────────────────────────────────────── */

describe('feedback check', () => {

	test('slow submit with no feedback = medium ISSUE', () => {
		const pd = { ...goodPage(), feedback: { formSubmitObserved: true, durationMs: 2500, loadingIndicatorSeen: false, successMessageSeen: false, failureMessageSeen: false } };
		const r = runPageChecks(pd).find(r => r.checkId === 'feedback_action_feedback');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'medium');
	});

	test('instant submit with success message passes', () => {
		const pd = { ...goodPage(), feedback: { formSubmitObserved: true, durationMs: 120, loadingIndicatorSeen: false, successMessageSeen: true, failureMessageSeen: false } };
		const r = runPageChecks(pd).find(r => r.checkId === 'feedback_action_feedback');
		assert.equal(r.status, 'PASS');
	});

	test('no submit observed = UNVERIFIED (not ISSUE)', () => {
		const r = runPageChecks(goodPage()).find(r => r.checkId === 'feedback_action_feedback');
		assert.equal(r.status, 'UNVERIFIED');
	});
});

/* ── ERROR EXPERIENCE ───────────────────────────────────────────── */

describe('error experience check', () => {

	test('technical exposure classified and high severity', () => {
		const pd = { ...goodPage(), errorStates: [{ context: 'submit form', text: 'TypeError: Cannot read properties of undefined (reading \'x\')', hasRecovery: false, preservesInput: true }] };
		const rs = runPageChecks(pd).filter(r => r.checkId === 'error_experience');
		const issue = rs.find(r => r.status === 'ISSUE');
		assert.ok(issue, 'issue produced');
		assert.equal(issue.severity, 'high');
		assert.ok(issue.evidence.some(e => e.detail === 'TECHNICAL_ERROR_EXPOSURE'));
	});

	test('unhelpful one-word error flagged medium', () => {
		const pd = { ...goodPage(), errorStates: [{ context: 'submit', text: 'Invalid.', hasRecovery: true, preservesInput: true }] };
		const rs = runPageChecks(pd).filter(r => r.checkId === 'error_experience');
		const issue = rs.find(r => r.status === 'ISSUE');
		assert.equal(issue.severity, 'medium');
	});

	test('good error with recovery passes', () => {
		const pd = { ...goodPage(), errorStates: [{ context: 'submit', text: 'Password must contain at least 8 characters. Please try again.', hasRecovery: true, preservesInput: true }] };
		const rs = runPageChecks(pd).filter(r => r.checkId === 'error_experience');
		const pass = rs.find(r => r.status === 'PASS');
		assert.ok(pass);
	});

	test('data loss risk flagged high', () => {
		const pd = { ...goodPage(), errorStates: [{ context: 'submit', text: 'Submission failed. Please correct and retry.', hasRecovery: true, preservesInput: false }] };
		const rs = runPageChecks(pd).filter(r => r.checkId === 'error_experience');
		const issue = rs.find(r => r.status === 'ISSUE');
		assert.equal(issue.severity, 'high');
	});

	test('no errors observed = UNVERIFIED', () => {
		const rs = runPageChecks(goodPage()).filter(r => r.checkId === 'error_experience');
		assert.equal(rs[0].status, 'UNVERIFIED');
	});

	test('error experience kinds enum exposed', () => {
		assert.ok(ERROR_EXPERIENCE_KINDS.includes('TECHNICAL_ERROR_EXPOSURE'));
		assert.ok(ERROR_EXPERIENCE_KINDS.includes('GOOD_ERROR_HANDLING'));
	});
});

/* ── FORM USABILITY ─────────────────────────────────────────────── */

describe('form usability checks', () => {

	const formPage = (fields) => ({ ...goodPage(), forms: [{ action: '/save', method: 'post', fields, submitLabel: 'Save' }] });

	test('unlabeled fields flagged with count', () => {
		const pd = formPage([
			{ name: 'email', type: 'email', hasLabel: true },
			{ name: 'qty', type: 'number', hasLabel: false, ariaLabel: null, placeholder: null },
		]);
		const r = runPageChecks(pd).find(r => r.checkId === 'form_field_labels');
		assert.equal(r.status, 'ISSUE');
		assert.ok(r.detail.includes('1/2'));
	});

	test('email-like field with type=text flagged', () => {
		const pd = formPage([{ name: 'user_email', type: 'text', hasLabel: true }]);
		const r = runPageChecks(pd).find(r => r.checkId === 'form_input_types');
		assert.equal(r.status, 'ISSUE');
	});

	test('email field with type=email passes input types', () => {
		const pd = formPage([{ name: 'user_email', type: 'email', hasLabel: true }]);
		const r = runPageChecks(pd).find(r => r.checkId === 'form_input_types');
		assert.equal(r.status, 'PASS');
	});

	test('password without autocomplete flagged low', () => {
		const pd = formPage([{ name: 'password', type: 'password', hasLabel: true, autocomplete: null }]);
		const r = runPageChecks(pd).find(r => r.checkId === 'form_password_handling');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'low');
	});

	test('password with proper autocomplete passes', () => {
		const pd = formPage([{ name: 'password', type: 'password', hasLabel: true, autocomplete: 'current-password' }]);
		const r = runPageChecks(pd).find(r => r.checkId === 'form_password_handling');
		assert.equal(r.status, 'PASS');
	});

	test('no required fields in DOM => UNVERIFIED, not PASS', () => {
		const pd = formPage([{ name: 'q', type: 'search', hasLabel: false, placeholder: 'Search…', required: false }]);
		const r = runPageChecks(pd).find(r => r.checkId === 'form_required_marking');
		assert.equal(r.status, 'UNVERIFIED');
	});
});

/* ── HIERARCHY ──────────────────────────────────────────────────── */

describe('hierarchy checks', () => {

	test('h2 after h4 skip flagged', () => {
		const pd = {
			...goodPage(),
			headings: { h1: [{ text: 'D' }], h2: [], h3plus: [], order: [{ level: 1, text: 'D' }, { level: 4, text: 'X' }, { level: 2, text: 'Y' }] },
		};
		const r = runPageChecks(pd).find(r => r.checkId === 'hierarchy_heading_order');
		assert.equal(r.status, 'ISSUE');
	});
});

/* ── ACCESSIBILITY ──────────────────────────────────────────────── */

describe('accessibility checks', () => {

	test('missing alt flagged', () => {
		const pd = { ...goodPage(), images: [{ src: '/chart.png', alt: null, decorative: false }, { src: '/div.png', alt: null, decorative: true }] };
		const r = runPageChecks(pd).find(r => r.checkId === 'a11y_image_alt');
		assert.equal(r.status, 'ISSUE');
	});

	test('decorative images without alt are fine', () => {
		const pd = { ...goodPage(), images: [{ src: '/div.png', alt: null, decorative: true }] };
		const r = runPageChecks(pd).find(r => r.checkId === 'a11y_image_alt');
		assert.equal(r.status, 'PASS');
	});

	test('missing lang flagged low', () => {
		const pd = { ...goodPage(), lang: '' };
		const r = runPageChecks(pd).find(r => r.checkId === 'a11y_document_lang');
		assert.equal(r.status, 'ISSUE');
	});

	test('unnamed interactive elements flagged', () => {
		const pd = { ...goodPage(), interactive: { elementsWithoutName: ['button:nth(3)', 'a.nav >> nth=2'], positiveTabIndex: [], focusableCount: 10 } };
		const r = runPageChecks(pd).find(r => r.checkId === 'a11y_interactive_names');
		assert.equal(r.status, 'ISSUE');
	});

	test('positive tabindex flagged medium', () => {
		const pd = { ...goodPage(), interactive: { elementsWithoutName: [], positiveTabIndex: ['div.card'], focusableCount: 10 } };
		const r = runPageChecks(pd).find(r => r.checkId === 'a11y_positive_tabindex');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'medium');
	});

	test('user-scalable=no flagged high (zoom disabled)', () => {
		const pd = { ...goodPage(), viewportMeta: { present: true, userScalable: false } };
		const r = runPageChecks(pd).find(r => r.checkId === 'a11y_viewport_zoom');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'high');
	});
});

/* ── RESPONSIVENESS ─────────────────────────────────────────────── */

describe('responsiveness checks', () => {

	test('horizontal overflow on mobile flagged high', () => {
		const pd = { ...goodPage(), viewport: mobileViewport, responsive: { scrollWidth: 812, clientWidth: 375, horizontalOverflow: true, overflowingSelectors: ['table.stats'], touchTargetsBelowMin: [], clippedText: [] } };
		const r = runPageChecks(pd).find(r => r.checkId === 'resp_horizontal_overflow');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'high');
	});

	test('overflow check not evaluated on desktop', () => {
		const pd = { ...goodPage(), responsive: { ...goodPage().responsive, scrollWidth: 1440, horizontalOverflow: false } };
		const r = runPageChecks(pd).find(r => r.checkId === 'resp_horizontal_overflow');
		assert.equal(r.status, 'UNVERIFIED');
	});

	test('tiny touch targets on mobile flagged', () => {
		const pd = {
			...goodPage(), viewport: mobileViewport,
			responsive: { scrollWidth: 375, clientWidth: 375, horizontalOverflow: false, overflowingSelectors: [], clippedText: [], touchTargetsBelowMin: [{ selector: 'button.icon', rect: { width: 16, height: 16 } }] },
		};
		const r = runPageChecks(pd).find(r => r.checkId === 'resp_touch_targets');
		assert.equal(r.status, 'ISSUE');
	});

	test('touch targets only checked on mobile', () => {
		const pd = { ...goodPage(), responsive: { ...goodPage().responsive, touchTargetsBelowMin: [{ selector: 'x', rect: { width: 10, height: 10 } }] } };
		const r = runPageChecks(pd).find(r => r.checkId === 'resp_touch_targets');
		assert.equal(r.status, 'UNVERIFIED');
	});

	test('missing viewport meta flagged high', () => {
		const pd = { ...goodPage(), viewportMeta: { present: false } };
		const r = runPageChecks(pd).find(r => r.checkId === 'resp_viewport_meta');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'high');
	});

	test('clipped text flagged medium', () => {
		const pd = { ...goodPage(), viewport: mobileViewport, responsive: { ...goodPage().responsive, clippedText: [{ selector: 'h2.promo' }] } };
		const r = runPageChecks(pd).find(r => r.checkId === 'resp_clipped_text');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.severity, 'medium');
	});
});

/* ── CONSOLE ────────────────────────────────────────────────────── */

describe('console errors check', () => {

	test('console errors surfaced under ERROR_HANDLING', () => {
		const pd = { ...goodPage(), consoleErrors: [{ text: 'Uncaught TypeError: x is not a function' }] };
		const r = runPageChecks(pd).find(r => r.checkId === 'console_errors');
		assert.equal(r.status, 'ISSUE');
		assert.equal(r.dimension, 'ERROR_HANDLING');
	});
});
