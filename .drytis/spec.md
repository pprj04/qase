# Qase — Autonomous QA Agent

## Overview
An autonomous QA agent that tests live websites in a real Chromium browser, reports defects, and (roadmap) learns from each run to build a persistent regression suite.

## Tech Stack
- **Backend**: Node.js (ESM), Express 5, @cleanslate/sdk (agent loop + Playwright browser)
- **Frontend**: Vanilla HTML/CSS/JS — 3-panel dashboard (runs | chat | browser+tabs), SSE live updates
- **Persistence**: JSON files in `.qase/` (sessions, workflows, test cases, schedules)
- **LLM**: OpenAI-compatible gateway (Drytis LLM), provider configurable via Settings UI

## Architecture
```
Express API ──→ store.js (in-memory Map + JSON mirror)
     ↓                ↓
  SSE stream    agent.js (SDK runtime + tool gate)
     ↑                ↓
  Dashboard     browserBridge.js (cursor, frames, session restore)
                     ↓
                 Playwright Chromium
```

## Key Decisions
- **One browser at a time** — `closeOtherBrowsers()` in agent.js
- **Credentials never reach the model** — vault + placeholder substitution at keyboard
- **All state through emit()** — single funnel for SSE + persistence
- **23-tool gate** — agent can only use browser + QA tools, nothing else
- **No build step** — frontend served as static files by Express

## Roadmap
See `.drytis/specs/roadmap-workflows-testcases-regression.md` for the full 7-phase plan:
1. Workflow Capture & Persistence
2. Test Case Generation from Workflows
3. Test Case Replay Engine (deterministic, no LLM)
4. Scheduled Regression Runs
5. Smart Model Routing (cost optimization)
6. Enhanced Reporting & Notifications
7. Multi-Target Projects
