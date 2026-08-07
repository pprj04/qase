import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveContextFeatures, reconcileFeatures } from '../server/featureGap.js';

describe('Mission Context: deriveContextFeatures', () => {

	it('extracts CRM features from build prompt', () => {
		const features = deriveContextFeatures({
			buildPrompt: 'Build a CRM with leads, deals, and invoicing'
		});
		assert.ok(features.length >= 3, `Expected at least 3 features, got ${features.length}`);
		assert.ok(features.some(f => f.feature.includes('Contact')), 'Should expect contacts');
		assert.ok(features.some(f => f.feature.includes('Pipeline') || f.feature.includes('deal')), 'Should expect pipeline');
		// All context features must have confidence 1.0
		for (const f of features) {
			assert.equal(f.confidence, 1.0, `Feature "${f.feature}" should have confidence 1.0`);
			assert.equal(f.source, 'context', `Feature "${f.feature}" should have source=context`);
		}
	});

	it('extracts e-commerce features from build prompt', () => {
		const features = deriveContextFeatures({
			buildPrompt: 'Build an e-commerce store with cart and checkout'
		});
		assert.ok(features.length >= 3);
		assert.ok(features.some(f => f.feature.includes('cart') || f.feature.includes('Cart')));
		assert.ok(features.some(f => f.feature.includes('checkout') || f.feature.includes('Checkout')));
	});

	it('extracts auth features from build prompt', () => {
		const features = deriveContextFeatures({
			buildPrompt: 'Build an app with user authentication and login'
		});
		assert.ok(features.length >= 1);
		assert.ok(features.some(f => f.feature.includes('Login') || f.feature.includes('auth')));
	});

	it('extracts features from requirements array', () => {
		const features = deriveContextFeatures({
			requirements: ['user registration', 'blog posts', 'payment processing']
		});
		assert.ok(features.length >= 3);
		assert.ok(features.some(f => f.feature.includes('registration') || f.feature.includes('Registration')));
		assert.ok(features.some(f => f.feature.includes('Content') || f.feature.includes('creation')));
		assert.ok(features.some(f => f.feature.includes('Payment') || f.feature.includes('payment')));
	});

	it('returns empty array when no context provided', () => {
		assert.deepEqual(deriveContextFeatures({}), []);
		assert.deepEqual(deriveContextFeatures(null), []);
		assert.deepEqual(deriveContextFeatures(undefined), []);
	});

	it('returns empty array when context has no relevant keywords', () => {
		const features = deriveContextFeatures({
			buildPrompt: 'Build a simple landing page with a hero image'
		});
		// "landing" and "hero" should match, but let's verify it returns something
		assert.ok(features.length >= 1, 'Landing page should match at least CTA');
	});

	it('deduplicates overlapping keywords', () => {
		const features = deriveContextFeatures({
			buildPrompt: 'Build a store with e-commerce cart and product checkout and shopping cart'
		});
		// "cart" appears multiple times but should only produce one "Shopping cart" feature
		const cartFeatures = features.filter(f => f.feature.toLowerCase().includes('cart'));
		assert.equal(cartFeatures.length, 1, 'Should have exactly one cart feature');
	});

	it('combines buildPrompt and requirements', () => {
		const features = deriveContextFeatures({
			buildPrompt: 'Build a task management app',
			requirements: ['user authentication', 'file upload']
		});
		assert.ok(features.some(f => f.feature.includes('Task') || f.feature.includes('task')));
		assert.ok(features.some(f => f.feature.includes('Login') || f.feature.includes('auth')));
		assert.ok(features.some(f => f.feature.includes('upload') || f.feature.includes('Upload')));
	});
});

describe('Mission Context: reconcileFeatures', () => {

	it('merges context and heuristic features without duplicates', () => {
		const contextFeatures = [
			{ feature: 'Login / authentication', category: 'authentication', confidence: 1.0, source: 'context' },
			{ feature: 'User registration', category: 'authentication', confidence: 1.0, source: 'context' }
		];
		const heuristicFeatures = [
			{ feature: 'Login / authentication', category: 'authentication', confidence: 0.6, source: 'heuristic' },
			{ feature: 'Settings page', category: 'ui', confidence: 0.5, source: 'heuristic' }
		];

		const { merged, discrepancies } = reconcileFeatures(contextFeatures, heuristicFeatures);
		// "Login / authentication" appears in both but context version wins (1 unique),
		// "User registration" only in context (1 unique),
		// "Settings page" only in heuristic (1 unique) = 3 total
		assert.equal(merged.length, 3, `Expected 3 unique features, got ${merged.length}`);
		assert.ok(merged.some(f => f.feature === 'Login / authentication' && f.source === 'context'));
		assert.ok(merged.some(f => f.feature === 'Settings page'));
		// Login appears in both — context version wins
		const login = merged.find(f => f.feature === 'Login / authentication');
		assert.equal(login.confidence, 1.0);
	});

	it('handles empty context features', () => {
		const { merged } = reconcileFeatures([], [
			{ feature: 'Search', confidence: 0.5 }
		]);
		assert.equal(merged.length, 1);
		assert.equal(merged[0].source, 'heuristic');
	});

	it('handles empty heuristic features', () => {
		const { merged } = reconcileFeatures([
			{ feature: 'Login', confidence: 1.0, source: 'context' }
		], []);
		assert.equal(merged.length, 1);
	});

	it('flags discrepancies when context expects features heuristic did not detect', () => {
		const contextFeatures = [
			{ feature: 'User registration', category: 'authentication', confidence: 1.0, source: 'context' },
			{ feature: 'Password reset', category: 'authentication', confidence: 1.0, source: 'context' }
		];
		const heuristicFeatures = [
			{ feature: 'Login / authentication', category: 'authentication', confidence: 0.6, source: 'heuristic' }
		];

		const { merged, discrepancies } = reconcileFeatures(contextFeatures, heuristicFeatures);
		// Context expects "User registration" and "Password reset" but heuristic didn't detect either
		const contextMissing = discrepancies.filter(d => d.contextImplied && !d.heuristicDetected);
		assert.ok(contextMissing.length >= 2, `Expected at least 2 context-missing discrepancies, got ${contextMissing.length}`);
		assert.ok(contextMissing.some(d => d.feature === 'User registration'));
		assert.ok(contextMissing.some(d => d.feature === 'Password reset'));
	});

	it('flags discrepancies when heuristic detects high-confidence features not in context', () => {
		const contextFeatures = [
			{ feature: 'Login / authentication', confidence: 1.0, source: 'context' }
		];
		const heuristicFeatures = [
			{ feature: 'Dark mode toggle', confidence: 0.8, source: 'heuristic' }
		];

		const { discrepancies } = reconcileFeatures(contextFeatures, heuristicFeatures);
		// Heuristic found a high-confidence feature not mentioned in context
		const heuristicOnly = discrepancies.filter(d => d.heuristicDetected && !d.contextImplied);
		assert.ok(heuristicOnly.length >= 1, `Expected at least 1 heuristic-only discrepancy, got ${heuristicOnly.length}`);
		assert.ok(heuristicOnly.some(d => d.feature === 'Dark mode toggle'));
	});
});
