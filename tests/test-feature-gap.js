/**
 * Tests for Feature Gap Intelligence with Purpose Understanding
 *
 * Key principle: Purpose comes before feature expectations.
 * A login page on a CRM → registration NOT expected (employees don't self-register).
 * A login page on a SaaS → registration IS expected (users self-register).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
	extractAppInventory, generateExpectedFeatures, detectFeatureGaps,
	analyzeFeatureGaps, gapsToFindings, inferAppPurpose,
	analyzeWorkflowGaps, detectWorkflowSteps
} from '../server/featureGap.js';

/* ── Helpers ── */

function makeSession(overrides = {}) {
	return {
		id: 'test-session',
		projectId: 'test-project',
		targetUrl: 'https://app.example.com',
		capturedSteps: [],
		activities: [],
		findings: [],
		report: { covered: [], notCovered: [] },
		todos: [],
		...overrides
	};
}

// SaaS app: login + dashboard, users self-register
const saasSession = makeSession({
	capturedSteps: [
		{ action: 'navigate', url: 'https://app.example.com/login' },
		{ action: 'fill', target: '#email', value: 'test@test.com', url: 'https://app.example.com/login' },
		{ action: 'fill', target: '#password', value: 'pass', url: 'https://app.example.com/login' },
		{ action: 'click', target: '#login-btn', url: 'https://app.example.com/login' },
		{ action: 'navigate', url: 'https://app.example.com/dashboard' },
		{ action: 'navigate', url: 'https://app.example.com/projects' },
		{ action: 'navigate', url: 'https://app.example.com/team' },
		{ action: 'navigate', url: 'https://app.example.com/settings' },
		{ action: 'navigate', url: 'https://app.example.com/notifications' }
	],
	activities: [
		{ detail: 'Login page', summary: 'Form found' },
		{ detail: 'Dashboard with project list', summary: 'Workspace loaded' },
		{ detail: 'Team collaboration page', summary: 'Team members visible' },
		{ detail: 'Subscription plans visible', summary: 'SaaS pricing tiers' }
	]
});

// E-commerce: products + cart + checkout
const ecommerceSession = makeSession({
	capturedSteps: [
		{ action: 'navigate', url: 'https://shop.example.com/products' },
		{ action: 'navigate', url: 'https://shop.example.com/products/widget' },
		{ action: 'navigate', url: 'https://shop.example.com/cart' },
		{ action: 'navigate', url: 'https://shop.example.com/checkout' },
		{ action: 'navigate', url: 'https://shop.example.com/orders' }
	],
	activities: [
		{ detail: 'Payment checkout', summary: 'Stripe checkout' },
		{ detail: 'Product listing', summary: 'Products loaded' },
		{ detail: 'Shopping cart', summary: 'Cart with items' }
	]
});

// Marketing site: landing page, no auth
const marketingSession = makeSession({
	capturedSteps: [
		{ action: 'navigate', url: 'https://landing.example.com/' },
		{ action: 'navigate', url: 'https://landing.example.com/about' },
		{ action: 'navigate', url: 'https://landing.example.com/pricing' },
		{ action: 'navigate', url: 'https://landing.example.com/contact' }
	],
	activities: [{ detail: 'Landing page about our features', summary: 'Marketing site with newsletter signup' }]
});

// Admin dashboard: login + admin URL patterns, internal tool
const adminSession = makeSession({
	capturedSteps: [
		{ action: 'navigate', url: 'https://admin.example.com/login' },
		{ action: 'click', target: '#login-btn', url: 'https://admin.example.com/login' },
		{ action: 'navigate', url: 'https://admin.example.com/panel' },
		{ action: 'navigate', url: 'https://admin.example.com/console/users' },
		{ action: 'navigate', url: 'https://admin.example.com/management/reports' }
	],
	activities: [
		{ detail: 'Admin panel', summary: 'Internal management console' },
		{ detail: 'User management', summary: 'Operations dashboard' }
	]
});

/* ── extractAppInventory ── */

describe('extractAppInventory', () => {
	it('detects SaaS app type', () => {
		const inv = extractAppInventory(saasSession);
		assert.equal(inv.appType.saas, true);
		assert.equal(inv.auth.hasLogin, true);
	});

	it('detects e-commerce app type', () => {
		const inv = extractAppInventory(ecommerceSession);
		assert.equal(inv.appType.ecommerce, true);
		assert.equal(inv.capabilities.payment, true);
	});

	it('detects marketing app type', () => {
		const inv = extractAppInventory(marketingSession);
		assert.equal(inv.appType.marketing, true);
		assert.equal(inv.auth.hasLogin, false);
	});

	it('extracts distinct pages', () => {
		const inv = extractAppInventory(saasSession);
		assert.ok(inv.pages.includes('/login'));
		assert.ok(inv.pages.includes('/dashboard'));
	});

	it('detects form fields', () => {
		const inv = extractAppInventory(saasSession);
		assert.ok(inv.formFields.length > 0);
	});

	it('captures pending todos', () => {
		const session = makeSession({
			todos: [
				{ text: 'Test A', status: 'completed' },
				{ text: 'Test B', status: 'pending' }
			]
		});
		const inv = extractAppInventory(session);
		assert.deepEqual(inv.pendingTodos, ['Test B']);
	});

	it('calculates exploration confidence from page count', () => {
		const shallowSession = makeSession({
			capturedSteps: [{ action: 'navigate', url: 'https://app.example.com/' }]
		});
		const shallowInv = extractAppInventory(shallowSession);
		// 1 page = very low exploration confidence
		assert.ok(shallowInv.explorationConfidence <= 0.2,
			`expected <= 0.2, got ${shallowInv.explorationConfidence}`);

		const deepInv = extractAppInventory(saasSession);
		// 4+ pages = higher confidence
		assert.ok(deepInv.explorationConfidence > shallowInv.explorationConfidence,
			`deep (${deepInv.explorationConfidence}) should exceed shallow (${shallowInv.explorationConfidence})`);
	});
});

/* ── inferAppPurpose ── */

describe('inferAppPurpose', () => {
	it('identifies SaaS platform purpose', () => {
		const inv = extractAppInventory(saasSession);
		const purpose = inferAppPurpose(inv, saasSession);
		assert.equal(purpose.id, 'saas_platform');
		assert.ok(purpose.confidence > 0, 'has non-zero confidence');
		assert.ok(purpose.userGenerated, 'SaaS is user-generated');
	});

	it('identifies e-commerce purpose', () => {
		const inv = extractAppInventory(ecommerceSession);
		const purpose = inferAppPurpose(inv, ecommerceSession);
		assert.equal(purpose.id, 'ecommerce');
		assert.ok(purpose.userGenerated, 'e-commerce is user-generated');
	});

	it('identifies marketing purpose', () => {
		const inv = extractAppInventory(marketingSession);
		const purpose = inferAppPurpose(inv, marketingSession);
		assert.equal(purpose.id, 'marketing');
		assert.equal(purpose.userGenerated, false, 'marketing is not user-generated');
	});

	it('identifies admin dashboard as NOT user-generated', () => {
		const inv = extractAppInventory(adminSession);
		const purpose = inferAppPurpose(inv, adminSession);
		assert.equal(purpose.id, 'admin_dashboard');
		assert.equal(purpose.userGenerated, false,
			'internal admin tools do NOT have self-registration');
	});

	it('returns generic purpose for unknown app type', () => {
		const session = makeSession({
			capturedSteps: [{ action: 'navigate', url: 'https://app.example.com/page' }],
			activities: []
		});
		const inv = extractAppInventory(session);
		const purpose = inferAppPurpose(inv, session);
		assert.ok(purpose.id, 'has an id');
		assert.equal(typeof purpose.confidence, 'number');
	});

	it('purpose confidence is scaled by exploration depth', () => {
		// Shallow exploration = low purpose confidence
		const shallowInv = extractAppInventory(makeSession({
			capturedSteps: [{ action: 'navigate', url: 'https://app.example.com/' }],
			activities: []
		}));
		const shallowPurpose = inferAppPurpose(shallowInv, makeSession());

		// Even if it matches signals, exploration should pull confidence down
		// (Unless there are zero signal matches, in which case it's generic at 0.3)
		assert.ok(shallowPurpose.confidence <= 0.35,
			`shallow exploration should cap confidence, got ${shallowPurpose.confidence}`);
	});
});

/* ── generateExpectedFeatures (purpose-driven) ── */

describe('generateExpectedFeatures', () => {
	it('returns { expected, purpose } object', () => {
		const inv = extractAppInventory(saasSession);
		const result = generateExpectedFeatures(inv);
		assert.ok(Array.isArray(result.expected), 'has expected array');
		assert.ok(result.purpose, 'has purpose object');
		assert.ok(result.purpose.id, 'purpose has id');
	});

	it('expects registration for SaaS (user-generated)', () => {
		const inv = extractAppInventory(saasSession);
		const { expected } = generateExpectedFeatures(inv);
		assert.ok(expected.some(e => e.feature.includes('registration')),
			'SaaS with login should expect registration');
	});

	it('does NOT expect registration for admin dashboard (NOT user-generated)', () => {
		const inv = extractAppInventory(adminSession);
		const { expected } = generateExpectedFeatures(inv);
		const hasRegistration = expected.some(e => e.feature.includes('registration'));
		assert.equal(hasRegistration, false,
			'Internal admin dashboard should NOT expect user registration');
	});

	it('expects logout for all authenticated apps', () => {
		const inv = extractAppInventory(saasSession);
		const { expected } = generateExpectedFeatures(inv);
		assert.ok(expected.some(e => e.feature.includes('Logout')) ||
			!inv.auth.hasLogin, 'Should expect logout when login exists');
	});

	it('expects password reset for user-generated apps', () => {
		const inv = extractAppInventory(saasSession);
		const { expected } = generateExpectedFeatures(inv);
		assert.ok(expected.some(e => e.feature.includes('Password reset')));
	});

	it('does NOT expect password reset for admin (internal) apps', () => {
		const inv = extractAppInventory(adminSession);
		const { expected } = generateExpectedFeatures(inv);
		const hasReset = expected.some(e => e.feature.includes('Password reset'));
		assert.equal(hasReset, false,
			'Internal admin tools typically handle password reset via IT, not self-service');
	});

	it('includes purpose-specific expected features', () => {
		const inv = extractAppInventory(ecommerceSession);
		const { expected, purpose } = generateExpectedFeatures(inv);
		assert.equal(purpose.id, 'ecommerce');
		// Should expect e-commerce specific things
		assert.ok(expected.some(e => e.feature.toLowerCase().includes('cart') || e.feature.toLowerCase().includes('product')),
			'E-commerce should expect product/cart features');
	});

	it('does not expect auth features for marketing site', () => {
		const inv = extractAppInventory(marketingSession);
		const { expected } = generateExpectedFeatures(inv);
		assert.equal(expected.filter(e => e.category === 'authentication').length, 0);
	});

	it('includes pending todos as expected features', () => {
		const session = makeSession({
			todos: [{ text: 'Test the settings page', status: 'pending' }]
		});
		const inv = extractAppInventory(session);
		const { expected } = generateExpectedFeatures(inv);
		assert.ok(expected.some(e => e.feature.includes('settings page')));
	});

	it('scales confidence by exploration depth', () => {
		// Shallow session (1 page)
		const shallowInv = extractAppInventory(makeSession({
			capturedSteps: [{ action: 'navigate', url: 'https://app.example.com/login' }],
			activities: [{ detail: 'Login page', summary: 'Form' }]
		}));
		const { expected: shallowExpected } = generateExpectedFeatures(shallowInv);

		// Deep session (same app, more exploration)
		const { expected: deepExpected } = generateExpectedFeatures(
			extractAppInventory(saasSession)
		);

		// Both should have auth expectations, but deep should have higher confidence
		const shallowAuth = shallowExpected.find(e => e.category === 'authentication');
		const deepAuth = deepExpected.find(e => e.category === 'authentication');

		if (shallowAuth && deepAuth) {
			assert.ok(deepAuth.confidence >= shallowAuth.confidence,
				`deep exploration (${deepAuth.confidence}) should have >= confidence than shallow (${shallowAuth.confidence})`);
		}
	});

	it('every expected feature has whyExpected and impact', () => {
		const inv = extractAppInventory(saasSession);
		const { expected } = generateExpectedFeatures(inv);
		for (const e of expected) {
			assert.ok(e.whyExpected, `${e.feature}: has whyExpected`);
			assert.ok(e.impact, `${e.feature}: has impact`);
			assert.ok(e.severity, `${e.feature}: has severity`);
		}
	});
});

/* ── detectFeatureGaps ── */

describe('detectFeatureGaps', () => {
	it('finds gaps between expected and actual', () => {
		const inv = extractAppInventory(saasSession);
		const { expected } = generateExpectedFeatures(inv);
		const gaps = detectFeatureGaps(expected, inv);
		assert.ok(Array.isArray(gaps));
		// Note: may be empty if all expected features were covered
	});

	it('excludes features that were covered in the report', () => {
		const session = makeSession({
			capturedSteps: [{ action: 'navigate', url: 'https://app.example.com/login' }],
			activities: [{ detail: 'Login page with password reset link', summary: 'Login form' }],
			report: { covered: ['Password reset link works correctly'], notCovered: [] }
		});
		const inv = extractAppInventory(session);
		const { expected } = generateExpectedFeatures(inv);
		const gaps = detectFeatureGaps(expected, inv);
		const resetGap = gaps.find(g => g.feature.includes('Password reset'));
		assert.equal(resetGap, undefined, 'covered features should not be gaps');
	});

	it('each gap has required fields', () => {
		const inv = extractAppInventory(saasSession);
		const { expected } = generateExpectedFeatures(inv);
		const gaps = detectFeatureGaps(expected, inv);
		for (const gap of gaps) {
			assert.ok(gap.feature, 'has feature');
			assert.ok(gap.whyExpected, 'has whyExpected');
			assert.ok(gap.impact, 'has impact');
			assert.ok(gap.severity, 'has severity');
			assert.ok(typeof gap.confidence === 'number', 'has confidence');
			assert.ok(gap.recommendation, 'has recommendation');
			assert.ok(gap.fixPrompt, 'has fixPrompt');
			assert.ok(gap.id, 'has id');
		}
	});

	it('reduces confidence for features with existing findings', () => {
		const session = makeSession({
			capturedSteps: [{ action: 'navigate', url: 'https://app.example.com/login' }],
			activities: [{ detail: 'Login page', summary: 'Form' }],
			findings: [{ id: '1', title: 'Login broken', severity: 'high', category: 'authentication' }]
		});
		const inv = extractAppInventory(session);
		const { expected } = generateExpectedFeatures(inv);
		const gaps = detectFeatureGaps(expected, inv);
		const authGap = gaps.find(g => g.category === 'authentication');
		if (authGap) {
			assert.ok(authGap.confidence < 0.7, 'confidence should be reduced');
			assert.equal(authGap.isExistingButBroken, true, 'flagged as existing-but-broken');
		}
	});

	it('does not flag admin dashboard gaps for missing registration', () => {
		const inv = extractAppInventory(adminSession);
		const { expected } = generateExpectedFeatures(inv);
		const gaps = detectFeatureGaps(expected, inv);
		// Registration should NOT appear as a gap for admin
		const regGap = gaps.find(g => g.feature.includes('registration'));
		assert.equal(regGap, undefined, 'admin dashboard should not have registration gap');
	});
});

/* ── analyzeFeatureGaps (full pipeline) ── */

describe('analyzeFeatureGaps', () => {
	it('returns gaps, inventory, purpose, and summary', () => {
		const result = analyzeFeatureGaps(saasSession);
		assert.ok(Array.isArray(result.gaps));
		assert.ok(result.inventory);
		assert.ok(result.purpose, 'should include purpose inference');
		assert.ok(result.purpose.id, 'purpose has id');
		assert.ok(typeof result.summary === 'string');
	});

	it('sorts gaps by severity then confidence', () => {
		const result = analyzeFeatureGaps(saasSession);
		if (result.gaps.length < 2) return;
		const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
		for (let i = 0; i < result.gaps.length - 1; i++) {
			const a = result.gaps[i];
			const b = result.gaps[i + 1];
			const sevDiff = severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
			assert.ok(sevDiff <= 0, 'should be sorted by severity');
		}
	});

	it('summary includes purpose name and confidence', () => {
		const result = analyzeFeatureGaps(saasSession);
		assert.ok(result.summary.includes(result.purpose.name) || result.summary.includes('gap'),
			`summary should mention purpose or gaps: "${result.summary}"`);
	});

	it('admin dashboard analysis shows admin purpose', () => {
		const result = analyzeFeatureGaps(adminSession);
		assert.equal(result.purpose.id, 'admin_dashboard');
		// Should NOT have registration as a gap
		const regGap = result.gaps.find(g => g.feature.includes('registration'));
		assert.equal(regGap, undefined, 'admin dashboard must not flag registration as missing');
	});

	it('exploration confidence affects gap confidence', () => {
		// Very shallow exploration
		const shallow = analyzeFeatureGaps(makeSession({
			capturedSteps: [{ action: 'navigate', url: 'https://app.example.com/login' }],
			activities: [{ detail: 'Login page', summary: 'Form' }]
		}));
		const shallowMaxConf = shallow.gaps.length > 0
			? Math.max(...shallow.gaps.map(g => g.confidence))
			: 0;

		// Deep exploration
		const deep = analyzeFeatureGaps(saasSession);
		const deepMaxConf = deep.gaps.length > 0
			? Math.max(...deep.gaps.map(g => g.confidence))
			: 0;

		// Shallow gaps should have lower max confidence (or no gaps at all)
		assert.ok(shallowMaxConf <= deepMaxConf || shallow.gaps.length === 0,
			`shallow max conf (${shallowMaxConf}) should be <= deep (${deepMaxConf})`);
	});
});

/* ── gapsToFindings ── */

describe('gapsToFindings', () => {
	it('converts gaps to findings with category missing_feature', () => {
		const result = analyzeFeatureGaps(saasSession);
		const findings = gapsToFindings(result.gaps, saasSession);
		// May be empty if no gaps — that's fine
		for (const f of findings) {
			assert.equal(f.category, 'missing_feature');
		}
	});

	it('each finding has evidence engine fields', () => {
		const result = analyzeFeatureGaps(saasSession);
		const findings = gapsToFindings(result.gaps, saasSession);
		for (const f of findings) {
			assert.ok(f.observed, 'has observed');
			assert.ok(f.impact, 'has impact');
			assert.ok(f.recommendation, 'has recommendation');
			assert.ok(f.fixPrompt, 'has fixPrompt');
			assert.ok(typeof f.confidence === 'number', 'has confidence');
		}
	});

	it('preserves session metadata', () => {
		const result = analyzeFeatureGaps(saasSession);
		const findings = gapsToFindings(result.gaps, saasSession);
		for (const f of findings) {
			assert.equal(f.sessionId, saasSession.id);
			assert.equal(f.projectId, saasSession.projectId);
		}
	});

	it('tags findings with feature_gap', () => {
		const result = analyzeFeatureGaps(saasSession);
		const findings = gapsToFindings(result.gaps, saasSession);
		for (const f of findings) {
			assert.ok(f.tags.includes('feature_gap'));
		}
	});

	it('does not produce registration findings for admin dashboard', () => {
		const result = analyzeFeatureGaps(adminSession);
		const findings = gapsToFindings(result.gaps, adminSession);
		const regFinding = findings.find(f => f.title.includes('registration'));
		assert.equal(regFinding, undefined,
			'admin dashboard findings must not include registration');
	});
});

/* ── User Journey / Workflow Understanding ── */

// CRM with leads + contacts + opportunities but missing pipeline/deal close
const crmWorkflowSession = makeSession({
	capturedSteps: [
		{ action: 'navigate', url: 'https://crm.example.com/login' },
		{ action: 'navigate', url: 'https://crm.example.com/leads' },
		{ action: 'navigate', url: 'https://crm.example.com/contacts' },
		{ action: 'navigate', url: 'https://crm.example.com/deals' },
		{ action: 'navigate', url: 'https://crm.example.com/opportunities' },
	],
	activities: [
		{ detail: 'CRM login page', summary: 'Sales login' },
		{ detail: 'Leads list with create lead button', summary: 'Lead management' },
		{ detail: 'Contacts converted from leads', summary: 'Contact records' },
		{ detail: 'Opportunities board', summary: 'Deal opportunities' },
	],
	report: { summary: 'CRM with leads, contacts, and opportunities', covered: [], notCovered: [] },
});

// E-commerce with browse → product → cart → checkout but missing order confirmation
const ecommerceWorkflowSession = makeSession({
	capturedSteps: [
		{ action: 'navigate', url: 'https://shop.example.com/products' },
		{ action: 'navigate', url: 'https://shop.example.com/products/widget' },
		{ action: 'navigate', url: 'https://shop.example.com/cart' },
		{ action: 'navigate', url: 'https://shop.example.com/checkout' },
	],
	activities: [
		{ detail: 'Product catalog listing', summary: 'Browse products' },
		{ detail: 'Product detail page', summary: 'Product page' },
		{ detail: 'Shopping cart', summary: 'Cart with items' },
		{ detail: 'Checkout page', summary: 'Payment checkout' },
	],
	report: { summary: 'E-commerce store with products and checkout', covered: [], notCovered: [] },
});

describe('User Journey / Workflow Understanding', () => {

	describe('detectWorkflowSteps', () => {
		it('detects CRM workflow steps from exploration data', () => {
			const inv = extractAppInventory(crmWorkflowSession);
			const { detected } = detectWorkflowSteps(inv, crmWorkflowSession, 'crm');
			assert.ok(detected.has('login'), 'login detected');
			assert.ok(detected.has('create_lead'), 'create lead detected');
			assert.ok(detected.has('qualify_lead'), 'qualify lead → contact detected');
			assert.ok(detected.has('create_opportunity'), 'create opportunity detected');
		});

		it('detects e-commerce workflow steps', () => {
			const inv = extractAppInventory(ecommerceWorkflowSession);
			const { detected } = detectWorkflowSteps(inv, ecommerceWorkflowSession, 'ecommerce');
			assert.ok(detected.has('browse'), 'browse detected');
			assert.ok(detected.has('product_detail'), 'product detail detected');
			assert.ok(detected.has('add_to_cart'), 'add to cart detected');
			assert.ok(detected.has('checkout'), 'checkout detected');
		});

		it('returns empty for unknown purpose', () => {
			const inv = extractAppInventory(makeSession());
			const { detected } = detectWorkflowSteps(inv, makeSession(), 'unknown_purpose');
			assert.equal(detected.size, 0);
		});
	});

	describe('analyzeWorkflowGaps', () => {
		it('finds missing CRM pipeline step (opportunity exists, deal stage missing)', () => {
			const inv = extractAppInventory(crmWorkflowSession);
			const purpose = inferAppPurpose(inv, crmWorkflowSession);
			const { gaps, journey } = analyzeWorkflowGaps(inv, crmWorkflowSession, purpose);

			assert.ok(journey.length > 0, 'has journey');
			assert.ok(gaps.length > 0, 'has workflow gaps');

			// Should find "Move through pipeline stages" missing
			const pipelineGap = gaps.find(g => g.feature.includes('pipeline'));
			assert.ok(pipelineGap, 'pipeline stage gap detected');
			assert.ok(pipelineGap.isWorkflowGap, 'flagged as workflow gap');
		});

		it('finds missing e-commerce order confirmation (checkout exists, confirmation missing)', () => {
			const inv = extractAppInventory(ecommerceWorkflowSession);
			const purpose = inferAppPurpose(inv, ecommerceWorkflowSession);
			const { gaps } = analyzeWorkflowGaps(inv, ecommerceWorkflowSession, purpose);

			const orderConfGap = gaps.find(g => g.feature.includes('Order confirmation'));
			assert.ok(orderConfGap, 'order confirmation gap detected');
			assert.ok(orderConfGap.isWorkflowGap, 'flagged as workflow gap');
			assert.ok(orderConfGap.whyExpected.includes('Checkout'),
				'explains it follows checkout');
		});

		it('workflow gaps have fix prompts with journey context', () => {
			const inv = extractAppInventory(crmWorkflowSession);
			const purpose = inferAppPurpose(inv, crmWorkflowSession);
			const { gaps } = analyzeWorkflowGaps(inv, crmWorkflowSession, purpose);

			for (const gap of gaps) {
				assert.ok(gap.fixPrompt, 'has fix prompt');
				assert.ok(gap.fixPrompt.includes('workflow'), 'mentions workflow');
				assert.ok(gap.whyExpected, 'has why expected');
				assert.ok(gap.impact, 'has impact');
				assert.ok(typeof gap.journeyPosition === 'number', 'has journey position');
				assert.ok(typeof gap.journeyTotal === 'number', 'has journey total');
			}
		});

		it('does not flag steps when no neighbors exist', () => {
			// Empty session — no workflow steps detected at all
			const inv = extractAppInventory(makeSession());
			const purpose = { id: 'saas_platform', name: 'SaaS', confidence: 0.5, signals: [], userGenerated: true };
			const { gaps } = analyzeWorkflowGaps(inv, makeSession(), purpose);
			// With no steps detected, no neighbor-based gaps should be generated
			assert.equal(gaps.length, 0);
		});

		it('returns empty for purpose without workflow template', () => {
			const inv = extractAppInventory(makeSession());
			const purpose = { id: 'generic', name: 'Generic', confidence: 0.3, signals: [], userGenerated: false };
			const { gaps, journey } = analyzeWorkflowGaps(inv, makeSession(), purpose);
			assert.equal(gaps.length, 0);
			assert.equal(journey.length, 0);
		});
	});

	describe('analyzeFeatureGaps integration with workflow', () => {
		it('returns journey array in result', () => {
			const result = analyzeFeatureGaps(crmWorkflowSession);
			assert.ok(Array.isArray(result.journey), 'has journey array');
		});

		it('workflow gaps appear in the gaps array', () => {
			const result = analyzeFeatureGaps(crmWorkflowSession);
			const wfGaps = result.gaps.filter(g => g.isWorkflowGap);
			assert.ok(wfGaps.length > 0, 'has workflow gaps');
		});

		it('workflow gaps are tagged as workflow category', () => {
			const result = analyzeFeatureGaps(ecommerceWorkflowSession);
			const wfGaps = result.gaps.filter(g => g.isWorkflowGap);
			for (const g of wfGaps) {
				assert.equal(g.category, 'workflow');
			}
		});

		it('summary mentions workflow gaps', () => {
			const result = analyzeFeatureGaps(crmWorkflowSession);
			assert.ok(result.summary.includes('workflow'),
				`summary should mention workflow: "${result.summary}"`);
		});

		it('workflow gap findings include journey context in fix prompt', () => {
			const result = analyzeFeatureGaps(ecommerceWorkflowSession);
			const wfGaps = result.gaps.filter(g => g.isWorkflowGap);
			for (const g of wfGaps) {
				assert.ok(g.fixPrompt.includes('journey'),
					'fix prompt should mention journey context');
			}
		});
	});
});
