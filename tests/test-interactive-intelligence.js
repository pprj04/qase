/**
 * B2: Interactive Intelligence — unit tests
 *
 * Verifies that extractInteractiveSignals() correctly extracts behavioral
 * evidence from captured step outcomes, and that purpose detection weights
 * verified signals higher than passive metadata.
 *
 * Run: node --test tests/test-interactive-intelligence.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractAppInventory, inferAppPurpose } from '../server/featureGap.js';

function makeStep(action, opts = {}) {
	return {
		id: `step-${Math.random().toString(36).slice(2, 8)}`,
		ts: Date.now(),
		toolCallId: opts.toolCallId || `tc-${Math.random().toString(36).slice(2, 8)}`,
		action,
		target: opts.target || '',
		label: opts.label || '',
		value: opts.value || '',
		url: opts.url || 'https://app.com',
		outcome: opts.outcome || { status: 'success' }
	};
}

describe('B2: extractInteractiveSignals — basic counts', () => {

	it('returns zeros for empty steps', () => {
		const session = { capturedSteps: [], activities: [], findings: [], report: {} };
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.totalActions, 0);
		assert.equal(inv.interactions.successfulActions, 0);
		assert.equal(inv.interactions.failedActions, 0);
		assert.equal(inv.interactions.successRate, 0);
	});

	it('steps with pending outcomes are not counted', () => {
		const session = {
			capturedSteps: [
				makeStep('click', { outcome: { status: 'pending' } }),
				makeStep('fill', { outcome: { status: 'pending' } }),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.totalActions, 0);
	});

	it('counts successes and failures correctly', () => {
		const session = {
			capturedSteps: [
				makeStep('click', { outcome: { status: 'success' } }),
				makeStep('fill', { outcome: { status: 'success' } }),
				makeStep('click', { outcome: { status: 'failed', error: 'not found' } }),
				makeStep('click', { outcome: { status: 'pending' } }), // excluded
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.totalActions, 3);
		assert.equal(inv.interactions.successfulActions, 2);
		assert.equal(inv.interactions.failedActions, 1);
		assert.equal(inv.interactions.errorsEncountered, 1);
		assert.ok(Math.abs(inv.interactions.successRate - 0.667) < 0.01);
	});
});

describe('B2: Auth flow verification', () => {

	it('detects successful login: fill password → click submit → URL changes', () => {
		const session = {
			capturedSteps: [
				makeStep('fill', {
					url: 'https://app.com/login',
					target: '#password',
					label: 'password',
					outcome: { status: 'success' }
				}),
				makeStep('click', {
					url: 'https://app.com/login',
					target: '#submit',
					label: 'submit',
					outcome: { status: 'success', urlAfter: 'https://app.com/dashboard' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.verifiedAuth.loginAttempted, true);
		assert.equal(inv.interactions.verifiedAuth.loginSucceeded, true);
	});

	it('detects failed login: fill password → click submit → URL stays on login', () => {
		const session = {
			capturedSteps: [
				makeStep('fill', {
					url: 'https://app.com/login',
					target: '#password',
					label: 'password',
					outcome: { status: 'success' }
				}),
				makeStep('click', {
					url: 'https://app.com/login',
					target: '#submit',
					label: 'submit',
					outcome: { status: 'success', urlAfter: 'https://app.com/login?error=1' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.verifiedAuth.loginAttempted, true);
		assert.equal(inv.interactions.verifiedAuth.loginSucceeded, false);
	});

	it('detects failed login: submit fails', () => {
		const session = {
			capturedSteps: [
				makeStep('click', {
					url: 'https://app.com/signin',
					target: 'button[type="submit"]',
					label: 'Sign in',
					outcome: { status: 'failed', error: 'Invalid credentials' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.verifiedAuth.loginAttempted, true);
		assert.equal(inv.interactions.verifiedAuth.loginSucceeded, false);
		assert.equal(inv.interactions.brokenFeatures.auth, true);
	});

	it('detects successful registration', () => {
		const session = {
			capturedSteps: [
				makeStep('fill', {
					url: 'https://app.com/register',
					target: '#email',
					label: 'email',
					outcome: { status: 'success' }
				}),
				makeStep('click', {
					url: 'https://app.com/register',
					target: '#signup-btn',
					label: 'Sign up',
					outcome: { status: 'success', urlAfter: 'https://app.com/welcome' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.verifiedAuth.registerAttempted, true);
		assert.equal(inv.interactions.verifiedAuth.registerSucceeded, true);
	});
});

describe('B2: Feature verification', () => {

	it('detects successful search', () => {
		const session = {
			capturedSteps: [
				makeStep('type', {
					target: '#search-box',
					label: 'search query',
					value: 'search query for products',
					outcome: { status: 'success' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.verifiedFeatures.search, true);
	});

	it('detects failed search', () => {
		const session = {
			capturedSteps: [
				makeStep('click', {
					target: '#search-button',
					label: 'Find',
					outcome: { status: 'failed', error: 'No results' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.brokenFeatures.search, true);
	});

	it('detects successful payment flow', () => {
		const session = {
			capturedSteps: [
				makeStep('click', {
					url: 'https://shop.com/checkout',
					target: '#place-order',
					label: 'Place order',
					outcome: { status: 'success', urlAfter: 'https://shop.com/confirmation' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.verifiedFeatures.payment, true);
	});

	it('detects failed payment', () => {
		const session = {
			capturedSteps: [
				makeStep('click', {
					url: 'https://shop.com/cart',
					target: '#checkout',
					label: 'Checkout',
					outcome: { status: 'failed', error: 'Payment declined' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.brokenFeatures.payment, true);
	});

	it('detects form submission success', () => {
		const session = {
			capturedSteps: [
				makeStep('fill', {
					target: '#name',
					label: 'name',
					outcome: { status: 'success' }
				}),
				makeStep('click', {
					target: '#save-btn',
					label: 'Save',
					outcome: { status: 'success' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.verifiedFeatures.formSubmission, true);
	});
});

describe('B2: Page transitions', () => {

	it('captures page transitions from URL changes', () => {
		const session = {
			capturedSteps: [
				makeStep('click', {
					url: 'https://app.com/home',
					target: '#nav-dashboard',
					outcome: { status: 'success', urlAfter: 'https://app.com/dashboard' }
				}),
				makeStep('click', {
					url: 'https://app.com/dashboard',
					target: '#nav-settings',
					outcome: { status: 'success', urlAfter: 'https://app.com/settings' }
				}),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.pageTransitions.length, 2);
		assert.equal(inv.interactions.pageTransitions[0].from, 'https://app.com/home');
		assert.equal(inv.interactions.pageTransitions[0].to, 'https://app.com/dashboard');
	});
});

describe('B2: Dialog interactions', () => {

	it('counts dialog appearances', () => {
		const session = {
			capturedSteps: [
				makeStep('click', { outcome: { status: 'success', dialogAppeared: true } }),
				makeStep('click', { outcome: { status: 'success', dialogAppeared: false } }),
				makeStep('click', { outcome: { status: 'success', dialogAppeared: true } }),
			],
			activities: [], findings: [], report: {}
		};
		const inv = extractAppInventory(session);
		assert.equal(inv.interactions.dialogInteractions, 2);
	});
});

describe('B2: Purpose detection with verified signals', () => {

	it('weights verified login + dashboard as strong SaaS signal', () => {
		// A session where the agent verified login worked and reached dashboard
		// with enough exploration for reasonable confidence
		const steps = [
			// Login flow
			makeStep('fill', {
				url: 'https://app.com/login',
				target: '#password',
				label: 'password',
				outcome: { status: 'success' }
			}),
			makeStep('click', {
				url: 'https://app.com/login',
				target: '#submit',
				label: 'Sign in',
				outcome: { status: 'success', urlAfter: 'https://app.com/dashboard' }
			}),
		];
		// Add more exploration steps to boost explorationConfidence (need 15+ steps/pages for 1.0)
		const pages = ['dashboard', 'projects', 'team', 'settings', 'workspace', 'reports', 'analytics', 'billing', 'profile', 'notifications', 'messages', 'calendar', 'tasks', 'integrations', 'api-keys'];
		for (const page of pages) {
			steps.push(makeStep('navigate', {
				url: `https://app.com/${page}`,
				target: `#nav-${page}`,
				outcome: { status: 'success', urlAfter: `https://app.com/${page}` }
			}));
		}

		const session = {
			capturedSteps: steps,
			activities: [
				{ detail: 'Navigated to dashboard workspace', summary: '' },
				{ detail: 'Viewed project list', summary: '' },
			],
			findings: [],
			report: { summary: 'SaaS platform with workspace and project management' }
		};
		const inv = extractAppInventory(session);
		const purpose = inferAppPurpose(inv, null, session);

		// With verified login → dashboard, saas_platform or admin_dashboard should rank high
		assert.ok(
			['saas_platform', 'admin_dashboard'].includes(purpose.id),
			`Expected saas_platform or admin_dashboard, got ${purpose.id}`
		);
		// Verified login should give strong confidence (explorationConfidence should be high with 17 steps)
		assert.ok(purpose.confidence > 0.5, `Expected confidence > 0.5, got ${purpose.confidence} (explorationConfidence: ${inv.explorationConfidence})`);
	});

	it('verified payment flow boosts ecommerce signal', () => {
		const session = {
			capturedSteps: [
				makeStep('click', {
					url: 'https://shop.com/checkout',
					target: '#place-order',
					label: 'Place order',
					outcome: { status: 'success', urlAfter: 'https://shop.com/order-confirmed' }
				}),
			],
			activities: [
				{ detail: 'Viewed product catalog', summary: '' },
				{ detail: 'Added item to cart', summary: '' },
				{ detail: 'Proceeded to checkout and paid', summary: '' },
			],
			findings: [],
			report: { summary: 'Online store with shopping cart and checkout' }
		};
		const inv = extractAppInventory(session);
		const purpose = inferAppPurpose(inv, null, session);
		assert.equal(purpose.id, 'ecommerce');
	});
});
