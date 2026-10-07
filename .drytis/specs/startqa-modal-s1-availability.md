# Phase S1 · Honest browser availability (launch failure ≠ unsupported)

## Goal
A failed launch probe must never disable a browser checkbox pre-run. Only genuinely unsupported
families (e.g. DuckDuckGo static rule) stay NOT_SUPPORTED. Launch failures surface in run
results/evidence only.

## Files
- `server/browserSupportResolution.js` — `resolveBrowserSupport` (:148) / `resolveBrowserSupportSync` (:191):
  when `entry.status === 'present'` with reason starting "Binary present but failed to launch",
  return a SUPPORTED status (`status:'supported'`, `launchVerified:false`, keep the raw reason in a
  new `probeNote` field). Do NOT return NOT_SUPPORTED for a probe failure.
- `server/localBrowserRegistry.js` — keep recording `launchVerified:false` + reason (no change to probe).
- `server/qaConfigurations.js` — `availabilityFor` unchanged (not_supported → NOT_SUPPORTED only);
  `toConfiguration` may surface `browserSupport.probeNote` for UI tooltips.
- `public/qaConfigMatrix.js` — `isSelectable` unchanged (still AVAILABLE-only).

## Acceptance criteria (running app)
- [ ] Open Start QA run: Chrome, Edge, Firefox, Opera, Brave checkboxes are enabled and checked by default.
- [ ] No "Binary present but failed to launch…" text appears as a pre-run availability reason in the modal.
- [ ] DuckDuckGo stays visible-but-disabled with its honest unsupported reason.
- [ ] If a real launch failure happens during a run, the failure appears in that run's results/evidence — not in the browser availability UI.

## Tests
- Unit: probe-failed branded browser resolves supported (launchVerified false), duckduckgo still not_supported.
- Unit: qa-configurations for chrome/edge/opera/brave = AVAILABLE with probeNote when registry has failed probe.

## Edge cases
- Registry snapshot null (probe never ran) → engine-equivalent fallback unchanged.
- Stale 5-min TTL cache must not resurrect NOT_SUPPORTED after fix (fresh boot).
