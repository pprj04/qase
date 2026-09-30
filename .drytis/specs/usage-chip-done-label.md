# Fix meeting header usage chip & done status label

Ticket #12544. User feedback (screenshot of a finished meeting run header):

## Problem
1. Usage chip rendered `4.76M in · 27.2k out · tok · 88% ctx` — the `tok`
   unit label appears as its own segment after the counts, which reads as a
   stray, unlabeled item. It should attach to the counts it belongs to.
2. Status chip shows raw `done` text when a run finishes, unlike
   `awaiting_input` → "waiting for you".

## Changes (both in `public/app.js`)
1. `renderHeader()` usage line (was ~455–469):
   - Old: `${parts.join(' · ')}${estimated ? '~' : ''} tok${contextPart}`
   - New: build count segments as `${est}${input} tok in` / `${est}${output} tok out`
     so the chip renders e.g. `4.76M tok in · 27.2k tok out · 88% ctx`.
   - `~` prefix only when `usage.estimated === true` (unchanged semantics).
   - Pending state (`-- in · -- out`), context-only fallback (`88% ctx`),
     and tooltip text unchanged.
2. `setStatus()` (~505): map `done` → `done ✓`; `awaiting_input` →
   `waiting for you` (unchanged); other statuses fall through as before.

## Acceptance criteria
- [ ] Usage chip never renders a standalone `· tok` segment
- [ ] Chip reads `4.76M tok in · 27.2k tok out · 88% ctx` for the screenshot scenario
- [ ] `~` prefix still appears before each count when usage is estimated
- [ ] Pending and context-only fallback states unchanged
- [ ] Status chip shows `done ✓` instead of `done`; other statuses unaffected
- [ ] Existing test suite still green; unit tests cover the new chip formatting

## Tests
- Add `formatTokens` + chip-composition assertions to a node:test UI file
  (pattern used by `server/uiPrimitives.test.js` etc.): extractable pure logic
  or regex against source. No browser tests needed for string composition;
  tester does one visual pass on the preview.
