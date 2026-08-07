# Qase — Mission & Vision

> What Qase is. Why it exists. What principles guide every decision.
> This document does NOT contain architecture details, roadmaps, or data models.
> Those live in ARCHITECTURE.md, ROADMAP.md, CAPABILITIES.md, and KNOWLEDGE.md.

---

## Product Definition

> **Qase is the autonomous quality layer for AI-generated software.**

Its role is to understand the intended purpose of an application, explore and validate
its behavior, identify defects, missing capabilities, and workflow gaps, produce
structured evidence and improvement recommendations, and continuously revalidate
changes until the software reaches an acceptable quality threshold.

### The Question Qase Answers

Not *"what is broken?"* but **"what should this software become?"**

### What Qase is NOT

Not a Playwright wrapper. Not a bug finder. Not a testing platform.
Those are implementation details.

---

## Thomas's Demo

```
Thomas types "Create a CRM" in AI Studio
  → AI Studio generates the app
  → Qase understands: "This is supposed to be a CRM"
  → Qase explores and validates
  → Qase finds bugs, missing features, broken workflows
  → Qase generates structured improvement prompt
  → AI Studio regenerates using the prompt
  → Qase revalidates: "3 bugs fixed, 2 gaps closed, 1 regression"
  → After N iterations: Qase says "Approved" or "Not ready, here's why"
```

Nobody watching asks "Is this PostgreSQL?" They ask:
*"How did it know the CRM was missing customer management?"*

---

## Capability Status (Honest)

Thomas buys one product, not components. Here is what that product can and cannot do:

| Capability | Status | Evidence |
|-----------|--------|----------|
| **Explore an application** | ✅ Good | Playwright agent, 78 test cases, multi-viewport, self-healing |
| **Find bugs** | ✅ Good | Evidence engine, screenshots, DOM, console, reproducibility |
| **Understand application purpose** | 🟡 Partial | 11 purpose types, 43% accuracy on 30 real apps |
| **Understand user workflows** | 🟡 Partial | 9 workflow templates, neighbor-based gap detection |
| **Find missing features** | 🟡 Partial | Purpose-driven expected features, precision unmeasured on real apps |
| **Understand intent (requirements)** | 🔴 Missing | Can't take a build prompt and know what to expect before testing |
| **Generate improvement recommendations** | 🟡 Partial | Per-finding fix prompts + app improvement prompt, untested in live loop |
| **Revalidate and compare** | 🟡 Partial | Iterations, comparison, trend tracking built, zero live loops run |
| **Learn from past missions** | 🔴 Missing | Every mission starts from zero — no knowledge carry-over |
| **Close the loop** | 🔴 Missing | Contract designed, zero end-to-end cycles |
| **Scale to concurrent users** | 🔴 Missing | Single process, single agent, JSON files |

---

## Input Sources

AI Studio, humans, and CI/CD are all just input sources. They all create Missions.
**Mission owns everything.**

```
AI Studio  ──→  Mission
Human       ──→  Mission
CI/CD       ──→  Mission
```

AI Studio is not an "integration." It is an input source — the primary one, but
structurally identical to any other.

---

## Principles

1. **Mission owns everything.** All input sources create Missions. Mission is the central object.
2. **Purpose emerges from understanding.** Not inferred first from whatever data is available. Understanding = Context + Static Analysis + Interactive Exploration + Reasoning.
3. **Capabilities, not pipeline stages.** Orchestrator selects capabilities dynamically based on mission needs. New capabilities are added to the registry, not bolted onto a pipeline.
4. **Knowledge accumulates across missions.** Every mission teaches the next. Knowledge influences planning, not just reporting.
5. **Heuristic floor, LLM ceiling.** Deterministic heuristics guarantee baseline output. LLM enhances. Neither alone is sufficient.
6. **Evidence is layered.** Raw evidence → Normalized evidence → Evidence graph → Knowledge. Each layer makes the next more useful.
7. **Assessment and decision are separate.** Quality Assessment determines what happened. Decision Engine determines whether to approve, regenerate, escalate, or stop. Business policy stays separate from analysis.
8. **Measure, don't predict.** Report what validation shows, not what we hope.
9. **Evolutionary, not rewrite.** Pipeline stages become capabilities. Nothing gets thrown away.
10. **AI Studio apps are the test set.** Public websites are the wrong benchmark.
11. **Every change must answer: "Does this make Qase better at autonomously improving software?"**
