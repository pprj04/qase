# Phase 4 re-test (ticket #14026) — 2026-10-01

Re-test of 3 fixed defects on /app-react/ (run d415f567…, 72 messages):

1. **Message bodies — FIXED.** All 72 `.msg-body` non-empty; markdown renders (`<p>`, `<strong>`, `<ul>`, `<code>`); no literal `#` headings remain. Served CSS hash `index-react-CqcGvesL.css`.
2. **Transcript flex height — STILL FAILS, root cause found.** `.shell-body` grid-template-columns in the served CSS is `auto minmax(360px, minmax(0, 1fr)) auto auto` — **nested `minmax()` is invalid CSS**, so the browser drops the entire declaration at parse time (computed `gridTemplateColumns: 1280px`, template-areas "none", 4 implicit rows). Result: sidebar/conversation/viewer/mode-rail STACK VERTICALLY, each ~108px; `.transcript` = 48px tall vs 8146px scrollHeight. Fix: `auto minmax(360px, 1fr) auto auto` (single minmax).
3. **Composer auto-grow — FIXED.** 40px → 61px with 2 lines (Shift+Enter newline), shrinks back to 40px after Ctrl+A+Delete; Send disabled when empty. NO POST /message this run (network log clean — no accidental send).

Console: only known /favicon.ico 404.
