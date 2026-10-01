# Review — ticket #14026 Phase 4 (transcript/composer/questions), project 3542

Reviewed against working tree on top of d517756 (Phase 4 uncommitted).

**RESULT: PASS (7/7), credential-flow WARN RESOLVED on re-verify. Remaining: commit-pending WARN only.**

- markdown.ts is a verbatim port of public/uiPrimitives.js markdown() (escape-first, placeholders, https-only links, h3, ul/ol, <p> wrap). PASS.
- liveSession.tsx: thinking never a bubble; delta append; message supersedes delta; /answer /stop /message; stream closes on sign-out. PASS.
- Transcript.tsx: agent markdown, user/system plain text, `text` field fallback fix, 160px auto-scroll, thinking strip, question card, composer Enter/Shift+Enter/170px/Stop. PASS.
- Layout: nested minmax fixed (`minmax(360px, 1fr)`), viewer auto-collapse <1000px via matchMedia. PASS.
- server/ untouched except reactTranscript.test.js (4/4) + 2-line reactApiState update. PASS.
- Suite 768 pass / 0 fail / 20 skipped. build:react exit 0, tsc strict clean. PASS.
- Security: markdown output escaped-first; user bubbles plain text. PASS.

## Credential-flow WARN — RESOLVED (re-verified)
Original WARN: username value was interpolated into sendAnswer() text; /credentials never called; note overpromised vault semantics.
Fix verified:
- storeCredentials() in liveSession.tsx:321-333 POSTs `/sessions/${state.session.id}/credentials` with `{fields}` — exact legacy endpoint/payload (legacy app.js:2040); pre-existing server route app.js:1075 untouched (UI-only constraint holds).
- QuestionSlot storeAndContinue builds {QA_USERNAME, QA_PASSWORD, QA_OTP} and routes to onStoreCredentials only; NO credential value appears in any onAnswer/sendAnswer string. Skip-login canned answer byte-identical to legacy app.js:2019. Note text byte-identical to legacy app.js:2010-2011 ({{QA_USERNAME}}/{{QA_PASSWORD}} keyboard-swap) — and now accurate since values really go to the vault.
- reactTranscript.test.js test 4 pins all of this (endpoint match, `!/username: \$\{username/`, legacy skip string, QA_USERNAME). 4/4 pass; full suite re-run 768/0/20-skip.
- Also fixed: 'session' SSE event now patches current session id (liveSession.tsx:234-238, no synthetic id:''); ThinkingStrip uses exported tailOf (line 157).

## Remaining WARNs
- Entire Phase 2/3/4 surface uncommitted (HEAD d517756); origin/DEV behind.
- Cosmetic: `(question.otpLabel !== undefined || true)` in Transcript.tsx:234 is a dead always-true condition.
- Cosmetic: legacy OTP placeholder is "One-time code or extra field (optional)" vs React "One-time code (if required)" — wording-only.

Files: src/lib/markdown.ts, src/state/liveSession.tsx, src/components/Transcript.tsx, src/App.tsx, src/shell.css, server/reactTranscript.test.js.
