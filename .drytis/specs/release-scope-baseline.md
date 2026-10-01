# QASE 2.1 — Release Scope & Feature Inventory (baseline #12953, 2026-09-25)

Branch: `PUSHKAR` @ a8b271b (in sync with origin). Working branch policy: **all work ships on PUSHKAR**; `LIVE`/`main` are legacy. Server: Node 24, Express, Playwright (Chromium), local JSON run store (`QASE_RUN_STORE=local`), optional PostgreSQL + distributed Redis workers.

## Test baseline (2026-09-25, current HEAD)

`npm run verify`: **501 tests — 492 pass, 0 fail, 9 skip.**
(The previously recorded drytisTransport nonce flake did not fire this run; it remains ~1-in-8 probable — see memory `drytis-transport-nonce-flake.md`. Fix known (hex nonce) but was inside the Sep-15 rollback scope; needs explicit user approval to re-apply.)

Preview health: root/healthz/readyz all 200; `service-bg-service-4182` RUNNING.

### The 9 skipped tests
| # | Test | Why skipped | Phase that owns it |
|---|---|---|---|
| 1–4 | browserMedia/meeting-link/meeting-popup/suspend-restore integrations | Require live browser + meeting host (`meeting.drytis.dev`) | Phase 5 (journey) |
| 5 | diagnostics native-input integration | live browser | Phase 5 |
| 6 | control-plane real PostgreSQL registration | needs `QASE_TEST_DATABASE_URL` | Phase 6 |
| 7–9 | Drytis meeting alias navigations (guest button, redirect, new tab) | live meeting host | Phase 9 |

**Environment gap:** this container has NO PostgreSQL (MariaDB only). Running the 3 DB tests requires provisioning a PG instance or `QASE_TEST_DATABASE_URL` pointing at one. Decide in Phase 6.

## Feature inventory

### Implemented & tested
- 3 run modes: QA (`server/prompt.js`), SQA (ISO 25010/TMMI catalog, `sqaPrompt.js`, `sqaCatalog.js`), Founder (`founderPrompt.js`), incl. mode-specific tools and report finalizers.
- Browser agent: Playwright Chromium, declared-origin policy, SSRF/DNS-rebinding guards, destructive-action authorization gate (TTL'd yes/no grants), credential vault, ask_question interactive flow.
- 8 device profiles incl. iPhone/Pixel/Galaxy/iPad + landscape, deterministic mobile DOM audit (`mobileAudit.js`).
- Meeting-link testing (mic probe, prejoin inspection, join approval).
- Findings + per-finding fix prompts, "copy all" / markdown download / PDF export.
- Run resilience: keepalive (DoH-resolved public edge ping), crash snapshots (`runsnapshots/`), boot-time runResume (3-attempt cap), interrupted-status tracking.
- Security hardening of QASE itself: CSRF, auth throttle, error sanitizer, security headers, instance access.
- Drytis integration API skeleton: HMAC-signed `/internal/v1/drytis` reviews (create/start/stop/deliver), nonce store (PG in prod), CSP `frame-ancestors` embed.
- White-box static security analysis from source snapshots (`whiteboxAnalysis.js`).

### Partial / unfinished
| Area | State | Phase |
|---|---|---|
| Token/context usage | Captured server-side (`session.contextUsage`), **never rendered in UI** | 4 |
| Stop/cancel reliability | Exists but historically flaky (stuck runs per dev-team feedback) | 3 |
| Drytis integration | API + contract tests exist; disabled by default; no Studio round-trip | 9 |
| Security testing (feature) | SQA catalog controls + white-box only; **no automated DAST probes** | 7 |
| Deployment | Preview healthy; **production custom-domain routing blocked by platform defect** (see blocker list) | 2 |

### Missing (transcript-confirmed gaps → roadmap tickets)
- Run timer, post-run layout, select-all launcher, "test these next" follow-ups, founder form cleanup, 👍/👎 feedback, usage analytics — **#12956 (Phase 4)**
- Multi-browser (Firefox/WebKit) — **#12960 (Phase 8)**
- Findings → board accept-all handoff — **#12961 (Phase 9)**

## Known blockers (repro / status)

| Blocker | Repro | Status |
|---|---|---|
| **Prod custom-domain routing (qase.drytis.com)** | `https://qase.drytis.com` → TLS alert / static 502.html; `list_production_custom_domains` = [] after every deploy flow | **Platform defect** — tls-edge never registers the custom-domain route (tickets #10927, #10964, #12246). Do NOT re-deploy to fix. Verify: URL → 200 after platform fix. |
| **deploy_to_production 500** | stop → deploy returns backend 500; stale deployment record #153 blocks fresh deploys | Platform defect. Workaround: `redeploy_production`. |
| **Prod branch drift** | Persistent volume keeps old checkout branch across recreation; drytis-init pulls but doesn't switch branches | Mitigated: repo now configured to PUSHKAR; after any branch change run `git checkout PUSHKAR && git pull` in prod pod. |
| **FS corruption after container resume** | After pause/resume: EIO/"Structure needs cleaning", `-?????????` inodes, .git damage | Recurring platform issue. Recovery playbook in memory `fs-corruption-after-resume.md`. Quarantine dirs (*.corrupt-*) ignored by .gitignore. |
| **drytisTransport nonce flake** | `npm run verify` intermittently: 1 fail in drytisTransport.test.js ("invalid nonce") | Known ~3% per deliver() call. Fix (hex nonce) needs user approval — was in rollback scope. |
| **Chromium OS libs** | `chromium.launch()` fails with missing .so in fresh prod pods | Fixed: apt line in setup script + `playwright install chromium` (idempotent). Verified #12271. |

## In scope for this release (per roadmap #12953–#12964)

Phases 1–6 (baseline, deployment, run dependability, product UX, customer journey, security & data isolation) plus feature phases 7 (security suite) and 8 (multi-browser) are dev-complete scope. Phases 9 (Studio round-trip) depends on Drytis-side work. Phases 10–12 gate launch.

**Out of scope this release:** mobile-app/ emulator testing, open-sourcing, pricing/subscription wiring, client-connector integrations (Jira/Linear etc. beyond the Studio contract).

## Reliability/quality targets for Phase 11 pilot (to be confirmed with team)

- ≥95% runs reach a terminal state (done/failed/awaiting-input) without manual intervention
- 0 destructive actions repeated after recovery
- Finding accuracy ≥80% human-validated on pilot runs
- Preview + production both serving PUSHKAR HEAD
