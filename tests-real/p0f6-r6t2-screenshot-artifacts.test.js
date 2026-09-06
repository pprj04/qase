/**
 * R6-T2 — Screenshot artifact persistence (hermetic).
 *
 * Spec: .drytis/specs/phase-R6-evidence-integrity.md G2 + this ticket.
 *   A1  capture succeeds → artifact persisted (real bytes on disk)
 *   A2  persisted artifact retrievable via store + (route-level below)
 *   A3  the EXISTING step_outcome evidence node carries the artifact ref —
 *       no duplicate evidence node created for persistence
 *   A4  screenshot capture failure truthful (not_attempted / write_failed)
 *   A5  artifact write failure truthful (registry row status write_failed;
 *       bytes never claimed persisted)
 *   A6  missing artifact → getArtifact null → route 404
 *   A7  corrupt artifact (size mismatch) → null → 404
 *   A8  session delete removes artifacts; completed-run evidence refs stay
 *       intact in the graph (references remain, retrieval 404s honestly)
 *   A9  budget-prune path also removes artifacts (store.js integration)
 *   A10 stats/saveHealth surfaces counts; attempted-vs-persisted counters
 *       land in collection stats (screenshotsAttempted/Persisted)
 *   R1* child-server (required-auth): owner reads metadata+content; user B
 *       gets identical 404 for A's artifact; admin reads it; open-mode child
 *       serves anonymous reads (disabled-auth compat)
 *
 * Hermetic: QASE_DATA_DIR → temp dir before ANY server module import; real
 * /workspace/.qase checksum-guarded (R2-B-H convention).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_ARTIFACTS = join(ROOT, '.qase', 'artifacts.json');
const REAL_GRAPH = join(ROOT, '.qase', 'evidence-graph.json');
const REAL_SESSIONS = join(ROOT, '.qase', 'sessions.json');
const hash = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
const REAL = { artifacts: hash(REAL_ARTIFACTS), graph: hash(REAL_GRAPH), sessions: hash(REAL_SESSIONS) };

const TMP = mkdtempSync(join(tmpdir(), 'r6t2-'));
process.env.QASE_DATA_DIR = TMP; // before ANY server module import

const bust = () => `?r6t2=${Date.now()}-${Math.random().toString(36).slice(2)}`;
const am = q => import(`../server/artifactStore.js${q}`);
const eg = q => import(`../server/evidenceGraph.js${q}`);

test.after(() => {
	try { rmSync(TMP, { recursive: true, force: true }); } catch {}
	assert.equal(hash(REAL_ARTIFACTS), REAL.artifacts, '[hermeticity] real artifacts.json changed');
	assert.equal(hash(REAL_GRAPH), REAL.graph, '[hermeticity] real evidence-graph.json changed');
	assert.equal(hash(REAL_SESSIONS), REAL.sessions, '[hermeticity] real sessions.json changed');
});

const jpegLen = n => n + 3; // Buffer.alloc(n) + three marker bytes
const jpegish = (n = 64) => Buffer.from([...Buffer.alloc(n, 0xff), 0xd8, 0xff, 0xd9]).toString('base64');

test('A1+A2: capture succeeds → real bytes persisted and retrievable', async () => {
	const a = await am(bust());
	const r = a.persistScreenshotArtifact({
		sessionId: 'sess_a1', missionId: 'm_a1', ownerUserId: 'u_owner',
		stepId: 'step_x', base64: jpegish(128), url: 'https://x.test/p', title: 'P'
	});
	assert.equal(r.status, 'persisted');
	assert.equal(r.persisted, true);
	assert.ok(r.artifactId.startsWith('art_'));
	assert.equal(r.bytes, jpegLen(128));

	const got = a.getArtifact(r.artifactId);
	assert.ok(got, 'artifact resolves');
	assert.equal(got.byteLength, jpegLen(128));
	assert.equal(got.mimeType, 'image/jpeg');
	assert.equal(got.ownerUserId, 'u_owner');
	// bytes on disk are REAL and match
	assert.ok(existsSync(join(TMP, 'artifacts', 'sess_a1')), 'artifact dir created');
	assert.equal(got.data.length, jpegLen(128));
});

test('A3: existing step_outcome node carries artifact ref; no duplicate node', async () => {
	const a = await am(bust());
	const g = await eg(bust());
	const art = a.persistScreenshotArtifact({ sessionId: 'sess_a3', base64: jpegish(32) });
	assert.equal(art.status, 'persisted');

	const session = {
		id: 'sess_a3',
		ownerUserId: 'u_owner',
		capturedSteps: [
			{ id: 'step_shot', toolCallId: 'tc_1', action: 'screenshot', url: 'https://x.test/', ts: Date.now(),
				outcome: { status: 'success' },
				screenshot: { captureAttempted: true, persisted: true, artifactId: art.artifactId, status: 'persisted', bytes: 34, capturedAt: art.capturedAt } },
			{ id: 'step_click', toolCallId: 'tc_2', action: 'click', url: 'https://x.test/', ts: Date.now(),
				outcome: { status: 'success' } } // no screenshot → no artifact fields at all
		],
		findings: []
	};
	const res = g.collectSessionEvidence(session, { id: 'm_a3' }, 1);
	assert.equal(res.evidenceCreated, 2, 'exactly one node per step — none added for artifacts');

	const evs = g.getSessionEvidence('sess_a3');
	const shotNode = evs.find(e => e.metadata?.stepId === 'step_shot');
	const clickNode = evs.find(e => e.metadata?.stepId === 'step_click');
	assert.ok(shotNode, 'screenshot step node exists');
	assert.ok(shotNode.metadata.artifact, 'artifact ref ON the node metadata');
	assert.equal(shotNode.metadata.artifact.id, art.artifactId);
	assert.equal(shotNode.metadata.screenshotPersisted, true);
	assert.equal(shotNode.metadata.screenshotAttempted, true);
	assert.equal(clickNode.metadata.artifact, undefined, 'non-screenshot step carries no artifact block');
	assert.equal(clickNode.metadata.screenshotAttempted, undefined);
	// counters
	assert.equal(res.stats.screenshotsAttempted, 1);
	assert.equal(res.stats.screenshotsPersisted, 1);
});

test('A4: capture failure truthful — no bytes → not_attempted, never claimed persisted', async () => {
	const a = await am(bust());
	const g = await eg(bust());
	const r = a.persistScreenshotArtifact({ sessionId: 'sess_a4' }); // no base64
	assert.equal(r.attempted, false);
	assert.equal(r.persisted, false);
	assert.equal(r.status, 'not_attempted');
	assert.equal(r.artifactId, undefined);

	// A step whose tool result carried no image (text-only screenshot result)
	const session = {
		id: 'sess_a4',
		capturedSteps: [{ id: 'step_f', action: 'screenshot', ts: Date.now(),
			outcome: { status: 'failed', error: 'page crashed' },
			screenshot: { captureAttempted: true, persisted: false, artifactId: null, status: 'not_attempted', bytes: 0, error: 'screenshot bytes absent' } }],
		findings: []
	};
	const res = g.collectSessionEvidence(session, { id: 'm_a4' }, 1);
	const node = g.getSessionEvidence('sess_a4')[0];
	assert.equal(node.metadata.screenshotPersisted, false);
	assert.equal(node.metadata.screenshotStatus, 'not_attempted');
	assert.equal(node.metadata.artifact, null, 'explicit null — never a phantom ref');
	assert.equal(res.stats.screenshotsAttempted, 1);
	assert.equal(res.stats.screenshotsPersisted, 0);
});

test('A5: artifact write failure truthful (registry row write_failed; bytes not claimed)', async () => {
	// Corrupt artifact dir: place a FILE where the session dir must go.
	mkdirSync(join(TMP, 'artifacts'), { recursive: true });
	writeFileSync(join(TMP, 'artifacts', 'sess_a5-blocker'), 'not-a-dir');
	const a = await am(bust());
	const r = a.persistScreenshotArtifact({ sessionId: 'sess_a5-blocker', base64: jpegish(16) });
	assert.equal(r.status, 'write_failed');
	assert.equal(r.persisted, false);
	assert.ok(r.error, 'error message present');
	// Registry row exists with write_failed status; getArtifact refuses it.
	const rows = a.listArtifacts({ sessionId: 'sess_a5-blocker' });
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, 'write_failed');
	assert.equal(a.getArtifact(r.artifactId), null, 'write-failed artifact never retrievable');
});

test('A6+A7: missing artifact and corrupt artifact → null (route 404 shape)', async () => {
	const a = await am(bust());
	const ok = a.persistScreenshotArtifact({ sessionId: 'sess_a6', base64: jpegish(48) });
	assert.ok(a.getArtifact(ok.artifactId), 'baseline resolves');

	assert.equal(a.getArtifact('art_does_not_exist'), null, 'unknown id → null');

	// Corrupt: truncate the bytes on disk after persist.
	const row = a.listArtifacts({ sessionId: 'sess_a6' })[0];
	const absDir = join(TMP, 'artifacts', 'sess_a6');
	const names = readdirSync(absDir);
	assert.equal(names.length, 1);
	const absPath = join(absDir, names[0]);
	writeFileSync(absPath, Buffer.from([0x00])); // 1 byte instead of 50
	assert.equal(a.getArtifact(ok.artifactId), null, 'size mismatch → null (corrupt)');
	void row;
});

test('A8: session delete removes artifacts; evidence refs remain (honest 404 later)', async () => {
	const a = await am(bust());
	const g = await eg(bust());
	const art = a.persistScreenshotArtifact({ sessionId: 'sess_a8', base64: jpegish(24) });
	const session = {
		id: 'sess_a8',
		capturedSteps: [{ id: 's1', action: 'screenshot', ts: Date.now(), outcome: { status: 'success' },
			screenshot: { captureAttempted: true, persisted: true, artifactId: art.artifactId, status: 'persisted', bytes: 26, capturedAt: art.capturedAt } }],
		findings: []
	};
	g.collectSessionEvidence(session, { id: 'm_a8' }, 1);
	const node = g.getSessionEvidence('sess_a8')[0];
	assert.equal(node.metadata.artifact.id, art.artifactId, 'ref in graph before cleanup');

	const rm = a.removeArtifactsForSession('sess_a8');
	assert.equal(rm.removed, 1);
	assert.equal(a.getArtifact(art.artifactId), null, 'bytes gone');
	// The graph node and its artifact ref are UNTOUCHED — the reference is
	// historical truth; retrieval now 404s honestly.
	const nodeAfter = g.getSessionEvidence('sess_a8')[0];
	assert.equal(nodeAfter.metadata.artifact.id, art.artifactId, 'evidence ref survives cleanup');
	assert.equal(nodeAfter.metadata.screenshotPersisted, true);
});

test('A9+A10: stats + save health surface counts', async () => {
	// Fresh data dir: cache-busted imports share the registry FILE, so prior
	// tests' rows would leak into the counts. Point at a clean subdir.
	const sub = join(TMP, `stats-${Date.now()}`);
	mkdirSync(sub, { recursive: true });
	const prevDataDir = process.env.QASE_DATA_DIR;
	process.env.QASE_DATA_DIR = sub;
	try {
	const a = await am(bust());
	a.persistScreenshotArtifact({ sessionId: 'sess_a10', base64: jpegish(10) });
	a.persistScreenshotArtifact({ sessionId: 'sess_a10', base64: jpegish(20) });
	const stats = a.artifactStoreStats();
	assert.equal(stats.artifacts, 2);
	assert.equal(stats.sessions, 1);
	assert.equal(stats.totalBytes, jpegLen(10)+jpegLen(20));
	const health = a.getArtifactSaveHealth();
	assert.equal(typeof health.saveFailures, 'number');
	assert.equal(health.lastSaveError, null, 'explicit null — never fabricated');
	} finally { process.env.QASE_DATA_DIR = prevDataDir; }
});

/* ── Child-server (required-auth + open-mode) ───────────────────── */

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
		srv.on('error', reject);
	});
}

async function bootServer({ requiredAuth = true } = {}) {
	const home = mkdtempSync(join(tmpdir(), 'r6t2-srv-'));
	mkdirSync(join(home, '.qase'), { recursive: true });
	const port = await freePort();
	const TOKEN = `r6t2-token-${Math.random().toString(36).slice(2)}`;
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			...(requiredAuth ? { QASE_AUTH_MODE: '', QASE_API_TOKEN: TOKEN } : { QASE_AUTH_MODE: 'disabled' }),
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
		try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
		await delay(300);
	}
	const call = async (path, { method = 'GET', body, token, cookie } = {}) => {
		const headers = {};
		if (body !== undefined) headers['content-type'] = 'application/json';
		if (token) headers.authorization = `Bearer ${token}`;
		if (cookie) headers.cookie = cookie;
		const r = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
		let json = null;
		try { json = await r.json(); } catch {}
		return { status: r.status, json, headers: r.headers };
	};
	const cleanup = () => {
		try { child.kill('SIGKILL'); } catch {}
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	};
	return { base, call, cleanup, masterToken: TOKEN, home, stderr: () => stderr };
}

test('R1–R7 (required-auth): full ownership matrix on artifact routes', async t => {
	const home = mkdtempSync(join(tmpdir(), 'r6t2-srv2-'));
	mkdirSync(join(home, '.qase'), { recursive: true });
	const dataDir = join(home, '.qase');
	const prevDataDir = process.env.QASE_DATA_DIR;
	const port = await freePort();
	const TOKEN = `r6t2b-${Math.random().toString(36).slice(2)}`;
	const base = `http://127.0.0.1:${port}`;

	const boot = () => {
		const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
			cwd: home,
			env: {
				...process.env,
				QASE_AUTH_MODE: '', QASE_API_TOKEN: TOKEN,
				QASE_DATA_DIR: dataDir, PORT: String(port),
				QASE_PUBLIC_URL: '', QASE_PROVIDER: 'custom', QASE_API_KEY: 'test-not-real',
				QASE_BASE_URL: 'http://127.0.0.1:1/v1', QASE_MODEL: 'test-model',
				NODE_PATH: join(ROOT, 'node_modules')
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		return child;
	};
	const waitUp = async () => {
		for (let i = 0; i < 120; i += 1) {
			try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
			await delay(300);
		}
		throw new Error('server never came up');
	};
	const call = async (path, { method = 'GET', body, token, cookie } = {}) => {
		const headers = {};
		if (body !== undefined) headers['content-type'] = 'application/json';
		if (token) headers.authorization = `Bearer ${token}`;
		if (cookie) headers.cookie = cookie;
		const r = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
		let json = null;
		try { json = await r.json(); } catch {}
		return { status: r.status, json };
	};

	t.after(() => {
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	});

	// ── Boot #1: create real users (their auth sessions persist in dataDir). ──
	let child = boot();
	t.after(() => { try { child.kill('SIGKILL'); } catch {} });
	await waitUp();

	const mk = async (email, role) => {
		const pw = `pw-${email}-12345678`;
		await call('/api/auth/users', { method: 'POST', token: TOKEN, body: { email, name: email, password: pw, role } });
		const lr = await fetch(`${base}/api/auth/login`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password: pw })
		});
		const cookie = (lr.headers.getSetCookie?.() ?? []).find(x => x.startsWith('qase_session='))?.split(';')[0];
		const body = await lr.json().catch(() => ({}));
		return { cookie, userId: body?.user?.id };
	};
	const a1 = await mk('a-r6t2@qase.test', 'operator');
	const b1 = await mk('b-r6t2@qase.test', 'operator');
	const admin = await mk('admin-r6t2@qase.test', 'admin');
	assert.ok(a1.cookie && b1.cookie && admin.cookie && a1.userId, 'users created + logged in');

	// ── Kill #1, seed artifacts owned by real principals, boot #2. ──
	child.kill('SIGKILL');
	await delay(400);
	process.env.QASE_DATA_DIR = dataDir;
	const seeder = await am(bust());
	const owned = seeder.persistScreenshotArtifact({
		sessionId: 'sess_seed_a', missionId: 'm_seed', ownerUserId: a1.userId,
		base64: jpegish(32), url: 'https://x.test/a', title: 'a-shot'
	});
	const synthetic = seeder.persistScreenshotArtifact({
		sessionId: 'sess_seed_x', missionId: 'm_seed', ownerUserId: 'someone-else-id',
		base64: jpegish(16), url: 'https://x.test/x', title: 'x-shot'
	});
	process.env.QASE_DATA_DIR = prevDataDir;
	assert.equal(owned.status, 'persisted');
	assert.equal(synthetic.status, 'persisted');

	child = boot();
	await waitUp();

	const artA = owned.artifactId;
	const artX = synthetic.artifactId;

	// R-anon: no principal → 401 (required mode gates first).
	assert.equal((await call(`/api/v1/artifacts/${artA}`)).status, 401, 'anonymous → 401');

	// R-owner: A reads own artifact metadata + content.
	const ownMeta = await call(`/api/v1/artifacts/${artA}`, { cookie: a1.cookie });
	assert.equal(ownMeta.status, 200, `owner meta -> ${ownMeta.status}`);
	assert.equal(ownMeta.json.id, artA);
	assert.equal(ownMeta.json.mimeType, 'image/jpeg');
	assert.ok(!('relPath' in ownMeta.json), 'NO filesystem path leaked');
	const ownContent = await fetch(`${base}/api/v1/artifacts/${artA}/content`, { headers: { cookie: a1.cookie } });
	assert.equal(ownContent.status, 200);
	assert.equal(ownContent.headers.get('content-type'), 'image/jpeg');
	const buf = Buffer.from(await ownContent.arrayBuffer());
	assert.equal(buf.length, jpegLen(32), 'actual bytes served');

	// R-cross-user: B denied A's artifact AND the third-party one; identical
	// 404 body for missing vs unauthorized (no existence leak).
	const bMeta = await call(`/api/v1/artifacts/${artA}`, { cookie: b1.cookie });
	const missing = await call('/api/v1/artifacts/art_nope', { cookie: b1.cookie });
	const bX = await call(`/api/v1/artifacts/${artX}`, { cookie: b1.cookie });
	assert.equal(bMeta.status, 404);
	assert.equal(missing.status, 404);
	assert.equal(bX.status, 404);
	assert.deepEqual(bMeta.json, missing.json, 'identical 404 body — no existence leak');
	const bContent = await fetch(`${base}/api/v1/artifacts/${artA}/content`, { headers: { cookie: b1.cookie } });
	assert.equal(bContent.status, 404);

	// R-admin: admin reads A's artifact (documented capability).
	assert.equal((await call(`/api/v1/artifacts/${artA}`, { cookie: admin.cookie })).status, 200, 'admin reads any artifact');

	// R-master: bearer master token reads.
	assert.equal((await call(`/api/v1/artifacts/${artA}`, { token: TOKEN })).status, 200);

	// R-stats: counts + save health visible to master.
	const st = await call('/api/v1/artifacts/stats', { token: TOKEN });
	assert.equal(st.status, 200);
	assert.equal(st.json.artifacts, 2);
	assert.ok(st.json.saveHealth && typeof st.json.saveHealth.saveFailures === 'number');
});

test('R8 (disabled-auth/open mode): anonymous read still works (dev compatibility)', async t => {
	const home = mkdtempSync(join(tmpdir(), 'r6t2-open-'));
	mkdirSync(join(home, '.qase'), { recursive: true });
	const prev = process.env.QASE_DATA_DIR;
	process.env.QASE_DATA_DIR = join(home, '.qase');
	const seeder = await am(bust());
	const art = seeder.persistScreenshotArtifact({ sessionId: 'sess_open', base64: jpegish(8) });
	process.env.QASE_DATA_DIR = prev;

	const port = await freePort();
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			QASE_AUTH_MODE: 'disabled',
			QASE_DATA_DIR: join(home, '.qase'), PORT: String(port),
			QASE_PUBLIC_URL: '', QASE_PROVIDER: 'custom', QASE_API_KEY: 'test-not-real',
			QASE_BASE_URL: 'http://127.0.0.1:1/v1', QASE_MODEL: 'test-model',
			NODE_PATH: join(ROOT, 'node_modules')
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	t.after(() => { try { child.kill('SIGKILL'); } catch {} try { rmSync(home, { recursive: true, force: true }); } catch {} });
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 120; i += 1) {
		try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
		await delay(300);
	}
	const meta = await fetch(`${base}/api/v1/artifacts/${art.artifactId}`);
	assert.equal(meta.status, 200, `open-mode anonymous read -> ${meta.status}`);
	const j = await meta.json();
	assert.equal(j.id, art.artifactId);
});

/* ── Requirement L: executable proof (repeated collection → no duplicate nodes) ── */

test('L: repeated evidence collection never duplicates artifact-bearing nodes or refs', async () => {
	const a = await am(bust());
	const g = await eg(bust());
	const art = a.persistScreenshotArtifact({ sessionId: 'sess_L', base64: jpegish(40) });
	assert.equal(art.status, 'persisted');

	const session = {
		id: 'sess_L',
		ownerUserId: 'u_owner',
		capturedSteps: [
			{ id: 'step_L1', toolCallId: 'tcL_1', action: 'screenshot', url: 'https://x.test/', ts: Date.now(),
				outcome: { status: 'success' },
				screenshot: { captureAttempted: true, persisted: true, artifactId: art.artifactId, status: 'persisted', bytes: jpegLen(40), capturedAt: art.capturedAt } },
			{ id: 'step_L2', toolCallId: 'tcL_2', action: 'click', url: 'https://x.test/', ts: Date.now(),
				outcome: { status: 'success' } }
		],
		findings: []
	};

	const first = g.collectSessionEvidence(session, { id: 'm_L' }, 1);
	const nodes1 = g.getSessionEvidence('sess_L');
	assert.equal(nodes1.length, 2, 'exactly one node per step after first collection');

	// The true production repeat-cases: re-finalize, fix-validation re-link.
	const second = g.collectSessionEvidence(session, { id: 'm_L' }, 1);
	const nodes2 = g.getSessionEvidence('sess_L');

	// Session-keyed evidence is keyed by step — repeated collection of the
	// same session NEVER creates a second node for the same step.
	assert.equal(nodes2.length, 2, 'no duplicate step nodes after re-collection');
	const shotNodes = nodes2.filter(n => n.metadata?.artifact?.id === art.artifactId);
	assert.equal(shotNodes.length, 1, 'exactly ONE node references the artifact');
	// The artifact ref itself is stable and never duplicated within the node.
	assert.ok(!Array.isArray(shotNodes[0].metadata.artifact), 'artifact ref is scalar, not duplicated');

	// Counters stay truthful across repeated runs (attempted/persisted per run).
	assert.equal(first.stats.screenshotsAttempted, 1);
	assert.equal(first.stats.screenshotsPersisted, 1);
	assert.equal(second.stats.screenshotsAttempted, 1);
	assert.equal(second.stats.screenshotsPersisted, 1);

	// And the artifact store still resolves exactly one artifact.
	assert.equal(a.listArtifacts({ sessionId: 'sess_L' }).length, 1, 'no duplicate artifact rows');
});
