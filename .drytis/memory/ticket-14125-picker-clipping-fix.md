# Ticket #14125 — Device picker left-edge clipping fix (DONE)

Branch NIHARIKA, uncommitted. User: 'Not rendering correctly' + image_782e9d49.png (picker content clipped on left: '…CE', '…hrome 138', '…ows Desktop').

## Root cause
Base `.modal` caps every dialog at `width: min(600px, calc(100vw - 28px))` with `overflow: hidden`. `.dp-modal .modal-inner { width: min(720px, 94vw) }` sized the INNER to 720px inside the 600px dialog → inner centered → 121px past the dialog's LEFT edge → clipped by overflow:hidden. (Same invariant as layout-gotchas.md: .modal is the width owner — size the dialog, not the inner.)

## Fix (styles.css ~8681)
`.dp-modal { width: min(720px, calc(100vw - 28px)); max-width: 720px; } .dp-modal .modal-inner { width: auto; }`
Verified by geometry probe at 1024/1280/1920: dialog 720px, inner fully inside, title at +16px inset. All other dialogs audited — no other broken `.modal-inner { width }` pattern (dm-modal/founder/sqa size their dialogs correctly).

## Verification
Tester: 7/7 layout+flow PASS at 1024/1366/1920 (all text fully readable, search+select flow works); V3 console 'FAIL' was the 5 pre-login 401s — pre-existing, unrelated. Reviewer PASS all 5 items. Suites 99/99 public, 830/0/9 npm test, test:ui PASS, acceptance PASS.

## Follow-ups raised (not done, need customer approval)
- Dead rule `.test-cases-inner,.bulk-run-inner{max-width:860px}` never fires — those dialogs may have been intended 860px wide.
- Pre-login 401 console noise from unauthenticated API probes on the landing page (sessions/environments×2/device-runtime/auth/me) — could be gated behind auth.