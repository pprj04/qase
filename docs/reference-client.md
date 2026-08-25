# QASE Reference Client

`examples/reference-client/qase-client.mjs` — a single-file, zero-dependency
(Node ≥ 18) client for the integration API. It is the **canonical example**
of consuming QASE as an external application: no UI, no browser, no internal
modules, no `.qase` file access.

## Install / import

```js
import { createClient } from './qase-client.mjs';

const client = createClient({
  baseUrl: 'https://qase.example.com',   // your QASE deployment
  keyId: 'my-ci-key',                    // registered principal
  secret: process.env.QASE_INTEGRATION_SECRET
});
```

## Methods

| method | endpoint |
|---|---|
| `whoami()` | GET `/api/v1/integration/whoami` |
| `createMission(input, {idempotencyKey, correlationId})` | POST `/api/v1/integration/missions` |
| `startMission(id)` | POST `/api/v1/integration/missions/:id/start` |
| `getMission(id)` | GET `/api/v1/integration/missions/:id` |
| `stopMission(id)` | POST `/api/v1/integration/missions/:id/stop` |
| `getReport(id, {format})` | GET `/api/v1/integration/missions/:id/report` |
| `getFindings(id, {limit, offset})` | GET `/api/v1/integration/missions/:id/findings` |
| `getEvidence(id, {limit, offset})` | GET `/api/v1/integration/missions/:id/evidence` |
| `revalidateMission(id)` | POST `/api/v1/integration/missions/:id/revalidate` |
| `revalidateFinding(id, {idempotencyKey})` | POST `/api/v1/integration/findings/:id/revalidate` |
| `getFindingValidation(id)` | GET `/api/v1/integration/findings/:id/validation` |
| `registerWebhook({url, events, label})` | POST `/api/v1/integration/webhooks` |
| `waitForCompletion(id, {timeoutMs, intervalMs, onProgress})` | polling helper |
| `verifyWebhookSignature(bodyText, ts, sigHeader)` | webhook HMAC check |

All calls return `{ status, json, text, headers }`.

## Golden flow

`golden-flow.mjs` runs the full external lifecycle as the B1 production
gate: authenticate → register signed webhook → create mission (maxTurns 8,
idempotent) → poll to completion → verify the signed `mission.completed`
webhook (HMAC + correlation id) → retrieve report/findings/evidence →
trigger revalidation → negative checks.

```bash
node examples/reference-client/golden-flow.mjs \
  --base http://localhost:5173 \
  --key qase-admin \
  --secret "$QASE_INTEGRATION_SECRET" \
  --target https://new.drytis.com
```

The script's local webhook receiver listens on port 9930 — the operator
allow-lists that loopback port for QASE via
`QASE_ALLOWED_LOCAL_TARGETS=9930` (a documented targetGuard extension, not a
bypass).

## Typical consumer loop (CI)

```js
const idem = `ci-${process.env.BUILD_ID}`;
const { json } = await client.createMission(
  { name: `CI ${idem}`, type: 'smoke', targetUrl: APP_URL, context: { maxTurns: 12 } },
  { idempotencyKey: idem, correlationId: `cid_${idem}` }
);
const mission = await client.waitForCompletion(json.missionId, {
  onProgress: m => console.log(m.status, m.turnCount, '/', m.maxTurns)
});
if (mission.status !== 'completed') throw new Error(mission.failureReason);
const report = await client.getReport(json.missionId, { format: 'md' });
const { json: findings } = await client.getFindings(json.missionId);
// gate the pipeline on verdict / findings, then revalidate after fixes:
await client.revalidateMission(json.missionId);
```
