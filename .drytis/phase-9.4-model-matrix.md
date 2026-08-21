# Phase 9.4 — Model Matrix Report

## Step 1 — Model Matrix Results

Tested all 10 models discovered via `GET /v1/models` on the Drytis LLM gateway.

### Summary Table

| Model | Simple | 1Tool | 5T | 10T | 15T | 20T | Notes |
|-------|--------|-------|-----|------|------|------|-------|
| **z-ai/glm-5** | ✓ | ✓ | 5/5 | 10/10 | 15/15 | **20/20** | Best all-rounder, max latency 19s |
| **z-ai/glm-5.1** | ✓ | ✓ | 5/5 | 10/10 | — | **20/20** | Reliable |
| **z-ai/glm-5.2** | ✓ | ✓ | 5/5 | 10/10 | — | **20/20** | Reliable |
| z-ai/glm-4.6v | ✓ | ✓ | 5/5 | 10/10 | — | 3/20 ✗ | Fails after turn 10 |
| drytis/kimi-k3 | ✓ | ✓ | 5/5 | 10/10 | 15/15 | timeout | ~10s/turn, hit 10min limit |
| drytis/kimi-k2.5 | ✓ | ✗ (0 tools) | — | — | — | — | Cannot make tool calls |
| drytis/kimi | ✓ | ✓ | — | — | — | — | Not tested further |
| drytis/minimax-m2.7 | ✗ | ✗ | — | — | — | — | Rate limit (quota exhausted) |
| drytis/MiniMax-M3 | ✗ | ✗ | — | — | — | — | Rate limit (quota exhausted) |
| z-ai2/glm-5 | ✗ | ✗ | — | — | — | — | Invalid model name |

### Key Finding

**z-ai/glm-5, glm-5.1, and glm-5.2 ALL pass 20/20 sequential tool calls with zero failures.**
The model API is NOT the blocker. The failure in real QASE missions must be in one of:
- Context growth (browser snapshots, screenshots, diagnostics bloat context)
- Tool result size (browser_snapshot returns full DOM)
- CleanSlate SDK integration (context compaction, serialization)
- QASE agent integration (prompt construction, tool registration)

### Metrics Detail (z-ai/glm-5, best performer)

| Turn | 5T | 10T | 15T | 20T |
|------|-----|------|------|------|
| Max latency (ms) | 6903 | 13714 | 10161 | 19448 |
| Final context tokens | 669 | 1271 | 1882 | 2389 |

Context grows linearly (~120 tokens/turn) in the synthetic test.
Real QASE missions add browser_snapshot (full DOM), screenshots, diagnostics — much larger.

### Models eliminated:
- **drytis/minimax-m2.7**, **drytis/MiniMax-M3**: Quota exhausted
- **z-ai2/glm-5**: Invalid model name (gateway returns 400)
- **drytis/kimi-k2.5**: Cannot make tool calls (0/1)
- **z-ai/glm-4.6v**: Fails after turn 10

### Models viable for QASE:
- **z-ai/glm-5** ← current default, proven reliable
- **z-ai/glm-5.1** ← reliable
- **z-ai/glm-5.2** ← reliable
- **drytis/kimi-k3** ← reliable but slow (~10s/turn)
