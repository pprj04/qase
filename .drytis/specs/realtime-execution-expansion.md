# Real-Time Execution Expansion — spec

## Goal
Every selectable environment in the EXISTING catalog either executes on a real,
verified runtime (actual device + actual browser) or is honestly BLOCKED as
`REAL DEVICE · UNAVAILABLE`. No UI/structure changes. No silent fallback. No
faked execution levels.

## Ground truth (recon, 2026-10-02)
- Catalog v2027.02.0 already contains: all requested iPhones 11–17 Pro Max
  (incl. 16e, 17 Air), iPad generations (5th–11th, Air 3rd–7th, mini 5th–7th,
  Pro 11 1st–5th, Pro 12.9 3rd–6th, Pro 13 M4), macOS High Sierra→Tahoe
  (Monterey/Ventura/Sonoma/Sequoia/Tahoe included), all requested Android
  models (manufacturer field present), Windows Desktop/Laptop/Tablet + 7
  Surface models, browsers Chrome/Firefox/Edge/Opera/Brave/DuckDuckGo/Safari
  with per-family version ladders (chrome 140–156, firefox 141–158, edge
  140–156, opera 122–137, brave 136–140, ddg 1–3).
- Execution today: browserstackProvider resolves 'environment' mode ONLY with
  BROWSERSTACK_USERNAME + BROWSERSTACK_ACCESS_KEY (absent by default → local
  Chromium 'emulated'). No real reservation (create_session returns
  sessionId:null). runtimeFacts (UA/viewport/DPR/touch) are probed from the
  page but NEVER compared to the selection. attestationFor reads the catalog
  snapshot, not the runtime. Evidence = ephemeral SSE frames; artifact sidecar
  only. Local launch seam: browserBridge.js ensureContext → chromium.launch
  (single engine).

## Constraints (customer, verbatim-critical)
1. NO structural/UI changes: keep layout, three columns, sidebar, preview,
   matrix picker, workflow, dark terminal design. Only add data + wire truth.
2. Real availability check → reserve → connect ACTUAL browser → VERIFY
   identity (device/OS/browser/version) → run → real evidence → re-verify →
   release. Mismatch = BLOCK with honest reason.
3. No silent fallback (device→device, Safari→Chrome, REAL→SIMULATED, 11→10).
   Unavailable = show REAL DEVICE/BROWSER UNAVAILABLE and BLOCK. Only the
   user's explicit new selection changes the target.
4. Execution type from the ACTUAL runtime only. REAL DEVICE · AVAILABLE /
   CONNECTING / RUNNING / UNAVAILABLE states, never granted because the
   catalog has the device.
5. Browser version displayed/recorded = version the runtime reports (Chrome
   141 if runtime says 141), never a hardcoded catalog label.
6. iOS/iPadOS engine accuracy: non-Safari browsers there are apps over the
   WebKit engine — runtime metadata must say browser app + engine separately;
   never claim independent engines.
7. Real evidence: device/make/model/device ID/OS/OS ver/browser/browser ver/
   execution type/runtime session ID/timestamp/resolution/viewport/orientation
   + screenshots/console/network where available — from the runtime, never
   fabricated or reused.
8. PASS only after the requested runtime actually executed; BLOCK on
   unavailable device/browser, identity mismatch, connection failure, or
   missing required capability.
9. Infrastructure rule: no runtime available for a device → keep it in the
   catalog, mark REAL DEVICE · UNAVAILABLE, prevent execution, name the
   missing capability. Honesty over演示.
10. Meeting tests use the real device's camera/mic/speaker — or are blocked.

## Phases
- R1 Catalog completeness & availability baseline — verify/align naming with
  the requested list (iPad "N-inch" aliases etc.), add anything truly missing,
  and give every environment an honest runtimeAvailability status
  (unavailable-by-default where no runtime exists) surfaced through the
  EXISTING board/picker metadata — no UI change beyond the honest status text.
- R2 Runtime identity verification — extend the runtime probe to report
  device/OS/browser/version/engine; runtimeIntegrity compares runtime facts vs
  requested selection; mismatch → BLOCK + reason; browser version everywhere
  becomes runtime-authoritative; engine metadata for iOS/iPadOS.
- R3 Real runtime wiring & no-silent-fallback — real reservation when a
  provider is configured; REAL DEVICE · CONNECTING/RUNNING lifecycle; run
  path BLOCKS on unavailable instead of falling back; actual browser engines
  locally where installed (Playwright firefox/webkit) with honest UNAVAILABLE
  otherwise.
- R4 Real evidence — persisted, runtime-sourced evidence bundle (screenshot,
  console, network, metadata incl. runtime session id + authoritative browser
  version) attested from runtime facts; meeting media on real capabilities or
  honest block.
- R5 Final validation — per-family sweep (Apple/Android/Windows × 7 browsers),
  suite + acceptance + live checks; documented BLOCK reasons for every
  environment without a real runtime.
