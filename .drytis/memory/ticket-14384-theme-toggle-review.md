# Review · #14384 Phase T2 — Theme toggle in Settings (PASS)

Round 1 (only round needed). Verdict: PASS, 0 FAIL, 1 minor WARN.

- Wiring: `public/app.js:6321–6329` — single module-scope `change` listener → `themeStore.set()` (store is sole source of truth, exposed via `globalThis.__qaseThemeStore` from #14383); dialog `open` event (fires on `showModal()` at app.js:5749) only re-syncs `cfg.theme.value = themeStore.preference()` — no double-binding. Select shows STORED preference, not resolved value (System Default stays selected).
- HTML: `index.html:679–687` — one `.field` (`<label class="field">` wrapping `<span>Theme</span>` + `<select id="cfg-theme">` 3 options + `<small>` hint) placed after Model, before Reasoning field-row. Matches house pattern exactly. Live-served (curl).
- `fillSettings()` (5658) does NOT touch cfg.theme → config load/save can't desync.
- Suite reproduced: 1123/1103/0 fail/20 skipped. Live styles.css?v=20261001-5 still brace-balanced (depth 0, no dip) — #14383 round-2 fix intact.
- Security: no secrets/URLs in new/changed files.
- Scope: app.js/index.html diffs = T1 store init (already reviewed) + ~25 T2 lines. styles.css diff belongs to #14383. No scope creep, no new navigation.

WARN (minor, non-blocking): no automated unit test for the T2 select wiring (no test drives cfg-theme change → store.set); covered only by browser tests (PASS 5/5). Spec T2 doesn't demand one.
