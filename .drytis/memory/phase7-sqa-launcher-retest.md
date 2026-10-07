# SQA launcher crash fix — verified 2026-10-01

Prior fail: clicking open-sqa threw `TypeError: e.map is not a function` (catalog profiles/sources are keyed objects) and wiped the whole React tree. Fixed — dialog now renders.

Re-test result: PASS 6/6.
- Dialog renders fully: catalog line "catalog 2026.08.2 · 48 controls · 25 sources" (note: 48 controls, earlier task text said 44 — catalog grew, payload is what the API returned).
- 5 assurance profiles: "Universal software quality core" checked+disabled (36 controls · required); Medical-device / Airborne / Functional-safety / Payment-data (3 controls each, checkable, with descriptions).
- 10 product attribute checkboxes; disclaimer paragraph; Start assessment DISABLED by default.
- Authorization checkbox toggles button enabled/disabled.
- Validation: URL "nope" → "Enter a complete HTTP or HTTPS target URL."; valid URL + empty Product → "Product, release, and environment must contain visible text."
- Escape closes the dialog. No POST /api/* at all — no assessment started.
- Console: only the known ignorable favicon 404.
