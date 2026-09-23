import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { createFounderState } from './founderService.js';
import { runTurn } from './agent.js';

test('QA completion message survives a real JSON store reload', async t => {
	const originalDirectory = process.cwd();
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-chat-store-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(directory, { recursive: true, force: true });
	});
	process.chdir(directory);
	const first = await import(`./store.js?qa-write=${Date.now()}`);
	const session = first.createSession('QA completion persistence');
	session.targetUrl = 'https://example.test';
	session.findings = [{ severity: 'high', title: 'Submit fails', actual: 'HTTP 500' }];
	const record = {
		runtime: {
			async *run() {
				session.report = { ts: 123, verdict: 'fail', summary: 'Tested the form.' };
				yield { type: 'tool_result', toolName: 'finish_qa_report', result: { success: true, published: true } };
			},
			getPendingQuestion: () => undefined
		},
		bridge: { hasPage: () => false, captureFrame: async () => {}, stopFrames() {} }
	};
	const adapter = {
		...first, liveFor: () => record, listLive: () => [],
		commit: first.emit, publish() {}
	};
	await runTurn(session, { task: 'Complete QA' }, adapter);
	first.flushSessions();
	const second = await import(`./store.js?qa-read=${Date.now()}`);
	second.loadSessions();
	const restored = second.getSession(session.id);
	assert.equal(restored.status, 'done');
	assert.equal(restored.messages.filter(message => message.kind === 'qa-report').length, 1);
	assert.equal(restored.messages.at(-1).id, 'qa-report-123');
	assert.match(restored.messages.at(-1).text, /Submit fails — HTTP 500/);
	second.flushSessions();
});

test('local JSON persistence round-trips token usage for a completed run', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-token-store-test-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const first = await import(`./store.js?token-write=${Date.now()}`);
	const session = first.createSession('Token counted run');
	const usage = {
		inputTokens: 15_000,
		outputTokens: 3_500,
		totalTokens: 18_500,
		cachedInputTokens: 900,
		estimated: false,
		updatedAt: 1_786_896_000_000
	};
	session.tokenUsage = usage;
	first.emit(session, 'usage', { usage });
	first.flushSessions();

	const second = await import(`./store.js?token-read=${Date.now()}`);
	second.loadSessions();
	const restored = second.getSession(session.id);
	assert.deepEqual(restored.tokenUsage, usage);
	assert.deepEqual(second.listSessions()[0].tokenUsage, usage);
	second.flushSessions();
});

test('listSessions summaries carry plan progress alongside usage totals', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-plan-store-test-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const store = await import(`./store.js?plan=${Date.now()}`);

	const planned = store.createSession('Partially planned run');
	planned.todos = [
		{ text: 'Load the page', status: 'completed' },
		{ text: 'Check the form', status: 'completed' },
		{ text: 'Check the footer', status: 'pending' },
		{ text: 'Verify navigation', status: 'in_progress' }
	];
	store.emit(planned, 'todos', { todos: planned.todos });
	const empty = store.createSession('Idle run');

	const summary = Object.fromEntries(store.listSessions().map(entry => [entry.title, entry]));
	assert.equal(summary['Partially planned run'].todoTotal, 4);
	assert.equal(summary['Partially planned run'].todoCompleted, 2);
	assert.equal(summary['Idle run'].todoTotal, 0);
	assert.equal(summary['Idle run'].todoCompleted, 0);
	store.flushSessions();
});

test('local deletion aborts and disposes the existing live record without recreating it', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-store-test-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const store = await import(`./store.js?isolated=${Date.now()}`);
	const session = store.createSession('Deletion cleanup');
	const calls = [];
	const record = store.liveFor(session.id);
	record.controller = { abort: () => calls.push('abort') };
	record.dispose = () => calls.push('dispose');

	assert.equal(store.deleteSession(session.id), true);
	assert.deepEqual(calls, ['abort', 'dispose']);
	assert.equal(store.peekLive(session.id), undefined);
	assert.equal(store.deleteSession(session.id), false);
	store.flushSessions();
});

test('local JSON persistence round-trips Founder Mode independently from QA and SQA', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-founder-store-test-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const first = await import(`./store.js?founder-write=${Date.now()}`);
	const session = first.createSession('Founder — Example');
	session.mode = 'founder';
	session.founder = createFounderState({
		authorizationConfirmed: true,
		target: { name: 'Example', release: '1.0.0', environment: 'staging' },
		productContext: { stage: 'mvp', primaryGoal: 'Validate demand' }
	}, () => 1_786_896_000_000);
	first.emit(session, 'founder.created');
	first.flushSessions();

	const second = await import(`./store.js?founder-read=${Date.now()}`);
	second.loadSessions();
	const restored = second.getSession(session.id);
	assert.equal(restored.mode, 'founder');
	assert.equal(restored.founder.scope.target.name, 'Example');
	assert.equal(restored.founder.scope.productContext.stage, 'mvp');
	assert.equal(restored.sqa, undefined);
	assert.equal(second.listSessions()[0].mode, 'founder');
	second.flushSessions();
});

test('local run creation binds a Drytis integration without storing submitted source content', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-drytis-store-test-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const store = await import(`./store.js?drytis=${Date.now()}`);
	const id = 'fe25868f-45f3-45cc-84a5-69fec3c42de1';
	const session = store.createSession('Drytis project', {
		id,
		targetUrl: 'https://preview.example.test/',
		findings: [{ id: 'a2c92a2f-b571-4f0d-9a6b-58be04c0afca', title: 'Static issue' }],
		drytisIntegration: {
			schemaVersion: '2026-08-1',
			externalReviewId: id,
			snapshotSha256: `sha256:${'a'.repeat(64)}`
		}
	});
	assert.equal(session.id, id);
	assert.equal(session.targetUrl, 'https://preview.example.test/');
	assert.equal(session.findings.length, 1);
	assert.equal(session.drytisIntegration.externalReviewId, id);
	assert.throws(() => store.createSession('Duplicate', { id }), error => error.code === 'QASE_RUN_ID_CONFLICT');
	store.flushSessions();

	const serialized = await fs.readFile(path.join(isolatedDirectory, '.qase', 'sessions.json'), 'utf8');
	assert.doesNotMatch(serialized, /sourceSnapshot|fileContent|submitted source/i);
	const restoredStore = await import(`./store.js?drytis-read=${Date.now()}`);
	restoredStore.loadSessions();
	assert.deepEqual(restoredStore.getSession(id).drytisIntegration, session.drytisIntegration);
	restoredStore.flushSessions();
});

test('a reload after a mid-tool crash fails the orphaned running activity instead of stranding publish', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-stale-activity-store-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const first = await import(`./store.js?stale-write=${Date.now()}`);
	const session = first.createSession('Interrupted mid browser_click');
	session.targetUrl = 'https://example.test';
	session.status = 'running';
	session.activities = [
		{ id: 'done-open', ts: 1, status: 'done', toolName: 'browser_open' },
		{ id: 'call_stuck', ts: 2, status: 'running', toolName: 'browser_click', label: 'Clicked', detail: 'Share Meeting Link' }
	];
	first.emit(session, 'status', { status: 'running' });
	first.flushSessions();

	const second = await import(`./store.js?stale-read=${Date.now()}`);
	second.loadSessions();
	const restored = second.getSession(session.id);
	assert.equal(restored.status, 'interrupted', 'mid-run session becomes interrupted');
	assert.equal(restored.interruptedFromRun, true, 'active execution qualifies for auto-resume');
	const stuck = restored.activities.find(activity => activity.id === 'call_stuck');
	const settled = restored.activities.find(activity => activity.id === 'done-open');
	assert.equal(stuck.status, 'failed');
	assert.match(stuck.error, /Interrupted by a server restart/);
	assert.equal(settled.status, 'done', 'finished activities are untouched');
	second.flushSessions();
});

test('a reload while awaiting approval preserves the question instead of interrupting the run', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-waiting-store-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const first = await import(`./store.js?waiting-write=${Date.now()}`);
	const session = first.createSession('Approval required');
	session.status = 'awaiting_input';
	session.pendingQuestion = { toolCallId: 'ask-1', question: 'May I join the live meeting?' };
	session.secretNames = ['QA_PASSWORD'];
	session.activities = [{ id: 'orphaned', status: 'running', toolName: 'browser_click' }];
	first.emit(session, 'status', { status: 'awaiting_input' });
	first.flushSessions();

	const second = await import(`./store.js?waiting-read=${Date.now()}`);
	second.loadSessions();
	const restored = second.getSession(session.id);
	assert.equal(restored.status, 'awaiting_input');
	assert.deepEqual(restored.pendingQuestion, session.pendingQuestion);
	assert.deepEqual(restored.secretNames, [], 'ephemeral vault names are still cleared');
	assert.equal(restored.activities[0].status, 'failed', 'orphaned activity is reconciled');
	assert.equal(restored.interruptedFromRun, false);
	second.flushSessions();
});

test('session persistence is not blocked by a stale PID temp directory', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-temp-collision-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	await fs.mkdir(path.join(isolatedDirectory, '.qase', `sessions.json.tmp-${process.pid}`), { recursive: true });
	const store = await import(`./store.js?temp-collision=${Date.now()}`);
	const session = store.createSession('Must persist despite stale temp path');
	store.flushSessions();
	const persisted = JSON.parse(await fs.readFile(path.join(isolatedDirectory, '.qase', 'sessions.json'), 'utf8'));
	assert.equal(persisted.some(candidate => candidate.id === session.id), true);
});

test('session history is persisted with owner-only permissions', async t => {
	const originalDirectory = process.cwd();
	const isolatedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qase-session-mode-'));
	t.after(async () => {
		process.chdir(originalDirectory);
		await fs.rm(isolatedDirectory, { recursive: true, force: true });
	});
	process.chdir(isolatedDirectory);
	const store = await import(`./store.js?mode=${Date.now()}`);
	store.createSession('Private history');
	store.flushSessions();
	const metadata = await fs.stat(path.join(isolatedDirectory, '.qase', 'sessions.json'));
	assert.equal(metadata.mode & 0o777, 0o600);
});
