# #14384 Theme toggle in Settings (T2) — DONE, reviewer+tester PASS

- index.html: one .field (Theme + select#cfg-theme, 3 options) in #settings before Reasoning row. app.js: cfg.theme entry + wiring after themeStore init (module scope, single change listener calling themeStore.set, re-normalize, dialog 'open' re-sync).
- Select shows the STORED preference (system stays "System Default"), never resolved value.
- Reviewer PASS all criteria; one non-blocking WARN (no unit test for select↔store wiring — browser-covered).
- Suite 1123/1103/0/20. Tester note for T3: a <main> region has a fixed near-black background in BOTH themes ("terminal viewport") — audit it during hardcoded-color migration.