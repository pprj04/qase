# Meeting Transcripts Summary (5 files)

## Participants
- **Thomas Eide (TE)** — Product owner / boss. Drives strategic direction.
- **Mishal Muneer (MM)** — Team lead / developer on Qase architecture
- **Abhishek U (AU)** — Manager/coordinator between team and Thomas
- **Pushkaraj Potdar (PP)** — Developer (UI, flows, bugs)
- **S S Niharikaa Aitam (SA)** — QA tester (BrowserStack device testing)
- **Manoj Kumar Ch (MC)** — Team member

## Key Themes

### 1. Qase Architecture (biggest theme)
- **Current state**: Single agent + single orchestration pipeline with browser automation tools. Thomas says "that doesn't scale."
- **Thomas's vision**: Microservices architecture. Break Qase into isolated services/endpoints so Drytis (the parent platform) can integrate/consume it. Spin up 50-100,000 workers on demand.
- **Mishal is implementing a new architecture plan** targeting up to 1M users with low latency.
- Thomas stresses learning MVC, proper front/back end separation, context compression between agents, logging, harnessing/orchestration patterns.

### 2. Integration with Drytis (parent platform)
- Qase needs **public API endpoints** so Drytis's dev team can call it in workflows.
- Drytis will hand off to Qase; Qase runs QA, returns results.
- Thomas wants the team to "eat their own dog food" — use Drytis's Edge model to develop Qase itself.

### 3. The Four Drytis Models (new.drytis.com)
- **Studio** — cloud-based IDE, $25/mo, DIY, all features included
- **Drytis 5.1** — AI engineer (frontier model, being built in-house)
- **Edge** — AI + human engineer handoff (the KEY product)
- **Albert** — handoff to best engineers in the world
- The competitive moat: **SME feedback loops** — engineers provide 4 data points (what's wrong, what it should be, why it's wrong, prompt to fix) vs competitors who only get "swearing" as feedback.

### 4. Testing Drytis's Models
- Run identical projects through Edge 3× from 3 different accounts → 3 different engineers → compare output variance, cost variance, time variance.
- Define "out of band" behavior (e.g., 2-hour project takes 3 days).
- Snapshot code before/after engineer work.
- Automate 24/7 testing.

### 5. Known Bugs Raised by Thomas
- **Password change** doesn't log out other sessions (confirmed real bug)
- **Mobile mic/camera permissions** — asks repeatedly each meeting (reported as resolved)
- **Planning agent exposes the LLM model name** and chain of thought (security issue)
- **502 bad gateway** on production
- No authentication issue — multiple people using Qase simultaneously can see each other

### 6. Design Feedback
- Thomas wants Qase UI to look like a **coding tool / CLI aesthetic** — monospace/coding fonts, "feel like an expert in coding"
- The "green button" (feedback mechanism) is being removed — handoff should be seamless/invisible

### 7. Feature Page (new.drytis.com)
- Team tasked with reviewing "Everything Drytis does at a glance" feature list
- Reorder content for SEO + AEO (AI Engine Optimization)
- Remove unnecessary features, ensure all features are in the right section
- Studio = everything included for $25, no features held back
- Team shared a prompt for reordering; Thomas said layout team will handle visuals

### 8. Testing Progress
- 120 Android devices tested via BrowserStack (Chrome, Edge, Firefox, Opera, Safari)
- 33 new bugs reported (login, mic, camera)
- 50 Xiaomi devices tested, 19 bugs logged
- 36 mobile devices, 90 bugs (Studio login, meeting links, camera, mic, mute)
- Team testing Drytis AI Studio across browsers/platforms

### 9. Workflow Request
- Abhishek repeatedly asks for a QA workflow document (how Case runs → finds bugs → reports → next run)
- Team promised to deliver a rough workflow before next Thomas meeting

### 10. Team Dynamics / Mentorship
- Thomas pushes team to transition from "QA engineers" to "product dev engineers"
- Emphasizes self-learning via AI (Gemini, ChatGPT) for architecture concepts
- Mentions potential to integrate fully into dev team if they level up
- Praises their work but stresses they're "a long way off" from enterprise-grade

## Action Items Identified
1. Build public API endpoints for Drytis integration
2. Implement scalable microservices architecture
3. Recreate & fix Thomas's reported bugs (password logout, planning agent exposure)
4. Change UI to coding/CLI aesthetic
5. Deliver QA workflow document
6. Review & reorder feature page content for SEO/AEO
7. Set up model testing scenarios (identical project × 3 engineers)
8. Implement continuous learning between missions
9. Fix 502 bad gateway on production
10. Test across more browsers (DuckDuckGo, mobile browsers, iOS/Android apps)
