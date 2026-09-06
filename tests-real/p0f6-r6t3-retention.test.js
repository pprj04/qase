/**
 * R6-T3 — Evidence & artifact retention: focused hermetic suite.
 *
 * Hermeticity (R2-B-H convention): QASE_DATA_DIR points at a fresh mkdtemp
 * BEFORE any server module import; after() asserts the real /workspace/.qase
 * files byte-identical. Cache-busting dynamic imports so each test family can
 * reset module state without cross-contamination.
 *
 * Matrix (ticket): A config parse · B invalid config safe · C dry-run no-mutation
 * · D eligible deleted · E protected retained · F linked evidence prevents
 * deletion · G unlinked stale evidence (graph side: pruneUnlinked only)
 * · H idempotent · I registry consistent · J failure truthful · K counts/bytes
 * · L projected bytes · M collection still deduped · N within-retention stays
 * accessible · O ownership unaffected · P open-mode compat · Q required-auth
 * compat · R real store untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = '/workspace';
const REAL = join(ROOT, '.qase');
const REAL_FILES = ['artifacts.json', 'evidence-graph.json', 'sessions.json', 'missions.json', 'findings.json'];
const realHashes = new Map();
for (const f of REAL_FILES) {
	try { realHashes.set(f, createHash('sha256').update(readFileSync(join(REAL, f))).digest('hex')); } catch { realHashes.set(f, 'ABSENT'); }
}

let TMP = null;
function freshDir(tag = 'r6t3') {
	TMP = mkdtempSync(join(tmpdir(), `${tag}-`));
	mkdirSync(join(TMP, '.qase'), { recursive: true });
	process.env.QASE_DATA_DIR = join(TMP, '.qase');
	// Shared-instance pair (see am/rt note above): reset in-memory registry
	// and point it at THIS temp dir. The module re-reads dataDir() lazily on
	// every access (QASE_DATA_DIR contract), so only the Map needs clearing.
	storePair._clearForTesting();
	return process.env.QASE_DATA_DIR;
}
const bust = () => `?bust=${Date.now()}-${Math.random().toString(36).slice(2)}`;
// ONE bust token per pair: artifactRetention.js statically imports
// artifactStore.js; if each gets its OWN cache-bust URL the retention module
// binds to a DIFFERENT artifactStore instance than the test's `am()` handle
// (empty registry — module-instance identity, not a product defect). The
// production wiring imports both from one graph (index.js), so the shared
// token here mirrors reality.
// am()/rt() share ONE module instance pair — artifactRetention.js statically
// imports artifactStore.js, and cache-busting either one separately gives
// retention a DIFFERENT artifactStore instance (empty registry — module
// identity, not a product defect; production index.js imports them unbusted).
// Reset between tests via _clearForTesting() + fresh QASE_DATA_DIR, NOT by
// re-importing. eg()/cfg() keep their own bust (they read QASE_DATA_DIR
// lazily per call, and are never instance-coupled to the artifact pair).
const storePair = await import(`${ROOT}/server/artifactStore.js`);
const rtPair = await import(`${ROOT}/server/artifactRetention.js`);
const am = () => storePair;
const rt = () => rtPair;
const eg = () => import(`${ROOT}/server/evidenceGraph.js${bust()}`);
const cfg = () => import(`${ROOT}/server/config.js${bust()}`);

const jpegish = (n = 64) => Buffer.from([...Buffer.alloc(n, 0xff), 0xd8, 0xff, 0xd9]).toString('base64');
const jpegLen = (n = 64) => n + 3;
const DAY = 86_400_000;

test.after(() => {
	// R — hermeticity: the real store was never touched.
	for (const f of REAL_FILES) {
		let now = 'ABSENT';
		try { now = createHash('sha256').update(readFileSync(join(REAL, f))).digest('hex'); } catch {}
		assert.equal(now, realHashes.get(f), `REAL .qase/${f} must be byte-identical after the suite`);
	}
	delete process.env.QASE_DATA_DIR;
});

/* ── A / B: configuration ─────────────────────────────────────────────── */

test('A: retention policy parses explicit values; B: invalid values fall back to defaults, never delete-everything', async () => {
	freshDir();
	const { normalizeRetentionPolicy, RETENTION_DEFAULTS } = await rt();

	// A — valid explicit values survive normalization.
	const p = normalizeRetentionPolicy({ artifactMaxCount: 500, artifactMaxAgeDays: 30 });
	assert.equal(p.artifactMaxCount, 500);
	assert.equal(p.artifactMaxAgeDays, 30);

	// A — defaults documented and conservative.
	assert.equal(RETENTION_DEFAULTS.artifactMaxCount, 20_000);
	assert.equal(RETENTION_DEFAULTS.artifactMaxAgeDays, 180);

	// B — nonsense inputs (NaN, negative, absurd) clamp to safe values.
	const bad1 = normalizeRetentionPolicy({ artifactMaxCount: 'not-a-number', artifactMaxAgeDays: NaN });
	assert.equal(bad1.artifactMaxCount, RETENTION_DEFAULTS.artifactMaxCount, 'NaN count falls back to default');
	assert.equal(bad1.artifactMaxAgeDays, RETENTION_DEFAULTS.artifactMaxAgeDays, 'NaN age falls back to default');
	const bad2 = normalizeRetentionPolicy({ artifactMaxCount: -5, artifactMaxAgeDays: 0 });
	assert.equal(bad2.artifactMaxCount, 100, 'negative count clamps to floor 100 — never 0');
	assert.equal(bad2.artifactMaxAgeDays, 1, 'zero age clamps to floor 1 — never 0 (delete-everything)');
	const bad3 = normalizeRetentionPolicy({ artifactMaxCount: 10_000_000 });
	assert.equal(bad3.artifactMaxCount, 500_000, 'absurd count clamps to ceiling');
});

test('B2: config.js clamps retention settings through the settings surface', async () => {
	freshDir();
	const m = await cfg();
	const base = { ...m.getConfig() };
	const next = m.saveConfig({
		...base,
		retentionArtifactMaxCount: -100,          // out-of-range → clamps to floor (same as test A + maxTurns convention)
		retentionArtifactMaxAgeDays: 'garbage'    // non-numeric → documented default (never 0)
	});
	assert.equal(next.retentionArtifactMaxCount, 100, 'negative count clamps to floor 100 — never 0');
	assert.equal(next.retentionArtifactMaxAgeDays, 180, 'invalid age → documented default');
	const next2 = m.saveConfig({ ...next, retentionArtifactMaxCount: 999, retentionArtifactMaxAgeDays: 45 });
	assert.equal(next2.retentionArtifactMaxCount, 999);
	assert.equal(next2.retentionArtifactMaxAgeDays, 45);
});

/* ── C–F, K, L, N: analysis semantics (pure, no server) ───────────────── */

test('C+D+E: dry-run reports candidates without mutation; apply deletes eligible, keeps protected', async () => {
	freshDir();
	const store = await am();
	const { analyzeArtifactRetention, applyArtifactRetention } = await rt();

	// old, unreferenced → age-eligible
	const old = store.persistScreenshotArtifact({ sessionId: 's_old', base64: jpegish(32), capturedAt: Date.now() - 400 * DAY });
	// recent, unreferenced → protected by age (within retention)
	const recent = store.persistScreenshotArtifact({ sessionId: 's_recent', base64: jpegish(32), capturedAt: Date.now() - 5 * DAY });
	// old but live-mission-referenced → protected
	const oldMission = store.persistScreenshotArtifact({ sessionId: 's_m', missionId: 'm_live', base64: jpegish(32), capturedAt: Date.now() - 400 * DAY });
	// old but graph-referenced → protected
	const oldGraph = store.persistScreenshotArtifact({ sessionId: 's_g', base64: jpegish(32), capturedAt: Date.now() - 400 * DAY });
	writeFileSync(join(process.env.QASE_DATA_DIR, 'sessions.json'), JSON.stringify([{ id: 's_live_a' }]));
	writeFileSync(join(process.env.QASE_DATA_DIR, 'missions.json'), JSON.stringify([{ id: 'm_live' }]));
	writeFileSync(join(process.env.QASE_DATA_DIR, 'evidence-graph.json'), JSON.stringify({
		evidence: [{ id: 'ev1', sessionId: 's_g', metadata: { artifact: { id: oldGraph.artifactId } } }], observations: [], edges: []
	}));

	// C — DRY RUN: full analysis, ZERO mutations.
	const before = JSON.stringify(store.listArtifacts({}));
	const dry = analyzeArtifactRetention({});
	assert.equal(dry.eligibleCount, 1, 'only the old unreferenced artifact is eligible');
	assert.equal(dry.candidates[0].id, old.artifactId);
	assert.equal(dry.projectedDeletions, 1);
	assert.equal(dry.projectedReclaimedBytes, jpegLen(32), 'L — projected bytes exact');
	// N — unreferenced but WITHIN the retention window is NOT a deletion
	// candidate: it is reported in the retainedInPolicy bucket (bucket
	// semantics after the accounting fix: protected = referenced rows;
	// retainedInPolicy = unreferenced, within window+ceiling; candidates =
	// unreferenced, outside window or over ceiling). The original assertion
	// expected the pre-fix shape where such rows were in NO bucket at all.
	assert.ok(!dry.candidates.some(c => c.id === recent.artifactId), 'N — recent is not a deletion candidate');
	assert.ok(dry.retainedInPolicy.some(p => p.id === recent.artifactId), 'N2 — unreferenced in-window row is REPORTED as retainedInPolicy');
	assert.equal(dry.total, dry.protectedCount + dry.inPolicyCount + dry.eligibleCount, 'accounting reconciles: every row is in exactly one bucket');
	assert.ok(dry.protected.some(p => p.id === oldMission.artifactId), 'E — live-mission artifact protected');
	assert.ok(dry.protected.some(p => p.id === oldGraph.artifactId), 'F — graph-referenced artifact protected');
	assert.equal(JSON.stringify(store.listArtifacts({})), before, 'C — dry run mutated nothing');

	// K — accounting fields.
	assert.equal(dry.stats.artifacts, 4);
	assert.equal(dry.total, 4);
	assert.equal(dry.stats.totalBytes, 4 * jpegLen(32), 'K — bytes exact');
	assert.equal(dry.stats.oldestCapturedAt, old.capturedAt, 'K — oldest tracked');
	assert.equal(dry.stats.newestCapturedAt, recent.capturedAt, 'K — newest tracked');

	// D — APPLY: eligible deleted, protected survive.
	const res = applyArtifactRetention({});
	assert.equal(res.deletedCount, 1);
	assert.equal(res.reclaimedBytes, jpegLen(32));
	assert.equal(store.getArtifact(old.artifactId), null, 'D — bytes gone');
	assert.ok(store.getArtifact(recent.artifactId), 'N — recent still retrievable');
	assert.ok(store.getArtifact(oldMission.artifactId), 'E — protected still retrievable');
	assert.ok(store.getArtifact(oldGraph.artifactId), 'F — protected still retrievable');
});

test('E2: live-session artifact protected even with no explicit graph ref', async () => {
	freshDir();
	const store = await am();
	const { analyzeArtifactRetention, applyArtifactRetention } = await rt();
	const a = store.persistScreenshotArtifact({ sessionId: 's_live_x', base64: jpegish(16), capturedAt: Date.now() - 400 * DAY });
	writeFileSync(join(process.env.QASE_DATA_DIR, 'sessions.json'), JSON.stringify([{ id: 's_live_x' }]));
	const res = applyArtifactRetention({});
	assert.equal(res.deletedCount, 0, 'live session pins its artifacts');
	assert.ok(store.getArtifact(a.artifactId));
});

test('D2: count-ceiling policy evicts oldest-first, deterministically', async () => {
	freshDir();
	const store = await am();
	const { applyArtifactRetention } = await rt();
	// The clamp floor for artifactMaxCount is 100 (documented delete-everything
	// safety rail, identical in config.js and normalizeRetentionPolicy). A
	// ceiling of 3 would normalize to 100 — so the fixture exercises the REAL
	// production clamp: 102 artifacts at the minimum ceiling 100 → exactly the
	// 2 oldest evicted.
	const TOTAL = 102, CEILING = 100;
	const made = [];
	for (let i = 0; i < TOTAL; i += 1) {
		made.push(store.persistScreenshotArtifact({ sessionId: `s_c${i}`, base64: jpegish(4), capturedAt: Date.now() - (TOTAL - i) * DAY }));
	}
	// No sessions/missions/graph → nothing protected; ceiling 100 evicts 2 oldest.
	const res = applyArtifactRetention({ policy: { artifactMaxCount: CEILING, artifactMaxAgeDays: 3650 } });
	assert.equal(res.deletedCount, TOTAL - CEILING);
	assert.equal(store.getArtifact(made[0].artifactId), null, 'oldest evicted');
	assert.equal(store.getArtifact(made[1].artifactId), null, 'second-oldest evicted');
	assert.ok(store.getArtifact(made[TOTAL - 1].artifactId), 'newest kept');
	assert.ok(store.getArtifact(made[TOTAL - 2].artifactId));
	assert.ok(store.getArtifact(made[2].artifactId));
});

/* ── H, I, J: idempotency, registry consistency, truthful failure ──────── */

test('H+I: apply is idempotent; registry stays consistent with disk', async () => {
	freshDir();
	const store = await am();
	const { applyArtifactRetention, analyzeArtifactRetention } = await rt();
	for (let i = 0; i < 3; i += 1) {
		store.persistScreenshotArtifact({ sessionId: `s_i${i}`, base64: jpegish(8), capturedAt: Date.now() - 300 * DAY });
	}
	const first = applyArtifactRetention({});
	const second = applyArtifactRetention({}); // same policy — nothing left eligible
	assert.equal(first.deletedCount, 3);
	assert.equal(second.deletedCount, 0, 'H — second run deletes nothing');
	// I — registry rows == files on disk, exactly.
	const registry = JSON.parse(readFileSync(join(process.env.QASE_DATA_DIR, 'artifacts.json'), 'utf8'));
	const rows = Array.isArray(registry) ? registry : Object.values(registry);
	assert.equal(rows.filter(r => r.status !== 'write_failed').length, 0, 'I — no phantom rows');
	const dry2 = analyzeArtifactRetention({});
	assert.equal(dry2.eligibleCount, 0);
});

test('J: deletion failure is reported truthfully, never claimed success', async () => {
	freshDir();
	const store = await am();
	const { applyArtifactRetention } = await rt();
	const a = store.persistScreenshotArtifact({ sessionId: 's_j', base64: jpegish(12), capturedAt: Date.now() - 300 * DAY });
	// Simulate an unwritable parent: make the artifacts dir read-only AFTER the
	// row exists so the unlink fails. (Root still owns mode flips in tmp.)
	const dir = join(process.env.QASE_DATA_DIR, 'artifacts', 's_j');
	chmodSync(dir, 0o500);
	try {
		const res = applyArtifactRetention({});
		// As non-root this fails; as root it may succeed. Both paths must be truthful.
		if (res.deletedCount === 0) {
			assert.equal(res.failed.length, 1, 'J — failure surfaced with error');
			assert.ok(res.failed[0].error.includes('unlink failed'), 'J — error is specific');
			assert.ok(res.reclaimedBytes === 0, 'J — no bytes claimed');
			// Registry row must REMAIN (never delete reference before bytes).
			const still = store.listArtifacts({ sessionId: 's_j' });
			assert.equal(still.length, 1, 'J — row preserved for next cycle');
		} else {
			assert.equal(res.failed.length, 0);
		}
	} finally {
		chmodSync(dir, 0o700);
	}
});

/* ── G + M: evidence-graph side ────────────────────────────────────────── */

test('G: unlinked stale evidence pruned by the EXISTING zero-degree rule; linked evidence never', async () => {
	freshDir();
	const g = await eg();
	g.createEvidence({ id: 'ev_free', type: 'step_outcome', observation: 'orphan', createdAt: Date.now() - 400 * DAY });
	g.createEvidence({ id: 'ev_kept', type: 'step_outcome', observation: 'linked', createdAt: Date.now() - 400 * DAY });
	g.addEdge('ev_kept', 'finding_x', 'supports');
	const before = g.getEvidenceStats?.() ?? null;
	const res = g.pruneUnlinked(1); // ceiling 1 → the linked node survives
	assert.equal(res.prunedEvidence, 1);
	assert.equal(g.getEvidence('ev_free') ?? null, null, 'unlinked node gone');
	assert.ok(g.getEvidence('ev_kept'), 'linked node survives — R6-T3 invariant');
});

test('M: repeated evidence collection still dedupes (R6-T2 idempotency preserved)', async () => {
	freshDir();
	const store = await am();
	const g = await eg();
	const art = store.persistScreenshotArtifact({ sessionId: 's_m', base64: jpegish(24) });
	const session = {
		id: 's_m', ownerUserId: 'u1', capturedSteps: [
			{ id: 'st1', toolCallId: 'tc1', action: 'screenshot', url: 'https://x/', ts: Date.now(), outcome: { status: 'success' },
				screenshot: { captureAttempted: true, persisted: true, artifactId: art.artifactId, status: 'persisted', bytes: jpegLen(24), capturedAt: art.capturedAt } }
		], findings: []
	};
	g.collectSessionEvidence(session, { id: 'm_m' }, 1);
	g.collectSessionEvidence(session, { id: 'm_m' }, 1);
	const nodes = g.getSessionEvidence('s_m');
	assert.equal(nodes.length, 1, 'M — still exactly one step node');
	assert.equal(nodes.filter(n => n.metadata?.artifact?.id === art.artifactId).length, 1);
});

/* ── O / P / Q: server-level ownership + auth-mode compatibility ───────── */

function freePort() {
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
		s.on('error', reject);
	});
}

async function bootServer({ mode, token, dataDir, port }) {
	const env = {
		...process.env,
		QASE_AUTH_MODE: mode === 'open' ? 'disabled' : '',
		...(token ? { QASE_API_TOKEN: token } : {}),
		QASE_DATA_DIR: dataDir,
		PORT: String(port),
		QASE_PUBLIC_URL: '',
		QASE_PROVIDER: 'custom',
		QASE_API_KEY: 'test-not-real',
		QASE_BASE_URL: 'http://127.0.0.1:1/v1',
		QASE_MODEL: 'test-model',
		NODE_PATH: join(ROOT, 'node_modules')
	};
	const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], { cwd: '/tmp', env, stdio: ['ignore', 'pipe', 'pipe'] });
	child.stderr.on('data', () => {});
	for (let i = 0; i < 150; i += 1) {
		try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return child; } catch {}
		await delay(200);
	}
	child.kill('SIGKILL');
	throw new Error('server did not boot');
}

test('O+Q: required-auth — retention dry-run endpoint gated; artifact ownership unchanged', async () => {
	const dir = freshDir('r6t3-oq');
	const TOKEN = 'r6t3-gate-token';
	const port = await freePort();
	// Seed an artifact with a known owner BEFORE boot.
	const store = await am();
	const owned = store.persistScreenshotArtifact({ sessionId: 's_own', ownerUserId: 'user-a', base64: jpegish(20) });
	const child = await bootServer({ mode: 'required', token: TOKEN, dataDir: dir, port });
	try {
		const base = `http://127.0.0.1:${port}`;
		// Q — anonymous is gated on the retention surface (master-prefix config
		// routes are stricter, but this one requires auth at minimum).
		const anon = await fetch(`${base}/api/v1/diagnostics/store-hygiene`);
		assert.ok(anon.status === 401 || anon.status === 403, `Q — anon gated (${anon.status})`);
		// O — master token reads the dry-run report incl. retention block.
		const authed = await fetch(`${base}/api/v1/diagnostics/store-hygiene`, { headers: { authorization: `Bearer ${TOKEN}` } });
		assert.equal(authed.status, 200);
		const report = await authed.json();
		assert.ok(report.artifactsRetention, 'retention block present');
		assert.equal(report.artifactsRetention.effectivePolicy.artifactMaxCount, 20_000, 'effective policy echoes default');
		// O — artifact retrieval ownership unchanged (no session/user for this row →
		// registry-level 200 for master, 404 for strangers is proven by p0f4 suite;
		// here we assert the retention surface did not BYPASS ownership: anon
		// cannot read the artifact itself).
		const anonArt = await fetch(`${base}/api/v1/artifacts/${owned.artifactId}`);
		assert.equal(anonArt.status, 401, 'O — anon still cannot read artifacts');
	} finally {
		child.kill('SIGKILL');
	}
});

test('P: open (disabled-auth) mode — retention surface stays readable (dev compatibility)', async () => {
	const dir = freshDir('r6t3-p');
	const port = await freePort();
	const child = await bootServer({ mode: 'open', token: '', dataDir: dir, port });
	try {
		const r = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics/store-hygiene`);
		assert.equal(r.status, 200);
		const report = await r.json();
		assert.ok(report.artifactsRetention, 'P — open mode sees the retention block');
		// Cleanup interlock still required in open mode.
		const bad = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics/store-hygiene/cleanup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
		assert.equal(bad.status, 400, 'P — apply:true interlock unchanged');
	} finally {
		child.kill('SIGKILL');
	}
});
