# QA dialog device-panel test notes (2026-10-06)

- Auth session cookie is very short-lived (~3–4 min). Device-panel fetches (`/api/qa-configurations?...`) 401 silently and the panel hangs on "Loading device rows…" — re-login restores it. Testers should re-login rather than wait.
- Device panel groups: platform filter options are `android (12996), ios (9702), ipados (7854), macos (6006), windows (2204)` = 38,762 total. Headings observed: "Android", "Apple iPhone", "Apple Mac", "Windows". Rows load 200/window via "Load more".
- Execution badge on every row observed is **"Virtual machine"** only — no "Emulator"/"Simulator"/"Browser emulation" labels exist in the DOM. DuckDuckGo checkboxes are disabled with tooltip "DuckDuckGo is a mobile-only browser with no Linux desktop build and no automation channel…".
- Empty search state: "No configurations match the current filters." (verified with "zzzzz").
- Search examples seen: Galaxy Tab S9/S10/A9+, Pixel Tablet, Tab P12, Galaxy S24/S24 Ultra, Pixel 9 Pro XL, iPhone 15 Pro Max (NOT "iPhone 15 Pro"), iPad Pro 11 (1st Gen), MacBook Air (M1), Surface Pro 9/10/11, Surface Go 3, Surface Laptop 5, Windows Desktop/(QHD), Windows Laptop/(FHD), Windows Tablet, iMac 24" M1/M4.
