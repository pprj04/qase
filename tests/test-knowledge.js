import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	writeKnowledge,
	queryKnowledge,
	detectAppMetadata,
	getAllPatterns,
	clearAllPatterns
} from '../server/knowledge.js';

// Clear before each test to ensure isolation
beforeEach(() => clearAllPatterns());

describe('Knowledge Layer: detectAppMetadata', () => {

	it('detects Next.js framework from session data', () => {
		const session = {
			targetUrl: 'https://example.com',
			capturedSteps: [{ url: 'https://example.com/_next/static/chunk.js', target: 'body', label: 'body' }],
			activities: [],
			report: {}
		};
		const meta = detectAppMetadata(session);
		assert.equal(meta.framework, 'next.js');
	});

	it('detects Clerk auth provider', () => {
		const session = {
			targetUrl: 'https://app.clerk.com',
			capturedSteps: [],
			activities: [{ detail: 'Signed in via Clerk', label: 'Auth' }],
			report: {}
		};
		const meta = detectAppMetadata(session);
		assert.equal(meta.authProvider, 'clerk');
	});

	it('detects Vue framework', () => {
		const session = {
			targetUrl: 'https://example.com',
			capturedSteps: [{ url: 'https://example.com', target: '#app', label: '__vue-app' }],
			activities: [],
			report: { summary: 'Built with Vue.js' }
		};
		const meta = detectAppMetadata(session);
		assert.equal(meta.framework, 'vue');
	});

	it('returns empty object for unknown stack', () => {
		const session = {
			targetUrl: 'https://example.com',
			capturedSteps: [],
			activities: [],
			report: {}
		};
		const meta = detectAppMetadata(session);
		assert.deepEqual(meta, {});
	});
});

describe('Knowledge Layer: writeKnowledge', () => {

	it('creates a pattern from a high-severity finding', () => {
		const session = {
			targetUrl: 'https://myapp.com',
			capturedSteps: [{ url: 'https://myapp.com/_next/page', target: '', label: '' }],
			activities: [],
			report: {}
		};
		const findings = [
			{ id: 'f1', severity: 'high', title: 'Login button does not respond on Safari', recommendation: 'Fix event handler' }
		];

		const results = writeKnowledge(findings, session, 'mission-1');
		assert.equal(results.length, 1);
		assert.equal(results[0].action, 'created');
		assert.equal(results[0].pattern.occurrences, 1);
		assert.equal(results[0].pattern.confidence, 0.3);
		assert.equal(results[0].pattern.framework, 'next.js');
	});

	it('skips low-severity findings', () => {
		const findings = [
			{ id: 'f1', severity: 'low', title: 'Minor CSS alignment issue on footer', recommendation: 'Fix CSS' },
			{ id: 'f2', severity: 'info', title: 'Console info message', recommendation: 'Ignore' }
		];
		const session = { targetUrl: 'https://example.com', capturedSteps: [], activities: [], report: {} };

		const results = writeKnowledge(findings, session, 'mission-1');
		assert.equal(results.length, 0);
	});

	it('accumulates occurrences when same pattern is seen again', () => {
		const session = {
			targetUrl: 'https://app.com',
			capturedSteps: [{ url: 'https://app.com/_next/main', target: '', label: '' }],
			activities: [],
			report: {}
		};
		const findings = [
			{ id: 'f1', severity: 'high', title: 'Login button does not respond on Safari', recommendation: 'Fix handler' }
		];

		// First write
		writeKnowledge(findings, session, 'mission-1');
		// Second write (same issue)
		writeKnowledge(findings, session, 'mission-2');
		// Third write (same issue)
		const results = writeKnowledge(findings, session, 'mission-3');

		assert.equal(results.length, 1);
		assert.equal(results[0].action, 'accumulated');
		assert.equal(results[0].pattern.occurrences, 3);
		assert.equal(results[0].pattern.confidence, 0.7); // 3 occurrences → 0.7
	});

	it('skips findings with very short titles', () => {
		const session = { targetUrl: 'https://example.com', capturedSteps: [], activities: [], report: {} };
		const findings = [
			{ id: 'f1', severity: 'critical', title: 'Bug', recommendation: 'Fix' }
		];
		const results = writeKnowledge(findings, session, 'mission-1');
		assert.equal(results.length, 0); // title too short (< 10 chars)
	});
});

describe('Knowledge Layer: queryKnowledge', () => {

	it('matches patterns by framework', () => {
		const session1 = {
			targetUrl: 'https://app.com',
			capturedSteps: [{ url: 'https://app.com/_next/page', target: '', label: '' }],
			activities: [],
			report: {}
		};
		// Write a pattern for next.js
		writeKnowledge(
			[{ id: 'f1', severity: 'high', title: 'Hydration mismatch on page load', recommendation: 'Fix SSR' }],
			session1, 'mission-1'
		);

		// Query for next.js
		const { patterns, hints } = queryKnowledge({ framework: 'next.js' });
		assert.ok(patterns.length >= 1);
		assert.equal(patterns[0].framework, 'next.js');
	});

	it('returns empty for unmatched framework', () => {
		const session = {
			targetUrl: 'https://app.com',
			capturedSteps: [{ url: 'https://app.com/_next/page', target: '', label: '' }],
			activities: [],
			report: {}
		};
		writeKnowledge(
			[{ id: 'f1', severity: 'high', title: 'Some next.js specific issue here', recommendation: 'Fix' }],
			session, 'mission-1'
		);

		const { patterns } = queryKnowledge({ framework: 'vue' });
		assert.equal(patterns.length, 0);
	});

	it('generates capability hints for Clerk auth', () => {
		const session = {
			targetUrl: 'https://app.clerk.com',
			capturedSteps: [],
			activities: [{ detail: 'Signed in via Clerk authentication', label: 'Auth' }],
			report: {}
		};
		writeKnowledge(
			[{ id: 'f1', severity: 'high', title: 'Clerk login timeout on Safari browser', recommendation: 'Upgrade Clerk SDK' }],
			session, 'mission-1'
		);

		const { hints } = queryKnowledge({ authProvider: 'clerk' });
		assert.ok(hints.length >= 1);
		assert.ok(hints.some(h => h.includes('Clerk') || h.includes('auth')), `Expected auth hint, got: ${hints.join('; ')}`);
	});

	it('sorts patterns by confidence then occurrences', () => {
		const session = {
			targetUrl: 'https://app.com',
			capturedSteps: [{ url: 'https://app.com/_next/page', target: '', label: '' }],
			activities: [],
			report: {}
		};

		// Create pattern A and accumulate it 3 times
		const findingA = { id: 'fa', severity: 'high', title: 'Common next.js hydration error on load', recommendation: 'Fix A' };
		writeKnowledge([findingA], session, 'm1');
		writeKnowledge([findingA], session, 'm2');
		writeKnowledge([findingA], session, 'm3');

		// Create pattern B (1 occurrence, lower confidence)
		const findingB = { id: 'fb', severity: 'high', title: 'Rare next.js build error with webpack', recommendation: 'Fix B' };
		writeKnowledge([findingB], session, 'm4');

		const { patterns } = queryKnowledge({ framework: 'next.js' });
		assert.ok(patterns.length >= 2);
		// Higher confidence pattern should be first
		assert.ok(patterns[0].confidence >= patterns[1].confidence);
	});
});

describe('Knowledge Layer: Confidence Model', () => {

	it('confidence increases with occurrences', () => {
		const session = {
			targetUrl: 'https://app.com',
			capturedSteps: [{ url: 'https://app.com/_next/page', target: '', label: '' }],
			activities: [],
			report: {}
		};
		const finding = { id: 'f1', severity: 'high', title: 'Consistent next.js build failure with timeout', recommendation: 'Fix' };

		// 1st occurrence
		let r = writeKnowledge([finding], session, 'm1');
		assert.equal(r[0].pattern.confidence, 0.3);

		// 2nd occurrence
		r = writeKnowledge([finding], session, 'm2');
		assert.equal(r[0].pattern.confidence, 0.5);

		// 3rd
		r = writeKnowledge([finding], session, 'm3');
		assert.equal(r[0].pattern.confidence, 0.7);

		// 4th and 5th
		writeKnowledge([finding], session, 'm4');
		r = writeKnowledge([finding], session, 'm5');
		assert.equal(r[0].pattern.confidence, 0.85);
	});
});

describe('Knowledge Layer: appType matching', () => {

	it('matches patterns by appType in queryKnowledge', () => {
		const session = {
			targetUrl: 'https://shop.com',
			capturedSteps: [{ url: 'https://shop.com', target: '', label: '' }],
			activities: [{ detail: 'Shopping cart total calculation failed', label: '' }],
			report: { summary: 'e-commerce checkout cart payment' }
		};
		// Write a pattern (detectAppMetadata will extract framework/auth/appType from session text)
		const finding = { id: 'f1', severity: 'high', title: 'Cart total miscalculated during checkout', recommendation: 'Fix cart math' };
		writeKnowledge([finding], session, 'm1');

		// Query by appType — the pattern should match since session text has ecommerce keywords
		const { patterns } = queryKnowledge({ appType: 'ecommerce' });
		assert.ok(patterns.length >= 1, `Expected at least 1 pattern matched by appType=ecommerce, got ${patterns.length}`);
	});

	it('detects appType from session metadata', () => {
		const ecommerceSession = {
			targetUrl: 'https://shop.com',
			capturedSteps: [{ url: 'https://shop.com/products', target: '', label: 'Add to cart' }],
			activities: [],
			report: { summary: 'product catalog with shopping cart' }
		};
		const meta = detectAppMetadata(ecommerceSession);
		assert.equal(meta.appType, 'ecommerce');
	});

	it('detects dashboard appType', () => {
		const dashboardSession = {
			targetUrl: 'https://analytics.app.com',
			capturedSteps: [{ url: 'https://analytics.app.com', target: '', label: '' }],
			activities: [{ detail: 'Dashboard charts loaded', label: '' }],
			report: { summary: 'analytics dashboard with charts and metrics' }
		};
		const meta = detectAppMetadata(dashboardSession);
		assert.equal(meta.appType, 'dashboard');
	});
});
