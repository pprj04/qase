# Spec: Developer Tool Aesthetic Redesign (Revised)

> **Aligned with user feedback:** Not a terminal — a coding tool (Cursor, VS Code, GitHub).
> Conversation-driven, not dashboard-driven.

## Problem

Current UI is glassmorphism with dashboard panels. Thomas wants it to feel like working alongside an autonomous engineer inside a developer tool. Two failures: (1) wrong visual language, (2) wrong information architecture — panels dominate, conversation is secondary.

## Phase Order (user-directed)

### Phase 0 — Information Hierarchy (HIGHEST PRIORITY)
Fix what occupies space before touching colors/fonts.

- [ ] Conversation gets ~70% of the middle panel height
- [ ] Mission Progress becomes a compact status strip (max ~60px tall, 1-2 lines)
- [ ] Application Understanding becomes a compact inspector (max ~120px, scrollable)
- [ ] Composer stays at bottom, always visible
- [ ] Both panels default to collapsed after pipeline completes (user expands if curious)

### Phase 1 — Developer Typography
- [ ] Load JetBrains Mono from Google Fonts CDN
- [ ] Set `--font` and `--mono` to JetBrains Mono stack
- [ ] Apply globally — headings, body, buttons, labels, inputs, nav
- [ ] System labels uppercase with letter-spacing where appropriate

### Phase 2 — IDE Visual Language
GitHub Dark / VS Code palette (NOT green-on-black terminal):
```
--bg:          #0d1117
--bg-surface:  #161b22
--bg-elevated: #1c2128
--bg-hover:    #21262d
--border:      #30363d
--border-soft: #21262d
--text:        #e6edf3
--text-dim:    #8b949e
--text-faint:  #484f58
--accent:      #58a6ff
--success:     #3fb950
--warning:     #d29922
--danger:      #f85149
--info:        #58a6ff
```

- [ ] Remove all `backdrop-filter`, translucent rgba backgrounds, soft shadows
- [ ] Solid dark surfaces everywhere
- [ ] Border-radius ≤ 3px globally (except dots/circles)
- [ ] Remove animated gradient drift background
- [ ] Flat buttons — no gradients, solid surface + 1px border, hover lightens bg
- [ ] Nav links — VS Code style: active = left 2px border + brighter text
- [ ] Status chips — 3px radius, monospace, uppercase
- [ ] Prompt chips — flat rectangular IDE quick actions (NOT terminal `>` commands)
- [ ] Inputs — solid bg, 1px border, focus = accent border (no glow)

### Phase 3 — Conversation-Driven AI
Replace dashboard panels with streaming AI messages in conversation.

- [ ] Pipeline stage completions inject agent messages into transcript:
  - `Understanding application...` → `Detected: CRM, Authentication, Dashboard (91% confidence)`
  - `Planning validation...` → `Generating test cases for 8 scenarios`
  - `Validation complete` → `3 issues found, 2 feature gaps detected`
- [ ] Mission Progress panel becomes a minimal status strip (not removed, but secondary)
- [ ] Application Understanding panel becomes compact inspector (collapsed by default)
- [ ] AI reasoning feels like Claude/ChatGPT thinking — natural, not robotic

### Phase 4 — Developer Terminology
Rename labels to developer tooling language:
- [ ] `Mission Progress` → `MISSION_STATUS`
- [ ] `Application Understanding` → `APPLICATION_ANALYSIS`
- [ ] `Thinking` tab → `REASONING_LOG`
- [ ] `Evidence` tab → `EVIDENCE`
- [ ] `Report` tab → `REPORT`
- [ ] Status indicators: `[ OK ]`, `[ EXECUTING ]`, `[ FAILED ]`, `[ PENDING ]`
- [ ] Mission summary labels: compact monospace format

### Phase 5 — Product Cleanup
- [ ] Remove `#model-badge` from topnav (agent must not expose LLM model)
- [ ] Quality metrics reframed around anomalies/out-of-band behavior
- [ ] Backend unchanged

## Files to Modify
| File | Phases |
|------|--------|
| `public/styles.css` | 0, 1, 2 (layout ratios, typography, palette, surfaces) |
| `public/index.html` | 3, 4, 5 (label renames, prompt chip text, remove model badge, panel structure) |
| `public/pipeline.js` | 0, 3 (compact rendering, conversation message injection) |
| `public/app.js` | 3, 5 (pipeline event → conversation message injection) |

## What Does NOT Change
- Three-panel layout
- Collapsible panel mechanism
- Backend
- Test suite

## Acceptance Criteria
- [ ] Conversation occupies majority of middle panel (~70%)
- [ ] JetBrains Mono on every text element
- [ ] Zero `backdrop-filter` in CSS
- [ ] GitHub Dark color palette (not terminal green-on-black)
- [ ] Border-radius ≤ 3px
- [ ] Pipeline progress appears as AI messages in conversation
- [ ] Labels use developer terminology (MISSION_STATUS, REASONING_LOG, etc.)
- [ ] Model name not visible anywhere
- [ ] Prompt chips are flat IDE actions (no `>` prefix)
- [ ] Zero console errors
- [ ] All tests pass
