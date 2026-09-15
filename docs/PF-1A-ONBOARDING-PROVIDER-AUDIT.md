# PF-1A onboarding and managed-provider audit

## Existing architecture

- Signup creates the existing internal `operator` role; authorization continues to use `admin`, `operator`, and `viewer` unchanged.
- Human sessions use the existing HttpOnly session cookie. Signup returns to Login; a successful login now enters Overview.
- Provider configuration is server/workspace configuration, sourced from environment variables and `.qase/config.json`. It is not user-level configuration.
- Mission requests contain no model-provider key. `server/agent.js` resolves the effective provider and secret on the server through `getModelTier('discovery')`.
- Provider Settings remain protected by the existing administrator credential guard. The browser receives only masked/write-only key state, never a full saved key.

## Defect and policy

Previously, the ordinary `/api/config` projection removed both the detailed provider fields and the only readiness fields. New Run therefore had no truthful preflight and auto-started a mission. `ensureRuntime()` then detected `No API key set`; execution-health classification surfaced that late failure as `WORKER_START_FAILED`.

PF-1A adds a provider-neutral, browser-safe execution readiness projection. Signed-in human launch routes reject unavailable execution before creating or starting runtime state. Draft creation with `autoStart: false` remains available, and machine/HMAC integration authorization contracts are unchanged. The ordinary account shell maps the internal `operator` role to the product label `Member`; stored RBAC values are unchanged.

## Secret boundary

The ordinary readiness projection contains only a boolean, a stable status, and generic workspace-administrator guidance. It contains no provider, endpoint, model, key hint, or detailed missing-field diagnosis. Full saved provider keys remain server-side and are neither returned nor placed in browser storage.

## PF-1B telemetry hook locations (documentation only)

- `server/agent.js` `runTurn()` is the execution-duration and model-call lifecycle boundary. `assistant_turn_start` is the current concrete per-model-turn signal and can support an honest LLM call count.
- `server/agent.js` currently handles SDK `context_usage`; it exposes estimated input/context-window occupancy, not billable provider usage.
- `@cleanslate/sdk` normalizes provider-reported usage in `dist/node/cleanSlateNodeMainService.js` (`inputTokens`, `outputTokens`, `totalTokens`, and `cachedInputTokens` when supplied), but the current public agent stream type does not emit that provider usage object.
- Reasoning-token usage is not present in the current public stream contract and must remain unavailable rather than inferred.
- Session `createdAt`/terminal timestamps and the `runTurn()` boundary can provide measured execution duration; PF-1B should define whether this means model time, active turn time, or end-to-end mission time before persisting it.

PF-1B should capture normalized provider usage at the SDK/service-to-agent seam or an explicit SDK event, aggregate by session/mission, and preserve `unknown` for fields a provider does not report. PF-1A intentionally adds no telemetry.
