/**
 * B1: Interactive Exploration Bridge — unit tests
 *
 * Verifies that captureStep creates steps with toolCallId and pending outcomes,
 * and that finalizeStepOutcome enriches them with behavioral evidence from
 * tool results.
 *
 * Run: node --test tests/test-interactive-exploration.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureStep, finalizeStepOutcome } from '../server/workflows.js';

function makeSession() {
	return {
		id: 'test-sess',
		targetUrl: 'https://example.com',
		capturedSteps: []
	};
}

describe('B1: captureStep with outcome tracking', () => {

	it('creates step with toolCallId and pending outcome', () => {
		const session = makeSession();
		const step = captureStep(session, {
			toolName: 'browser_click',
			input: { selector: '#login' },
			toolCallId: 'call-1'
		});
		assert.equal(step.toolCallId, 'call-1');
		assert.equal(step.outcome.status, 'pending');
	});

	it('creates step without toolCallId when not provided (backward compat)', () => {
		const session = makeSession();
		const step = captureStep(session, {
			toolName: 'browser_click',
			input: { selector: '#login' }
		});
		assert.equal(step.toolCallId, undefined);
		assert.equal(step.outcome.status, 'pending');
	});

	it('ignores non-browser tools', () => {
		const session = makeSession();
		const step = captureStep(session, {
			toolName: 'report_finding',
			input: {},
			toolCallId: 'call-x'
		});
		assert.equal(step, undefined);
	});
});

describe('B1: finalizeStepOutcome — success cases', () => {

	it('sets status to success when result has no success=false', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#submit' }, toolCallId: 'c1' });
		finalizeStepOutcome(session, 'c1', 'browser_click', { success: true });
		const step = session.capturedSteps[0];
		assert.equal(step.outcome.status, 'success');
		assert.equal(step.outcome.error, null);
	});

	it('sets status to success when result is an empty object', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#btn' }, toolCallId: 'c2' });
		finalizeStepOutcome(session, 'c2', 'browser_click', {});
		assert.equal(session.capturedSteps[0].outcome.status, 'success');
	});

	it('detects URL change from step.url to result.url', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#login' }, toolCallId: 'c3' });
		finalizeStepOutcome(session, 'c3', 'browser_click', {
			success: true,
			url: 'https://example.com/dashboard'
		});
		const step = session.capturedSteps[0];
		assert.equal(step.outcome.urlAfter, 'https://example.com/dashboard');
	});

	it('sets urlAfter to null when URL did not change', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#tab' }, toolCallId: 'c4' });
		finalizeStepOutcome(session, 'c4', 'browser_click', {
			success: true,
			url: 'https://example.com'
		});
		assert.equal(session.capturedSteps[0].outcome.urlAfter, null);
	});

	it('captures page title from result', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_snapshot', input: {}, toolCallId: 'c5' });
		finalizeStepOutcome(session, 'c5', 'browser_snapshot', {
			success: true,
			title: 'Dashboard — Admin Panel'
		});
		assert.equal(session.capturedSteps[0].outcome.titleAfter, 'Dashboard — Admin Panel');
	});
});

describe('B1: finalizeStepOutcome — failure cases', () => {

	it('sets status to failed with error message when success is false', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#gone' }, toolCallId: 'c6' });
		finalizeStepOutcome(session, 'c6', 'browser_click', {
			success: false,
			error: 'Element not found'
		});
		const step = session.capturedSteps[0];
		assert.equal(step.outcome.status, 'failed');
		assert.equal(step.outcome.error, 'Element not found');
	});

	it('uses message field as error when error not present', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_fill', input: { selector: '#email' }, toolCallId: 'c7' });
		finalizeStepOutcome(session, 'c7', 'browser_fill', {
			success: false,
			message: 'Timeout waiting for selector'
		});
		assert.equal(session.capturedSteps[0].outcome.error, 'Timeout waiting for selector');
	});

	it('defaults to generic error message when neither error nor message present', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#x' }, toolCallId: 'c8' });
		finalizeStepOutcome(session, 'c8', 'browser_click', { success: false });
		assert.equal(session.capturedSteps[0].outcome.error, 'Action failed');
	});
});

describe('B1: finalizeStepOutcome — snapshot enrichment', () => {

	it('extracts element count from snapshot result with elements array', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_snapshot', input: {}, toolCallId: 'c9' });
		finalizeStepOutcome(session, 'c9', 'browser_snapshot', {
			success: true,
			elements: [{}, {}, {}, {}, {}]  // 5 elements
		});
		assert.equal(session.capturedSteps[0].outcome.elementsFound, 5);
	});

	it('extracts element count from elementCount field', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_snapshot', input: {}, toolCallId: 'c10' });
		finalizeStepOutcome(session, 'c10', 'browser_snapshot', {
			success: true,
			elementCount: 42
		});
		assert.equal(session.capturedSteps[0].outcome.elementsFound, 42);
	});
});

describe('B1: finalizeStepOutcome — diagnostics enrichment', () => {

	it('counts console errors and network errors from diagnostics', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_diagnostics', input: {}, toolCallId: 'c11' });
		finalizeStepOutcome(session, 'c11', 'browser_diagnostics', {
			success: true,
			console: [
				{ level: 'error', message: 'Uncaught TypeError' },
				{ level: 'warning', message: 'Deprecated API' },
				{ level: 'error', message: 'Network request failed' }
			],
			network: [
				{ statusCode: 200 },
				{ statusCode: 404, error: 'Not Found' },
				{ statusCode: 500, error: 'Server Error' }
			]
		});
		const outcome = session.capturedSteps[0].outcome;
		assert.equal(outcome.consoleErrors, 2);
		assert.equal(outcome.networkErrors, 2);
	});
});

describe('B1: finalizeStepOutcome — edge cases', () => {

	it('is a no-op when toolCallId not found', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#a' }, toolCallId: 'c12' });
		// Different toolCallId — should not crash, should not modify existing step
		finalizeStepOutcome(session, 'nonexistent', 'browser_click', { success: true });
		assert.equal(session.capturedSteps[0].outcome.status, 'pending');
	});

	it('does not crash when result is null', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#b' }, toolCallId: 'c13' });
		finalizeStepOutcome(session, 'c13', 'browser_click', null);
		// Should still mark as success (null result means no explicit failure)
		assert.equal(session.capturedSteps[0].outcome.status, 'success');
	});

	it('does not crash when result is undefined', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#c' }, toolCallId: 'c14' });
		finalizeStepOutcome(session, 'c14', 'browser_click', undefined);
		assert.equal(session.capturedSteps[0].outcome.status, 'success');
	});

	it('steps remain pending when finalizeStepOutcome never called', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#d' }, toolCallId: 'c15' });
		captureStep(session, { toolName: 'browser_fill', input: { selector: '#e' }, toolCallId: 'c16' });
		// No finalizeStepOutcome calls — both steps stay pending
		assert.equal(session.capturedSteps[0].outcome.status, 'pending');
		assert.equal(session.capturedSteps[1].outcome.status, 'pending');
	});

	it('detects dialogs from result', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#delete' }, toolCallId: 'c17' });
		finalizeStepOutcome(session, 'c17', 'browser_click', {
			success: true,
			dialog: 'Are you sure you want to delete?'
		});
		assert.equal(session.capturedSteps[0].outcome.dialogAppeared, true);
	});

	it('does not crash when session has no capturedSteps', () => {
		const session = makeSession();
		session.capturedSteps = undefined;
		// Should be a safe no-op
		finalizeStepOutcome(session, 'c18', 'browser_click', { success: true });
	});
});

describe('B1: outcome shape', () => {

	it('finalized outcome has all expected fields', () => {
		const session = makeSession();
		captureStep(session, { toolName: 'browser_click', input: { selector: '#login' }, toolCallId: 'c19' });
		finalizeStepOutcome(session, 'c19', 'browser_click', {
			success: true,
			url: 'https://example.com/home',
			title: 'Home Page'
		});
		const outcome = session.capturedSteps[0].outcome;
		assert.ok('status' in outcome);
		assert.ok('urlAfter' in outcome);
		assert.ok('titleAfter' in outcome);
		assert.ok('error' in outcome);
		assert.ok('elementsFound' in outcome);
		assert.ok('consoleErrors' in outcome);
		assert.ok('networkErrors' in outcome);
		assert.ok('dialogAppeared' in outcome);
		assert.ok('ts' in outcome);
	});
});
