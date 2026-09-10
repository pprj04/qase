# Qase Deep Dive — Current State vs Expectations

## WHERE QASE IS TODAY (Built)

### ✅ What Works
- **Live AI QA Agent** — Single agent opens Chromium, explores a web app, interacts with it, files bugs, writes QA reports. Max 120 turns per run.
- **Deterministic Replay Engine** — Saved test cases replay headlessly via Playwright (no LLM needed). 10 assertion types (visual diff, console errors, DOM checks, etc.)
- **Autonomy Pipeline** — After live run: auto-saves workflow → generates test cases → creates cron schedule → produces dev intelligence/root-cause analysis
- **Visual Regression** — Baseline screenshots, pixel-diffing, approval workflow
- **Multi-viewport** — Desktop/tablet/mobile/mobile_small
- **Parallel execution** — Worker pool (default 3 concurrent)
- **Self-healing selectors** — LLM fixes broken CSS selectors (0.8 confidence threshold)
- **Bug management** — Findings store with severity, status, comments, export to GitHub/JIRA/Linear
- **Scheduling** — Cron-based regression runs, webhook notifications
- **683 sessions logged**, findings, test cases, workflows all persisted
- **80+ API endpoints** with Bearer token auth
- **BrowserStack** — Cloud Chrome/Firefox/Safari testing configured

### ⚠️ What's Limited / Half-Built
- **No database** — Everything is JSON files. sessions.json is already 683KB. Won't scale.
- **Single process** — Agent, browser, API, scheduler all in one Node process
- **Single agent** — No multi-agent orchestration. Thomas explicitly said "that doesn't scale."
- **No user accounts / multi-tenancy** — One API token, no login/logout, no roles
- **No API documentation** — 80+ endpoints, zero OpenAPI/Swagger
- **No Docker / deployment config** — Manual npm start only
- **No mobile app testing** — Browser only, no Appium/XCUITest
- **No unit tests** — 7 integration tests only, all require running server + LLM
- **@cleanslate/sdk is private** — Can't reinstall if node_modules lost
- **UI is Apple glassmorphism** — Thomas wants CLI/coding aesthetic

---

## WHAT THOMAS & OTHERS EXPECT

### From Thomas Eide (Product Owner)

#### 1. MICROSERVICES ARCHITECTURE (Critical)
> "Think about microservices. Break the application into individual, small consumable components."
> "That container — you could spin up 50 of them if you needed at the same time."

**Expectation:** Each Qase capability (agent execution, test replay, reporting, bug tracking) should be its own isolated service with its own endpoint. Drytis should be able to spin up 50-100,000 instances on demand.

**Current:** Monolithic single process. Cannot scale horizontally.

#### 2. PUBLIC API ENDPOINTS FOR INTEGRATION (Critical)
> "All of the toolkits that you've built have to have endpoints so that the dev team can integrate your application into the workflows."

**Expectation:** Drytis dev team calls Qase via API → Qase runs QA → returns structured results. The handoff should be seamless, almost invisible.

**Current:** 80+ endpoints exist but are undocumented, unversioned, and designed for the dashboard UI — not for external programmatic consumption. No `/api/v1/` namespace. No OpenAPI spec.

#### 3. EATING OWN DOG FOOD (High Priority)
> "This week, for the first time, we're hoping to eat our own dog food. Our dev team will internally start to be using this product."

**Expectation:** Drytis dev team uses Qase to test their own code. Every new iteration goes through the Edge model → tested by an engineer → responses come back.

**Current:** Qase CAN test web apps, but it's not integrated into Drytis's workflow. No CI/CD hooks, no Drytis-specific integration.

#### 4. TESTING THE DRYTIS MODELS (Strategic)
> "Take two identical projects, the exact same input, run it through Edge three times from three different accounts, and get three different engineers."

**Expectation:** Qase should be able to:
- Run identical projects through Edge/Drytis models multiple times
- Measure variance in: output quality, cost (tokens), time
- Define "out of band" thresholds (e.g., 2-hour project takes 3 days)
- Snapshot code before/after engineer work
- Run 24/7 automated testing

**Current:** Qase tests web app UIs. It does NOT test AI model outputs, token consumption, or engineer handoff quality. This is a fundamentally new capability that doesn't exist yet.

#### 5. CLI / CODING AESTHETIC (Medium)
> "Everything in your application should be in a coding font. It should look like old syntax. The entire design should look like coding format."

**Expectation:** Monospace fonts, terminal/IDE aesthetic, "feel like an expert in coding"

**Current:** Apple glassmorphism design. Opposite of what's wanted.

#### 6. BUGS TO FIX (Immediate)
- **Password change must log out all sessions** — confirmed real bug
- **Planning agent exposes LLM model name + chain of thought** — security leak
- **502 bad gateway on production**
- **No auth isolation** — multiple users see each other's data

#### 7. CONTINUOUS LEARNING
> "Mission finish → store application graph + workflows → next mission reuses existing knowledge → smarter planning → less scrolling → better testing"

**Current:** Partially exists — the autonomy pipeline saves workflows and generates tests. But there's no knowledge graph, no cross-session learning, no "smarter planning based on history."

#### 8. TRANSITION FROM QA → PRODUCT DEV
> "When you make this shift, you will move from being QA engineers to being product dev engineers."

**Expectation:** The team evolves from manual testers to product builders who use AI (Edge model) to develop Qase itself.

### From Abhishek (Coordinator)

#### 9. QA WORKFLOW DOCUMENT
> "Share that workflow. Even a basic rough workflow. Just basic steps on a notepad."

**Expectation:** Document showing: Case runs → finds bugs → reports → next run behavior. What happens to the 4 bugs found? Re-emphasized? Continuous testing?

**Current:** No documented workflow. The pipeline exists in code but isn't documented as a process.

#### 10. BUG STATUS ACCOUNTABILITY
> "Just like a black hole wherein you dump things. If I tell you anything, you will never come back with the status."

**Expectation:** Every bug Thomas reports should be tracked, reproduced, and status reported back.

**Current:** Findings store exists but there's no formal bug triage/reporting workflow.

### From the Team (Mishal, Pushkaraj, Niharikaa)

#### 11. SCALABILITY TO 1M USERS
> "What I'm targeting is up to a million users, they can use it without much latency issues."

**Current:** JSON files, single process. Nowhere near 1M user capacity.

#### 12. FEATURE PAGE REVIEW (new.drytis.com)
> "Go through that feature list and give me a set of instructions. One prompt to fix it."

**Expectation:** Review "Everything Drytis does at a glance" — reorder for SEO/AEO, remove unnecessary items, ensure correct categorization.

**Status:** Team shared a prompt. Thomas accepted. This is a marketing task, not a Qase feature.

---

## GAP ANALYSIS — What Needs to Be Done

### 🔴 CRITICAL (Blocks integration with Drytis)

| Gap | What's Needed | Effort |
|-----|--------------|--------|
| **No public API contract** | Versioned API (`/api/v1/`), OpenAPI spec, API key auth for external callers, webhook callbacks for async results | Medium |
| **Monolithic architecture** | Split into services: Agent Service, Replay Service, Reporting Service, each independently deployable | Large |
| **No database** | Migrate from JSON files to a real DB (PostgreSQL/MySQL). The project already has MySQL provisioned. | Medium-Large |
| **No multi-tenancy** | User accounts, organizations, API keys per org, session isolation | Medium |
| **Planning agent leaks model info** | Security fix — strip model name and chain-of-thought from any user-visible output | Small |

### 🟡 HIGH (Needed for dog-fooding and scale)

| Gap | What's Needed | Effort |
|-----|--------------|--------|
| **No model testing capability** | New module: submit project → run through Drytis/Edge N times → measure output/cost/time variance → flag out-of-band | Large (new feature) |
| **No Docker/deployment** | Dockerfile, docker-compose, health checks, horizontal scaling support | Medium |
| **No CI/CD integration docs** | How Drytis dev team plugs Qase into their pipeline | Small-Medium |
| **Single process bottleneck** | At minimum: separate worker process for agent execution, queue-based job dispatch | Medium |
| **No API documentation** | OpenAPI 3.0 spec, developer guide, integration examples | Medium |

### 🟢 MEDIUM (Quality / UX)

| Gap | What's Needed | Effort |
|-----|--------------|--------|
| **UI redesign** | CLI/coding aesthetic — monospace fonts, terminal feel | Medium |
| **No continuous learning** | Knowledge graph / cross-session memory for smarter test planning | Large |
| **Password/session bug** | Invalidate all sessions on password change | Small |
| **No mobile app testing** | Appium integration for iOS/Android apps | Large |
| **No unit tests** | Unit test coverage for core modules | Medium |

---

## RECOMMENDED EXECUTION ORDER

### Phase 1: Foundation (unblock integration)
1. Migrate JSON → MySQL database
2. Add multi-tenancy (users, orgs, API keys)
3. Fix security bugs (model leak, password/session)
4. Create versioned public API (`/api/v1/`) with OpenAPI spec

### Phase 2: Architecture (enable scale)
5. Split into microservices (Agent, Replay, Reporting)
6. Add job queue (Redis + Bull or similar) for async agent execution
7. Dockerize each service
8. Add horizontal scaling (multiple agent workers)

### Phase 3: Drytis Integration (dog-fooding)
9. Build Drytis webhook integration (Drytis → Qase → results back)
10. Build model testing module (run project × N → measure variance)
11. CI/CD pipeline integration docs
12. Out-of-band detection thresholds

### Phase 4: Polish
13. UI redesign to CLI/coding aesthetic
14. Continuous learning / knowledge graph
15. Mobile app testing (Appium)
16. Full test coverage (unit + integration)
