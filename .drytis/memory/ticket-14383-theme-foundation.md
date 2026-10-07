# #14383 Theme foundation (T1) — DONE, reviewer+tester PASS

Files: public/themePreference.js (+19 tests), theme-bootstrap.js (external, CSP-safe, first head script, v=2), styles.css ([data-theme] token layers), index.html (bootstrap + cache-bust v=20261001-5), app.js (store init + globalThis.__qaseThemeStore).

- Default dark; light only under :root[data-theme="light"]; base :root dark tokens untouched.
- system → resolved to concrete dark/light by JS; OS changes tracked live (sub-second async settle).
- Round-1 review FAIL (duplicated :root:not([data-theme]) line swallowed half the stylesheet — only visible for OS-light users) fixed; round 2 PASS. Lesson: after big styles.css edits run a brace-census check.
- For T2: read/write globalThis.__qaseThemeStore (preference() returns dark/light/system; set() applies instantly). Theme select belongs in #settings dialog near the Provider field (~L650 index.html), house .field pattern: <span>Theme</span> + select#cfg-theme.
- Suite at close: 1123 tests / 1103 pass / 0 fail / 20 skipped.