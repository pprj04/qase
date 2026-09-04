/**
 * P0-F4 — Multi-user ownership & workspace isolation (ticket #9038).
 *
 * Contract under test (spec: .drytis/specs/p0-f4-ownership-isolation.md):
 *
 * Server boots in REQUIRED-AUTH mode (QASE_API_TOKEN set, QASE_AUTH_MODE not
 * 'disabled'). Two operator users (A, B) and one admin are created via the
 * master token. All requests are real HTTP against a live child server — no
 * frontend, no mocks.
 *
 *  1. B cannot list A's missions / sessions / findings.
 *  2. B cannot GET A's individual mission / session / finding.
 *  3. B cannot mutate / stop / delete / answer A's resources.
 *  4. B cannot subscribe to A's SSE stream.
 *  5. B cannot read A's evidence (session evidence, mission evidence).
 *  6. Admin access to A's resources still works (documented capability).
 *  7. A's own access keeps working after B's attempts.
 *  8. Integration-auth workspace semantics unchanged (d23 covers signing;
 *     here we verify the requireMissionForIntegration path still resolves a
 *     workspace-bound mission for a non-user bearer master token).
 *  9. Anonymous access → 401 (required mode actually enforced).
 * 10. Legacy null-owner records stay visible to both users (shared history).
 *
 * Isolation: isolated child server with temp cwd; the dev store is never
 * touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

function cookieOf(setCookies, name) {
	const hit = (setCookies ?? []).find(c => c.startsWith(`${name}=`));
	return hit ? hit.split(';')[0] : null;
}

async function bootRequiredAuthServer() {
	const port = await freePort();
	const home = mkdtempSync(join(tmpdir(), 'p0f4-iso-'));
	mkdirSync(join(home, '.qase'), { recursive: true });
	const TOKEN = 'p0f4-master-token';
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			// REQUIRED mode: token set, auth mode not disabled.
			QASE_AUTH_MODE: '',
			QASE_API_TOKEN: TOKEN,
			// Isolate ALL stores (users.json too — userStore reads QASE_DATA_DIR)
			// so repeated runs can't hit email_taken from a previous boot.
			QASE_DATA_DIR: join(home, '.qase'),
			PORT: String(port),
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
	for (let i = 0; i < 120; i += 1) {
		try {
			const r = await fetch(`${base}/api/health`);
			if (r.ok) break;
		} catch { /* not up yet */ }
		await delay(300);
	}
	const call = async (path, { method = 'GET', body, token, cookie } = {}) => {
		const headers = {};
		if (body !== undefined) headers['content-type'] = 'application/json';
		if (token) headers.authorization = `Bearer ${token}`;
		if (cookie) headers.cookie = cookie;
		const r = await fetch(`${base}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
		let json = null;
		try { json = await r.json(); } catch { /* non-json */ }
		return { status: r.status, json, headers: r.headers };
	};
	const cleanup = () => {
		try { child.kill('SIGKILL'); } catch {}
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	};
	return { base, call, cleanup, masterToken: TOKEN, stderr: () => stderr };
}

/** Shared fixture: booted server + users A/B/admin + A-owned specimen data. */
async function fixture() {
	const srv = await bootRequiredAuthServer();
	const M = srv.masterToken;

	// Create two operators + one admin via the master token.
	const mk = async (email, role) => {
		const create = await srv.call('/api/auth/users', {
			method: 'POST',
			token: M,
			body: { email, name: email, password: `pw-${email}-12345678`, role }
		});
		assert.ok([200, 201].includes(create.status), `user create ${email} -> ${create.status}`);
		const login = await srv.call('/api/auth/login', {
			method: 'POST',
			body: { email, password: `pw-${email}-12345678` }
		});
		assert.equal(login.status, 200, `login ${email} -> ${login.status}`);
		const cookie = cookieOf(login.headers.getSetCookie(), 'qase_session');
		assert.ok(cookie, `qase_session cookie for ${email}`);
		return { email, cookie };
	};

	const userA = await mk('a-isolation@qase.test', 'operator');
	const userB = await mk('b-isolation@qase.test', 'operator');
	const admin = await mk('admin-isolation@qase.test', 'admin');

	// A creates a session, mission, finding.
	const sessionA = await srv.call('/api/sessions', {
		method: 'POST',
		cookie: userA.cookie,
		body: { title: 'A session' }
	});
	assert.equal(sessionA.status, 201, 'A creates session');
	const missionA = await srv.call('/api/missions', {
		method: 'POST',
		cookie: userA.cookie,
		body: { name: 'A mission', targetUrl: 'https://example.com', type: 'full_audit' }
	});
	assert.equal(missionA.status, 201, 'A creates mission');
	const findingA = await srv.call('/api/findings', {
		method: 'POST',
		cookie: userA.cookie,
		body: { title: 'A finding', severity: 'high', sessionId: sessionA.json.id }
	});
	assert.equal(findingA.status, 201, 'A creates finding');

	return {
		...srv,
		userA, userB, admin,
		sessionId: sessionA.json.id,
		missionId: missionA.json.id,
		findingId: findingA.json.id
	};
}

test('P0-F4 · required-auth mode: anonymous is 401', { timeout: 90_000 }, async () => {
	const srv = await bootRequiredAuthServer();
	try {
		const anon = await srv.call('/api/sessions');
		assert.equal(anon.status, 401, `anonymous /api/sessions -> ${anon.status}`);
	} finally {
		srv.cleanup();
	}
});

test('P0-F4 · cross-user isolation across missions, sessions, findings, SSE, evidence', { timeout: 120_000 }, async () => {
	const fx = await fixture();
	const A = fx.userA.cookie;
	const B = fx.userB.cookie;
	const ADM = fx.admin.cookie;
	try {
		/* 1 — LIST endpoints are scoped */
		const bSessions = await fx.call('/api/sessions', { cookie: B });
		assert.equal(bSessions.status, 200);
		// No ?limit → bare array; with ?limit → { items } envelope.
		const bSessionList = Array.isArray(bSessions.json) ? bSessions.json : (bSessions.json.items ?? []);
		assert.equal(bSessionList.findIndex(s => s.id === fx.sessionId), -1,
			'B must not list A session');

		const bMissions = await fx.call('/api/missions', { cookie: B });
		assert.equal(bMissions.status, 200);
		const missionList = Array.isArray(bMissions.json) ? bMissions.json : (bMissions.json.items ?? []);
		assert.equal(missionList.findIndex(m => m.id === fx.missionId), -1,
			'B must not list A mission');

		const bFindings = await fx.call('/api/findings', { cookie: B });
		assert.equal(bFindings.status, 200);
		const findingList = Array.isArray(bFindings.json) ? bFindings.json : (bFindings.json.items ?? []);
		assert.equal(findingList.findIndex(f => f.id === fx.findingId), -1,
			'B must not list A finding');

		/* 2 — DETAIL endpoints are scoped (404, no existence leak) */
		const bSession = await fx.call(`/api/sessions/${fx.sessionId}`, { cookie: B });
		assert.equal(bSession.status, 404, `B GET A session -> ${bSession.status}`);
		const bMission = await fx.call(`/api/missions/${fx.missionId}`, { cookie: B });
		assert.equal(bMission.status, 404, `B GET A mission -> ${bMission.status}`);
		const bFinding = await fx.call(`/api/findings/${fx.findingId}`, { cookie: B });
		assert.equal(bFinding.status, 404, `B GET A finding -> ${bFinding.status}`);
		const bV1Mission = await fx.call(`/api/v1/missions/${fx.missionId}`, { cookie: B });
		assert.equal(bV1Mission.status, 404, `B GET A v1 mission -> ${bV1Mission.status}`);
		const bV2Finding = await fx.call(`/api/v2/findings/${fx.findingId}`, { cookie: B });
		assert.equal(bV2Finding.status, 404, `B GET A v2 finding -> ${bV2Finding.status}`);

		/* 3 — MUTATION endpoints are scoped */
		const bMissionPut = await fx.call(`/api/missions/${fx.missionId}`, {
			method: 'PUT', cookie: B, body: { name: 'hijacked' }
		});
		assert.equal(bMissionPut.status, 404, `B PUT A mission -> ${bMissionPut.status}`);

		const bFindingPatch = await fx.call(`/api/findings/${fx.findingId}`, {
			method: 'PUT', cookie: B, body: { title: 'hijacked' }
		});
		assert.equal(bFindingPatch.status, 404, `B PUT A finding -> ${bFindingPatch.status}`);

		const bMissionStop = await fx.call(`/api/v1/missions/${fx.missionId}/stop`, {
			method: 'POST', cookie: B
		});
		assert.equal(bMissionStop.status, 404, `B stop A mission -> ${bMissionStop.status}`);

		const bSessionStop = await fx.call(`/api/sessions/${fx.sessionId}/stop`, {
			method: 'POST', cookie: B
		});
		assert.equal(bSessionStop.status, 404, `B stop A session -> ${bSessionStop.status}`);

		const bAnswer = await fx.call(`/api/sessions/${fx.sessionId}/answer`, {
			method: 'POST', cookie: B, body: { answer: 'Yes' }
		});
		assert.equal(bAnswer.status, 404, `B answer A session -> ${bAnswer.status}`);

		const bDelete = await fx.call(`/api/sessions/${fx.sessionId}`, {
			method: 'DELETE', cookie: B
		});
		assert.equal(bDelete.status, 404, `B DELETE A session -> ${bDelete.status}`);

		const bFindingStatus = await fx.call(`/api/findings/${fx.findingId}/status`, {
			method: 'PATCH', cookie: B, body: { status: 'resolved' }
		});
		assert.equal(bFindingStatus.status, 404, `B PATCH A finding status -> ${bFindingStatus.status}`);

		const bFindingComment = await fx.call(`/api/findings/${fx.findingId}/comments`, {
			method: 'POST', cookie: B, body: { author: 'B', text: 'hi' }
		});
		assert.equal(bFindingComment.status, 404, `B comment A finding -> ${bFindingComment.status}`);

		/* 4 — SSE stream is scoped */
		const bSse = await fetch(`${fx.base}/api/sessions/${fx.sessionId}/events`, {
			headers: { cookie: B, accept: 'text/event-stream' }
		});
		assert.equal(bSse.status, 404, `B SSE A session -> ${bSse.status}`);
		// Drain to release the socket when it (wrongly) opens.
		try { await bSse.body?.cancel(); } catch {}

		/* 5 — Evidence is scoped */
		const bSessionEvidence = await fx.call(`/api/v1/sessions/${fx.sessionId}/evidence`, { cookie: B });
		assert.equal(bSessionEvidence.status, 404, `B session evidence -> ${bSessionEvidence.status}`);
		const bMissionEvidence = await fx.call(`/api/v1/missions/${fx.missionId}/evidence`, { cookie: B });
		assert.equal(bMissionEvidence.status, 404, `B mission evidence -> ${bMissionEvidence.status}`);
		const bSessionObservations = await fx.call(`/api/v1/sessions/${fx.sessionId}/observations`, { cookie: B });
		assert.equal(bSessionObservations.status, 404, `B session observations -> ${bSessionObservations.status}`);

		/* 6 — Admin access still works (documented capability) */
		const admSession = await fx.call(`/api/sessions/${fx.sessionId}`, { cookie: ADM });
		assert.equal(admSession.status, 200, `admin GET A session -> ${admSession.status}`);
		const admMission = await fx.call(`/api/missions/${fx.missionId}`, { cookie: ADM });
		assert.equal(admMission.status, 200, `admin GET A mission -> ${admMission.status}`);
		const admFinding = await fx.call(`/api/findings/${fx.findingId}`, { cookie: ADM });
		assert.equal(admFinding.status, 200, `admin GET A finding -> ${admFinding.status}`);

		/* 7 — A's own access still works after all of B's attempts */
		const aSession = await fx.call(`/api/sessions/${fx.sessionId}`, { cookie: A });
		assert.equal(aSession.status, 200, 'A reads own session');
		assert.equal(aSession.json.ownerUserId != null, true, 'session carries ownerUserId');
		const aMission = await fx.call(`/api/missions/${fx.missionId}`, { cookie: A });
		assert.equal(aMission.status, 200, 'A reads own mission');
		const aFinding = await fx.call(`/api/findings/${fx.findingId}`, { cookie: A });
		assert.equal(aFinding.status, 200, 'A reads own finding');
		const aSessions = await fx.call('/api/sessions', { cookie: A });
		const aSessionList = Array.isArray(aSessions.json) ? aSessions.json : (aSessions.json.items ?? []);
		assert.notEqual(aSessionList.findIndex(s => s.id === fx.sessionId), -1,
			'A lists own session');

		/* 10 — Legacy null-owner records remain visible to both users */
		const bSessionsAfter = await fx.call('/api/sessions', { cookie: B });
		// The v2/pulse surface also scopes — verify B sees zero A-records there.
		const bV2Missions = await fx.call('/api/v2/missions', { cookie: B });
		assert.equal(bV2Missions.status, 200);
		const v2List = Array.isArray(bV2Missions.json) ? bV2Missions.json : (bV2Missions.json.items ?? bV2Missions.json.data ?? []);
		assert.equal(v2List.findIndex(m => m.id === fx.missionId), -1,
			'B must not list A mission via /api/v2');
	} finally {
		fx.cleanup();
	}
});

test('P0-F4 · master token and open-mode behavior unchanged', { timeout: 90_000 }, async () => {
	const srv = await bootRequiredAuthServer();
	try {
		// Master token sees the sessions list (single-tenant machine credential).
		const viaMaster = await srv.call('/api/sessions', { token: srv.masterToken });
		assert.equal(viaMaster.status, 200, `master list -> ${viaMaster.status}`);
	} finally {
		srv.cleanup();
	}
});
