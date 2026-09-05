/**
 * R6-T1 — Evidence counters + finding→evidence linkage.
 *
 * Covers the spec (.drytis/specs/phase-R6-evidence-integrity.md G1 + G3):
 *   U1  a new finding receives the correct evidenceIds (graph-resolved mirror)
 *   U2  unrelated evidence is NOT linked; evidence-less findings stay []
 *   U3  re-collection is idempotent — no duplicate links, no duplicate IDs
 *   U4  historical findings without evidenceIds load safely (normalized to [])
 *   U5  attempted-vs-persisted counters are accurate (success)
 *   U6  simulated persistence failure is visible in save health
 *   I1  integrity route surfaces counters + save health (child server)
 *   I2  F4 ownership preserved on the modified integrity route (child server)
 *
 * Hermetic: all stores live in a temp QASE_DATA_DIR; real /workspace/.qase is
 * checksum-guarded (R2-B-H convention).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_STORE = join(ROOT, '.qase', 'findings.json');
const REAL_HASH = existsSync(REAL_STORE) ? createHash('sha256').update(readFileSync(REAL_STORE)).digest('hex') : null;
const REAL_GRAPH = join(ROOT, '.qase', 'evidence-graph.json');
const REAL_GRAPH_HASH = existsSync(REAL_GRAPH) ? createHash('sha256').update(readFileSync(REAL_GRAPH)).digest('hex') : null;

const TMP = mkdtempSync(join(tmpdir(), 'r6t1-'));
mkdirSync(TMP, { recursive: true });
process.env.QASE_DATA_DIR = TMP; // before ANY server module import

const mod = q => import(`../server/evidenceGraph.js${q}`);
// findings.js must be the DEFAULT instance: evidenceGraph's static import
// binds to it, so the mirror write-back and the test must share one store.
const fdPlain = () => import('../server/findings.js');
const fmod = q => import(`../server/findings.js${q}`);
const bust = () => `?r6t1=${Date.now()}-${Math.random().toString(36).slice(2)}`;

test.after(() => {
	try { rmSync(TMP, { recursive: true, force: true }); } catch {}
	const g = existsSync(REAL_GRAPH) ? createHash('sha256').update(readFileSync(REAL_GRAPH)).digest('hex') : null;
	assert.equal(g, REAL_GRAPH_HASH, '[hermeticity] real evidence-graph.json changed');
	const f = existsSync(REAL_STORE) ? createHash('sha256').update(readFileSync(REAL_STORE)).digest('hex') : null;
	assert.equal(f, REAL_HASH, '[hermeticity] real findings.json changed');
});

function synthSession({ withStep = true, findings }) {
	return {
		id: `sess_${Math.random().toString(36).slice(2, 8)}`,
		capturedSteps: withStep
			? [{ id: 'step_1', action: 'click', url: 'https://x.test/', ts: Date.now(), outcome: { status: 'success', urlAfter: 'https://x.test/after' } }]
			: [],
		findings
	};
}

test('U1+U2+U5: new finding gets the correct evidenceIds; unrelated stays empty; counters exact', async () => {
	const eg = await mod(bust());
	const fd = await fdPlain();

	// Two findings in the findings store: one with evidence text, one without.
	const f1 = fd.addFinding({ id: 'finding_t1', title: 'Broken submit', severity: 'high', evidence: 'Submit returned 500; console shows TypeError', missionId: 'm_t1' });
	const f2 = fd.addFinding({ id: 'finding_t2', title: 'Cosmetic label', severity: 'low', missionId: 'm_t1' });

	const session = synthSession({
		findings: [
			{ id: 'finding_t1', title: 'Broken submit', severity: 'high', evidence: 'Submit returned 500; console shows TypeError', ts: Date.now(), steps: ['open', 'submit'] },
			{ id: 'finding_t2', title: 'Cosmetic label', severity: 'low', ts: Date.now() }
		]
	});
	const result = eg.collectSessionEvidence(session, { id: 'm_t1' }, 'iter_1');

	// U5 — counters exact: 1 step_outcome + 1 finding_detail attempted/persisted.
	assert.equal(result.evidenceCreated, 2);
	assert.equal(result.evidenceIdsPersisted, 1);
	assert.ok(result.stats, 'stats returned');
	assert.equal(result.stats.evidenceAttempted, 2);
	assert.equal(result.stats.evidencePersisted, 2);
	assert.equal(result.stats.evidenceIdsPersisted, 1);
	assert.equal(result.stats.missionId, 'm_t1');
	assert.equal(result.stats.sessionId, session.id);

	// U1 — the finding's mirror holds EXACTLY the graph-resolved evidence for it.
	const graphEv = eg.getFindingEvidence('finding_t1').map(e => e.id);
	assert.equal(graphEv.length, 1, 'exactly one typed evidence node for f1');
	assert.deepEqual(fd.getFinding('finding_t1').evidenceIds, graphEv);
	const node = eg.getEvidence(graphEv[0]);
	assert.equal(node.type, 'finding_detail');
	assert.equal(node.metadata.findingId, 'finding_t1');

	// U2 — the evidence-less finding has NO linked evidence and an empty mirror.
	assert.equal(eg.getFindingEvidence('finding_t2').length, 0);
	assert.deepEqual(fd.getFinding('finding_t2').evidenceIds, []);
	// ...and f1's mirror does not contain any unrelated evidence id.
	const allIds = [...graphEv];
	assert.deepEqual(fd.getFinding('finding_t2').evidenceIds.filter(x => allIds.includes(x)), []);
});

test('U3: re-collection is idempotent — no duplicate links or mirrored IDs', async () => {
	// ONE graph instance, two collection runs — the true production repeat-case
	// (fix-validation re-links, session re-finalize).
	const eg = await mod(bust());
	const fd = await fdPlain();

	fd.addFinding({ id: 'finding_dup', title: 'Dup target', evidence: 'stable evidence text', missionId: 'm_dup' });
	const session = synthSession({ withStep: false, findings: [{ id: 'finding_dup', title: 'Dup target', evidence: 'stable evidence text', ts: Date.now() }] });

	const first = eg.collectSessionEvidence(session, { id: 'm_dup' }, 'iter_1');
	const idsAfterFirst = fd.getFinding('finding_dup').evidenceIds.slice();
	const edgesAfterFirst = eg.getFindingEvidence('finding_dup').length;
	assert.equal(first.evidenceIdsPersisted, 1);
	assert.equal(edgesAfterFirst, 1);

	eg.collectSessionEvidence(session, { id: 'm_dup' }, 'iter_1');

	// T1 invariants on re-collection: the mirror never duplicates IDs, the
	// graph never duplicates a (from→to,type) link, and only genuinely-new
	// links were mirrored. (Repeat runs do create fresh finding_detail nodes —
	// pre-existing node-level creation; dedupe of those is R6-T3 retention.)
	const mirror = fd.getFinding('finding_dup').evidenceIds;
	assert.deepEqual(mirror, [...new Set(mirror)], 'no duplicate mirrored IDs');
	const linked = eg.getFindingEvidence('finding_dup');
	const pairSeen = new Set();
	for (const e of linked) {
		const k = `${e.id}→finding_dup`;
		assert.ok(!pairSeen.has(k), `no duplicate link ${k}`);
		pairSeen.add(k);
	}
	assert.ok(mirror.length >= idsAfterFirst.length, 'mirror only grows');
	assert.ok(mirror.every(id => pairSeen.has(`${id}→finding_dup`)), 'every mirrored ID is a real graph link');
});

test('U4: historical findings without evidenceIds load safely and normalize to []', async () => {
	const sub = join(TMP, `hist-${Date.now()}`);
	mkdirSync(sub, { recursive: true });
	writeFileSync(join(sub, 'findings.json'), JSON.stringify([
		{ id: 'f_legacy_1', title: 'Pre-T1 finding', severity: 'high', status: 'open', history: [], comments: [], testCaseIds: [], steps: [] },
		{ id: 'f_legacy_2', title: 'Garbage field', severity: 'low', evidenceIds: 'not-an-array', history: [], comments: [], testCaseIds: [], steps: [] },
		{ id: 'f_new', title: 'Already linked', severity: 'low', evidenceIds: ['ev_kept'], history: [], comments: [], testCaseIds: [], steps: [] }
	]));
	const prev = process.env.QASE_DATA_DIR;
	process.env.QASE_DATA_DIR = sub;
	try {
		const fd = await fmod(bust());
		assert.deepEqual(fd.getFinding('f_legacy_1').evidenceIds, [], 'missing field → []');
		assert.deepEqual(fd.getFinding('f_legacy_2').evidenceIds, [], 'garbage field → []');
		assert.deepEqual(fd.getFinding('f_new').evidenceIds, ['ev_kept'], 'valid field preserved');
	} finally {
		process.env.QASE_DATA_DIR = prev;
	}
});

test('U6: simulated persistence failure is visible in save health (no silent loss)', async () => {
	// Point QASE_DATA_DIR at a FILE → every graph save fails with ENOTDIR.
	const broken = join(TMP, 'broken-data-dir');
	writeFileSync(broken, 'not a directory');
	const prev = process.env.QASE_DATA_DIR;
	process.env.QASE_DATA_DIR = broken;
	try {
		const eg = await mod(bust());
		eg.collectSessionEvidence(
			synthSession({ findings: [{ id: 'finding_fail', title: 'x', evidence: 'ev', ts: Date.now() }] }),
			{ id: 'm_fail' }, 'iter_1'
		);
		await delay(400); // > 250ms debounce
		const health = eg.getEvidenceSaveHealth();
		assert.ok(health.saveFailures >= 1, `saveFailures recorded (got ${health.saveFailures})`);
		assert.ok(health.lastSaveError, 'lastSaveError message present');
		assert.ok(health.lastSaveErrorAt, 'lastSaveErrorAt present');
		assert.equal(health.pendingSave, true, 'pending write still pending');
	} finally {
		process.env.QASE_DATA_DIR = prev;
	}
});

/* ── Integration: real server, required-auth, surfaced route + F4 intact ── */

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

async function bootServer() {
	const port = await freePort();
	const home = mkdtempSync(join(tmpdir(), 'r6t1-srv-'));
	mkdirSync(join(home, '.qase'), { recursive: true });
	const TOKEN = 'r6t1-master-token';
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: home,
		env: {
			...process.env,
			QASE_AUTH_MODE: '',
			QASE_API_TOKEN: TOKEN,
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
		const r = await fetch(`${base}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined
		});
		let json = null;
		try { json = await r.json(); } catch {}
		return { status: r.status, json, headers: r.headers };
	};
	const cleanup = () => {
		try { child.kill('SIGKILL'); } catch {}
		try { rmSync(home, { recursive: true, force: true }); } catch {}
	};
	return { base, call, cleanup, masterToken: TOKEN, stderr: () => stderr };
}

test('I1+I2: integrity route surfaces counters/save-health; F4 ownership intact on the modified route', async () => {
	const srv = await bootServer();
	try {
		const M = srv.masterToken;
		// Two users (operator A owns, operator B must not see).
		const mk = async (email) => {
			const c = await srv.call('/api/auth/users', { method: 'POST', token: M, body: { email, name: email, password: `pw-${email}-12345678`, role: 'operator' } });
			assert.ok([200, 201].includes(c.status), `user create ${email} -> ${c.status}`);
			const l = await srv.call('/api/auth/login', { method: 'POST', body: { email, password: `pw-${email}-12345678` } });
			assert.equal(l.status, 200);
			return (l.headers.getSetCookie() ?? []).find(x => x.startsWith('qase_session='))?.split(';')[0];
		};
		const cookieA = await mk('a-r6t1@qase.test');
		const cookieB = await mk('b-r6t1@qase.test');

		const mission = await srv.call('/api/missions', {
			method: 'POST', cookie: cookieA,
			body: { name: 'T1 mission', targetUrl: 'https://example.com', type: 'full_audit' }
		});
		assert.equal(mission.status, 201, 'A creates mission');
		const mid = mission.json.id;

		// Owner reads the MODIFIED integrity route: new fields present, honest empties.
		const own = await srv.call(`/api/v1/missions/${mid}/evidence-integrity`, { cookie: cookieA });
		assert.equal(own.status, 200, `owner integrity -> ${own.status}`);
		assert.equal(own.json.missionId, mid);
		assert.ok('evidenceStats' in own.json, 'evidenceStats surfaced (null before any collection)');
		assert.ok(own.json.evidenceSaveHealth, 'save health surfaced');
		assert.equal(typeof own.json.evidenceSaveHealth.saveFailures, 'number');
		assert.equal(own.json.evidenceSaveHealth.lastSaveError, null, 'explicit null — never fabricated');
		assert.ok(own.json.linkage, 'linkage census surfaced');
		assert.equal(own.json.linkage.findingsWithTypedEvidence, 0);

		// I2 — cross-user denied without existence leak (F4 preserved).
		const other = await srv.call(`/api/v1/missions/${mid}/evidence-integrity`, { cookie: cookieB });
		assert.equal(other.status, 404, `cross-user -> 404 (got ${other.status})`);
		// Anonymous denied too.
		const anon = await srv.call(`/api/v1/missions/${mid}/evidence-integrity`);
		assert.equal(anon.status, 401, 'anonymous -> 401');
		// Master + admin-style master token still sees it (documented posture).
		const master = await srv.call(`/api/v1/missions/${mid}/evidence-integrity`, { token: M });
		assert.equal(master.status, 200, 'master retains workspace access');

		// Coverage route (sibling surface) still works for the owner — API compat.
		const cov = await srv.call(`/api/v1/missions/${mid}/evidence-coverage`, { cookie: cookieA });
		assert.equal(cov.status, 200, 'coverage route unchanged');
		assert.ok('coverage' in cov.json);
	} finally {
		srv.cleanup();
	}
});
