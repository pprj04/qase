import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntentMissionPayload } from '../public/missionIntent.js';

test('selected device always creates a device mission payload', () => {
	const result = buildIntentMissionPayload({ targetUrl: 'https://example.test/', device: 'iPhone SE' });
	assert.equal(result.requested, true);
	assert.equal(result.error, null);
	assert.equal(result.payload.constraints.device, 'iPhone SE');
	assert.equal(result.payload.targetUrl, 'https://example.test/');
});

test('requirements-only intent is persisted rather than ignored', () => {
	const result = buildIntentMissionPayload({ targetUrl: 'https://example.test/', requirementsText: ' login works , mobile checkout ' });
	assert.deepEqual(result.payload.requirements, ['login works', 'mobile checkout']);
	assert.equal(result.payload.constraints, undefined);
});

test('intent requires a target URL and never falls back to desktop messaging', () => {
	const result = buildIntentMissionPayload({ targetUrl: 'test this site', buildPrompt: 'Store', device: 'iPhone SE' });
	assert.equal(result.requested, true);
	assert.equal(result.payload, null);
	assert.match(result.error, /target URL/i);
});

test('ordinary composer input keeps the existing non-mission path', () => {
	assert.deepEqual(buildIntentMissionPayload({ targetUrl: 'continue testing' }), { requested: false, payload: null, error: null });
});
