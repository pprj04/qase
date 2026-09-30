# Phase 8 · Multi-browser engine coverage

Ticket: #13206 (dup of #12960; board-column gate). Branch: PUSHKAR.
Spec owner: coding agent. Written 2026-09-27.

## Probe findings (facts to encode, not re-derive)

- Playwright 1.62.0 pinned. `firefox` launcher works headless natively in this container (verified: launch → newPage → setContent OK, ~4.4s).
- Playwright's **WPE headless** webkit build segfaults 100% in this container (null-ip crash inside `libWPEWebKit-2.0.so.1.10.2` during view creation; fdo backend needs a display; known no-GPU-container WebKit issue class — playwright#13875, #42940). Env fixes (WEBKIT_DISABLE_DMABUF_RENDERER, LIBGL_ALWAYS_SOFTWARE, dbus, ldconfig) do NOT help.
- **Working webkit path:** point playwright's `webkit.launch({ executablePath })` at the bundled **GTK** MiniBrowser (`webkit-2336/minibrowser-gtk/MiniBrowser`) with `LD_LIBRARY_PATH=<gtk>/lib:<gtk>/sys/lib` and a running **Xvfb** display. Verified end-to-end: launch, context emulation (viewport + UA), goto, click, evaluate.
- Chromium unchanged.

## Design

### Engine registry — `server/browserEngines.js` (new)

```js
ENGINES = [
  { id: 'chromium', label: 'Chromium (Chrome)', available: true },
  { id: 'firefox',  label: 'Firefox',            available: true },
  { id: 'webkit',   label: 'WebKit (Safari engine)', available: true },
]
```
`resolveEngine(id)` → `{ type, launchOptions }`:
- chromium: playwright `chromium` type, no override (unchanged).
- firefox: playwright `firefox` type, no override.
- webkit: playwright `webkit` type + `executablePath` = GTK bundle + `env: { DISPLAY, LD_LIBRARY_PATH }` when Xvfb display is up.

`ensureXvfb()` — lazily start `Xvfb :77` once per process (spawn, wait for socket, keep handle; no nohup/& — plain child process held by the module). Idempotent; failure → webkit marked unavailable with reason.

### Bridge — `server/browserBridge.js`

- The patched `ensureContext` (line ~455-494) currently hardcodes `chromium`. Change to `engineFor(session)` → `resolveEngine(session.engine ?? 'chromium')` and launch with the resolved type/opts. Everything else (policy, network install, canary, security checks) is engine-agnostic and stays.
- `session.engine` stamped at bridge attach, like `deviceId` today (browserBridge.js:111-114).
- Engine failure degradation: if `resolveEngine` reports unavailable (webkit w/o display, firefox binary missing), `browser_open` fails with a clear `ENGINE_UNAVAILABLE` error the agent reads and reports as a finding, not a run crash.

### Session/payload — same path as device

- `POST /api/sessions` accepts `engine` (string, one of ENGINES ids; default `chromium`). app.js:388-439 parse → store.js:173-174 stamp → bridge reads.
- `GET /api/engines` returns the registry (id, label, available, reason) — the UI never hardcodes engine lists.

### Findings — `qaTools.js`

- `report_finding` gains optional `engine` field (string). The bridge injects the session engine into the finding server-side when the agent omits it (agent-side default, additive; old sessions unaffected).
- `public/app.js renderFinding` (1086-1147): meta line gains engine chip when present.

### Launcher UI

- QA modal: "Browser engine" select/checkboxes fed from `GET /api/engines`, default chromium. Multi-engine = ONE session per engine: the QA submit creates a run per selected engine sequentially (client-side loop over engines, tagging each run title with the engine label) — keeps the single-session agent conversation model intact (researcher's option a).
- Multi-engine default: transcript demands default-on multi-browser. Compromise encoded here: **chromium always runs the full sweep; secondary engines (firefox, webkit) run the core flow set** — client passes a kickoff note "Focus: core flows, cross-browser comparison" for secondary runs. Scope of "core flows" = the agent's judgment per existing kickoff mechanism.

### Prompt

- `server/prompt.js`: brief section — engine is set per run; report cross-engine differences explicitly; findings must name the engine.

## Files

- new `server/browserEngines.js`
- `server/browserBridge.js` (launch seam + engine stamp + failure mode)
- `server/app.js` (`GET /api/engines`, `engine` in POST /api/sessions)
- `server/store.js` (persist `engine`)
- `server/qaTools.js` (`engine` field)
- `server/prompt.js`
- `public/index.html` + `public/app.js` (launcher engine picker, per-engine run fan-out, finding chip)
- `scripts/setup` update: `npx playwright install chromium firefox webkit` + GTK webkit OS deps remain covered by existing apt lines (verify)
- `package.json` script `install-browser` gains firefox webkit

## Tests

- `server/browserEngines.test.js` (unit): registry shape, resolveEngine defaults, unavailable-engine error, xvfb helper guarded (no display in unit env → graceful).
- `server/multiEngine.integration.test.js` (live, QASE_RUN_BROWSER_TESTS=1): launch firefox + webkit(GTK/xvfb) + chromium through the bridge; load demo page; report_finding includes engine; engine fan-out helper creates N sessions.
- Unit test for app.js session validation accepting engine.
- Existing suites stay green.

## Acceptance criteria

- [ ] `GET /api/engines` returns chromium/firefox/webkit with availability
- [ ] QA launcher lets the user pick engines; default chromium; multi-select fans out one run per engine, titles tagged
- [ ] A firefox run and a webkit run each complete against the demo site (live test)
- [ ] Unavailable engine → clean agent-visible error, run continues/ends gracefully, UI shows reason
- [ ] Findings carry `engine`; UI shows the chip
- [ ] `npm run verify` green; live-browser suite green under flag
- [ ] Setup script installs all three engines for prod deploys

## Out of scope

- Parallel engines (sequential only — token cost, Thomas's rejected worry acknowledged deliberately)
- WPE headless webkit (broken in container; GTK+xvfb is the supported path)
- Engine-specific security checks (they are engine-agnostic already)
