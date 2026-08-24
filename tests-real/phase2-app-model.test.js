/**
 * Phase 2 Unit Tests — Application Model
 *
 * Tests the structured Application Model schema, validation, confidence,
 * evidence tracking, and serialization/deserialization.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	createAppModel, validateAppModel, makeConfidence, addEvidence,
	addUnknown, addConflict, determineStatus, summarizeAppModel,
	serializeAppModel, deserializeAppModel,
} from '../server/appModel.js';

describe('Application Model: Creation & Validation', () => {

	it('creates a valid empty model with all required fields', () => {
		const model = createAppModel({ missionId: 'm1', targetUrl: 'https://example.com' });
		const issues = validateAppModel(model);
		assert.equal(issues.length, 0, `Validation issues: ${issues.join(', ')}`);

		assert.equal(model.missionId, 'm1');
		assert.equal(model.targetUrl, 'https://example.com');
		assert.equal(model.status, 'discovered');
		assert.ok(model.intent);
		assert.ok(model.observed);
		assert.ok(model.understanding);
		assert.ok(Array.isArray(model.unknowns));
		assert.ok(Array.isArray(model.conflicts));
		assert.ok(model.confidence);
		assert.ok(Array.isArray(model.evidence));
	});

	it('creates model without missionId/targetUrl', () => {
		const model = createAppModel();
		assert.equal(model.missionId, null);
		assert.equal(model.targetUrl, null);
		assert.equal(validateAppModel(model).length, 0);
	});

	it('validates confidence values are 0-1 with basis arrays', () => {
		const model = createAppModel();
		model.confidence.purpose = makeConfidence(0.8, ['reason 1', 'reason 2']);
		model.confidence.features = makeConfidence(0.5, ['feature basis']);
		const issues = validateAppModel(model);
		assert.equal(issues.length, 0);

		assert.equal(model.confidence.purpose.value, 0.8);
		assert.deepEqual(model.confidence.purpose.basis, ['reason 1', 'reason 2']);
	});

	it('makeConfidence clamps values to 0-1', () => {
		assert.equal(makeConfidence(-0.5).value, 0);
		assert.equal(makeConfidence(1.5).value, 1);
		assert.equal(makeConfidence(0.65).value, 0.65);
	});

	it('makeConfidence rounds to 2 decimal places', () => {
		const conf = makeConfidence(0.837123);
		assert.equal(conf.value, 0.84);
	});

	it('makeConfidence filters falsy basis entries', () => {
		const conf = makeConfidence(0.5, ['real reason', '', null, 'another']);
		assert.deepEqual(conf.basis, ['real reason', 'another']);
	});

	it('rejects invalid status', () => {
		const model = createAppModel();
		model.status = 'invalid_status';
		const issues = validateAppModel(model);
		assert.ok(issues.some(i => i.includes('Invalid status')));
	});

	it('detects missing top-level fields', () => {
		const issues = validateAppModel({ not: 'valid' });
		assert.ok(issues.length > 5);
		assert.ok(issues.some(i => i.includes('Missing top-level field')));
	});
});

describe('Application Model: Evidence', () => {

	it('adds evidence with unique ids', () => {
		const model = createAppModel({ missionId: 'm1' });
		const id1 = addEvidence(model, 'mission_context', 'intent', 'Build prompt: CRM app');
		const id2 = addEvidence(model, 'static', 'observation', 'Page: /login');
		assert.notEqual(id1, id2);
		assert.equal(model.evidence.length, 2);
		assert.equal(model.evidence[0].source, 'mission_context');
		assert.equal(model.evidence[0].type, 'intent');
	});

	it('caps evidence description length', () => {
		const model = createAppModel();
		const longDesc = 'A'.repeat(1000);
		addEvidence(model, 'static', 'observation', longDesc);
		assert.equal(model.evidence[0].description.length, 500);
	});

	it('evidence entries have required fields', () => {
		const model = createAppModel();
		addEvidence(model, 'interactive', 'observation', 'Login verified');
		const issues = validateAppModel(model);
		assert.equal(issues.length, 0);
	});
});

describe('Application Model: Unknowns & Conflicts', () => {

	it('adds unknowns with category and reason', () => {
		const model = createAppModel();
		addUnknown(model, 'Payment flow not accessible', 'feature', 'Checkout requires login', true);
		assert.equal(model.unknowns.length, 1);
		assert.equal(model.unknowns[0].category, 'feature');
		assert.equal(model.unknowns[0].blocking, true);
	});

	it('adds conflicts with expected vs observed', () => {
		const model = createAppModel();
		addConflict(model,
			'Context says ecommerce but site looks like marketing',
			'ecommerce', 'marketing',
			['mission_context', 'heuristic'],
			'Purpose ambiguity', 0.7);
		assert.equal(model.conflicts.length, 1);
		assert.equal(model.conflicts[0].expectedValue, 'ecommerce');
		assert.equal(model.conflicts[0].observedValue, 'marketing');
		assert.equal(model.conflicts[0].confidence, 0.7);
	});

	it('conflict confidence is clamped 0-1', () => {
		const model = createAppModel();
		addConflict(model, 'test', 'a', 'b', [], 'test', 1.5);
		assert.equal(model.conflicts[0].confidence, 1);
	});
});

describe('Application Model: Status Determination', () => {

	it('returns understood when high confidence + purpose + evidence', () => {
		const model = createAppModel({ missionId: 'm1' });
		model.confidence.overall = makeConfidence(0.85, ['high']);
		model.understanding.purpose = { id: 'crm', name: 'CRM' };
		for (let i = 0; i < 6; i++) {
			addEvidence(model, 'static', 'observation', `evidence ${i}`);
		}
		assert.equal(determineStatus(model), 'understood');
	});

	it('returns partially_understood when moderate evidence', () => {
		const model = createAppModel({ missionId: 'm1' });
		model.confidence.overall = makeConfidence(0.5);
		model.understanding.purpose = { id: 'saas', name: 'SaaS' };
		for (let i = 0; i < 4; i++) {
			addEvidence(model, 'static', 'observation', `ev ${i}`);
		}
		assert.equal(determineStatus(model), 'partially_understood');
	});

	it('returns uncertain when insufficient evidence', () => {
		const model = createAppModel({ missionId: 'm1' });
		model.confidence.overall = makeConfidence(0.1);
		assert.equal(determineStatus(model), 'uncertain');
	});
});

describe('Application Model: Serialization', () => {

	it('serializes and deserializes without loss', () => {
		const model = createAppModel({ missionId: 'm1', targetUrl: 'https://app.com' });
		model.status = 'understood';
		model.understanding.purpose = { id: 'crm', name: 'CRM', source: 'merged' };
		model.confidence.overall = makeConfidence(0.85, ['high confidence']);
		addEvidence(model, 'static', 'observation', 'Test evidence');
		addUnknown(model, 'Unknown thing', 'feature', 'reason');

		const serialized = serializeAppModel(model);
		const json = JSON.stringify(serialized);
		const restored = deserializeAppModel(JSON.parse(json));

		assert.equal(restored.missionId, 'm1');
		assert.equal(restored.targetUrl, 'https://app.com');
		assert.equal(restored.status, 'understood');
		assert.equal(restored.understanding.purpose.id, 'crm');
		assert.equal(restored.confidence.overall.value, 0.85);
		assert.equal(restored.evidence.length, 1);
		assert.equal(restored.unknowns.length, 1);
	});

	it('deserializes invalid input gracefully', () => {
		const restored = deserializeAppModel(null);
		assert.equal(restored.status, 'discovered');

		const restored2 = deserializeAppModel({ missionId: 'x' });
		assert.equal(restored2.missionId, 'x');
	});
});

describe('Application Model: Summary', () => {

	it('summarizeAppModel produces expected output shape', () => {
		const model = createAppModel({ missionId: 'm1' });
		model.understanding.purpose = { id: 'crm', name: 'CRM', source: 'merged' };
		model.confidence.purpose = makeConfidence(0.8, ['high']);
		model.confidence.overall = makeConfidence(0.7, ['overall']);
		model.understanding.features.expected = [
			{ name: 'Contacts', source: 'context' },
			{ name: 'Deals', source: 'context' },
		];
		model.understanding.features.observed = [{ name: 'Contacts', source: 'static' }];
		model.understanding.features.verified = [{ name: 'Contacts', evidenceRef: 'ev1' }];
		model.understanding.workflows = [{
			name: 'CRM workflow',
			expectedSteps: [
				{ id: 's1', name: 'Login', status: 'verified' },
				{ id: 's2', name: 'Contacts', status: 'observed' },
				{ id: 's3', name: 'Pipeline', status: 'not_found' },
			],
			confidence: 0.6,
		}];
		addUnknown(model, 'Pipeline not accessible', 'feature', 'no creds');
		addConflict(model, 'test conflict', 'a', 'b', [], 'test', 0.5);

		const summary = summarizeAppModel(model);

		assert.equal(summary.status, 'discovered');
		assert.equal(summary.purpose.id, 'crm');
		assert.equal(summary.purpose.confidence, 0.8);
		assert.equal(summary.features.expectedCount, 2);
		assert.equal(summary.features.observedCount, 1);
		assert.equal(summary.features.verifiedCount, 1);
		assert.equal(summary.workflows.length, 1);
		assert.equal(summary.workflows[0].stepsTotal, 3);
		assert.equal(summary.workflows[0].stepsObserved, 2); // verified + observed
		assert.equal(summary.unknowns.length, 1);
		assert.equal(summary.conflicts.length, 1);
		assert.ok(summary.confidence.overall !== undefined);
	});
});
