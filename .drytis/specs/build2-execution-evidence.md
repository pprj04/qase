# BUILD 2 — Execution + Evidence Experience

Scope: session-detail UI only (public/). No engine changes, no evidence-graph
changes, no new APIs. Use existing data/APIs.

## Inspection findings (what exists)

### Tab row (index.html)
- `REASONING_LOG / APPLICATION_ANALYSIS / EVIDENCE / REPORT` — no FINDINGS tab
  since Phase 15 (user explicitly asks to restore one).
- `EVIDENCE` tab (`data-pane="plan"`, `#plan-list`) currently renders the
  session's *todo plan* (renderTodos), NOT browser evidence. It even says
  "The agent has not written a test plan yet" — mislabeled and confusing.
- Evidence *stats* panel (pipeline.js renderEvidenceSection) lives in the
  APPLICATION_ANALYSIS pane (global stats, not session-scoped cards).

### Available data per session (verified live)
- `GET /api/sessions/:id` → title, status, targetUrl, createdAt/updatedAt,
  findingCount/messageCount/stepCount, pipeline, running.
- `GET /api/sessions/:id/detail` → messages, capturedSteps, findings (rich:
  severity, category, title, status, confidence, steps, expected/actual,
  finding_status, reproducibility).
- `GET /api/v1/sessions/:id/evidence` (auth) → step_outcome evidence cards:
  action, target URL, observation, payload{status, urlAfter, titleAfter,
  consoleErrors, networkErrors}, timestamp, metadata.stepId, integrity.
- `GET /api/v1/sessions/:id/observations` (auth) → human-readable action +
  description records.
- `GET /api/findings/:id` (auth) → store finding incl. sessionId.
- `GET /api/findings/:id/evidence` (cookie or Bearer; phaseRouter) → linked
  evidence for a finding incl. screenshot-type items with
  metadata.artifactPath (`<runId>/<file>`), served at
  `GET /api/artifacts/:runId/:filename`.
- Artifacts root `.qase/artifacts/<runId>/` — trace.zip + screenshots
  (2,661 runs).

### Environment truthfulness (B0.2/B0.3)
- Session knows deviceRequest/device (device-strip shows it live) but
  `GET /api/sessions/:id` does NOT return device/deviceRequest, and stored
  session d1d4af29 has no device → desktop sessions display DESKTOP mode by
  absence (honest: no invented metadata; B0.2 provenance exists on
  replay/validation runs, not on agent sessions).
- The best honest per-session environment display today: provider "local
  (in-container Chromium)", viewport(s) explored from
  session.viewportsExplored, device null → DESKTOP unless device present.
  Server additions are OUT of scope per the brief ("work only on the existing
  execution/session detail UI") EXCEPT the one field the UI needs and the
  server already stores: expose `device`/`deviceRequest` on
  GET /api/sessions/:id payload (read-only, additive, no store change).

## Implementation plan

1. **Execution header** (chat panel head): title, status chip (exists),
   duration (createdAt→updatedAt formatted), target URL (exists), environment
   meta line: provider · browser · OS · device · execution mode chip
   (REAL_DEVICE / EMULATED_DEVICE / DESKTOP per B0.2 taxonomy, derived
   honestly: device && provider==='browserstack' → REAL_DEVICE;
   device && local → EMULATED_DEVICE; no device → DESKTOP; unknown → "not
   recorded"). No invented values; hide rows with no data.

2. **Tabs**: add FINDINGS between EVIDENCE and REPORT with live count badge.

3. **EVIDENCE tab rebuilt** (rename pane semantics; keep id plan-list for CSS
   compat but new render): filters (ALL / SCREENSHOTS / CONSOLE / NETWORK /
   STEPS), cards with timestamp, action+URL, step association (stepId label),
   payload summary, finding association (linked finding titles via
   /api/findings/:id/evidence mapping when available), screenshot thumbnails
   opening the real artifact in a new tab (no fake evidence: only render
   images for artifactPaths that exist — the API 404s naturally on miss),
   console evidence (payload.consoleErrors), network evidence
   (payload.networkErrors), trace evidence (trace.zip links per replay run
   when session-linked artifacts exist). Loading skeleton + explicit
   "No evidence captured" empty state with reason
   (mission ended before evidence collection / evidence pruned) + Retry.

4. **Findings tab**: cards — severity chip, category, title, status chip
   (open/closed + finding_status lifecycle), confidence %, evidence count
   (via /api/findings/:id/evidence length, lazy), affected environment
   (device/environment from finding or session), click → open Bugs page
   detail (existing bugs.js modal) — no duplicate finding system.

5. **Zero-evidence states**: EVIDENCE tab shows explicit empty states per
   filter; FINDINGS tab shows "No findings reported — the run completed
   without defects" vs "failed run" variant.

6. **Loading/error**: skeletons + Retry (reuse Build 1 helpers).

## Acceptance criteria
- [ ] Header shows name, status, duration, env line (provider/browser/OS/
      device/mode) for a completed execution; unknowns hidden or "not recorded"
- [ ] Tab row: REASONING_LOG / APPLICATION_ANALYSIS / EVIDENCE / FINDINGS /
      REPORT with counts
- [ ] EVIDENCE tab shows real step/console/network/screenshot/trace evidence
      with timestamps + step association; artifacts open real files
- [ ] Screenshot thumbnails only for real artifactPaths (natural 404 fallback
      shows "artifact unavailable")
- [ ] FINDINGS tab: severity/category/title/status/confidence/evidence
      count/environment; links into Bugs detail
- [ ] Zero-evidence + loading + error states explicit with Retry
- [ ] No engine/store/evidence-graph changes; one additive server field
      exposure (device/deviceRequest on session GET)
- [ ] Existing suites green; browser-verified on real completed execution

---

## Post-verification addendum (final)

**Regression triage — all 15 failures resolved, none Build-2-caused.**
The full-loop run (49 suites / 1066 pass / 15 fail) failed 3 suites:
`device-execution` (21/6), `execution-provenance` (57/8), `phase17-e2e` (2/8).

Root cause (shared): `tests/execution-provenance.test.js` §[6] (strict-BrowserStack
live test) enabled BrowserStack with `invalid_bs_user_zzz` credentials and its
`restore()` reverted ONLY `browserstackEnabled`/`browserstackStrict` — the garbage
user/key stayed in the stored config. When a mid-build server restart raced the
fire-and-forget restore PUT, `enabled=true` + invalid creds persisted; the B0.1
authority model (stored beats env) then made every subsequent execution attempt
BrowserStack and fail strict-mode. Secondary: `phase17-e2e` cancellations were a
missing `QASE_API_TOKEN` export in the harness shell (before() aborted), not a code
change; `device-execution` failures were the same leaked BS config.

Fixes applied:
1. `execution-provenance.test.js` restore() now round-trips the FULL BrowserStack
   config (enabled, strict, user, key) — leak permanently closed. Verified: suite
   green 65/65 AND stored config returns to `local-disabled-standby` / enabled=false.
2. Live store scrubbed (PUT cleared leaked creds, then explicit stored standby
   values so env placeholders `tRuEje…` can never resurrect as effective config;
   `browserstackEnabled=false`, source=Settings).
3. 18 idle "New test run" debris sessions deleted from the store (50→32 sessions).

Final suite results (isolated, correct env):
- device-execution: 22 pass / 0 fail (5 live tests skipped without token — by design)
- execution-provenance: 65 pass / 0 fail (incl. strict BS e2e + Phase 18 §[8])
- phase17-e2e: 10 pass / 0 fail (EXIT=0, real 9-minute mission)
- phase18-api 13/13, phase18-e2e 10/10, phase16-api 17/17 (unchanged)

**Device provenance demo run** (mission 87aa55c1, session a3c8ad17): real mission
with `constraints.device: "iPhone 15"` against :9902 — completed; session exposes
`device` (iPhone 15 / iOS 17.5 / 393×659 / engineEmulated true / source
playwright-registry) and `deviceRequest`; exec panel renders EMULATED_DEVICE.
Zero findings — legitimate outcome (nav is clickable at mobile width).

**Known BrowserStack credential status:** stored `browserstackLastVerified` shows a
REAL successful verification (masked user `con****om`) predating the leak — genuine
credentials were saved once, then overwritten by the test leak. The real key is not
recoverable from any store (by design, never persisted in plaintext). Re-enter
credentials via Settings → Test BrowserStack Connection before any real-device demo.
