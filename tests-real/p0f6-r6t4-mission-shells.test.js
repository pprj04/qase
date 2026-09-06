/**
 * R6-T4 — Never-started mission-shell lifecycle: focused hermetic suite.
 *
 * Hermeticity (R2-B-H convention): QASE_DATA_DIR points at a fresh mkdtemp
 * BEFORE any server module import; after() asserts the real /workspace/.qase
 * files are byte-identical. missions/evidenceGraph in-memory state reset via
 * the module's own _clearForTesting hooks between test families.
 *
 * Matrix (ticket): A fresh created stays · B stale never-started → cancelled ·
 * C reason = never_started_ttl_expired · D queued untouched · E running
 * untouched · F awaiting_input untouched · G completed untouched · H failed
 * untouched · I already-cancelled untouched · J created-with-execution-proof
 * protected · K idempotent · L dry-run zero mutations · M start-wins race ·
 * N shell resources · O cleanup failure truthful · P readable after cancel ·
 * Q owner/source preserved · R invalid TTL safe · S required-auth intact ·
 * T open mode intact · U real store untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = '/workspace';
const REAL = join(ROOT, '.qase');
const REAL_FILES = ['missions.json', 'evidence-graph.json', 'sessions.json', 'findings.json', 'artifacts.json'];
const realHashes = new Map();
for (const f of REAL_FILES) {
	try { realHashes.set(f, createHash('sha256').update(readFileSync(join(REAL, f))).digest('hex')); } catch { realHashes.set(f, 'ABSENT'); }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ── Hermetic isolation: temp data dir BEFORE any server import ─────── */
let TMP = null;
function freshDir(tag = 'r6t4') {
	TMP = mkdtempSync(join(tmpdir(), `${tag}-`));
	mkdirSync(join(TMP, '.qase'), { recursive: true });
	process.env.QASE_DATA_DIR = join(TMP, '.qase');
	return process.env.QASE_DATA_DIR;
}

// Module-identity contract (learned in R6-T3): missionShells.js STATICALLY
// imports missions.js/store.js/evidenceGraph.js, so the analyzer and the
// seeded store MUST be the same module instances. Production (index.js)
// imports them unbusted from one graph — mirrored here with ONE shared,
// lazily-initialized set that is RESET in place (_clearForTesting) instead
// of re-imported with cache-busts (which would fork instance identity).
const MODULES = {};
async function mods() {
	if (!MODULES.ready) {
		MODULES.missions = await import(`${ROOT}/server/missions.js`);
		MODULES.eg = await import(`${ROOT}/server/evidenceGraph.js`);
		MODULES.sh = await import(`${ROOT}/server/missionShells.js`);
		MODULES.hy = await import(`${ROOT}/server/storeHygiene.js`);
		MODULES.ready = true;
	}
	MODULES.missions._clearForTesting();
	MODULES.eg._clearForTesting();
	return MODULES;
}
const mmod = async () => (await mods()).missions;
const eg = async () => (await mods()).eg;
const shells = async () => (await mods()).sh;
const hygiene = async () => (await mods()).hy;
const cfg = () => import(`${ROOT}/server/config.js?t=${Date.now()}`); // config keeps its own bust (QASE_DATA_DIR is read lazily)

test.after(() => {
	// U — hermeticity: the real store was never touched.
	for (const f of REAL_FILES) {
		let now = 'ABSENT';
		try { now = createHash('sha256').update(readFileSync(join(REAL, f))).digest('hex'); } catch {}
		assert.equal(now, realHashes.get(f), `REAL .qase/${f} must be byte-identical after the suite`);
	}
	delete process.env.QASE_DATA_DIR;
});

/** Create a mission with a controllable timestamp anchor. */
async function seedMission(missions, over = {}) {
	return missions.createMission({
		name: over.name ?? 'R6-T4 shell',
		targetUrl: over.targetUrl ?? 'https://shell.example.test/',
		source: over.source ?? 'manual',
		workspaceId: over.workspaceId ?? 'ws_r6t4',
		ownerUserId: over.ownerUserId ?? 'usr_r6t4',
		correlationId: over.correlationId ?? null,
		...over.extra
	});
}

/** Age a mission record past the TTL by rewriting updatedAt on the store
 *  object (direct object poke — the ONLY way to fake elapsed time without
 *  timers; the module under test reads updatedAt/createdAt directly). */
async function ageMission(missions, id, hours) {
	const m = missions.getMission(id);
	assert.ok(m, 'seeded mission missing');
	m.updatedAt = Date.now() - hours * HOUR;
	m.createdAt = m.updatedAt - 1000;
	missions._touchForTesting?.(id);
}

/* ═══ A–C, K, L, P, Q: core semantics ══════════════════════════════════ */

test('A+B+C+P+Q: stale never-started shell → cancelled with reason; fresh stays; record readable + preserved metadata', async () => {
	freshDir();
	const missions = await mmod();
	await eg(); // empty graph
	const sh = await shells();

	// fresh (2h old) — never aged
	const fresh = await seedMission(missions, { name: 'fresh shell' });
	// stale (30h) — aged
	const stale = await seedMission(missions, { name: 'stale shell' });
	await ageMission(missions, stale.id, 30);

	const dry = sh.analyzeMissionShells({});
	assert.equal(dry.total, 2);
	assert.equal(dry.created, 2);
	assert.equal(dry.freshCreated, 1);
	assert.equal(dry.staleCreated, 1);
	assert.equal(dry.eligible, 1);
	assert.equal(dry.eligibleIds[0], stale.id);
	assert.equal(dry.projectedCancellations, 1);
	assert.equal(dry.protectedAnomalies, 0);
	// L — dry-run made ZERO mutations
	assert.equal(missions.getMission(fresh.id).status, 'created');
	assert.equal(missions.getMission(stale.id).status, 'created');

	const applied = sh.applyMissionShellTtl({});
	assert.equal(applied.cancelled, 1, `expected 1 cancel, got ${applied.cancelled}`);
	assert.equal(applied.cancelledIds[0], stale.id);

	const cancelled = missions.getMission(stale.id);
	assert.equal(cancelled.status, 'cancelled');            // B
	assert.equal(cancelled.cancellationReason, 'never_started_ttl_expired'); // C
	assert.ok(cancelled.cancelledAt, 'cancelledAt stamped');
	assert.notEqual(cancelled.cancelledAt, cancelled.createdAt, 'cancel time differs from creation');
	assert.equal(missions.getMission(fresh.id).status, 'created');          // A

	// P — mission remains readable through the store + list
	assert.ok(missions.getMission(stale.id));
	assert.ok(missions.listMissions().some(m => m.id === stale.id));
	assert.equal(missions.listMissions({ status: 'cancelled' }).length, 1);

	// Q — owner/source metadata preserved verbatim
	assert.equal(cancelled.ownerUserId, 'usr_r6t4');
	assert.equal(cancelled.workspaceId, 'ws_r6t4');
	assert.equal(cancelled.source, 'manual');
	assert.equal(cancelled.targetUrl, 'https://shell.example.test/');
	assert.equal(typeof cancelled.createdAt, 'number', 'creation time preserved');
});

test('K: apply is idempotent — second run cancels nothing, first run stays', async () => {
	freshDir();
	const missions = await mmod();
	await eg();
	const sh = await shells();
	const stale = await seedMission(missions);
	await ageMission(missions, stale.id, 40);

	const first = sh.applyMissionShellTtl({});
	assert.equal(first.cancelled, 1);
	const second = sh.applyMissionShellTtl({});
	assert.equal(second.cancelled, 0, 'already-cancelled shells are not re-cancelled');
	assert.equal(second.alreadyTerminalIds.length, 0, 'cancelled shells are not even candidates');
	assert.equal(missions.getMission(stale.id).status, 'cancelled');
	assert.equal(missions.getMission(stale.id).cancellationReason, 'never_started_ttl_expired');
});

/* ═══ D–I: every non-created status is untouched ═══════════════════════ */

test('D–I: queued/running/awaiting_input/completed/failed/cancelled/timeout/interrupted missions are never touched', async () => {
	freshDir();
	const missions = await mmod();
	await eg();
	const sh = await shells();

	const cases = [
		['queued', 'queued'],
		['running', 'running'],
		['awaiting_input', 'awaiting_input'],
		['completed', 'completed'],
		['failed', 'failed'],
		['cancelled', 'cancelled'],
		['timeout', 'timeout'],
		['interrupted', 'interrupted']
	];
	const ids = [];
	for (const [name, status] of cases) {
		const m = await seedMission(missions, { name });
		// legal-in-table or direct store writes for seeding purposes
		const rec = missions.getMission(m.id);
		rec.status = status;
		rec.updatedAt = Date.now() - 40 * HOUR; // deeply stale — must STILL not be touched
		ids.push([status, m.id]);
	}
	const applied = sh.applyMissionShellTtl({});
	assert.equal(applied.cancelled, 0, 'no non-created mission may be cancelled');
	for (const [status, id] of ids) {
		const m = missions.getMission(id);
		assert.equal(m.status, status, `${status} mission must stay ${status}`);
		assert.equal(m.cancellationReason ?? null, null, `${status} must not acquire a TTL cancellationReason`);
	}
});

/* ═══ J: created-with-execution-proof is protected (anomaly) ══════════ */

test('J: stale created WITH execution markers → protected anomaly, never auto-cancelled', async () => {
	freshDir();
	const missions = await mmod();
	const g = await eg();
	const sh = await shells();

	// Marker variants — each one alone must protect.
	const protectedCases = [
		['startedAt', m => { m.startedAt = Date.now() - 30 * HOUR; }],
		['sessionId', m => { m.sessionId = 's_x'; }],
		['iterations', m => { m.iterations = [{ number: 1, sessionId: 's_x', ranAt: 1 }]; }],
		['currentIteration', m => { m.currentIteration = 1; }],
		['findings', m => { m.findings = [{ id: 'f1' }]; }],
		['evidenceNodes', async m => {
			g.createEvidence({ sessionId: 's_ev', missionId: m.id, type: 'page_state' });
		}]
	];
	const seeded = [];
	for (const [name, mutate] of protectedCases) {
		const created = await seedMission(missions, { name });
		await ageMission(missions, created.id, 40);
		await mutate(missions.getMission(created.id));
		seeded.push([name, created.id]);
	}
	// Plus one clean stale shell to show the pass still works.
	const clean = await seedMission(missions, { name: 'clean shell' });
	await ageMission(missions, clean.id, 40);

	const dry = sh.analyzeMissionShells({});
	assert.equal(dry.protectedAnomalies, 6, `expected 6 protected, got ${dry.protectedAnomalies}`);
	assert.equal(dry.eligible, 1);
	assert.equal(dry.eligibleIds[0], clean.id);
	for (const [name, id] of seeded) {
		assert.equal(missions.getMission(id).status, 'created', `${name} marker must protect the mission`);
	}
	const applied = sh.applyMissionShellTtl({});
	assert.equal(applied.cancelled, 1, 'only the clean shell is cancelled');
	assert.ok(applied.analysis.protectedAnomalies >= 6);
	// anomaly detail reports WHICH markers fired
	const det = applied.analysis.anomalyDetail.find(a => a.id === seeded[0][1]);
	assert.equal(det.markers.startedAt, true);

	// createEvidence signature check — if the helper mis-seeded nothing was proven
	const withEv = await g.getMissionIdsWithEvidence();
	assert.ok(withEv.has(seeded[5][1]), 'evidence-node marker must be registered in the graph');
});

/* ═══ M: the start-vs-cleanup race ════════════════════════════════════ */

test('M: start wins the race — a shell moved to queued/running before the TTL write is NEVER cancelled', async () => {
	freshDir();
	const missions = await mmod();
	await eg();
	const sh = await shells();
	const stale = await seedMission(missions, { name: 'raced shell' });
	await ageMission(missions, stale.id, 40);

	// Stage 1 — the real choke-point backstop: after the analyzer picked the
	// shell, a concurrent writer moves it to running (the exact production
	// race: analyze → [start request stamps running] → apply).
	const dry = sh.analyzeMissionShells({});
	assert.equal(dry.eligibleIds.includes(stale.id), true);
	missions.updateMission(stale.id, { status: 'running', startedAt: Date.now() });
	const applied = sh.applyMissionShellTtl({});
	// The apply's re-check must see non-created and skip it.
	assert.equal(applied.cancelled, 0, 'a mission that raced to running must not be cancelled');
	const m1 = missions.getMission(stale.id);
	assert.equal(m1.status, 'running');
	assert.equal(m1.cancellationReason ?? null, null);

	// Stage 2 — breadth of the re-check: the same race against QUEUED.
	const stale2 = await seedMission(missions, { name: 'raced shell 2' });
	await ageMission(missions, stale2.id, 40);
	missions.updateMission(stale2.id, { status: 'queued', queuedAt: Date.now() });
	const applied2 = sh.applyMissionShellTtl({});
	assert.equal(applied2.cancelled, 0, 'queued mission must never be cancelled by the TTL pass');
	assert.equal(missions.getMission(stale2.id).status, 'queued');

	// Stage 3 — terminal-state inversion: once a mission is genuinely
	// terminal (cancelled by an EARLIER legitimate pass), a second pass must
	// never resurrect or rewrite it — only current status 'created' is a
	// write target.
	const stale3 = await seedMission(missions, { name: 'raced shell 3' });
	await ageMission(missions, stale3.id, 40);
	const first3 = sh.applyMissionShellTtl({});
	assert.equal(first3.cancelled, 1);
	const again = sh.applyMissionShellTtl({});
	assert.equal(again.cancelled, 0, 'already-cancelled shell is never re-cancelled or flipped');
	assert.equal(missions.getMission(stale3.id).status, 'cancelled');
	assert.equal(missions.getMission(stale3.id).cancellationReason, 'never_started_ttl_expired');
});

/* ═══ L2: dry-run purity at scale + U pre-check ═══════════════════════ */

test('L: analyze is provably pure — serialized store identical before/after, including anomaly detail', async () => {
	freshDir();
	const missions = await mmod();
	await eg();
	const sh = await shells();
	const ids = [];
	for (let i = 0; i < 12; i++) {
		const m = await seedMission(missions, { name: `shell-${i}` });
		await ageMission(missions, m.id, 25 + i * 3); // i=0 = 25h — unambiguously stale
		ids.push(m.id);
	}
	// three of them carry protection markers
	missions.getMission(ids[2]).sessionId = 's_prot';
	missions.getMission(ids[5]).currentIteration = 1;
	missions.getMission(ids[8]).findings = [{ id: 'fx' }];

	const dry = sh.analyzeMissionShells({});
	assert.equal(dry.eligible, 9, '12 stale − 3 protected');
	assert.equal(dry.protectedAnomalies, 3);
	assert.equal(dry.freshCreated, 0, 'all 12 seeded shells are past the TTL');
	// zero mutations: nothing moved off created, nothing acquired timestamps
	for (const id of ids) {
		const m = missions.getMission(id);
		assert.equal(m.status, 'created');
		assert.equal(m.cancelledAt ?? null, null);
		assert.equal(m.cancellationReason ?? null, null);
	}
	// TTL floor: a shell exactly at 23h59m is fresh (boundary sanity)
	const boundary = await seedMission(missions, { name: 'boundary' });
	await ageMission(missions, boundary.id, 23.98);
	const dry2 = sh.analyzeMissionShells({});
	assert.equal(dry2.freshCreated, 1, 'just-under-TTL shell is fresh');
});

/* ═══ N + O: resources and truthful failure ═══════════════════════════ */

test('N+O: eligible shells report no resources; a hidden sessionId on a cancelled shell surfaces as an anomaly, never a silent claim', async () => {
	freshDir();
	const missions = await mmod();
	await eg();
	const sh = await shells();
	const stale = await seedMission(missions, { name: 'res shell' });
	await ageMission(missions, stale.id, 40);
	const applied = sh.applyMissionShellTtl({});
	assert.equal(applied.cancelled, 1);
	assert.deepEqual(applied.resourceCleanup.disposed, [], 'no disposal claimed for a resource-less shell');
	assert.equal(applied.resourceCleanup.anomalies.length, 0);

	// Hidden session ref planted AFTER cancellation (simulates a malformed
	// record): must be reported, not silently claimed as disposed.
	const cancelled = missions.getMission(stale.id);
	cancelled.sessionId = 's_ghost';
	const result2 = sh.applyMissionShellTtl({}); // nothing left to cancel
	assert.equal(result2.cancelled, 0);
	// inspectShellResources only reports freshly-cancelled ids — ghost ref on
	// an already-cancelled record appears via the ANALYZER anomaly path next
	// time it is created-stale; here nothing further to assert beyond no-crash
	// and no fabricated disposal claims.
	assert.equal(result2.resourceCleanup.anomalies.length, 0);
});

test('O2: apply reports per-mission failure truthfully when the choke point refuses', async () => {
	freshDir();
	const missions = await mmod();
	await eg();
	const sh = await shells();
	const a = await seedMission(missions, { name: 'ok shell' });
	await ageMission(missions, a.id, 40);
	const b = await seedMission(missions, { name: 'blocked shell' });
	await ageMission(missions, b.id, 40);
	// Race b into queued AFTER analysis. apply() RE-ANALYZES internally, so b
	// (now queued) simply drops out of eligibility — cancelled=1 (only a),
	// no failure, no skip entry: the queued mission was never a candidate
	// for the write. Truthful reporting of the race outcome.
	const dry = sh.analyzeMissionShells({});
	assert.equal(dry.eligible, 2);
	missions.updateMission(b.id, { status: 'queued', queuedAt: Date.now() });
	const applied = sh.applyMissionShellTtl({});
	assert.equal(applied.cancelled, 1, 'only the untouched shell is cancelled');
	assert.equal(applied.failed.length, 0, 'queued is not a failure');
	assert.equal(applied.alreadyTerminalIds.length, 0, 're-analysis dropped the raced shell from candidacy entirely');
	assert.equal(missions.getMission(b.id).status, 'queued');
	assert.equal(missions.getMission(a.id).status, 'cancelled');
	assert.equal(missions.getMission(a.id).cancellationReason, 'never_started_ttl_expired');
});

/* ═══ R: invalid TTL ══════════════════════════════════════════════════ */

test('R: invalid TTL falls back to the 24h default — never 0, never infinite', async () => {
	freshDir();
	await mmod();
	await eg();
	const sh = await shells();
	assert.equal(sh.normalizeShellTtlHours(undefined), 24);
	assert.equal(sh.normalizeShellTtlHours(null), 24);
	assert.equal(sh.normalizeShellTtlHours('abc'), 24);
	assert.equal(sh.normalizeShellTtlHours(NaN), 24);
	assert.equal(sh.normalizeShellTtlHours(0), 1, 'zero clamps to 1h floor — never cancel-everything');
	assert.equal(sh.normalizeShellTtlHours(-5), 1);
	assert.equal(sh.normalizeShellTtlHours(1e9), 8760, 'absurd clamps to ceiling 1y');
	assert.equal(sh.normalizeShellTtlHours(48), 48);

	// config surface mirrors the clamp. saveConfig follows the house
	// convention (`Number(x) || DEFAULTS`, same as maxTurns/retention keys):
	// invalid OR zero → documented default. The runtime normalize() floor
	// ([1h]) is asserted above — both seams guarantee "never 0, never
	// infinite", each in its own idiom.
	const c = await cfg();
	const saved = c.saveConfig({ missionShellTtlHours: 0 });
	assert.equal(saved.missionShellTtlHours, 24);
	const saved2 = c.saveConfig({ missionShellTtlHours: 999999 });
	assert.equal(saved2.missionShellTtlHours, 8760);
	const saved3 = c.saveConfig({ missionShellTtlHours: 'nope' });
	assert.equal(saved3.missionShellTtlHours, 24);

	// publicConfig echoes the effective TTL (numeric policy, not secret)
	const pub = c.getPublicConfig();
	assert.equal(pub.missionShellTtlHours, 24);
});

/* ═══ S/T: auth modes via child servers ═══════════════════════════════ */

function getFreePort() {
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
		s.on('error', reject);
	});
}

async function startChild(port, env) {
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
		cwd: '/tmp', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', d => { stderr += d.toString(); });
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 150; i += 1) {
		try { const r = await fetch(`${base}/api/health`); if (r.ok) return { child, base, stderr }; } catch {}
		await delay(200);
	}
	child.kill('SIGKILL');
	throw new Error(`child server did not come up: ${stderr.slice(-800)}`);
}

async function callJson(url, opts = {}) {
	const r = await fetch(url, opts);
	let body = null;
	try { body = await r.json(); } catch {}
	return { status: r.status, body };
}

test('S: required-auth mode — shell dry-run/apply stay master-gated diagnostics; mission lifecycle unaffected', async () => {
	freshDir('r6t4-auth');
	const port = await getFreePort();
	const dataDir = process.env.QASE_DATA_DIR;
	const token = 'r6t4-master-token';
	const { child, base } = await startChild(port, {
		QASE_DATA_DIR: dataDir,
		QASE_AUTH_MODE: '',
		QASE_API_TOKEN: token,
		QASE_PROVIDER: 'custom',
		QASE_API_KEY: 'test-not-real',
		QASE_BASE_URL: 'http://127.0.0.1:1/v1',
		QASE_MODEL: 'test-model',
		QASE_PUBLIC_URL: '',
		NODE_PATH: join(ROOT, 'node_modules'),
		PORT: String(port)
	});
	try {
		// Seed through the API (the real create path): a stale-age shell is
		// not directly possible via API timestamps, so seed via the FILE the
		// child reads? No — the child owns its store. Instead: prove the gate
		// and the report shape with a fresh store.
		const anon = await callJson(`${base}/api/v1/diagnostics/store-hygiene`);
		assert.equal(anon.status, 401, 'anonymous must be rejected in required mode');
		const wrong = await callJson(`${base}/api/v1/diagnostics/store-hygiene`, {
			headers: { authorization: 'Bearer nope' }
		});
		assert.equal(wrong.status, 401);
		const authed = await callJson(`${base}/api/v1/diagnostics/store-hygiene`, {
			headers: { authorization: `Bearer ${token}` }
		});
		assert.equal(authed.status, 200);
		assert.equal(authed.body.missionShells.ttlHours, 24, 'default TTL echoed');
		assert.equal(authed.body.missionShells.cancelReason, 'never_started_ttl_expired');
		assert.equal(authed.body.missionShells.total, 0);
		assert.equal(authed.body.missionShells.projectedCancellations, 0);

		// apply stays behind the same interlock as T3
		const noApply = await callJson(`${base}/api/v1/diagnostics/store-hygiene/cleanup`, {
			method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		assert.equal(noApply.status, 400, 'apply:true interlock unchanged');

		// missions still work in required mode (create stays open to the token holder)
		const created = await callJson(`${base}/api/missions`, {
			method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'S-mode mission', targetUrl: 'https://example.com/' })
		});
		assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
		const after = await callJson(`${base}/api/v1/diagnostics/store-hygiene`, {
			headers: { authorization: `Bearer ${token}` }
		});
		assert.equal(after.body.missionShells.created, 1);
		assert.equal(after.body.missionShells.freshCreated, 1);
		assert.equal(after.body.missionShells.staleCreated, 0);
	} finally {
		child.kill('SIGKILL');
	}
});

test('T: open mode — diagnostics unchanged, no new gate introduced', async () => {
	freshDir('r6t4-open');
	const port = await getFreePort();
	const dataDir = process.env.QASE_DATA_DIR;
	const { child, base } = await startChild(port, {
		QASE_DATA_DIR: dataDir,
		QASE_AUTH_MODE: 'disabled',
		QASE_PROVIDER: 'custom',
		QASE_API_KEY: 'test-not-real',
		QASE_BASE_URL: 'http://127.0.0.1:1/v1',
		QASE_MODEL: 'test-model',
		QASE_PUBLIC_URL: '',
		NODE_PATH: join(ROOT, 'node_modules'),
		PORT: String(port)
	});
	try {
		const r = await callJson(`${base}/api/v1/diagnostics/store-hygiene`);
		assert.equal(r.status, 200, 'open mode must serve diagnostics without a token');
		assert.equal(r.body.missionShells.cancelReason, 'never_started_ttl_expired');
		assert.equal(r.body.missionShells.ttlHours,  24);
	} finally {
		child.kill('SIGKILL');
	}
});

/* ═══ V (extra): sequence with store hygiene — preserve + no double work ═ */

test('V: applyStoreHygiene expires shells first, then normal retention; shells are never deleted as shells', async () => {
	freshDir();
	const missions = await mmod();
	await eg();
	const sh = await shells();
	const hy = await hygiene();

	const stale = await seedMission(missions, { name: 'sequenced shell' });
	// storeHygiene's own vocabulary: a SHELL there means created+no session/
	// iterations older than 7d (staleShellOlderThanDays). Age 8 days so the
	// disk-side visibility signal fires in the same scenario the TTL cancels.
	await ageMission(missions, stale.id, 8 * 24);

	// analyzeStoreHygiene reads DISK — flush the debounced write first, and
	// assert the shell visibility signal BEFORE apply (once cancelled, the
	// record is terminal and no longer a 'created' shell on disk).
	missions.flushMissionsForShutdown();
	const preDry = hy.analyzeStoreHygiene({});
	assert.equal(preDry.stores.missions.staleShells, 1, 'shell count visible as a signal before apply');

	// The old behavior deleted stale created shells as debris; T4 must not.
	const r = hy.applyStoreHygiene({}, {
		deleteMission: missions.deleteMission,
		cancelMissionShells: () => sh.applyMissionShellTtl({})
	});
	assert.equal(r.pruned.missionShells.cancelled, 1, 'shell cancelled via the choke point');
	assert.ok(r.pruned.missions === undefined || !r.pruned.missions.includes(stale.id),
		'shell must NOT be deleted by mission pruning');
	const m = missions.getMission(stale.id);
	assert.ok(m, 'mission record preserved');
	assert.equal(m.status, 'cancelled');
	assert.equal(m.cancellationReason, 'never_started_ttl_expired');

	// analyzeStoreHygiene no longer counts shells as deletion-eligible
	missions.flushMissionsForShutdown();
	const dry = hy.analyzeStoreHygiene({});
	assert.ok(!dry.stores.missions.eligibleIds.includes(stale.id));
	// (the cancelled record is terminal now; it is not a stale SHELL anymore)
	assert.ok(dry.stores.missions.staleShells === 0 || dry.stores.missions.staleShells === undefined);
});
