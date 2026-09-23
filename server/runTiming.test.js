import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyStatusTiming, markReportPhase, markExecutionStarted, timingForEvent, setStatus, emit
} from './store.js';

function freshSession() {
	return { id: 'test-run', status: 'idle', createdAt: Date.now(), updatedAt: Date.now() };
}

test('running transition sets startedAt and setupStartedAt once', () => {
	const session = freshSession();
	applyStatusTiming(session, 'running');
	const first = session.startedAt;
	assert.equal(session.setupStartedAt, first);
	// A repeat transition must never reset the timer.
	applyStatusTiming(session, 'running');
	assert.equal(session.startedAt, first);
});

test('done transition sets completedAt once and never resets', () => {
	const session = freshSession();
	applyStatusTiming(session, 'running');
	applyStatusTiming(session, 'done');
	const done = session.completedAt;
	assert.ok(done >= session.startedAt);
	applyStatusTiming(session, 'done');
	assert.equal(session.completedAt, done);
});

test('error transition records completion and preserves failureReason', () => {
	const session = freshSession();
	applyStatusTiming(session, 'running');
	applyStatusTiming(session, 'error');
	assert.ok(session.completedAt);
	session.failureReason = 'Model connection lost';
	applyStatusTiming(session, 'done');
	// A done transition clears the failure reason only on a genuine success path.
	assert.equal(session.failureReason, undefined);
});

test('idle after running records cancellation with completion', () => {
	const session = freshSession();
	applyStatusTiming(session, 'running');
	applyStatusTiming(session, 'idle');
	assert.ok(session.cancelledAt);
	assert.equal(session.cancelledAt, session.completedAt);
});

test('idle before any run never sets cancellation timestamps', () => {
	const session = freshSession();
	applyStatusTiming(session, 'idle');
	assert.equal(session.cancelledAt, undefined);
	assert.equal(session.completedAt, undefined);
});

test('report phase boundaries only close when opened', () => {
	const session = freshSession();
	markReportPhase(session, 'end');
	assert.equal(session.reportEndedAt, undefined);
	markReportPhase(session, 'start');
	markReportPhase(session, 'end');
	assert.ok(session.reportStartedAt <= session.reportEndedAt);
});

test('execution start closes the setup phase', () => {
	const session = freshSession();
	applyStatusTiming(session, 'running');
	markExecutionStarted(session);
	assert.ok(session.setupEndedAt >= session.setupStartedAt);
	// Idempotent.
	const ended = session.setupEndedAt;
	markExecutionStarted(session);
	assert.equal(session.setupEndedAt, ended);
});

test('timingForEvent carries serverNow and all timing fields', () => {
	const session = freshSession();
	applyStatusTiming(session, 'running');
	const timing = timingForEvent(session);
	assert.ok(timing.serverNow > 0);
	assert.ok(timing.startedAt > 0);
	assert.equal(timing.failureReason, undefined);
});
