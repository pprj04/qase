# SQA launcher crashes entire React app (uncommitted Phase 7 work, ~2026-10-01)

**Severity: blocking.** Clicking the SQA mode-rail button (`data-testid="open-sqa"`) in the
React UI at /app-react/ throws `TypeError: e.map is not a function` inside a `useMemo`
in the SQA dialog component, which **unmounts the whole app** — `#root` goes empty, blank
page until a manual reload.

- Reproduced twice (initial click + programmatic click after a clean reload). The crash
  fires right after `GET /api/sqa/catalog` → 200.
- Root cause (high confidence): the catalog response returns `sources` and `profiles` as
  **keyed objects** (`{ISO_29119: {...}, ...}`, `{core: {...}, medical: {...}, ...}`), not
  arrays. Catalog payload: catalogVersion 2026.08.2, 25 sources, 5 profiles (core, medical,
  aviation, functional_safety, payment), 10 attributes, 44 controls. The component calls
  `.map()` on one of these object fields inside `useMemo`. Fix: `Object.values(...)` or
  type the fields as records.
- Consequence: NONE of the leader's test items 1–5 (dialog contents, validation errors,
  authorization-checkbox gating, Escape close) could be exercised — the dialog never renders.
- No network POST was ever fired; no real data touched.
- Also present: known ignorable /favicon.ico 404.
