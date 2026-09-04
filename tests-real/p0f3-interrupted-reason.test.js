'use strict';

/**
 * P0-F3 — the interrupted state is explainable.
 *
 * Defects fixed:
 *   1. Boot recovery (loadSessions) flipped running/awaiting_input →
 *      'interrupted' with NO reason, and WIPED pendingQuestion even when the
 *      agent had a live question at crash time.
 *   2. The watchdog branches set 'interrupted' with no persisted reason.
 *   3. The session API exposed none of it.
 *
 * Required behavior (tests G + H):
 *   G — interruptedReason is stored + exposed (API projection) truthfully:
 *       server_restart_recovery (boot), awaiting_input_timeout,
 *       watchdog_stuck, max_running_duration.
 *   H — an interrupted-awaiting-input session PRESERVES pendingQuestion
 *       (restart path); deliberate lifecycles (expiry) clear it with
 *       interruptedWhile recorded.
 *   — No fabricated reasons for historical records (already-interrupted
 *     sessions keep their existing reason/null).
 *   — done/failed/aborted/cancelled/timeout behavior unchanged.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ═══════ PART 1 — store-level: reason persistence + pendingQuestion ═══════ */

describe('P0-F3 — store: interrupted reason persistence (TEST G/H unit)', () => {
	let importCount = 0;
	async function freshStore(fixtures) {
		importCount += 1;
		const tempHome = mkdtempSync(join(tmpdir(), `p0f3-store-${importCount}-`));
		if (fixtures) {
			mkdirSync(join(tempHome, '.qase'), { recursive: true });
			writeFileSync(join(tempHome, '.qase', 'sessions.json'), JSON.stringify(fixtures));
		}
		const prevCwd = process.cwd();
		process.chdir(tempHome);
		try {
			const store = await import(`../server/store.js?iso=${importCount}-${Date.now()}`);
			store.loadSessions(); // index.js does this at boot; tests must too
			return store;
		} finally {
			process.chdir(prevCwd);
		}
	}

	test('TEST G · restart recovery: running → interrupted with server_restart_recovery', async () => {
		const store = await freshStore([
			{ id: 's-run', title: 'running', status: 'running', messages: [], findings: [], createdAt: 1, updatedAt: 2 }
		]);
		const s = store.getSession('s-run');
		assert.equal(s.status, 'interrupted');
		assert.equal(s.interruptedReason, 'server_restart_recovery');
	});

	test('TEST H · restart during awaiting_input: pendingQuestion PRESERVED + reason recorded', async () => {
		const question = { question: 'Which credentials should I use?', options: [{ label: 'QA account' }] };
		const store = await freshStore([
			{ id: 's-await', title: 'awaiting', status: 'awaiting_input', pendingQuestion: question, awaitingInputSince: 123, messages: [], findings: [], createdAt: 1, updatedAt: 2 }
		]);
		const s = store.getSession('s-await');
		assert.equal(s.status, 'interrupted');
		assert.equal(s.interruptedReason, 'server_restart_recovery');
		assert.equal(s.interruptedWhile, 'awaiting_input');
		assert.deepEqual(s.pendingQuestion, question, 'pending question survives the restart interruption');
		assert.equal(s.awaitingInputSince, undefined, 'expiry stamp cleared');
	});

	test('restart of a plain running session clears pendingQuestion (none was answerable)', async () => {
		const store = await freshStore([
			{ id: 's-run2', title: 'running', status: 'running', pendingQuestion: { question: 'stale' }, messages: [], findings: [], createdAt: 1, updatedAt: 2 }
		]);
		const s = store.getSession('s-run2');
		assert.equal(s.status, 'interrupted');
		assert.equal(s.interruptedReason, 'server_restart_recovery');
		assert.equal(s.pendingQuestion, undefined);
	});

	test('no fabricated reasons: an already-interrupted session keeps its recorded reason', async () => {
		const store = await freshStore([
			{ id: 's-hist', title: 'historical', status: 'interrupted', interruptedReason: 'watchdog_stuck', messages: [], findings: [], createdAt: 1, updatedAt: 2 }
		]);
		const s = store.getSession('s-hist');
		assert.equal(s.interruptedReason, 'watchdog_stuck', 'historical reason untouched');
	});

	test('no fabricated reasons: historical interrupted with NO reason stays null', async () => {
		const store = await freshStore([
			{ id: 's-legacy', title: 'legacy', status: 'interrupted', messages: [], findings: [], createdAt: 1, updatedAt: 2 }
		]);
		const s = store.getSession('s-legacy');
		assert.equal(s.status, 'interrupted');
		assert.equal(s.interruptedReason, undefined, 'legacy record: cause unknown → stays unknown');
	});

	test('done/error/idle sessions are untouched by recovery', async () => {
		const store = await freshStore([
			{ id: 's-done', title: 'd', status: 'done', messages: [], findings: [], createdAt: 1, updatedAt: 2 },
			{ id: 's-err', title: 'e', status: 'error', messages: [], findings: [], createdAt: 1, updatedAt: 2 },
			{ id: 's-idle', title: 'i', status: 'idle', pendingQuestion: { question: 'x' }, messages: [], findings: [], createdAt: 1, updatedAt: 2 }
		]);
		assert.equal(store.getSession('s-done').status, 'done');
		assert.equal(store.getSession('s-err').status, 'error');
		assert.equal(store.getSession('s-idle').status, 'idle');
		assert.ok(store.getSession('s-idle').pendingQuestion, 'idle keeps its pending question');
	});

	test('watchdog expiry: reason awaiting_input_timeout, question cleared (deliberate lifecycle)', async () => {
		const store = await freshStore(null);
		const s = store.createSession('expire me', null, {});
		s.status = 'awaiting_input';
		s.awaitingInputSince = Date.now() - (10 * 60 * 60 * 1000); // 10h ago
		s.pendingQuestion = { question: 'still waiting?' };
		store.liveFor(s.id).expiryHandlerRan = true; // block the app close-out hook
		let emitted = null;
		store.setAwaitingInputExpiryHandler(async () => { emitted = 'fired'; });
		store.__runWatchdogOnce();
		assert.equal(s.status, 'interrupted');
		assert.equal(s.interruptedReason, 'awaiting_input_timeout');
		assert.equal(s.interruptedWhile, 'awaiting_input');
		assert.equal(s.pendingQuestion, undefined, 'deliberate expiry clears the question');
		assert.equal(emitted, 'fired', 'close-out handler still fires (R2-A intact)');
	});

	test('watchdog stuck-detection: reason watchdog_stuck', async () => {
		const store = await freshStore(null);
		const s = store.createSession('stuck', null, {});
		s.status = 'running';
		store.liveFor(s.id).running = false; // looks stuck
		store.__runWatchdogOnce();
		assert.equal(s.status, 'interrupted');
		assert.equal(s.interruptedReason, 'watchdog_stuck');
	});

	test('markSessionInterrupted never overwrites an existing reason', async () => {
		const store = await freshStore(null);
		const s = store.createSession('twice', null, {});
		s.status = 'interrupted';
		s.interruptedReason = 'server_restart_recovery';
		store.markSessionInterrupted(s, 'watchdog_stuck', 'later transition', { clearPendingQuestion: false });
		assert.equal(s.interruptedReason, 'server_restart_recovery', 'first reason wins');
	});
});

/* ═══════ PART 2 — API projection (live child server) ═══════ */

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

describe('P0-F3 — API projection (TEST G/H live)', () => {
	test('GET /api/sessions/:id exposes interruptedReason/While/At + preserved pendingQuestion', { timeout: 90_000 }, async () => {
		const port = await freePort();
		const home = mkdtempSync(join(tmpdir(), 'p0f3-live-'));
		// Pre-seed the store the server will recover from: one awaiting_input
		// session with a live question (the forensic specimen), one running.
		mkdirSync(join(home, '.qase'), { recursive: true });
		const question = { question: 'Should I test the admin login too?', options: [{ label: 'Yes' }, { label: 'No' }] };
		writeFileSync(join(home, '.qase', 'sessions.json'), JSON.stringify([
			{ id: 'spec-await', title: 'awaiting specimen', status: 'awaiting_input', pendingQuestion: question, awaitingInputSince: Date.now() - 1000, messages: [], findings: [], capturedSteps: [], createdAt: 1, updatedAt: Date.now() },
			{ id: 'spec-run', title: 'running specimen', status: 'running', messages: [], findings: [], capturedSteps: [], createdAt: 1, updatedAt: Date.now() }
		]));
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
				QASE_BASE_URL: 'http://127.0.0.1:1/v1',
				QASE_MODEL: 'test-model',
				NODE_PATH: join(ROOT, 'node_modules')
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stderr = '';
		child.stderr.on('data', d => { stderr += d; });
		const base = `http://127.0.0.1:${port}`;
		try {
			for (let i = 0; i < 120; i += 1) {
				try {
					const r = await fetch(`${base}/api/health`);
					if (r.ok) break;
				} catch { /* not up yet */ }
				await delay(300);
			}
			const awaitSpec = await (await fetch(`${base}/api/sessions/spec-await`)).json();
			assert.equal(awaitSpec.status, 'interrupted');
			assert.equal(awaitSpec.interruptedReason, 'server_restart_recovery');
			assert.equal(awaitSpec.interruptedWhile, 'awaiting_input');
			assert.ok(awaitSpec.interruptedAt, 'interruptedAt stamped');
			assert.deepEqual(awaitSpec.pendingQuestion, question, 'API exposes the preserved pending question');

			const runSpec = await (await fetch(`${base}/api/sessions/spec-run`)).json();
			assert.equal(runSpec.status, 'interrupted');
			assert.equal(runSpec.interruptedReason, 'server_restart_recovery');
			assert.equal(runSpec.pendingQuestion, null);

			// The reason PERSISTS to disk (not just in-memory).
			await delay(900); // store debounce
			const onDisk = JSON.parse(readFileSync(join(home, '.qase', 'sessions.json'), 'utf8'));
			const diskAwait = onDisk.find(s => s.id === 'spec-await');
			assert.equal(diskAwait.interruptedReason, 'server_restart_recovery');
			assert.ok(diskAwait.pendingQuestion, 'question persisted through recovery write');
		} finally {
			child.kill('SIGKILL');
			rmSync(home, { recursive: true, force: true });
		}
	});
});
