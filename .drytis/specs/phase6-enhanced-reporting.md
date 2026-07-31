# Phase 6 — Enhanced Reporting & Notifications

## Goal

Three sub-features that make the QA output more useful:
1. **Historical Trend Dashboard** — metrics across runs over time
2. **Notification Webhooks** — fire on report completion and test failures
3. **Export Formats** — findings as JIRA/Linear/GitHub issue JSON; test cases as JSON/CSV

## Sub-feature A: Trend Dashboard

### Backend: `server/metrics.js`

Aggregates data across sessions and regression runs into a single dashboard payload:

```
GET /api/metrics/dashboard → {
  sessions: { total, byStatus: {idle, running, completed, ...}, avgFindings },
  findings: { total, bySeverity: {critical, high, medium, low, info}, recentTrend: [{ts, count}] },
  regression: { totalRuns, totalTests, passRate, recentTrend: [{ts, passed, failed, total, passRate}] },
  testCases: { total, bySeverity: {critical, high, medium, low} }
}
```

### Frontend: Enhancement to Report or Regression tab

The Regression tab already has a basic trend chart. Add a metrics overview panel at the top showing:
- Total sessions, findings (with severity breakdown dots), test cases
- Pass rate trend from regression runs

## Sub-feature B: Notification Webhooks

### Backend: `server/webhooks.js`

- Reads `QASE_WEBHOOK_URL` from env (optional).
- `notifyReport(session)` — fires when agent calls `finish_qa_report`. Payload: `{ event: 'qa_report', session: {id, title, targetUrl, verdict, findingCount, bySeverity}, findings: [...] }`.
- `notifyTestFailure(scheduleId, summary)` — fires when a regression/replay run has failures. Payload: `{ event: 'test_failure', scheduleId, failed, total, results: [...] }`.
- POSTs JSON to the webhook URL with a 5-second timeout. Failures are logged but never throw (fire-and-forget).
- Webhook delivery is async — never blocks the response.

### Integration points

- `qaTools.js` → `finish_qa_report` tool calls `notifyReport(session)` after setting `session.report`.
- `scheduler.js` → `executeSchedule()` calls `notifyTestFailure()` if `summary.failed + summary.errored > 0`.

## Sub-feature C: Export Formats

### Backend: `server/exporters.js`

Finding exporters:
- `exportFindingsGitHub(session)` → array of GitHub issue objects `{ title, body, labels }`
- `exportFindingsJira(session)` → array of JIRA issue objects `{ summary, description, issuetype, priority, labels }`
- `exportFindingsLinear(session)` → array of Linear issue objects `{ title, description, priority, labels }`

Test case exporters:
- `exportTestCasesJSON(testCases)` → returns the array as-is (clean JSON download)
- `exportTestCasesCSV(testCases)` → CSV string with columns: name, severity, steps, assertions, targetUrl

### Routes

```
GET /api/sessions/:id/export/findings?format=github|jira|linear|markdown
GET /api/test-cases/export?format=json|csv
```

Content-Disposition headers for download.

## Files to create/modify

| File | Action |
|---|---|
| `server/metrics.js` | NEW — dashboard data aggregation |
| `server/webhooks.js` | NEW — webhook notification system |
| `server/exporters.js` | NEW — export format converters |
| `server/qaTools.js` | MODIFY — call notifyReport in finish_qa_report |
| `server/scheduler.js` | MODIFY — call notifyTestFailure on failed runs |
| `server/index.js` | MODIFY — add metrics, export, webhook routes |
| `public/app.js` | MODIFY — metrics panel, export buttons |
| `public/index.html` | MODIFY — metrics overview section |
| `public/styles.css` | MODIFY — metrics panel styles |
| `.env` | ADD `QASE_WEBHOOK_URL` env key |

## Acceptance criteria

- [ ] GET /api/metrics/dashboard returns aggregated session, finding, regression, and test case metrics
- [ ] Webhook fires on finish_qa_report with correct payload shape
- [ ] Webhook fires on test case failure with correct payload shape
- [ ] Webhook failures don't crash the app (fire-and-forget)
- [ ] Findings exportable as GitHub issues (JSON)
- [ ] Findings exportable as JIRA issues (JSON)
- [ ] Findings exportable as Linear issues (JSON)
- [ ] Test cases exportable as JSON
- [ ] Test cases exportable as CSV
- [ ] All export endpoints set Content-Disposition for download
- [ ] Export buttons visible in the UI
- [ ] Metrics overview panel visible in the UI
