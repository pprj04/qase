/**
 * C1: Capability Registry + Orchestrator — unit tests
 *
 * Verifies that the registry can register capabilities, the orchestrator
 * can plan execution order via topological sort, and capabilities execute
 * correctly with dependency resolution and evidence collection.
 *
 * Run: node --test tests/test-capability-registry.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry, Orchestrator, createDefaultRegistry } from '../server/capabilities.js';

describe('C1: CapabilityRegistry', () => {

	it('registers and lists capabilities', () => {
		const reg = new CapabilityRegistry();
		reg.register({ id: 'cap_a', name: 'Capability A', dependsOn: [], execute: async () => ({}) });
		reg.register({ id: 'cap_b', name: 'Capability B', dependsOn: [], execute: async () => ({}) });
		assert.equal(reg.list().length, 2);
		assert.ok(reg.has('cap_a'));
		assert.ok(reg.has('cap_b'));
		assert.ok(!reg.has('cap_c'));
	});

	it('rejects duplicate capability ids', () => {
		const reg = new CapabilityRegistry();
		reg.register({ id: 'cap_a', name: 'A', dependsOn: [], execute: async () => ({}) });
		assert.throws(() => {
			reg.register({ id: 'cap_a', name: 'A2', dependsOn: [], execute: async () => ({}) });
		}, /already registered/);
	});

	it('retrieves a capability by id', () => {
		const reg = new CapabilityRegistry();
		reg.register({ id: 'cap_x', name: 'X', dependsOn: [], enabled: () => true, execute: async () => ({}) });
		const cap = reg.get('cap_x');
		assert.equal(cap.name, 'X');
		assert.equal(reg.get('nonexistent'), undefined);
	});
});

describe('C1: Orchestrator — planning', () => {

	it('plans correct order based on dependencies', () => {
		const reg = new CapabilityRegistry();
		reg.register({ id: 'a', name: 'A', dependsOn: [], execute: async () => ({}) });
		reg.register({ id: 'c', name: 'C', dependsOn: ['a', 'b'], execute: async () => ({}) });
		reg.register({ id: 'b', name: 'B', dependsOn: ['a'], execute: async () => ({}) });
		const orch = new Orchestrator(reg);
		const plan = orch.plan(['a', 'b', 'c']);
		const ids = plan.map(c => c.id);
		// A must come before B, B must come before C
		assert.equal(ids[0], 'a');
		assert.equal(ids[1], 'b');
		assert.equal(ids[2], 'c');
	});

	it('plans capabilities with no dependencies in any order', () => {
		const reg = new CapabilityRegistry();
		reg.register({ id: 'x', name: 'X', dependsOn: [], execute: async () => ({}) });
		reg.register({ id: 'y', name: 'Y', dependsOn: [], execute: async () => ({}) });
		const orch = new Orchestrator(reg);
		const plan = orch.plan(['x', 'y']);
		assert.equal(plan.length, 2);
	});

	it('excludes unavailable capabilities from plan', () => {
		const reg = new CapabilityRegistry();
		reg.register({ id: 'a', name: 'A', dependsOn: [], execute: async () => ({}) });
		reg.register({ id: 'b', name: 'B', dependsOn: ['a'], execute: async () => ({}) });
		reg.register({ id: 'c', name: 'C', dependsOn: ['a'], execute: async () => ({}) });
		const orch = new Orchestrator(reg);
		// Only 'a' and 'b' available, not 'c'
		const plan = orch.plan(['a', 'b']);
		const ids = plan.map(c => c.id);
		assert.ok(ids.includes('a'));
		assert.ok(ids.includes('b'));
		assert.ok(!ids.includes('c'));
	});
});

describe('C1: Orchestrator — execution', () => {

	it('executes capabilities and collects evidence', async () => {
		const reg = new CapabilityRegistry();
		reg.register({
			id: 'producer',
			name: 'Producer',
			dependsOn: [],
			enabled: () => true,
			producesEvidence: ['widget'],
			execute: async () => ({ widget: { id: 'w1' } })
		});
		reg.register({
			id: 'consumer',
			name: 'Consumer',
			dependsOn: ['producer'],
			requiredEvidence: ['widget'],
			enabled: () => true,
			producesEvidence: ['result'],
			execute: async (session, evidence) => {
				assert.ok(evidence.widget, 'Should have widget evidence from producer');
				return { result: `processed-${evidence.widget.id}` };
			}
		});

		const orch = new Orchestrator(reg);
		const session = { id: 'test' };
		const { results, evidence } = await orch.execute(session, {});

		assert.equal(results.producer.status, 'done');
		assert.equal(results.consumer.status, 'done');
		assert.equal(evidence.widget.id, 'w1');
		assert.equal(evidence.result, 'processed-w1');
	});

	it('skips capabilities when dependency produced no evidence', async () => {
		const reg = new CapabilityRegistry();
		reg.register({
			id: 'producer',
			name: 'Producer',
			dependsOn: [],
			enabled: () => true,
			producesEvidence: ['widget'],
			execute: async () => ({ widget: null }) // produces nothing
		});
		reg.register({
			id: 'consumer',
			name: 'Consumer',
			dependsOn: ['producer'],
			requiredEvidence: ['widget'],
			enabled: () => true,
			execute: async () => ({ result: 'should not reach' })
		});

		const orch = new Orchestrator(reg);
		const session = { id: 'test' };
		const { results } = await orch.execute(session, {});

		assert.equal(results.producer.status, 'done');
		assert.equal(results.consumer.status, 'skipped');
		assert.ok(results.consumer.reason?.includes('missing_evidence'));
	});

	it('skips disabled capabilities', async () => {
		const reg = new CapabilityRegistry();
		reg.register({
			id: 'always',
			name: 'Always',
			dependsOn: [],
			enabled: () => true,
			execute: async () => ({ data: 'yes' })
		});
		reg.register({
			id: 'sometimes',
			name: 'Sometimes',
			dependsOn: [],
			enabled: (config) => config.enableSometimes === true,
			execute: async () => ({ extra: 'data' })
		});

		const orch = new Orchestrator(reg);
		const session = { id: 'test' };
		const { results } = await orch.execute(session, { enableSometimes: false });

		assert.equal(results.always.status, 'done');
		// 'sometimes' is disabled — not in results at all (only enabled caps get executed)
		assert.equal(results.sometimes.status, 'pending');
	});

	it('failed capability marks downstream as skipped', async () => {
		const reg = new CapabilityRegistry();
		reg.register({
			id: 'a',
			name: 'A',
			dependsOn: [],
			enabled: () => true,
			producesEvidence: ['dataA'],
			execute: async () => { throw new Error('A failed'); }
		});
		reg.register({
			id: 'b',
			name: 'B',
			dependsOn: ['a'],
			enabled: () => true,
			execute: async () => ({ dataB: 'should not reach' })
		});
		reg.register({
			id: 'c',
			name: 'C',
			dependsOn: ['b'],
			enabled: () => true,
			execute: async () => ({ dataC: 'should not reach' })
		});

		const orch = new Orchestrator(reg);
		const session = { id: 'test' };
		const { results } = await orch.execute(session, {});

		assert.equal(results.a.status, 'failed');
		assert.equal(results.a.error, 'A failed');
		assert.equal(results.b.status, 'skipped');
		assert.equal(results.b.reason, 'dependency_failed');
		// c depends on b which was skipped — c should also be skipped (transitive)
		assert.equal(results.c.status, 'skipped');
	});

	it('independent capabilities both run even if one fails', async () => {
		const reg = new CapabilityRegistry();
		reg.register({
			id: 'a',
			name: 'A',
			dependsOn: [],
			enabled: () => true,
			producesEvidence: [],
			execute: async () => { throw new Error('A failed'); }
		});
		reg.register({
			id: 'b',
			name: 'B',
			dependsOn: [],
			enabled: () => true,
			producesEvidence: ['dataB'],
			execute: async () => ({ dataB: 'success' })
		});

		const orch = new Orchestrator(reg);
		const session = { id: 'test' };
		const { results, evidence } = await orch.execute(session, {});

		assert.equal(results.a.status, 'failed');
		assert.equal(results.b.status, 'done');
		assert.equal(evidence.dataB, 'success');
	});
});

describe('C1: Default Registry — pipeline stages', () => {

	it('registers all 8 pipeline stages', () => {
		const reg = createDefaultRegistry();
		const caps = reg.list();
		assert.equal(caps.length, 8);

		const ids = caps.map(c => c.id).sort();
		assert.ok(ids.includes('workflow_save'));
		assert.ok(ids.includes('test_generation'));
		assert.ok(ids.includes('smoke_run'));
		assert.ok(ids.includes('schedule_create'));
		assert.ok(ids.includes('dev_intelligence'));
		assert.ok(ids.includes('feature_gap'));
		assert.ok(ids.includes('mission_finalize'));
		assert.ok(ids.includes('knowledge_write'));
	});

	it('dependency chain: knowledge_write depends on mission_finalize depends on feature_gap', () => {
		const reg = createDefaultRegistry();
		assert.deepEqual(reg.get('knowledge_write').dependsOn, ['mission_finalize']);
		assert.deepEqual(reg.get('mission_finalize').dependsOn, ['feature_gap']);
	});

	it('test_generation depends on workflow_save', () => {
		const reg = createDefaultRegistry();
		assert.deepEqual(reg.get('test_generation').dependsOn, ['workflow_save']);
	});

	it('smoke_run depends on test_generation', () => {
		const reg = createDefaultRegistry();
		assert.deepEqual(reg.get('smoke_run').dependsOn, ['test_generation']);
	});

	it('dev_intelligence has no dependencies (can run independently)', () => {
		const reg = createDefaultRegistry();
		assert.deepEqual(reg.get('dev_intelligence').dependsOn, []);
	});

	it('feature_gap has no dependencies (can run independently)', () => {
		const reg = createDefaultRegistry();
		assert.deepEqual(reg.get('feature_gap').dependsOn, []);
	});

	it('plans correct execution order', () => {
		const reg = createDefaultRegistry();
		const orch = new Orchestrator(reg);
		const ids = reg.list().map(c => c.id);
		const plan = orch.plan(ids);
		const planIds = plan.map(c => c.id);

		// workflow_save before test_generation
		assert.ok(planIds.indexOf('workflow_save') < planIds.indexOf('test_generation'));
		// test_generation before smoke_run
		assert.ok(planIds.indexOf('test_generation') < planIds.indexOf('smoke_run'));
		// test_generation before schedule_create
		assert.ok(planIds.indexOf('test_generation') < planIds.indexOf('schedule_create'));
		// feature_gap before mission_finalize
		assert.ok(planIds.indexOf('feature_gap') < planIds.indexOf('mission_finalize'));
		// mission_finalize before knowledge_write
		assert.ok(planIds.indexOf('mission_finalize') < planIds.indexOf('knowledge_write'));
	});

	it('each capability has metadata (confidence, cost, category)', () => {
		const reg = createDefaultRegistry();
		for (const cap of reg.list()) {
			assert.ok(cap.confidence !== undefined, `${cap.id} missing confidence`);
			assert.ok(cap.cost !== undefined, `${cap.id} missing cost`);
			assert.ok(cap.category !== undefined, `${cap.id} missing category`);
			assert.ok(typeof cap.enabled === 'function', `${cap.id} missing enabled()`);
			assert.ok(typeof cap.execute === 'function', `${cap.id} missing execute()`);
		}
	});
});
