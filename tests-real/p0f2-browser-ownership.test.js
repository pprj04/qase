'use strict';

/**
 * P0-F2 — browser resource ownership across missions.
 *
 * The defect: closeOtherBrowsers() at turn start closed every non-running
 * session's browser — including sessions parked in awaiting_input. Mission A
 * asks a question → awaiting_input; mission B starts → A's browser closed;
 * A resumes → agent activity continues but browser/frame is gone.
 *
 * Required behavior:
 *   - awaiting_input sessions OWN their browser; another mission starting
 *     must not close it (TEST E).
 *   - the awaiting_input session resumes successfully (TEST F).
 *   - running sessions likewise (pre-existing, must not regress).
 *   - genuine non-holding sessions (idle/terminal) still get reclaimed —
 *     the pre-F2 reclaim behavior is preserved.
 *
 * Seams: PART 1 uses the shared agent+store modules under a temp cwd with
 * fake bridge records (same pattern as R2-B). PART 2 is a live child server
 * with a scripted fake LLM that makes mission A genuinely enter
 * awaiting_input via the ask_question tool, then starts mission B and
 * proves A's browser survived and A resumes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ═══════ PART 1 — ownership decisions (hermetic, fake records) ═══════ */

describe('P0-F2 — browser ownership decisions', () => {
	let agent;
	let store;
	let home;
	let prev;

	test('module load (temp cwd so no real .qase is touched)', async () => {
		home = mkdtempSync(join(tmpdir(), 'p0f2-agent-'));
		prev = process.cwd();
		process.chdir(home);
		try {
			// agent.js imports store.js normally — ONE shared instance.
			agent = await import('../server/agent.js');
			store = await import('../server/store.js');
		} finally {
			process.chdir(prev);
		}
		assert.ok(agent.__closeOtherBrowsersForTests, 'test seam present');
	});

	test('TEST E (unit) · awaiting_input browser survives closeOtherBrowsers from another mission', async () => {
		// Mission A: awaiting_input with a live browser bridge.
		const sessionA = store.createSession('A awaiting', null, {});
		sessionA.status = 'awaiting_input';
		sessionA.pendingQuestion = { question: 'Which account should I test with?' };
		const recordA = store.liveFor(sessionA.id);
		const suspendCalls = [];
		recordA.bridge = { suspend: async () => { suspendCalls.push(sessionA.id); } };

		// Mission B: running (holds its own).
		const sessionB = store.createSession('B running', null, {});
		sessionB.status = 'running';
		const recordB = store.liveFor(sessionB.id);
		recordB.running = true;
		recordB.bridge = { suspend: async () => { suspendCalls.push(sessionB.id); } };

		// B's turn-start sweep.
		const protectedIds = await agent.__closeOtherBrowsersForTests(sessionB.id);

		assert.deepEqual(suspendCalls, [], 'neither A (awaiting_input) nor B (running) had its browser closed');
		assert.ok(protectedIds.includes(sessionA.id), 'A reported as protected');
	});

	test('idle and terminal sessions still reclaimed (no ownership hold)', async () => {
		const closed = [];
		const make = (status, running) => {
			const s = store.createSession(`s-${status}-${running}`, null, {});
			s.status = status;
			const r = store.liveFor(s.id);
			r.running = running;
			r.bridge = { suspend: async () => { closed.push(status); } };
			return s;
		};
		make('idle', false);
		make('done', false);
		make('error', false);
		make('interrupted', false);
		const keeper = store.createSession('keeper', null, {});
		keeper.status = 'running';
		store.liveFor(keeper.id).running = true;

		await agent.__closeOtherBrowsersForTests(keeper.id);

		// Pre-F2 reclaim behavior intact for sessions with NO hold.
		assert.deepEqual(closed.sort(), ['done', 'error', 'idle', 'interrupted'].sort());
	});

	test('live turn flag without status stamp still protects the browser', async () => {
		const s = store.createSession('transition-window', null, {});
		s.status = 'idle'; // status not yet stamped for the new turn
		const r = store.liveFor(s.id);
		r.running = true; // but a turn IS executing
		const suspendCalls = [];
		r.bridge = { suspend: async () => { suspendCalls.push(s.id); } };

		const keeper = store.createSession('keeper2', null, {});
		keeper.status = 'running';
		store.liveFor(keeper.id).running = true;

		await agent.__closeOtherBrowsersForTests(keeper.id);
		assert.deepEqual(suspendCalls, [], 'mid-flight turn keeps its browser even before the status stamp');
	});

	test('cleanup: terminal session still cleaned at its genuine lifecycle end', async () => {
		// Ownership protects against the CROSS-MISSION sweep only. When the
		// session genuinely finalizes (here: disposeSessionResources, the
		// terminal cleanup path), the browser goes away.
		const s = store.createSession('terminal-now', null, {});
		s.status = 'interrupted';
		const r = store.liveFor(s.id);
		const events = [];
		r.dispose = () => events.push('dispose');
		const result = await agent.disposeSessionResources(s.id, { log: () => {} });
		assert.deepEqual(events, ['dispose'], 'terminal cleanup disposes the browser');
		assert.equal(result.workspaceRemoved, true);
		rmSync(home, { recursive: true, force: true });
	});
});

/* ═══════ PART 2 — live end-to-end with a scripted fake LLM ═══════ */

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = createTcpServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

/**
 * Minimal OpenAI-compatible STREAMING fake: POST /v1/chat/completions with
 * SSE chunks. The SDK always requests stream:true, so tool calls must arrive
 * as delta.tool_calls chunks followed by finish_reason 'tool_calls'.
 *
 * Script: call 1 → ask_question tool call (drives awaiting_input). Every
 * later call → final text (drives the turn to completion).
 */
async function fakeLlmServer() {
	const port = await freePort();
	let callCount = 0;
	const srv = createHttpServer((req, res) => {
		if (req.method === 'POST' && req.url.includes('/chat/completions')) {
			req.resume();
			req.on('end', () => {
				callCount += 1;
				const chunks = [];
				if (callCount === 1) {
					chunks.push({ choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{
						index: 0, id: 'call-1', type: 'function',
						function: { name: 'ask_question', arguments: '' }
					}] } }] });
					const args = JSON.stringify({
						summary: 'Testing scope decision',
						question: 'Should I proceed with the checkout test?',
						options: [{ label: 'Yes, proceed' }, { label: 'No, stop here' }],
						allowCustom: true
					});
					// arguments streamed in two fragments like a real provider
					chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{
						index: 0,
						function: { arguments: args.slice(0, Math.ceil(args.length / 2)) }
					}] } }] });
					chunks.push({ choices: [{ index: 0, delta: { tool_calls: [{
						index: 0,
						function: { arguments: args.slice(Math.ceil(args.length / 2)) }
					}] } }] });
					chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
				} else {
					chunks.push({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Final' } }] });
					chunks.push({ choices: [{ index: 0, delta: { content: ' report: exploration complete, no issues found.' } }] });
					chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
				}
				res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
				for (const chunk of chunks) {
					res.write(`data: ${JSON.stringify({ id: `chatcmpl-${callCount}`, object: 'chat.completion.chunk', created: Date.now() / 1000 | 0, model: 'test-model', ...chunk })}\n\n`);
				}
				res.write('data: [DONE]\n\n');
				res.end();
			});
			return;
		}
		res.writeHead(404); res.end();
	});
	await new Promise(r => srv.listen(port, '127.0.0.1', r));
	return { srv, port };
}

async function bootServer(llmPort, env) {
	const port = await freePort();
	const home = mkdtempSync(join(tmpdir(), 'p0f2-live-'));
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			QASE_AUTH_MODE: 'disabled',
			QASE_API_TOKEN: '',
			PORT: String(port),
			QASE_DATA_DIR: join(home, '.qase'),
			QASE_PUBLIC_URL: '',
			QASE_PROVIDER: 'custom',
			QASE_API_KEY: 'test-not-real',
			QASE_BASE_URL: `http://127.0.0.1:${llmPort}/v1`,
			QASE_MODEL: 'test-model',
			QASE_HEADLESS: '1',
			QASE_MAX_TURNS: '20',
			NODE_PATH: join(ROOT, 'node_modules')
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', d => { stderr += d; });
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 120; i += 1) {
		try {
			const r = await fetch(`${base}/api/health`);
			if (r.ok) break;
		} catch { /* not up yet */ }
		await delay(300);
	}
	return { child, base, home, stderr: () => stderr };
}

describe('P0-F2 — live end-to-end (TEST E/F)', () => {
	test('TEST E+F (live) · A awaiting_input + B starts → A browser alive, A resumes', { timeout: 180_000 }, async () => {
		const llm = await fakeLlmServer();
		const srv = await bootServer(llm.port);
		try {
			const call = (p, opt = {}) => fetch(`${srv.base}${p}`, {
				method: opt.method ?? 'GET',
				headers: { 'content-type': 'application/json', ...(opt.headers ?? {}) },
				body: opt.body ? JSON.stringify(opt.body) : undefined
			});

			// Mission A: first LLM call asks a question → awaiting_input.
			const a = await (await call('/api/sessions', {
				method: 'POST',
				body: { executionProvider: 'local' }
			})).json();
			const msgA = await call(`/api/sessions/${a.id}/message`, {
				method: 'POST',
				body: { text: 'Explore the demo site and report bugs.' }
			});
			assert.ok(msgA.ok, `message accepted (${msgA.status})`);

			// Wait for A to reach awaiting_input (LLM ask_question).
			let aStatus = null;
			for (let i = 0; i < 60; i += 1) {
				const s = await (await call(`/api/sessions/${a.id}`)).json();
				aStatus = s.status;
				if (aStatus === 'awaiting_input') break;
				await delay(500);
			}
			assert.equal(aStatus, 'awaiting_input', `A reached awaiting_input (got ${aStatus})\n${srv.stderr().slice(-600)}`);

			// A now holds a browser in awaiting_input. Count live Chromiums.
			const countChromium = async () => {
				const ps = spawn('sh', ['-c', "ps -eo args | grep -c '[c]hrome' || true"]);
				let n = '';
				ps.stdout.on('data', d => { n += d; });
				await new Promise(r => ps.on('close', r));
				return parseInt(n.trim() || '0', 10);
			};
			const before = await countChromium();

			// Mission B starts → its turn-start sweep runs closeOtherBrowsers.
			const b = await (await call('/api/sessions', {
				method: 'POST',
				body: { executionProvider: 'local' }
			})).json();
			const msgB = await call(`/api/sessions/${b.id}/message`, {
				method: 'POST',
				body: { text: 'Check the pricing page.' }
			});
			assert.ok(msgB.ok, `B message accepted (${msgB.status})`);
			// Let B's turn start (first model call) complete.
			await delay(2500);

			// THE REGRESSION: A must still be awaiting_input WITH its browser.
			const aAfter = await (await call(`/api/sessions/${a.id}`)).json();
			assert.equal(aAfter.status, 'awaiting_input', 'A still awaiting_input after B started');
			const after = await countChromium();
			assert.ok(after >= before, `chromium count not reduced by B starting (before=${before}, after=${after})`);

			// TEST F — resume A: answer the question. The fake LLM's next call
			// returns the final text, so the turn completes.
			const answer = await call(`/api/sessions/${a.id}/answer`, {
				method: 'POST',
				body: { answer: 'Yes, proceed.' }
			});
			assert.ok(answer.ok, `answer accepted (${answer.status})`);
			let resumed = null;
			for (let i = 0; i < 60; i += 1) {
				const s = await (await call(`/api/sessions/${a.id}`)).json();
				resumed = s.status;
				if (resumed === 'done' || resumed === 'error') break;
				await delay(500);
			}
			assert.equal(resumed, 'done', `A resumed and completed (got ${resumed})\n${srv.stderr().slice(-600)}`);
			const aFinal = await (await call(`/api/sessions/${a.id}`)).json();
			assert.ok((aFinal.messageCount ?? 0) > 0, 'A transcript survived the round trip');
		} finally {
			srv.child.kill('SIGKILL');
			rmSync(srv.home, { recursive: true, force: true });
			llm.srv.close();
		}
	});
});
