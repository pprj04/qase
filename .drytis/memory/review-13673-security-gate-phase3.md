# Review 13673 — Phase 3 authorization gate, payload cap, stop control

Verdict: 6 PASS, 1 FAIL (partial, criterion 4 env wiring), 1 WARN.

**Key defect found — QASE_SECURITY_PAYLOAD_LIMIT is dead wiring:**
`server/config.js` reads the env key into `config.securityPayloadLimit` (clamped 1–200 at line 134) and `.env` sets it to 40, but `server/agent.js:479` calls `guardSecurityPayloadTool(guardSqaBrowserTool(tool, session), session)` **without passing the limit**. The guard then does `clampSecurityPayloadLimit(undefined)` → always the default 40. The env knob can never raise/lower the cap at runtime; only `limitOverride` (used by tests) exercises the clamp. Safety still holds (hard 40), so this is configurability-dead, not safety-dead. Fix (for next phase, not done by reviewer): pass `settings.securityPayloadLimit` at the agent.js call site.

Everything else verified clean: gate UI (syncQaSecurityGate, setCustomValidity + invalid-mirror + JS submit guard), Select-all no-bypass, payload spread-only-when-present, browserPolicy.js untouched (0-line diff), stop control (securityRunControls.test.js abort mid-turn → idle / "Stopped by user." / 0 findings), server 400 backstop intact, notes trimmed client + bounded 2000 server. styles.css additive-only (132+/0−). Suites: 104 pass / 0 fail.
