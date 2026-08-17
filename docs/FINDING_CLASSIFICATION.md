# Finding Classification Reference — Phase 16

> 19 structured categories + UNKNOWN. Deterministic rules; provenance recorded.

## Storage (separate from observation)

| Field | Type | Notes |
|---|---|---|
| `primary_category` | enum | One of the 20 values below |
| `secondary_categories` | enum[] | Max 3 |
| `classification_confidence` | 0–1 | Method-specific |
| `classification.method` | string | `keyword_rules \| legacy_category \| explicit \| fallback_unknown` |

The original free-text `category` field is **preserved unchanged** (legacy
clients depend on it) — the structured taxonomy lives in the fields above.

## Categories

| # | Category | Scope | Typical signals |
|---|----------|-------|-----------------|
| 1 | `FUNCTIONAL` | Core behavior wrong/broken | fails, error, crash, does nothing, cannot submit |
| 2 | `UI` | Interface renders incorrectly | missing element, misaligned, overlap |
| 3 | `UX` | Behavior confuses users | no feedback, unclear, hard to |
| 4 | `VISUAL` | Styling only | css, color, font, spacing |
| 5 | `API` | HTTP contract problems | 4xx/5xx, endpoint, response |
| 6 | `SECURITY` | Vulnerabilities / exposure | xss, injection, token leak, plaintext |
| 7 | `PERFORMANCE` | Speed/resource problems | slow, timeout, freeze |
| 8 | `ACCESSIBILITY` | WCAG violations | aria, contrast, keyboard, screen reader |
| 9 | `DATA` | Persistence/correctness of data | not persisted, mismatch, stale |
| 10 | `AUTHENTICATION` | Identity verification | login, logout, credentials |
| 11 | `AUTHORIZATION` | Access control | role, permission, admin-only |
| 12 | `NAVIGATION` | Moving around the app | dead link, redirect loop, 404 |
| 13 | `COMPATIBILITY` | Browser/device differences | safari, firefox, viewport |
| 14 | `MOBILE` | Small-screen specific | responsive, touch |
| 15 | `REGRESSION` | Worked before | used to work, after update |
| 16 | `FEATURE_GAP` | Expected capability absent | missing, not implemented, no X |
| 17 | `INFRASTRUCTURE` | Deployment/environment | build, dns, certificate |
| 18 | `AI_BEHAVIOR` | AI feature misbehaves | llm, prompt, hallucination |
| 19 | `COMPLIANCE` | Legal/policy | gdpr, cookie consent, terms |
| — | `UNKNOWN` | Signals didn't match | confidence ≤ 0.3, never guessed |

## Rules precedence

1. **Explicit human/agent PATCH** (`PATCH /api/findings/:id/classification`)
   wins immediately with `method='explicit'`.
2. **Keyword rules** over title + actual + observed text (multi-word phrases
   weighted higher). Confidence 0.6–0.9 depending on match count.
3. **Legacy category mapping** when keywords are silent but the legacy
   free-text category is meaningful (`auth` → `AUTHENTICATION`, `forms` →
   `FUNCTIONAL`, `performance` → `PERFORMANCE`, …). Confidence 0.5.
4. **UNKNOWN fallback** — confidence ≤ 0.3. Generic legacy values
   (`general`, `unknown`, `other`, `misc`, `""`) never mask keyword rules and
   never count as evidence of anything.

## Guarantees

- **Every finding gets classified** — worst case `UNKNOWN`, which is an honest
  statement, not a guess.
- Classification never edits the observation fields
  (`title/expected/actual/steps/observed`).
- Secondary categories are validated against the same enum and capped at 3.
- The taxonomy is served at `GET /api/bug-intelligence/enums` so UI and
  integrations can't drift.
