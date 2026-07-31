# Phase 13 — Developer Intelligence

## Problem
Findings are filed as raw observations ("button doesn't work") but contain **no actionable intelligence for developers**. There's no root-cause analysis, no suggested fix approach, and no structured "improvement prompt" an engineer could feed into their own AI coding tool. The agent reviews the app but never translates its learnings into **dev-consumable** output.

## Target
After every QA session, generate a **Developer Intelligence Report** alongside the QA report:
1. Per-finding **structured fix suggestions** (root cause hypothesis, fix approach, affected files hint)
2. Per-finding **AI-ready improvement prompt** (copy-paste into Copilot/Cursor/Claude to fix the bug)
3. App-level **Improvement Report** (architectural patterns: UX issues, accessibility gaps, performance concerns, security observations)

---

## Architecture

### New Files
1. **`server/devIntelligence.js`** — LLM-powered analysis module
2. **`server/devReport.js`** — Dev intelligence report builder + export

### Files to Modify
1. **`server/pipeline.js`** — Add Stage 5: Dev Intelligence generation (after test case generation, using findings + workflow)
2. **`server/index.js`** — Routes for dev report export + per-finding intelligence
3. **`server/config.js`** — Config flag `autoDevReport` (default on)
4. **`public/app.js`** — Dev Intelligence section in Report tab; per-finding "AI Fix Prompt" button
5. **`public/index.html`** — Dev report container
6. **`public/styles.css`** — Dev intelligence styles

---

## Sub-Phases

### 13A — Structured Fix Suggestions
**Per-finding root-cause analysis and fix approach via LLM**

- Create `server/devIntelligence.js`:
  - `analyzeFinding(finding, context)` — LLM call that takes a finding and returns:
    ```javascript
    {
      rootCause: "Likely caused by missing event handler on the submit button...",
      fixApproach: "Add a click event listener or verify the form's onSubmit binding...",
      affectedArea: "frontend | backend | database | config | css",
      estimatedComplexity: "trivial | low | medium | high",
      relatedFindings: ["finding-id"]  // auto-grouped by similarity
    }
    ```
  - `analyzeSessionFindings(session)` — batch-analyze all findings, group related ones
  - Use the `execution` model tier (cheaper, structured output)
  - Cache results on the finding object: `finding.devIntelligence = { ... }`

- Add to pipeline Stage 5:
  - Guard: `config.autoDevReport !== false && session.findings.length > 0`
  - After test generation completes, run dev intelligence analysis on all findings
  - Emits `pipeline_progress` for each finding analyzed

- Add routes:
  - `GET /api/findings/:id/intelligence` — get/save dev intelligence for a single finding
  - `POST /api/findings/:id/intelligence` — regenerate (force re-analyze)
  - `GET /api/sessions/:id/dev-report` — full dev intelligence report

### 13B — AI-Ready Improvement Prompts
**Per-finding copy-paste prompt for dev AI tools (Copilot/Cursor/Claude)**

- In `server/devIntelligence.js`:
  - `buildFixPrompt(finding, intelligence)` — generates a well-structured prompt:
    ```
    ## Bug Fix Request
    
    **Issue:** [finding.title]
    **Severity:** [finding.severity]
    **URL:** [finding.url]
    
    **Steps to Reproduce:**
    1. [finding.steps...]
    
    **Expected:** [finding.expected]
    **Actual:** [finding.actual]
    
    **Root Cause Analysis:** [intelligence.rootCause]
    **Suggested Fix Approach:** [intelligence.fixApproach]
    
    **Task:** Implement the fix following the approach above. Add or update tests 
    to cover this scenario and prevent regression.
    ```
  - `buildAppImprovementPrompt(session)` — app-level improvement prompt covering all findings

- Add routes:
  - `GET /api/findings/:id/fix-prompt` — returns the AI-ready prompt (text/plain)
  - `GET /api/sessions/:id/improvement-prompt` — app-level prompt

- UI:
  - Per-finding "📋 Copy AI Fix Prompt" button in finding detail
  - "Copy App Improvement Prompt" button on report tab
  - "Download Dev Report" button (markdown export)

### 13C — App-Level Improvement Report
**Cross-cutting analysis: UX, accessibility, performance, security patterns**

- In `server/devIntelligence.js`:
  - `buildAppImprovementReport(session)` — LLM analyzes ALL findings + workflow + test results to produce:
    ```javascript
    {
      ux: [{ issue, impact, recommendation, relatedFindings }],
      accessibility: [{ issue, impact, recommendation, relatedFindings }],
      performance: [{ issue, impact, recommendation, relatedFindings }],
      security: [{ issue, impact, recommendation, relatedFindings }],
      patterns: [{ pattern, occurrences, recommendation }],  // recurring issues
      priority: [{ action, rationale, impact }]  // ranked action items
    }
    ```

- In `server/devReport.js`:
  - `buildDevReportMarkdown(session, intelligence)` — full markdown document:
    - Executive summary
    - Per-finding intelligence table
    - App improvement sections (UX/A11y/Perf/Security)
    - Priority action items
    - AI prompt appendix
  - `exportDevReport(session, format)` — markdown / JSON

- Routes:
  - `GET /api/sessions/:id/dev-report?format=markdown|json` — full report
  - `GET /api/sessions/:id/dev-report.md` — markdown download

- UI:
  - New "Dev Report" section on Report tab (collapsible, below QA report)
  - Shows: improvement categories with issue cards, priority actions
  - Export buttons: Markdown, JSON

---

## Acceptance Criteria

### 13A — Fix Suggestions
- [ ] `server/devIntelligence.js` exists with `analyzeFinding()` and `analyzeSessionFindings()`
- [ ] Each finding gets `rootCause`, `fixApproach`, `affectedArea`, `estimatedComplexity`
- [ ] Pipeline Stage 5 runs dev intelligence automatically (when enabled)
- [ ] `GET /api/findings/:id/intelligence` returns structured analysis
- [ ] Results cached on finding object (don't re-analyze unless forced)
- [ ] Integration tests: mock LLM → structured output verified

### 13B — AI Fix Prompts
- [ ] `buildFixPrompt()` generates well-structured copy-paste prompt
- [ ] `GET /api/findings/:id/fix-prompt` returns text/plain prompt
- [ ] "Copy AI Fix Prompt" button on finding detail in UI
- [ ] "Copy App Improvement Prompt" on report tab
- [ ] Integration tests: prompt format verified

### 13C — App Improvement Report
- [ ] `buildAppImprovementReport()` returns structured cross-cutting analysis
- [ ] `buildDevReportMarkdown()` produces full markdown document
- studio.drytis.ai## Dev Intelligence section renders on Report tab
- [ ] Export works (Markdown, JSON)
- [ ] Pipeline integration (Stage 5)
- [ ] Integration tests

---

## Test Plan
- Unit: `devIntelligence.js` with mocked LLM responses
- Integration: analyze finding → verify structured output fields
- Integration: pipeline Stage 5 runs after test generation
- Browser: fix prompt copy button, dev report rendering, export
