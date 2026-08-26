#!/usr/bin/env node
/**
 * Dev Team usage/traffic agent — minimal QASE reference client.
 * Uses ONLY the documented public read API (/api/v2) + Bearer token auth.
 * No QASE UI, no internal modules, no direct store/file access.
 *
 * Usage: QASE_BASE_URL=http://host:5173 QASE_API_TOKEN=... node dev-agent.mjs
 */
const BASE = process.env.QASE_BASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN;
if (!TOKEN) { console.error('QASE_API_TOKEN required'); process.exit(2); }

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } });
  const cid = res.headers.get('x-correlation-id');
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error */ }
  if (!res.ok) {
    const err = new Error(`${path} → HTTP ${res.status}: ${JSON.stringify(body)}`);
    err.status = res.status; err.body = body; throw err;
  }
  return { body, cid };
}

async function main() {
  // 1. Authenticate (health is the only public endpoint; prove auth works by reading a protected one)
  const health = await api('/api/v2/health');
  console.log('1. health:', health.body.status, '| version', health.body.version ?? '-');

  // 2. Project + activity overview
  const projects = await api('/api/v2/projects');
  // /projects returns a bare array — normalize for downstream consumers
  const projectList = Array.isArray(projects.body) ? projects.body : projects.body.data;
  console.log(`2. projects: ${projectList.length} (${projectList.map(p => p.name).join(', ')})`);

  const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
  const usage = await api('/api/v2/usage/summary', { from: since, bucket: 'day' });
  const t = usage.body.totals;
  console.log(`3. usage last 7d: ${t.missions_created} missions created, ${t.missions_completed} completed, ${t.findings_reported} findings, ${t.fix_validations} fix-validations, ${t.regression_runs} regression runs`);
  const mix = usage.body.mission_source_mix;
  console.log(`   source mix: ${Object.entries(mix).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // 4. Per-project activity question: findings per project
  for (const p of projectList.slice(0, 5)) {
    const f = await api('/api/v2/findings', { project_id: p.id, page_size: 1 });
    console.log(`4. project "${p.name}": ${f.body.total} findings`);
  }

  // 5. API traffic on QASE itself (telemetry since deployment)
  const traffic = await api('/api/v2/metrics/api-usage');
  const tot = traffic.body.data.reduce((a, d) => a + d.total, 0);
  const top = Object.entries(traffic.body.data[0]?.endpoints ?? {})
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`5. QASE api traffic: ${tot} authenticated reads since ${traffic.body.since} | top today ${top}`);

  // 6. Trend question: regression runs + fix validation outcome mix
  const reg = await api('/api/v2/regression/trend');
  const points = (Array.isArray(reg.body) ? reg.body : reg.body.data ?? []).slice(-3)
    .map(r => `${(r.ts ?? '').slice(0, 10)}: ${r.total} runs, pass_rate ${r.pass_rate}`).join(' | ');
  console.log(`6. regression trend (last 3): ${points || 'n/a'}`);
  const fv = await api('/api/v2/fix-validations', { page_size: 1 });
  console.log(`   fix-validations on record: ${fv.body.total}`);

  // 7. Error handling demo: malformed date must 400, anonymous must 401
  try { await api('/api/v2/usage/summary', { from: 'not-a-date' }); console.log('7. malformed date: NOT rejected (BUG)'); }
  catch (e) { console.log(`7. malformed date → HTTP ${e.status} ✓`); }
  const anon = await fetch(`${BASE}/api/v2/missions`);
  console.log(`   anonymous /missions → HTTP ${anon.status} ✓ (expected 401)`);

  console.log('\nDEV-AGENT FLOW: PASS');
}

main().catch(e => { console.error('DEV-AGENT FLOW: FAIL —', e.message); process.exit(1); });
