# Qase — Roadmap

> Phases, milestones, success metrics, engineering estimates.
> Organized by capability milestones, not implementation tasks.

---

## Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Purpose detection accuracy | 43% | >90% | Validation harness on AI Studio-generated apps |
| Feature-gap precision | Unknown | >85% | Manual review against known feature sets |
| False positive rate | ~9% | <10% | Classified gaps vs real gaps |
| Workflow coverage | Unknown | >85% | Steps detected / expected steps |
| Bug detection precision | Unknown | >90% | Findings vs real bugs |
| End-to-end AI Studio loop | Not running | Working | One full cycle completed |
| Knowledge carry-over | None | Active | Mission N benefits from Mission N-1 |

All metrics measured against AI Studio-generated apps, not public websites.

---

## Phase 1: Capability Milestones

> Foundation work organized by the capability it delivers.

### Milestone 1: Application Understanding
*When complete, Qase can look at an app and know what it is — from multiple sources.*

| Task | What | Effort |
|------|------|--------|
| Mission Context Input | Accept buildPrompt + requirements, derive expected features as ground truth | ~1 wk |
| Interactive Exploration Bridge | Capture action outcomes (login success, search results, cart adds), feed to intelligence | ~2 wks |
| SPA Route Detection | Detect client-side routes (React Router, Vue Router), crawl SPA nav | ~1 wk |

**Milestone complete when**: Purpose accuracy is measured against real generated apps and shows measurable improvement from interactive data + mission context.

### Milestone 2: Knowledge Layer
*When complete, Qase learns from every mission and applies that knowledge to the next.*

| Task | What | Effort |
|------|------|--------|
| Knowledge Query (pre-mission) | Match app metadata → surface known patterns before exploration | ~3 days |
| Knowledge Write (post-mission) | Extract findings → patterns, store, accumulate confidence | ~3 days |
| Orchestrator Knowledge Hook | Knowledge hints influence capability selection | ~1 day |

**Milestone complete when**: A pattern from Mission N surfaces automatically in Mission N+1 and influences capability selection.

### Milestone 3: Capability Architecture
*When complete, the system runs capabilities through an orchestrator, not a fixed pipeline.*

| Task | What | Effort |
|------|------|--------|
| Capability Interface | Define + implement the formal contract (id, inputs, outputs, dependencies, confidence, cost) | ~2 days |
| Wrap Pipeline as Capabilities | Each pipeline stage becomes a registered capability | ~3 days |
| Orchestrator (v1) | Plan capabilities based on mission type, resolve dependencies, execute | ~3 days |
| Decision Engine Separation | Split verdict/decision logic out of quality assessment | ~1 day |

**Milestone complete when**: A new capability can be added by registering it, without touching the pipeline.

---

## Phase 2: Real-World Validation

*Goal: Honest metrics on real generated apps. Measure, don't predict.*

| Task | What | Effort | Type |
|------|------|--------|------|
| Build Test Apps | 5-10 apps with known features (todo, blog, store, dashboard, landing) | ~1 wk | Engineering |
| Run Full Pipeline + Measure | Purpose accuracy, gap precision, false positives, workflow coverage | ~1 wk | Research |
| Fix Top Failures | Based on metrics, fix top 3-5 failure patterns | ~1 wk | Research |

**Phase complete when**: Real numbers exist for every success metric above, measured against generated apps.

---

## Phase 3: Close the Loop

*Goal: End-to-end AI Studio integration with measurable convergence.*

| Task | What | Effort |
|------|------|--------|
| AI Studio Contract | Formalize input/output schema, test with real or simulated endpoint | ~1 wk |
| Live Loop Testing | Run generate → validate → improve → regenerate → revalidate, 3-5 iterations | ~2 wks |
| Continuous Regeneration | Automated loop until release-ready or max iterations | ~1 wk |

**Phase complete when**: One complete cycle runs — AI Studio generates → Qase validates → improvement prompt → AI Studio regenerates → Qase revalidates → verdict.

---

## Phase 4: Product Polish

| Task | What | Effort |
|------|------|--------|
| UI Redesign — Terminal/CLI | Monospace, dark terminal style, "expert coding tool" feel | ~1 wk |
| Security Fixes | Session invalidation on password change, planning agent info leak | ~1 wk |

---

## Phase 5: Scale (After Product Proven)

| Task | What | Effort | Dependency |
|------|------|--------|------------|
| PostgreSQL Migration | Move sessions, findings, missions, knowledge from JSON to DB | ~2 wks | Phase 3 |
| Queue + Workers | Redis/BullMQ job queue, separate worker processes | ~2 wks | Database |
| Multi-User Auth + Tenancy | Per-user accounts, API keys, project isolation | ~2 wks | Database |
| Containerization | Docker, K8s, auto-scaling | ~2 wks | Queue + DB |

---

## Engineering Estimates Summary

| Phase | Engineering Effort | Research Risk |
|-------|-------------------|---------------|
| Phase 1: Foundation | ~5 weeks | Medium (interactive exploration outcome unknown) |
| Phase 2: Validation | ~3 weeks | **High** (will surface unknown failures) |
| Phase 3: Close Loop | ~4 weeks | Medium (convergence unknown) |
| Phase 4: Polish | ~2 weeks | Low |
| Phase 5: Scale | ~8 weeks | Low |

**Total engineering: ~22 weeks (all phases).**
**Phases 1-4 (product proven): ~14 weeks.**
**Research unknowns resolved by running, not by estimating.**

---

## What NOT to Do

- ❌ Rewrite from scratch (evolutionary migration)
- ❌ Build K8s/Docker before product works
- ❌ Add more purpose types (frozen — improve accuracy, not breadth)
- ❌ Benchmark against public websites (wrong test set)
- ❌ Predict accuracy numbers (measure only)
- ❌ Treat AI Studio as "integration" (it's an input source)
- ❌ Infer purpose before understanding (purpose emerges)

---

## Immediate Next Action

**Milestone 1 (Application Understanding)** and **Milestone 2 (Knowledge Layer)**
are independent and foundational. Start both.

Milestone 1 unblocks Phase 2 (validation needs understanding to work).
Milestone 2 ensures learning accumulates from day one.
