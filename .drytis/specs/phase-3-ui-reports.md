# Phase 3 · Surface token usage in UI and reports

## Goal
Make per-run token usage visible: run-list badge, run detail, report markdown/PDF, and operational metrics.

## Files
- **Run list**: `public/app.js` `renderRun()` (198–270) — compact badge next to the findingCount badge, e.g. `12.3k tok` (format with k/M). Data comes from the run-list payload (Phase 1).
- **Run detail**: add a usage chip/row in the session header area (near status/mode info). Also handle the SSE `'usage'` event in the dispatcher (public/app.js:1830–2013) to update it live — and while there, render the already-persisted-but-never-shown `contextUsage` on the `'context'` event (currently falls through to `default: break`).
- **Markdown report**: `server/report.js` `buildReportMarkdown()` (line 42) — add header line `- Tokens: <input> prompt / <output> completion / <total> total` (append `(estimated)` when applicable). Only when `session.tokenUsage` exists.
- **PDF**: `server/reportPdf.js` — same line in the header block if it renders header metadata.
- **Metrics**: `server/operations.js` — add `qase_model_tokens_total` counter (labels: `kind` = input|output|total, `mode` = qa|sqa|founder) incremented at finalization. Exposed at `GET /metrics`.
- SQA/Founder parallel renderers (`public/sqaPresentation.js`, `public/founderView.js`/`founderPresentation.js`) get the same badge only if trivially analogous; otherwise out of scope for this phase.

## Acceptance criteria
- [ ] The run list shows a token badge for every run that has token usage
- [ ] Opening a run shows its token usage; the number updates live during a run (SSE)
- [ ] Downloading the .md report of a counted run includes the Tokens line; reports of older uncounted runs render unchanged
- [ ] `GET /metrics` exposes `qase_model_tokens_total` counters
- [ ] Token numbers use k/M formatting (e.g. `12.3k`) in the UI

## Edge cases
- Old sessions with no `tokenUsage`: badge/line simply absent — never "0 tokens".
- Very large numbers formatting; zero-token components hidden rather than shown as "0".
