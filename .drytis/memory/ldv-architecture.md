# Live Device View (LDV) architecture — phases 1–4 done

- Single source of truth: `public/activeRuntimeEnvironment.js` → `resolveActiveRuntimeEnvironment({session, environments, runtimeBoard})` → `state.activeRuntimeEnvironment` in app.js. Recomputed in `applySessionSnapshot` and SSE `case 'status'`. Precedence: environmentSnapshot > runtimeFacts(+attestation) > legacy session.device. executionType attestation-gated (REAL only with verified attestation — never name-inferred).
- `public/browserChrome.js` — browser brand/key rendering; frame via `#stage[data-device-kind="phone|tablet|desktop"]` + `data-browser-key`, `--ldv-aspect` set from real resolution+orientation.
- Lifecycle vocabulary: queued/reserving/connecting/connected/running/completed/failed/device_unavailable (`runtimeStatusFor`).
- **LAYOUT GOTCHA**: `.viewer` panel-head height is pinned by `grid-template-rows: 64px …` in **4 places** (base ~:1631, mobile ~:2912/:2983, cli-theme ~:5477, cli-theme mobile ~:6057) — first row must stay `auto` or the env card clips. Same class of bug: `.modal-body` is display:grid — needs `minmax(0,1fr)` or wide tables blow out dialogs (see device-matrix fix #13833).
- **renderTranscript wipes children** via `replaceChildren()` — any pinned node inside #transcript (e.g. #execution-target-block) must be re-appended in renderTranscript.
- Stale orphan `node server/index.js` can own port 5173 after code changes; `procmgr restart drytis-service` "502 JSON parse" on first call is normal — check `ss -ltnp | grep 5173` and kill orphans.
- Bulk: `activeBatchRunId(batch, sessionsById)` in bulkProgress.js picks the run the live preview follows; onTick calls selectSession. Evidence provenance rendered from artifact sidecars (`meta.evidenceHeader`) in report tab `.evidence-section`.
- Tests live in `public/*.test.js` colocated, node --test.
