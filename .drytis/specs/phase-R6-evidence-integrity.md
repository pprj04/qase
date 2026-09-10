# Phase R6 — Evidence Integrity & Persistence (GAP SPECIFICATION)

> **Status: SPEC ONLY. No implementation decided, none started.**
> Written 2026-09-04 at HEAD `4ce0803` (P0 pack F1–F5 + F6 sweep complete, 0 regressions).
> Sources: `notes/forensics-prod-complaints-2026-09-03.md` (Complaints 2/4/5/6), Audit D
> (`artifacts/audit/qase-audit-2026-09-03.md` + `.drytis/next-build-plan.md`),
> `specs/phase-R3-persistence-observability.md`, live store census 2026-09-04.
> Every claim below was re-verified at HEAD before entering this file —
> where a source claim no longer holds, it is marked **DISPROVEN** and excluded from scope.

---

## 0. What already exists (DO NOT REBUILD)

| Capability | Where (verified at HEAD) | State |
|---|---|---|
| Evidence graph with atomic + debounced writes | `evidenceGraph.js:190-195` (atomicWrite, 500ms debounce) | ✅ exists |
| Retention prune, zero-degree only | `evidenceGraph.js:225 pruneUnlinked(maxEvidence=60_000)` — **wired** via `storeHygiene.js:236-237` (`cfg.evidenceNodeMax`) and exposed through the store-hygiene route (`index.js:4048-4055`) | ✅ exists (linked nodes untouchable BY DESIGN — a finding's chain is never pruned) |
| Evidence node types: step_outcome, finding_detail, screenshot, observation, console, assertion | `evidenceGraph.js` builders; live census: evidence 52,872 / observations 4,491 / edges 24,315 | ✅ exists |
| `evidenceIds` FIELD on finding-shaped graph records | `evidenceGraph.js:485` (`input.evidenceIds || []`), `:1202` placeholder comment "will be linked below" | ⚠️ field exists, **never populated at linkage time** — live: 0/8,230 findings carry populated `evidenceIds` (census 2026-09-04) |
| Evidence-coverage % per mission | `GET /api/v1/missions/:id/evidence-coverage` → `computeEvidenceCoverage` (F4-ownership-guarded) | ✅ exists — but reports coverage %, NOT attempted-vs-persisted |
| Evidence-integrity report per mission | `GET /api/v1/missions/:id/evidence-integrity` | ✅ exists |
| Replay-path screenshot artifacts on disk | `replay.js:39-48` — JPEG artifacts written to disk | ✅ exists (mission path does NOT reuse this seam — the gap, not the file) |
| Missions store atomic writes | `missions.js:21,93,110` use `atomicWrite` — Audit D / next-build-plan claim of "raw writeFileSync" | ✅ **DISPROVEN at HEAD** — not a gap anymore (if it ever was) |
| Sessions prune with keep-bound | R2-B `pruneOldSessions` keep-50, proven | ✅ exists |
| Mission `executedOn` provenance | F1/F6 (provider/browser/os/device, null = unknown) | ✅ exists |
| Store hygiene surface (deleteMission cascades, pruneRunsByIds, pruneAssessmentsByIds) | `storeHygiene.js` | ✅ exists |

**Net effect:** the genuinely-missing list is much shorter than any source document implies. This
spec exists precisely to keep Phase 2 from rebuilding the table above.

---

## 1. The genuine gaps (each traces to a source + a HEAD-verified fact)

### G1 — Finding→evidence linkage is edges-only (Complaint 4)
- Forensic: findings store carries no `evidenceIds`; links live only as graph SUPPORTS edges;
  Bugs page shows "No typed evidence linked" for most findings (`app.js` ~900).
- HEAD-verified: 0/8,230 findings in `.qase/findings.json` have populated `evidenceIds`.
- Gap: populate `evidenceIds` on findings **at linkage time** in `buildIterationEvidence`
  (the "will be linked below" placeholder at `evidenceGraph.js:1202` is the seam), so the
  findings store and the graph agree without a backfill dependency. Findings created WITHOUT
  an evidence string keep an empty array — visible as "0 linked", never silently.
- Test shape: mission with N evidential findings → every finding carries its evidenceIds;
  finding without evidence text → `evidenceIds: []` and the UI count is honest about 0.

### G2 — Screenshots are metadata-only in the graph (Complaint 4)
- Forensic: `browser_screenshot`/`browser_snapshot` tool calls become step_outcome nodes
  with **no bytes anywhere in the graph**; the 2,063 `screenshot` nodes that exist came from
  fix-validation/uxChecks sources with `payload: null`. SSE frames (320ms JPEG) are transient.
- Gap: persist screenshot bytes or artifact refs for browser_screenshot steps. The replay
  path already writes JPEG artifacts to disk (`replay.js:39-48`) — the mission path must
  reuse that seam (artifact ref in the graph, not inline bytes — keeps graph JSON bounded).
- Constraint: artifact retention must interact with G4 below (no unbounded disk).

**STATUS: IMPLEMENTED (R6-T2, commit follows this spec update) — actual behavior:**

*Artifact store* (`server/artifactStore.js`, NEW): byte-store + registry under
`<QASE_DATA_DIR>/artifacts/<sessionId>/shot-<seq>-<ts>.jpeg` with `artifacts.json` registry
(atomicWrite). Deterministic ID `art_<sha1(sessionId|seq|ts|byteLen)[:16]>`. Honors
QASE_DATA_DIR. Corrupt registry → quarantined to `artifacts.json.corrupt-<ts>`, starts
empty (reads report missing — never fabricate). NOT a parallel evidence system: the
evidence graph stays the source of truth and only references artifact IDs.

*Capture → persistence* (`server/agent.js` runTurn): after `finalizeStepOutcome` for a
`browser_screenshot` tool result, bytes are extracted (`firstScreenshotBase64` accepts the
SDK's flat `{base64, mimeType, url, title}` shape — verified against
`@cleanslate/sdk BrowserAutomationTools` + the same `service.screenshot` seam the browser
bridge streams — plus dataUrl and nested variants) and persisted. The captured step is
stamped `step.screenshot = {captureAttempted, persisted, artifactId, status, bytes, error,
capturedAt}`. Truth table: bytes absent → `not_attempted` (never fabricated); write
failure → `write_failed` with error; success → `persisted` + artifactId.

*Evidence linkage* (`server/evidenceGraph.js`): the EXISTING step_outcome node's metadata
now carries `artifact: {id, sessionId, mimeType, bytes, capturedAt}` (explicit `null` when
attempted-but-unpersisted — never a phantom ref), plus `screenshotAttempted/Persisted/Status/Error`.
No new evidence node is minted for persistence. Re-collection idempotency guard added:
`metadata.stepKey` (step.id → toolCallId → index) mints a step_outcome node ONCE; repeated
collection (re-finalize, fix-validation re-link, boot recovery) never duplicates nodes,
while per-run counters stay truthful. Collection stats now include
`screenshotsAttempted/screenshotsPersisted`.

*Retrieval* (`server/index.js`): `GET /api/v1/artifacts/:id` (metadata projection, NO
filesystem paths) and `GET /api/v1/artifacts/:id/content` (actual bytes, correct
Content-Type/Length, private cache). Ownership via the SAME `canAccessResource` choke
point; identical 404 for missing/unauthorized (F4 no-existence-leak). Stats endpoint
`GET /api/v1/artifacts/stats` (counts + saveHealth). Open (disabled-auth) mode unchanged.

*Lifecycle* (`server/store.js` + `server/index.js`): `removeArtifactsForSession` rides the
two existing terminal seams — session DELETE route and `pruneOldSessions` budget prune.
Evidence nodes KEEP their artifact refs after cleanup (historical truth); retrieval then
404s honestly. No time-based eviction (retention = G4/R6-T3 policy).

*Incidental reliability fix (found by the R6-T2 required-auth test)*: `userStore.login()`
mutated `lastLoginAt` via a 120ms-debounced users write; a SIGKILL in the window dropped
users.json while the cookie's session row (written synchronously) survived → boot#2 loaded
zero users, deleted the orphaned session, and 401'd valid cookies. `flushUsers()` is now
exported and called by the login handler before the response (sessions already had this
guarantee; users now match it).

*Tests* (`tests-real/p0f6-r6t2-screenshot-artifacts.test.js`, 10): A1/A2 bytes persisted
+ retrievable; A3 artifact ref on existing node, no duplicate; A4 capture-failure truth;
A5 write-failure truth; A6/A7 missing + corrupt (size-mismatch) → 404 shape; A8 session
cleanup keeps evidence refs, retrieval 404s; A9/A10 stats + saveHealth; R1–R7 required-auth
matrix (anon 401, owner 200, cross-user identical-404, admin 200, master 200, content
bytes served); R8 open-mode anonymous read; L repeated collection → no duplicate nodes.

### G3 — No attempted-vs-persisted evidence counters (Complaint 4)
- Forensic: no per-run `evidenceCount` on runs/sessions/missions anywhere.
- Gap: stamp counters at finalize — `screenshots_attempted/persisted`,
  `evidence_attempted/evidence_persisted` — on the session/mission record; surface on run
  header in UI + `/api/v1/diagnostics`. A run that failed to persist evidence must SAY so.
- Test shape: N screenshot steps → counters exact; SIGKILL-class drop (kill before debounce
  flush) → counters still stamped at finalize time where finalize ran, or the gap is visible
  via the debounce-tail note below.

### G3b — Debounce tail loss is invisible (Complaint 4)
- Forensic: 500ms debounced graph save → hard-kill drops the tail silently.
- Gap: **visibility, not a policy change** — flush-on-shutdown hook already exists for
  ux-assessments (`flushUxAssessmentsForShutdown`); mirror it for the evidence graph, and
  expose `lastFlushAt`/pending-count in diagnostics (R3-G9 pattern).

### G4 — Linked-evidence growth is unbounded (Audit D scale risk)
- HEAD-verified: evidence-graph.json 41.5MB; missions.json 30.5MB; findings.json 16.6MB;
  ux-assessments 21.6MB; sessions 18.1MB (bounded by keep-50); test-cases 0.8MB.
- Existing `pruneUnlinked` only removes zero-degree nodes. **By design it never touches
  linked evidence** — correct for integrity, but it means total growth is bounded only by
  mission count.
- Gap (policy, needs user sign-off): tiered retention — e.g. full fidelity for recent/active
  missions; step_outcome TRIMMING (keep finding_detail + screenshot + assertion edges
  intact) for missions older than N days; hard ceiling with explicit "what gets dropped"
  documentation. Data-safety proof mandatory before any drop: R2-B prune-safety test pattern
  (seeded store → prune → assert invariants + byte-level untouched fields).

**STATUS: IMPLEMENTED (R6-T3, commit follows this spec update) — artifact retention shipped;
evidence-node trimming deliberately NOT shipped (stays policy-gated).**

*Policy* (`server/config.js`): `retentionArtifactMaxCount` default 20,000 and
`retentionArtifactMaxAgeDays` default 180, both user-tunable through the existing settings
surface. saveConfig clamps count [100, 500,000] and age [1, 3650]; invalid/non-numeric
input falls back to the documented defaults — a bad value can NEVER mean "delete everything"
(count 0 / age 0 are unreachable through configuration).

*Analyzer + executor* (`server/artifactRetention.js`, NEW): pure
`analyzeArtifactRetention()` (zero mutations) and `applyArtifactRetention()`. Protection
reasons, first-match-wins: `evidence-node-ref` (graph metadata.artifact.id or node of a
live session), `live-mission`, `live-session`, `store-filename-ref` (regex sweep of
replay-runs/baselines/test-cases/workflows/findings/missions/sessions stores). Eligibility:
unreferenced AND (older than age window OR over count ceiling, oldest-first with
artifactId tie-break). `write_failed` rows are never eligible (metadata-only). Deletion
order per artifact: bytes FIRST, then registry row, then atomic persist — a crash between
leaves a row whose getArtifact() truthfully returns null (R6-T2 semantics) and the next
cycle re-claims it; idempotent.

*Honest accounting* (product defect found by test N during this build): every registry row
lands in EXACTLY one bucket — `protected` (referenced), `retainedInPolicy` (unreferenced,
within window+ceiling), or `candidates` — so `total == protectedCount + inPolicyCount +
eligibleCount` always reconciles. Before the fix, unreferenced in-window rows appeared in
no bucket at all.

*Wiring* (`server/index.js`): `GET /api/v1/diagnostics/store-hygiene` embeds an
`artifactsRetention` dry-run block (effectivePolicy, stats, counts, projected deletions
and reclaimed bytes); `POST /api/v1/diagnostics/store-hygiene/cleanup` applies retention
AFTER store hygiene (so protection is evaluated against the post-hygiene world) under the
same explicit `{apply:true}` interlock; response gains `artifactsRetention {deletedCount,
reclaimedBytes, failed, protectedCount}`. artifactStore gains `listArtifactRows()` (raw,
internal-only) and `deleteArtifactById()` (ordered, crash-safe).

*Evidence nodes deliberately untouched:* `pruneUnlinked` (zero-degree only) remains the ONLY
evidence-node prune. Tiered node trimming (step_outcome for old missions) stays a future,
separately-signed-off decision — the protection-first design means retention can NEVER
delete an artifact an evidence node still references, so trimming nodes later will not
strand references.

*Tests* (`tests-real/p0f6-r6t3-retention.test.js`, 11): A/B policy parse + clamp; B2
config clamps; C+D+E dry-run zero-mutation + apply deletes eligible/keeps protected;
E2 live-session protection; D2 count-ceiling deterministic eviction (102@100 → exactly 2
oldest); H+I idempotency + registry/disk consistency; J unlink-failure truthful (row
preserved); G pruneUnlinked semantics unchanged; M R6-T2 collection idempotency intact;
O+Q required-auth gating + ownership; P open-mode compatibility. Suite also fixed a
pre-existing hang in phase9.4-reliability RT-5 (leaked 300s timer kept the runner alive —
37/37 now complete in seconds; zero assertions weakened).

*Incidental (R6-T3):* none — the only cross-file fix is the accounting buckets above.

### G5 — Created-never-started mission shells (Complaint 2.2 residual) — SHIPPED (R6-T4)
- Forensic: 2,833 shells. HEAD-verified: 2,937 of 4,384 missions sit at `status:'created'`.
- Operator decision (2026-09-06): default TTL **24 h**; eligible shells transition
  `created → cancelled` with `cancellationReason: 'never_started_ttl_expired'`; the record is
  **preserved** (never deleted); never failed/timeout/interrupted/aborted (no execution occurred —
  F3 invariant honored: no fabricated reason).
- **Authoritative never-started rule**: `status === 'created'` is necessary but NOT sufficient.
  ALL of these must be absent: `startedAt`, `sessionId`, `iterations[]`, `currentIteration > 0`,
  `findings[]`, and any evidence node in the graph referencing the mission
  (`getMissionIdsWithEvidence()`, single pass). ANY marker ⇒ executed ⇒ protected anomaly,
  reported, never auto-cancelled.
- **Eligibility window**: age anchored at `updatedAt ?? createdAt` (recent edit = fresh intent);
  a shell is stale only when older than the TTL. Only `created` missions are candidates — every
  other status (queued/running/awaiting_input/terminal) is untouched.
- **Transition semantics**: the ONLY writer is `updateMission()` (the existing choke point).
  `created → cancelled` is legal in the matrix; `running/queued → cancelled` is illegal and is
  dropped by the choke point if a start races past the apply's synchronous re-check
  (`current.status !== 'created'` immediately before the write, same tick).
- **Config**: `missionShellTtlHours` (default 24). saveConfig clamps to [1, 8760] following the
  house `Number(x) || DEFAULTS` convention (invalid/zero → 24 h — never 0, never infinite);
  `normalizeShellTtlHours` floors runtime values at 1 h; echoed in `getPublicConfig()`.
- **Cleanup**: eligible shells hold no session/browser/workspace by definition. Defensive sweep
  reports any hidden resource as an anomaly — never silently claims disposal, never force-deletes.
- **No automatic startup sweep**: expiry runs only through the explicit, master-gated
  `POST /api/v1/diagnostics/store-hygiene/cleanup {apply:true}` (consistent with the rest of the
  lifecycle architecture). Dry-run block in `GET /api/v1/diagnostics/store-hygiene` reports
  total/created/fresh/stale/eligible/anomalies/projectedCancellations with zero mutations.
- **storeHygiene alignment**: stale shells are no longer deletion-eligible in
  `analyzeStoreHygiene` (was: deleted as debris after 7 d) — the TTL cancels and preserves; the
  `staleShells` count stays as a visibility signal. `applyStoreHygiene` runs shell expiry FIRST,
  then ordinary count-based retention (cancelled records age out like any terminal mission).
  `MISSION_STALE_SHELLS` remediation text now points at the TTL path.
- **storeHygiene QASE_DATA_DIR fix**: the module hardcoded `.qase` at load, violating the
  documented isolation contract — now honors `QASE_DATA_DIR` like every other store (a genuine
  pre-existing bug that would have made child-server hygiene runs read the REAL store).
- **Test coverage**: `tests-real/p0f6-r6t4-mission-shells.test.js` — A fresh untouched, B/C
  cancel+reason, D–I all statuses untouched, J six protection markers, K idempotent, L dry-run
  purity, M start-wins race (running + queued + no-terminal-flip), N/O resource truth, O2 raced
  skip semantics, P readability, Q metadata preserved, R invalid TTL both seams, S required-auth
  (gated diagnostics + lifecycle), T open mode, U real-store byte-identity guard, V sequencing
  with store hygiene (cancel-first, never delete-as-shell). 12/12.

### G6 — Store corruption/write-failure invisibility (R3 spec G9/G14, carried here) — SHIPPED (R6-T5)
- `store.js`/`missions.js` silently start empty on corrupt load; write failures swallowed.
- **Shipped**: NEW `server/storeHealth.js` — per-store in-memory registry (sessions/missions/
  findings/evidence) recording `corruptLoadCount`, `lastCorruptLoadAt`, `lastCorruptBackup`
  (**basename only** — no filesystem paths in diagnostics), sanitized `lastCorruptLoadError`,
  `writeFailureCount`, `lastWriteFailureAt`, `lastWriteFailureError`, and `recoveredAsEmpty`.
  All four persistence layers record at the moment of detection. Surfaced through the EXISTING
  `GET /api/v1/diagnostics/state-integrity` (`result.storeHealth`). Observability ONLY: no
  behavior change, no retry/repair policy, no new persistence (counters are process-scoped and
  honest about it; quarantine files remain on disk). Explicit `null` = never failed, never
  fabricated. Errors sanitized to ≤300 chars with paths reduced to basenames.
- **Incidental genuine fix discovered during verification**: `store.js` resolved
  `STATE_DIR = cwd/.qase` at module load, IGNORING `QASE_DATA_DIR` (same isolation-contract
  bug class as storeHygiene pre-T4). Isolated child servers were silently reading the DEV
  sessions store — the `phase11a-findings-store-v2` "metrics total ≥ 1" assertion only passed
  via that leak. Both fixed: store.js now honors `QASE_DATA_DIR`, and the test asserts
  self-consistency (metrics.total == Σ session.findingCount) instead of an absolute count.

### G7 — Dead webhook listener (R3 spec G4, carried here) — SHIPPED (R6-T5)
- `missionBus.on('updated', …)` (index.js) vs store emit `mission:updated` →
  mission-failure webhooks never fire for updateMission-based failures.
- **Shipped**: listener event name aligned to `'mission:updated'`. One-line class of fix as
  specified; verified END-TO-END in the focused suite: an `updateMission`-path mission failure
  (PATCH status → failed) now enqueues EXACTLY ONE signed `mission.failed` webhook delivery
  (HMAC signature verified) with no duplicate from the `mission:finalized` listener and none
  for unrelated missions. The once-per-mission `failedWebhookSent` guard was already in place.
  Focus: `tests-real/p0f6-r6t5-store-integrity-webhook.test.js` — 11/11 hermetic (real
  corrupt-load quarantine via child boot on a corrupted sessions.json; write-failure
  injection; snapshot shape/sanitization; state-integrity surfacing + auth gating; the
  webhook end-to-end proof).

### G8 — Meeting-target media emulation (Complaint 6, carried — environment)
- No `/dev/snd` in container; no fake-audio launch flags in SDK config; meetings fail at
  getUserMedia. NOT an app bug. Gap: launch flags (`--use-fake-ui-for-media-stream
  --use-fake-device-for-media-stream`) for meeting-target missions OR honest capability
  gating ("meeting testing requires media emulation"). Lowest priority in this phase.

---

## 2. DECISION REQUIRED — durable store target (MySQL vs PostgreSQL)

**No choice is made in this spec.** The user decides. Evidence for both sides:

| | MySQL | PostgreSQL |
|---|---|---|
| Availability | Auto-provisioned in this Drytis workspace, credentials via backend env tags — currently **unused** by QASE (Audit D) | Not present in the container today; would be an infrastructure addition |
| ROADMAP alignment | Not mentioned | Phase 5 "Scale" names PostgreSQL explicitly (`.drytis/ROADMAP.md:105`) |
| Migration risk | Same shape of work: JSON → relational mapping for sessions/findings/missions/evidence | Same, plus provisioning |
| Operational fit | Zero new infra in THIS deployment | Standard choice if QASE outgrows the workspace |

Related known limitation (R3 territory, already documented during #8773): `store.js` derives
its state dir from `process.cwd()` and ignores `QASE_DATA_DIR`. Any persistence migration
must address env-driven data roots or the test-isolation guarantees regress.

**Also undecided (user call, listed so it isn't silently dropped):** single-workspace vs
per-user tenancy posture for the durable store (F4 shipped owner-scoping with a documented
shared-workspace default for legacy null-owner records).

---

## 3. Proposed ticket order (for the next session — nothing built yet)

1. **R6-T1 Evidence counters + linkage** (G1 + G3 + G3b) — pure additive, no data loss risk.
2. **R6-T2 Screenshot artifact persistence** (G2) — reuses replay JPEG seam; needs G4's
   retention interaction stated before build.
3. **R6-T3 Retention policy** (G4) — REQUIRES user sign-off on the drop policy first.
4. **R6-T4 Mission-shell lifecycle** (G5) — REQUIRES user sign-off on TTL + terminal state.
5. **R6-T5 Store integrity visibility** (G6) + webhook event fix (G7) — small, shippable together.
6. **R6-T6 Media emulation for meetings** (G8) — optional, environment-scoped.
7. **R6-T7 Durable-store migration** — ONLY after §2 decision. Largest item; own planning pass.

---

## 4. Acceptance criteria for THIS spec (not the implementation)

- [x] Every gap claim traced to a forensic/audit line AND re-verified at HEAD where checkable
- [x] What-already-exists table present (§0) with file:line evidence
- [x] Disproven source claims excluded from scope (missions atomic writes)
- [x] Policy decisions isolated and marked user-required (G4, G5, §2)
- [x] No implementation started, no architecture change, no scope beyond Evidence & Persistence
