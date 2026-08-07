# Qase — Knowledge Layer

> How Qase learns across missions. Pattern store, retrieval, learning model.
> Phase 1 is intentionally minimal. Complexity comes later.

---

## The Problem

Every mission starts from zero today. Mission 8000 encounters the same React + Clerk
login timeout that Mission 5000 already diagnosed — and rediscovers it from scratch.

That's not an autonomous engineer. That's a goldfish.

---

## Phase 1: Pattern Store (Minimal MVP)

### What It Does

```
After each mission:
  Extract notable findings as patterns
  Store in knowledge base

Before each mission:
  Match app metadata against known patterns
  Surface relevant ones in the report
```

### Schema

```json
{
  "id": "kp_001",
  "framework": "next.js",
  "authProvider": "clerk",
  "pattern": "login_timeout_safari",
  "issue": "Clerk SDK times out on Safari 17+ when using pkce flow",
  "recommendation": "Upgrade to Clerk SDK 5.2+ or disable PKCE for Safari",
  "fixPrompt": "Update the Clerk SDK to version 5.2 or later...",
  "source": {
    "missionId": "m_abc123",
    "findingId": "f_xyz789"
  },
  "occurrences": 3,
  "confidence": 0.85,
  "firstSeen": "2026-08-01T10:00:00Z",
  "lastSeen": "2026-08-06T14:30:00Z"
}
```

### Storage

- Phase 1: JSON file (`.qase/knowledge.json`)
- Phase 2: Will migrate to database when available

### Write Logic (Post-Mission)

After `quality_assessment` runs, the `knowledge_write` capability:

1. Iterates over findings with `severity >= 'medium'`
2. Extracts metadata: framework, auth provider, pattern type
3. Checks if a similar pattern already exists:
   - Match on `framework + authProvider + pattern`
   - If match: increment `occurrences`, update `lastSeen`, bump `confidence`
   - If no match: create new pattern entry
4. Optional LLM enhancement: generate a better `fixPrompt` from the finding's root cause

### Read Logic (Pre-Mission)

Before the orchestrator plans capabilities, the `knowledge_query` capability:

1. Extracts app metadata from mission context + early exploration:
   - Framework hints (URL patterns, meta tags, JS bundles)
   - Auth provider hints (login page text, auth redirects)
   - App type hints
2. Queries knowledge base: `WHERE framework = ? OR authProvider = ?`
3. Returns relevant patterns + capability hints:
   - "Clerk auth detected → known issues: login_timeout_safari (3 occurrences)"
   - Capability hint: "deepen auth testing"
4. Orchestrator uses hints to schedule additional capabilities or deeper exploration

### Confidence Model

```
occurrences = 1  →  confidence = 0.3  (anecdotal)
occurrences = 2  →  confidence = 0.5  (pattern emerging)
occurrences = 3  →  confidence = 0.7  (likely real)
occurrences = 5  →  confidence = 0.85 (strong pattern)
occurrences = 10+→  confidence = 0.95 (well-established)
```

Simple. No Bayesian inference, no decay functions in Phase 1.

---

## How Knowledge Influences Planning

Knowledge is NOT a passive database. It actively shapes capability selection:

```
Example 1: Known Framework Issue
  Knowledge: "Next.js 14 app router has known hydration mismatch bugs"
  Effect: Orchestrator schedules deeper client-side testing

Example 2: Auth Provider Pattern
  Knowledge: "Clerk apps commonly have redirect loops on Safari"
  Effect: Orchestrator adds cross-browser testing capability

Example 3: Recurring Bug Pattern
  Knowledge: "E-commerce apps with Stripe commonly have webhook race conditions"
  Effect: Feature Gap capability adds "webhook handling" to expected features
```

---

## Phase 2: Richer Learning (Future)

Not built yet. Planned:

| Feature | Description |
|---------|-------------|
| Framework rule sets | Per-framework expected features, common pitfalls, best practices |
| Cross-mission correlation | "This exact bug appeared in 5 different missions — systemic issue" |
| Best practices library | "All SaaS apps should have: password reset, email verification, billing" |
| Confidence decay | Old patterns lose confidence if not seen recently |
| Manual annotations | Human review can confirm/deny patterns |
| Pattern categories | Bug patterns, missing-feature patterns, workflow patterns |

---

## What Knowledge Does NOT Do

- ❌ Does NOT replace exploration (knowledge is prior, not truth)
- ❌ Does NOT auto-fix apps (it suggests, the improvement prompt carries the fix)
- ❌ Does NOT store app-specific data (patterns are generalizable, not per-app)
- ❌ Does NOT make decisions (knowledge informs, the Decision Engine decides)
