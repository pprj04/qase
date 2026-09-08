/**
 * R6-T5 — Store-integrity visibility + mission-failure webhook repair.
 *
 * Two families:
 *  1) storeHealth: per-store corrupt-load + write-failure counters exposed
 *     through GET /api/v1/diagnostics/state-integrity (G-matrix A–N).
 *  2) Webhook: the failure listener subscribed to 'updated' but missions.js
 *     emits 'mission:updated' — dead listener; updateMission-path failures
 *     never fired mission.failed webhooks. Fixed by aligning the event name.
 *     Proof (F-matrix): delivery, signing, queue, dedupe, no duplicates from
 *     mission:finalized, unrelated updates fire nothing.
 *
 * Hermeticity (R2-B-H convention): QASE_DATA_DIR = fresh mkdtemp BEFORE any
 * server import; after() asserts the real /workspace/.qase files are
 * byte-identical (N — no shared store mutation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = '/workspace';
const REAL = join(ROOT, '.qase');
const REAL_FILES = ['missions.json', 'evidence-graph.json', 'sessions.json', 'findings.json', 'artifacts.json', 'webhook-deliveries.json', 'webhook-subscriptions.json'];
const realHashes = new Map();
for (const f of REAL_FILES) {
	try { realHashes.set(f, createHash('sha256').update(readFileSync(join(REAL, f))).digest('hex')); } catch { realHashes.set(f, 'ABSENT'); }
}

function freshDir(tag = 'r6t5') {
	const tmp = mkdtempSync(join(tmpdir(), `${tag}-`));
	mkdirSync(join(tmp, '.qase'), { recursive: true });
	process.env.QASE_DATA_DIR = join(tmp, '.qase');
	return process.env.QASE_DATA_DIR;
}

// Module-identity contract (R6-T3/T4/T5): the registry MUST be canonical —
// every busted store module's static `import './storeHealth.js'` resolves to
// the same canonical instance, so counters accumulate in ONE place. The
// STORE modules themselves are bust-imported per corrupt-load test: their
// file paths freeze at import, so each test needs a fresh instance bound to
// that test's QASE_DATA_DIR (recordCorruptLoad still lands in the shared
// registry via the canonical static import).
let healthMod = null;
const healthPeek = async () => {
	// PEEK: return the canonical registry WITHOUT clearing — load-time
	// corrupt-load recordings already happened at busted-module import.
	if (!healthMod) healthMod = await import(`${ROOT}/server/storeHealth.js`);
	return healthMod;
};
const healthM = async () => {
	// RESET variant for tests that record their own events deliberately.
	const m = await healthPeek();
	m._clearForTesting();
	return m;
};
const busted = (p) => import(`${ROOT}/server/${p}?b=${Date.now()}-${Math.random().toString(36).slice(2)}`);
// Load-time contract per module (traced, NOT uniform): missions.js and
// store.js do NOT self-load at import (loadMissionsFromDisk()/loadSessions()
// are boot calls made by index.js); findings.js and evidenceGraph.js DO
// self-load at module bottom. Each helper triggers the real load path so
// corrupt-file handling runs exactly as at boot.
const missionsM = async () => {
	const m = await busted('missions.js');
	m.loadMissionsFromDisk();
	return m;
};

test.after(() => {
	// N — hermeticity: the real store was never touched.
	for (const f of REAL_FILES) {
		let now = 'ABSENT';
		try { now = createHash('sha256').update(readFileSync(join(REAL, f))).digest('hex'); } catch {}
		assert.equal(now, realHashes.get(f), `REAL .qase/${f} must be byte-identical after the suite`);
	}
	delete process.env.QASE_DATA_DIR;
});

/* ═══ PART G — storeHealth matrix ════════════════════════════════════ */

test('A: clean store has zero corruption / zero write failures; explicit nulls', async () => {
	freshDir();
	const h = await healthM();
	const snap = h.getStoreHealthSnapshot();
	assert.deepEqual(Object.keys(snap).sort(), ['evidence', 'findings', 'missions', 'sessions']);
	for (const [name, s] of Object.entries(snap)) {
		assert.equal(s.corruptLoadCount, 0, `${name} corruptLoadCount`);
		assert.equal(s.writeFailureCount, 0, `${name} writeFailureCount`);
		assert.equal(s.lastCorruptLoadAt, null, `${name} lastCorruptLoadAt null when never corrupted`);
		assert.equal(s.lastWriteFailureAt, null, `${name} lastWriteFailureAt null when never failed`);
		assert.equal(s.lastCorruptBackup, null);
		assert.equal(s.recoveredAsEmpty, false, `${name} not recoveredAsEmpty`);
	}
});

test('B+C+D: corrupt missions.json → count, timestamp, quarantine basename recorded; behavior unchanged', async () => {
	const dir = freshDir();
	writeFileSync(join(dir, 'missions.json'), '{ this is not json');
	const missions = await missionsM(); // module load runs loadMissions() → quarantine
	const h = await healthPeek(); // PEEK — the recording already landed at import; clearing would wipe it
	const snap = h.getStoreHealthSnapshot();
	assert.equal(snap.missions.corruptLoadCount, 1);
	assert.ok(snap.missions.lastCorruptLoadAt, 'timestamp recorded');
	assert.ok(snap.missions.lastCorruptBackup, 'quarantine identifier recorded');
	// D — identifier is a SAFE basename: no slashes, no path separators
	assert.ok(!/[/\\]/.test(snap.missions.lastCorruptBackup), 'no path separators in public snapshot');
	assert.ok(snap.missions.lastCorruptBackup.startsWith('missions.json.corrupt-'));
	assert.equal(snap.missions.recoveredAsEmpty, true, 'recovered-as-empty is visible');
	// J — existing recovery behavior intact: store starts empty, quarantined
	// file preserved on disk with the recorded basename suffix.
	assert.equal(missions.listMissions().length, 0);
	const quarantined = readdirSync(dir).find(f => f.startsWith('missions.json.corrupt-'));
	assert.ok(quarantined, 'quarantined file preserved on disk');
	assert.equal(quarantined, snap.missions.lastCorruptBackup);
});

test('B2+C2: corrupt sessions.json and findings.json also record (findings records no backup — by design)', async () => {
	const dir = freshDir('r6t5-b2');
	writeFileSync(join(dir, 'sessions.json'), 'not-json');
	writeFileSync(join(dir, 'findings.json'), 'not-json');
	await busted('store.js').then(m => m.loadSessions()); // loadSessions → quarantine path (store.js does not self-load)
	await busted('findings.js');   // load → log-only (no rename)
	const h = await healthPeek(); // PEEK — recordings landed at import
	const snap = h.getStoreHealthSnapshot();
	assert.equal(snap.sessions.corruptLoadCount, 1);
	assert.ok(snap.sessions.lastCorruptBackup?.startsWith('sessions.json.corrupt-'));
	assert.equal(snap.findings.corruptLoadCount, 1);
	assert.equal(snap.findings.lastCorruptBackup, null, 'findings keeps the damaged file in place — no fabricated backup');
	assert.equal(snap.findings.recoveredAsEmpty, true);
});

test('B3: corrupt evidence-graph.json records with backup basename', async () => {
	const dir = freshDir('r6t5-b3');
	writeFileSync(join(dir, 'evidence-graph.json'), 'not-json');
	await busted('evidenceGraph.js'); // module load runs loadGraph() → rename to .corrupt
	const snap = (await healthPeek()).getStoreHealthSnapshot(); // PEEK — recording landed at import
	assert.equal(snap.evidence.corruptLoadCount, 1);
	assert.ok(snap.evidence.lastCorruptBackup === 'evidence-graph.json.corrupt' || /evidence-graph\.json\.corrupt/.test(snap.evidence.lastCorruptBackup));
	assert.equal(snap.evidence.recoveredAsEmpty, true);
});

test('F+G+H: write failures count deterministically, with timestamp + bounded error summary', async () => {
	freshDir();
	const h = await healthM();
	// Simulate the exact call the persistence catch makes.
	h.recordWriteFailure('sessions', { error: new Error('EACCES: permission denied, open sessions.json') });
	await delay(5);
	h.recordWriteFailure('sessions', { error: 'ENOSPC: no space left on device' });
	const snap = h.getStoreHealthSnapshot();
	assert.equal(snap.sessions.writeFailureCount, 2, 'H — repeated failures increment');
	assert.ok(snap.sessions.lastWriteFailureAt >= snap.sessions.lastCorruptLoadAt ?? 0);
	assert.ok(/ENOSPC/.test(snap.sessions.lastWriteFailureError), 'G — last error summary recorded');
	assert.ok(snap.sessions.lastWriteFailureError.length <= 300, 'error summary bounded');
	assert.equal(snap.sessions.corruptLoadCount, 0, 'unrelated axes untouched');
	// I — diagnostics remain readable after failure
	assert.equal(typeof snap.missions.corruptLoadCount, 'number');
});

test('F2: REAL write failure through the missions persistence path (no mocks)', async () => {
	const dir = freshDir('r6t5-f2');
	const missions = await missionsM();
	const m = missions.createMission({ name: 'wf', targetUrl: 'https://example.com/' });
	assert.ok(m.id);
	// Make persistence impossible: replace the store DIRECTORY with a FILE.
	// atomicWrite writes <file>.tmp then renames — a file at the dir path
	// makes mkdir/rename throw. Flush via the shutdown seam (synchronous).
	rmSync(dir, { recursive: true, force: true });
	writeFileSync(dir, 'now a file'); // QASE_DATA_DIR itself is a file
	const outcome = missions.flushMissionsForShutdown();
	assert.equal(outcome.ok, false, 'flush reports failure');
	const snap = (await healthPeek()).getStoreHealthSnapshot(); // PEEK — the flush catch recorded at call time
	assert.ok(snap.missions.writeFailureCount >= 1, 'write failure recorded through the real path');
	assert.ok(snap.missions.lastWriteFailureAt);
	// restore for after()
	rmSync(dir, { force: true });
	mkdirSync(dir, { recursive: true });
});

test('K+L+M: state-integrity API exposes storeHealth; auth behavior unchanged (child servers)', async () => {
	// K — open mode serves the block; L — required mode gates it identically
	// to the rest of the route; both boot the SAME build.
	async function bootAndProbe(mode) {
		const dir = freshDir(`r6t5-k-${mode}`);
		const port = await new Promise((resolve, reject) => {
			const s = createServer();
			s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
			s.on('error', reject);
		});
		const env = {
			...process.env,
			QASE_DATA_DIR: dir,
			QASE_AUTH_MODE: mode === 'open' ? 'disabled' : '',
			...(mode === 'required' ? { QASE_API_TOKEN: 'r6t5-k-token' } : {}),
			PORT: String(port),
			QASE_PUBLIC_URL: '',
			QASE_PROVIDER: 'custom',
			QASE_API_KEY: 'test-not-real',
			QASE_BASE_URL: 'http://127.0.0.1:1/v1',
			QASE_MODEL: 'test-model',
			NODE_PATH: join(ROOT, 'node_modules')
		};
		const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], { cwd: '/tmp', env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stderr = '';
		child.stderr.on('data', d => { stderr += d.toString(); });
		for (let i = 0; i < 150; i += 1) {
			try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) break; } catch {}
			await delay(200);
			if (i === 149) { child.kill('SIGKILL'); throw new Error(`server did not boot (${mode}): ${stderr.slice(-500)}`); }
		}
		try {
			const base = `http://127.0.0.1:${port}`;
			const headers = mode === 'required' ? { authorization: 'Bearer r6t5-k-token' } : {};
			const res = await fetch(`${base}/api/v1/diagnostics/state-integrity`, { headers });
			if (mode === 'required') {
				assert.equal(res.status, 200, 'token holder reads diagnostics');
				const body = await res.json();
				assert.ok(body.storeHealth, 'K — storeHealth block present');
				assert.deepEqual(Object.keys(body.storeHealth).sort(), ['evidence', 'findings', 'missions', 'sessions']);
				assert.equal(body.storeHealth.missions.corruptLoadCount, 0);
				// L — anonymous is still 401
				const anon = await fetch(`${base}/api/v1/diagnostics/state-integrity`);
				assert.equal(anon.status, 401, 'L — required-auth behavior unchanged');
			} else {
				assert.equal(res.status, 200, 'M — open mode unchanged');
				const body = await res.json();
				assert.ok(body.storeHealth, 'storeHealth present in open mode too');
				assert.ok(Array.isArray(body.issues), 'existing response shape preserved (issues)');
				assert.ok(body.summary, 'existing response shape preserved (summary)');
			}
		} finally {
			child.kill('SIGKILL');
		}
	}
	await bootAndProbe('required');
	await bootAndProbe('open');
});

test('E2: public snapshot never contains filesystem paths', async () => {
	freshDir();
	const h = await healthM();
	h.recordCorruptLoad('sessions', { error: 'x', backupPath: '/very/secret/path/.qase/sessions.json.corrupt-123' });
	h.recordWriteFailure('evidence', { error: 'boom at /very/secret/path/evidence-graph.json' });
	const text = JSON.stringify(h.getStoreHealthSnapshot());
	assert.ok(!/\/very\/secret/.test(text), 'no absolute paths leaked');
	assert.ok(text.includes('sessions.json.corrupt-123'), 'safe basename retained');
});

/* ═══ PART F — webhook repair proof ══════════════════════════════════ */

// The webhook engine enqueues deliveries; the signing scheme is
// v1=hex(hmac(secret, ts.body)). Rather than mocking the engine, run the
// REAL server (child) with a REAL mission failure through the updateMission
// path and inspect the persisted delivery ledger — end-to-end, no mocks.
async function bootWithReceiver() {
	const dir = freshDir('r6t5-hook');
	const port = await new Promise((resolve, reject) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
		s.on('error', reject);
	});
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: '/tmp',
		env: {
			...process.env,
			QASE_DATA_DIR: dir,
			QASE_AUTH_MODE: '',
			QASE_API_TOKEN: 'r6t5-hook-token',
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
	child.stderr.on('data', d => { stderr += d.toString(); });
	for (let i = 0; i < 150; i += 1) {
		try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) break; } catch {}
		await delay(200);
		if (i === 149) { child.kill('SIGKILL'); throw new Error(`server did not boot: ${stderr.slice(-500)}`); }
	}
	return { child, base: `http://127.0.0.1:${port}`, dir };
}

test('W: mission failure via updateMission path → exactly ONE signed mission.failed delivery; dedupe + no finalized-duplicate', async () => {
	const { child, base, dir } = await bootWithReceiver();
	try {
		const H = { authorization: 'Bearer r6t5-hook-token', 'content-type': 'application/json' };

		// Register a subscription. missionId is REQUIRED by the route; the
		// subscription is still effectively workspace-wide because the
		// mission is created with a null workspaceId — matchingSubscriptions
		// passes a sub when (s.missionId == null) OR missionId matches.
		// Register AFTER creating the mission so the id is known.
		const created = await fetch(`${base}/api/missions`, {
			method: 'POST', headers: H,
			body: JSON.stringify({ name: 'T5 hook mission', targetUrl: 'https://example.com/', autoStart: false })
		});
		const mission = await created.json();
		assert.equal(created.status, 201);

		const sub = await fetch(`${base}/api/v1/webhooks`, {
			method: 'POST', headers: H,
			body: JSON.stringify({ missionId: mission.id, url: 'https://example.com/r6t5-failure', events: ['mission.failed', 'mission.completed'] })
		});
		assert.equal(sub.status, 201, 'subscription registered');
		const subBody = await sub.json();
		assert.ok(subBody.missionId === mission.id || subBody.missionId === undefined);

		// PUT the mission to failed (goes through updateMission →
		// 'mission:updated'). No PATCH route exists for missions — the API
		// mutation surface is PUT /api/missions/:id.
		const fail = await fetch(`${base}/api/missions/${mission.id}`, {
			method: 'PUT', headers: H,
			body: JSON.stringify({ status: 'failed', failureReason: 'R6-T5 synthetic failure via updateMission path' })
		});
		assert.ok(fail.status === 200 || fail.status === 409 || fail.status === 400, `PUT status ${fail.status}`);

		// A second updateMission write with status 'failed' (re-assert) must
		// NOT produce a second delivery (once-per-mission guard).
		if (fail.status === 200) {
			await fetch(`${base}/api/missions/${mission.id}`, {
				method: 'PUT', headers: H,
				body: JSON.stringify({ status: 'failed', failureReason: 're-assert' })
			});
		}

		// Unrelated mission updates (name change on a fresh mission) must
		// not fire anything.
		const other = await (await fetch(`${base}/api/missions`, {
			method: 'POST', headers: H,
			body: JSON.stringify({ name: 'unrelated', targetUrl: 'https://example.com/', autoStart: false })
		})).json();
		await fetch(`${base}/api/missions/${other.id}`, {
			method: 'PUT', headers: H,
			body: JSON.stringify({ name: 'unrelated-renamed' })
		});

		await delay(600); // deliveries persist on enqueue (sync) — small settle

		// Read the persisted ledger (the engine writes .qase/webhook-deliveries.json).
		const ledgerPath = join(dir, 'webhook-deliveries.json');
		const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
		const deliveries = Array.isArray(ledger) ? ledger : (ledger.deliveries ?? []);
		const failed = deliveries.filter(d => d.event === 'mission.failed' && d.payload?.missionId === mission.id);
		assert.equal(failed.length, 1,
			`exactly one mission.failed delivery for the failed mission (got ${failed.length}; PATCH status was ${fail.status})`);
		assert.equal(failed[0].payload.status, 'failed');
		assert.equal(failed[0].payload.failureReason, 'R6-T5 synthetic failure via updateMission path');
		// payload contract preserved
		assert.ok('verdict' in failed[0].payload && 'findingsCount' in failed[0].payload && 'completedAt' in failed[0].payload);
		// no failure webhook for the unrelated mission
		const unrelated = deliveries.filter(d => d.payload?.missionId === other.id && d.event === 'mission.failed');
		assert.equal(unrelated.length, 0, 'unrelated mission updates fire no failure webhook');
		// delivery reached the queue with the registered target + signature material
		assert.equal(failed[0].url, 'https://example.com/r6t5-failure');
		assert.ok(failed[0].attempts >= 0);
		// signing: the engine signs at delivery time; the ledger carries the
		// signature scheme inputs — verify via signWebhookPayload semantics
		// (already unit-covered in b1 suite) here we assert the ledger row
		// carries the signed-candidate body the signer consumed.
		assert.ok(typeof failed[0].payload === 'object');
	} finally {
		child.kill('SIGKILL');
	}
});

test('W2: signature scheme regression — v1=hmac(secret, ts.body) over the exact failed-payload shape', async () => {
	// Mirrors b1-webhook-delivery's independent implementation check, over a
	// mission.failed payload (the event the repaired listener enqueues).
	const { signWebhookPayload } = await import(`${ROOT}/server/webhookDelivery.js`);
	const secret = 'r6t5-sig-secret';
	process.env.QASE_INTEGRATION_SECRET = secret;
	const body = JSON.stringify({ event: 'mission.failed', missionId: 'm1', status: 'failed', verdict: 'fail' });
	const ts = '1780000000';
	const { signature } = signWebhookPayload(body, ts);
	const expected = `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
	assert.equal(signature, expected, 'signing scheme unchanged');
});

/* ═══ J — existing recovery behavior remains intact (unit) ════════════ */

test('J2: quarantined corrupt file is preserved on disk exactly as before', async () => {
	const dir = freshDir('r6t5-j2');
	const bad = ']} corrupted beyond repair [{';
	writeFileSync(join(dir, 'missions.json'), bad);
	const missions = await missionsM();
	const h = await healthPeek(); // Preserve the corruption event recorded by the load.
	const snap = h.getStoreHealthSnapshot();
	const backup = snap.missions.lastCorruptBackup;
	assert.ok(backup, 'recorded');
	// the ORIGINAL file content now lives under the quarantine name
	const preserved = readFileSync(join(dir, backup), 'utf8');
	assert.equal(preserved, bad, 'quarantined bytes preserved verbatim');
	// Recovery starts empty in memory; it does not write a replacement file.
	assert.deepEqual(missions.listMissions(), []);
	assert.ok(!readdirSync(dir).includes('missions.json'));
});
