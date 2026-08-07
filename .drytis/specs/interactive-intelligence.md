# B2: Feed Interactive Data into Intelligence Layer

## Problem

`extractAppInventory()` in `server/featureGap.js` derives capabilities from **passive metadata** only:
- `hasLogin` ← URL regex `/login|signin/`
- `hasPayment` ← activity text matching `/payment|checkout/`
- `hasDashboard` ← URL regex `/dashboard|admin/`

It never checks whether these features **actually work**. With B1 outcomes now available on every captured step, the intelligence layer can reason about verified behavior.

## Goal

Enrich `extractAppInventory()` with an `interactions` object that captures behavioral evidence — which actions succeeded, which failed, what pages were reached, whether auth flows completed.

This enriched data feeds into:
- Purpose detection (stronger signal when login works AND leads to dashboard)
- Feature gap analysis (different gap severity for "feature broken" vs "feature missing")
- Workflow gap analysis (broken transitions detected from failed outcomes)

## Changes

### 1. `server/featureGap.js` — new `extractInteractiveSignals(steps)`

Extracts behavioral evidence from captured step outcomes:

```js
{
  totalActions: number,
  successfulActions: number,
  failedActions: number,
  successRate: number,           // 0-1
  verifiedAuth: {                // login/register attempts and their outcomes
    loginAttempted: boolean,
    loginSucceeded: boolean,     // fill password + click → success + URL changed
    registerAttempted: boolean,
    registerSucceeded: boolean,
  },
  verifiedFeatures: {            // features confirmed working via interaction
    search: boolean,             // search action → success
    payment: boolean,            // checkout/cart → success
    formSubmission: boolean,     // any form fill+submit → success
    mediaUpload: boolean,        // file/upload → success
  },
  brokenFeatures: {              // features that exist but failed when tested
    search: boolean,
    payment: boolean,
    formSubmission: boolean,
    auth: boolean,
  },
  pageTransitions: [{ from, to, action }],  // successful navigations
  errorsEncountered: number,     // total failed actions
  dialogInteractions: number,    // dialogs/alerts encountered
}
```

### 2. `server/featureGap.js` — enrich `extractAppInventory()` return

Add `interactions` field to the returned inventory object. Existing fields remain unchanged — `interactions` is purely additive.

### 3. `server/featureGap.js` — update purpose detection

In `inferAppPurpose()` or `generateExpectedFeatures()`, weight verified signals higher:
- If `interactions.verifiedAuth.loginSucceeded` AND URL changed to dashboard → stronger SaaS/dashboard signal
- If `interactions.verifiedFeatures.payment` → stronger ecommerce signal
- If `interactions.brokenFeatures.auth` → note auth is broken (not missing)

## Acceptance Criteria

- [ ] `extractInteractiveSignals()` correctly counts success/failure from step outcomes
- [ ] Login verification: fill on password field + click → success + URL change = loginSucceeded
- [ ] Login failure: same sequence → failed outcome or URL stayed on login page = loginAttempted but not succeeded
- [ ] Registration verification works the same way for signup pages
- [ ] Search verification: search-related activity + success outcome
- [ ] Payment verification: cart/checkout action + success outcome
- [ ] Broken feature detection: feature was attempted but failed
- [ ] Page transitions captured from successful URL changes
- [ ] Steps with pending outcomes (agent interrupted) are counted as neither success nor failure
- [ ] `interactions` field added to inventory return without breaking existing fields
- [ ] Purpose detection considers verified signals (login works → SaaS signal stronger)
- [ ] Unit tests cover all scenarios

## Tests

File: `tests/test-interactive-intelligence.js`

Test cases:
1. Empty steps → all zeros, no verified features
2. All pending outcomes → no verified/unverified features
3. Successful login flow (fill password → click → URL changes to /dashboard)
4. Failed login flow (fill password → click → same URL or error)
5. Successful search (search action → success)
6. Failed payment (checkout action → failed)
7. Mixed outcomes (some success, some failure → correct counts)
8. Page transitions captured
9. Dialog interactions counted
10. Purpose detection weights verified login+dashboard as SaaS

## Out of Scope

- C1 (Capability Registry) — separate task
- Dashboard UI changes — future enhancement
- LLM-based reasoning over outcomes — future enhancement
