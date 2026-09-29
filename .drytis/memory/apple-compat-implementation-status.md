# Apple Compat Matrix — implementation status (audited 2026-09)

Spec: `.drytis/specs/apple-compat-matrix.md` (master blueprint, 7 phases).
All 7 phases appear IMPLEMENTED and tested:

- Catalog: `server/environmentCatalog.js` (v2026.09.1) — PLATFORMS, BROWSERS, BROWSER_VERSIONS, MACOS_SAFARI_VERSIONS, APPLE_DEVICES (iPhone 11–17, 6 iPad lines, macOS per-OS device), safariVersionFor/isCombinationSupported/buildEnvId/generateEnvironments/availabilityReport.
- DB: `server/postgres/migrations/015_environments.sql` — `environments` table + `qa_runs.environment_id`/`environment_snapshot` jsonb. RLS tenant-scoped.
- Local store: `createLocalEnvironmentBackend` in `server/environmentService.js` → `.qase/environments.json`. "Both stores" = Postgres repo (`server/postgres/environmentRepository.js`) + this JSON backend, chosen by `QASE_RUN_STORE` in `server/serviceFactory.js`; `services.environments` facade is uniform.
- API: `/api/environments` (GET list w/ filters+limit/offset), `/api/environments/facets`, `/api/environments/availability`, `/api/environments/:envId` (GET/PATCH), POST create. 422 invalid combo, 409 dup, PATCH only `active` + `executionProvider`.
- Run linkage: `resolveEnvironmentForRun` in `server/app.js`; all three session endpoints (`/api/sessions`, `/api/sqa/sessions`, `/api/founder/sessions`) accept `environmentId`, store snapshot.
- UI: `<dialog id="environments">` in `public/index.html` (~line 270), admin modal logic at end of `public/app.js` (~3318+). Pickers `#qa-environment-select`, `#sqa-environment-select`, `#founder-environment-select`. Env pref persisted in localStorage key `qase.environmentId`. No framework — vanilla JS/ESM.
- Execution: `server/browserstackProvider.js` (CDP https://cdp.browserstack.com/playwright, BROWSERSTACK_USERNAME/ACCESS_KEY, resolveExecution → browserstack|emulated|default), consumed by `server/browserBridge.js`.
- Scripts: `scripts/generate-environments.mjs` (seed/--print), `scripts/validate-matrix.mjs` (13-point checklist).
- Tests: environmentCatalog.test.js, environmentService.test.js, environmentApi.test.js, environmentRepository.test.js, browserstackProvider.test.js, browserBridgeEnvironment.test.js.

Gaps (candidates for the new "Testing Matrix" feature): no per-environment coverage/matrix dashboard, no test-case entity, findings have no env dimension (only run-level snapshot), no "create bug from failed execution" flow (closest = fixPromptBuilder "fix prompt" from qa_findings).
