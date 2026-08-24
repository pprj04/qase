# M1-P3 — DATA & STATE SAFETY (Phase 5 deliverable)

## 1. sessions.json growth — root cause & decision

**Observed (live):** 50 sessions / 25.2MB in-memory payload (disk file 33.4MB
pretty-printed). Largest session 2.4MB, median 126KB. The M1-P2 perf suite
bound is <15MB after pruning — routinely exceeded because `pruneOldSessions(50)`
is **count-based** (store.js:44, swept at boot + every 30 min at index.js:156).

**Root cause:** heavyweight sessions are agent missions whose `messages[]` array
carries the full conversation (multi-MB each). Count-based pruning keeps 50 of
those regardless of bytes.

**Options compared (smallest production-safe solution wins):**

| Approach | Risk | Verdict |
|---|---|---|
| A. byte-based pruning (evict oldest until under budget) | Low — same mechanism, new key | **CHOSEN (interim)** |
| B. payload slimming (strip messages from persisted sessions) | Breaks UI/console replay + protected tests | REJECTED for M1-P3 |
| C. archival (move evicted to sessions-archive.json) | Medium — new file, replay UX question | DEFERRED to M1-P4 |
| C+B hybrid | Changes protected replay behavior | DEFERRED |
| D. split heavyweight data (messages → per-session file) | Refactor across store.js + 28 session routes | DEFERRED to M1-P4/P5 |

**Decision: Option A — IMPLEMENTED in this phase.** Keep count-cap 50 AND add
a 12MB byte budget (min 5 survivors). Eviction oldest-first. No schema change,
no UI change, one function in store.js (`pruneOldSessions`). Verified live:
store at 58 sessions / 31.9MB → after boot prune 25 sessions / 14.9MB on disk
(11.2MB payload + pretty-print overhead) — RL-1 (<15MB) green. The protected
phase9.3 suite (19 tests) passes unchanged: its semantics ("bounded store")
are strengthened, not weakened — the gate proved the count-only prune was
already insufficient in practice.

## 2. Atomicity audit — before/after M1-P3 Phase 3

| Store | Before | After | Status |
|---|---|---|---|
| evidence-graph.json (29MB) | tmp write → **copy** via readFileSync (crash mid-copy truncates) | tmp + `renameSync` + loud parse-failure preserving corrupt file | **FIXED (P0-1)** |
| fix-validations.json (4MB) | plain `writeFileSync` | `atomicWrite()` (tmp+rename) | **FIXED (P0-2)** |
| sessions / missions / findings / test-cases / replay / schedules / knowledge / ux / workflows | already `atomicWrite()` | unchanged | OK |
| store.js:59 / testCases.js / replayStore.js silent-empty-on-parse-failure | silent reset | documented in risk register (P1) | DEFERRED — loud-fail pattern from P0-1/P0-2 to be applied in M1-P4 |

## 3. Concurrency

- No locks/mutexes exist around store mutation+persist; writes are serialized per-store only by Node's single-threaded nature within one process. In-memory Map mutation during a debounced persist window is safe (single thread); the SIGINT/SIGTERM gap (debounced writes dropped on shutdown — P0 documented, not fixed) remains the only real loss window.
- Store paths inconsistent (cwd-relative vs module-relative) — documented in risk register; unify in M1-P4.

## 4. Duplicate IDs / orphaned state / partial persistence

- `createMission` accepts caller-supplied `data.id` → silent overwrite on repeat (P1, documented, M1-P4).
- 2 stuck QUEUED fix-validations (fxv_f80d, fxv_61b3) live-block new validations via the 409 active-check — documented; resolution belongs to the phaseRouter owner (do-not-touch unless P0).
- Orphaned artifacts (217MB / 3,761 dirs) — no pruning; documented for M1-P4 observability/cleanup job.
- Missions bloat: recordIteration stores the entire findings array per iteration (missions.js:319-355) — the dominant driver of missions.json 10.3MB; documented for M1-P4 (slim iterations, keep latest full findings).

## 5. Recovery after restart

- **Running missions:** boot recovery now exists — `recoverInterruptedMissions()` (P0-4) reaps missions stranded in running/awaiting_input whose session was pruned/lost → `interrupted` with a marker. Verified live: 57 zombies → `interrupted:57`, 14 legitimately running preserved.
- **Boot order:** loadSessions → prune → recover missions → scheduler → watchdog → cleanup interval → listen. Shutdown still drops debounced writes (SIGINT handler aborts sessions, never flushes) — **documented P0, deferred** (needs a controlled flush API on each store; M1-P4).
- **Mission finalization:** lazy finalize on GET + store-boot recovery covers both known stuck paths; bus event name mismatch (`mission:finalized` vs `finalized`) documented (webhook listeners dead) — M1-P4.
