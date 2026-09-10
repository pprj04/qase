# R6-T5 — Store-integrity visibility (G6) + dead webhook listener (G7)

Ticket: #9525 · Parent spec: `phase-R6-evidence-integrity.md` §G6, §G7 · HEAD at start: `a03719e` (R6-T4)

> A previous turn left the implementation **uncommitted in the tree**. This pass verified
> it at HEAD rather than rebuilding (forensics-first convention: `git status` → read →
> test → finish). Focused suite passed 11/11 on first run at the discovered state.

## Goal

Two small, independent fixes carried from the R3/Audit-D forensics:

- **G6** — corrupt store loads and persistence write failures were console-only.
  Operators discovered silent data loss via an empty UI, never via a diagnostic.
  Gap: per-store visibility, surfaced through the EXISTING `state-integrity` route.
  Observability ONLY — no behavior change, no retry policy, no auto-repair.
- **G7** — `index.js` subscribed a mission-failure webhook listener to `'updated'`,
  but `missions.js` emits `'mission:updated'`. The listener was dead: any mission
  that failed through the `updateMission` path fired **no** `mission.failed` webhook.

## Files

| File | Change |
|---|---|
| `server/storeHealth.js` | NEW — per-store health registry + `getStoreHealthSnapshot()` + `_clearForTesting()` |
| `server/store.js` | record corrupt load (quarantine site) + write failures (both catch blocks) |
| `server/missions.js` | same, for `missions.json` |
| `server/findings.js` | same, for `findings.json` (load failure + persist failure) |
| `server/evidenceGraph.js` | same, for `evidence-graph.json` (corrupt quarantine + save catch) |
| `server/index.js` | G7: listener event name `'updated'` → `'mission:updated'`; G6: `result.storeHealth = getStoreHealthSnapshot()` on `GET /api/v1/diagnostics/state-integrity` |
| `server/webhookDelivery.js` | verify-only edits from the prior turn (delivery pump/ledger used by tests) |
| `tests-real/p0f6-r6t5-store-integrity-webhook.test.js` | NEW — 11-test hermetic suite |

## Design decisions

1. **Process-scoped counters, honest about it.** A restart resets counters — that is
   a truthful fact about the process, and the quarantine files (`*.corrupt-<ts>`)
   persist on disk for forensics. `recoveredAsEmpty` flags stores that booted from
   a corrupt file so a silent reset is never mistaken for a healthy boot.
2. **No paths in diagnostics.** `lastCorruptBackup` keeps the basename only;
   error strings are sanitized (absolute paths reduced to basenames, 300-char bound).
3. **Explicit null = never failed.** Never zero-as-fabricated; the snapshot always
   contains all four stores so the API shape is stable.
4. **G7 is a one-line event-name alignment.** The once-per-mission `failedWebhookSent`
   guard already existed; the B2 `mission:finalized` listener is untouched. No
   signing/queue/retry semantics changed.
5. **No new route.** `storeHealth` rides the existing `GET /api/v1/diagnostics/state-integrity`
   (master-token-gated as before).

## Acceptance criteria

- [x] Corrupt `sessions.json` boot → quarantine preserved on disk + registry records
      corruptLoadCount=1, lastCorruptLoadAt, basename-only backup id, recoveredAsEmpty=true
- [x] Write-failure injection (read-only data dir) → writeFailureCount increments per store
- [x] Snapshot shape stable: all four stores, explicit nulls, sanitized errors, no paths
- [x] `GET /api/v1/diagnostics/state-integrity` exposes `storeHealth`; gated exactly as before
- [x] G7: mission failure via the `updateMission` path → exactly ONE signed
      `mission.failed` delivery in the ledger (no duplicate from the finalized listener;
      unrelated missions untouched)
- [x] Hermetic suite: temp `QASE_DATA_DIR`, real-store byte-identity guard
- [x] Regression battery green (T1–T4, F1–F5, lifecycle/ownership/auth/API)
- [x] Spec updated with shipped behavior; single commit

## Tests

`tests-real/p0f6-r6t5-store-integrity-webhook.test.js` — 11 tests:
storeHealth counters via REAL corrupt-load quarantine (child boot on a corrupted
sessions.json) and write-failure injection; snapshot shape/sanitization/null semantics;
state-integrity route surfacing incl. auth gating (401 anon / 200 token); webhook fix
end-to-end via the signed delivery ledger (register subscription → PATCH mission to
failed → exactly one `mission.failed` delivery → HMAC signature verified → no
finalized-listener duplicate → unrelated mission untouched).
