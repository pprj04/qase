import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { runTurn } from './agent.js';
import { AGENT_FAULT_USAGE, applyAgentFault, parseAgentFaultCommand, unresponsiveRuntimeError } from './agentFaultSimulation.js';

function faultFixture() {
	const session = { id: randomUUID(), mode: 'qa', targetUrl: 'https://example.test', messages: [], activities: [], todos: [], findings: [], secretNames: [], status: 'idle' };
	const record = {};
	const store = {
		liveFor: () => record,
		publish() {},
		commit: async () => {},
		setStatus: async (s, status, detail) => { s.status = status; s.lastStatusDetail = detail; },
		addMessage: async (s, item) => { s.messages.push(item); return item; },
		addActivity: async (s, item) => { const activity = { id: randomUUID(), ts: Date.now(), ...item }; s.activities.push(activity); return activity; },
		updateActivity: async () => {}
	};
	return { session, record, store };
}

test('parseAgentFaultCommand extracts subcommands and rejects non-commands', () => {
	assert.equal(parseAgentFaultCommand('/qase-test unresponsive-runtime'), 'unresponsive-runtime');
	assert.equal(parseAgentFaultCommand('Run /qase-test runtime-reuse-block please'), 'runtime-reuse-block');
	assert.equal(parseAgentFaultCommand('/QASE-TEST Unresponsive-Runtime'), 'unresponsive-runtime');
	assert.equal(parseAgentFaultCommand('/qase-test'), undefined);
	assert.equal(parseAgentFaultCommand('/qase-test nope'), 'nope');
	assert.equal(parseAgentFaultCommand('https://example.test'), undefined);
	assert.equal(parseAgentFaultCommand(''), undefined);
	assert.equal(parseAgentFaultCommand(undefined), undefined);
});

test('unresponsive-runtime applies the exact incident surface: actionable error + status error + quarantine', async () => {
	const { session, record, store } = faultFixture();
	const note = await applyAgentFault(session, 'unresponsive-runtime', store);
	assert.ok(typeof note === 'string' && note.length > 0);
	assert.equal(record.unresponsive, true);
	assert.equal(session.status, 'error');
	assert.equal(session.messages.at(-1).kind, 'error');
	assert.equal(session.messages.at(-1).text, unresponsiveRuntimeError().message);
	assert.equal(session.lastStatusDetail, unresponsiveRuntimeError().message);
});

test('runtime-reuse-block quarantines without touching the transcript', async () => {
	const { session, record, store } = faultFixture();
	const note = await applyAgentFault(session, 'runtime-reuse-block', store);
	assert.ok(typeof note === 'string' && note.length > 0);
	assert.equal(record.unresponsive, true);
	assert.equal(session.status, 'idle');
	assert.equal(session.messages.length, 0);
});

test('unknown subcommands are refused, not guessed', async () => {
	const { session, record, store } = faultFixture();
	assert.equal(await applyAgentFault(session, 'nope', store), undefined);
	assert.equal(await applyAgentFault(session, undefined, store), undefined);
	assert.equal(record.unresponsive, undefined);
	assert.equal(session.status, 'idle');
});

test('the real agent reuse block rejects a follow-up turn on a quarantined runtime', async () => {
	const { session, record, store } = faultFixture();
	await applyAgentFault(session, 'runtime-reuse-block', store);
	record.runtime = { async *run() {}, getPendingQuestion: () => undefined };
	record.bridge = { hasPage: () => false, captureFrame: async () => {}, stopFrames() {} };
	await assert.rejects(
		runTurn(session, { task: 'Continue the run' }, store),
		/This agent could not shut down safely. Start a new run to continue./
	);
});

test('usage string names the command and both modes', () => {
	assert.match(AGENT_FAULT_USAGE, /\/qase-test/);
	assert.match(AGENT_FAULT_USAGE, /unresponsive-runtime/);
	assert.match(AGENT_FAULT_USAGE, /runtime-reuse-block/);
});
