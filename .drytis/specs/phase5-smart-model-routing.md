# Phase 5 — Smart Model Routing

## Goal

Separate the model used for expensive exploration (discovery tier) from the model used for lighter tasks like test case generation (execution tier). This lets users keep a high-tier model for the autonomous agent while using a cheaper/faster model for repetitive LLM tasks — reducing cost per run.

Replay runs already use no LLM (deterministic Playwright, Phase 3), so they are unaffected.

## Design

Both tiers share the same provider, API key, and base URL (they go through the same gateway). Only the **model name** differs per tier:

- **Discovery tier** — used by the autonomous agent (`agent.js`) for live site exploration. Needs strong reasoning. Defaults to the current `QASE_MODEL`.
- **Execution tier** — used by test case generation (`testGen.js`) for structured data generation. Can be a cheaper/faster model. Defaults to the discovery model if unset (backward compatible).

### Tier resolution

```
getModelTier('discovery')  → { provider, model: discoveryModel || model, baseUrl, apiKey, ... }
getModelTier('execution')  → { provider, model: executionModel || model, baseUrl, apiKey, ... }
```

If neither `discoveryModel` nor `executionModel` is set, both fall back to the existing `model` field — fully backward compatible.

## Files to change

### 1. `server/config.js`

- Add `discoveryModel` and `executionModel` to `fromEnv()` (reads `QASE_DISCOVERY_MODEL`, `QASE_EXECUTION_MODEL`).
- Add them to `DEFAULTS` (both undefined → fall back to `model`).
- Add `export function getModelTier(tier)` — returns the full config with `model` overridden by the tier.
- Update `getPublicConfig()` to include `discoveryModel` and `executionModel`.
- Update `saveConfig()` to accept and persist the new fields.

### 2. `server/agent.js`

- Import `getModelTier` from `config.js`.
- In `ensureRuntime()`, replace `getConfig()` with `getModelTier('discovery')`.

### 3. `server/testGen.js`

- Import `getModelTier` from `config.js`.
- In `callLLM()`, replace `getConfig()` with `getModelTier('execution')`.

### 4. `server/index.js`

- No route changes needed — `getPublicConfig()` already returns config and is served at `/api/config`.

### 5. `public/index.html`

- Add a "Model routing" section in the settings dialog with two fields:
  - Discovery model (label: "for agent exploration")
  - Execution model (label: "for test case generation")

### 6. `public/app.js`

- Read `discoveryModel` and `executionModel` into `fillSettings()`.
- Send them in `readSettings()`.
- Display tier info in the model badge tooltip.

## Acceptance criteria

- [ ] `getModelTier('discovery')` returns the discovery model, falling back to the default model
- [ ] `getModelTier('execution')` returns the execution model, falling back to the default model
- [ ] Agent exploration runs use the discovery tier model
- [ ] Test case generation uses the execution tier model
- [ ] Replay runs use no LLM (unchanged — already deterministic)
- [ ] Both model tiers are visible and editable in the Settings UI
- [ ] Settings persist across restarts
- [ ] Backward compatible: if no tier-specific models are set, everything works as before
