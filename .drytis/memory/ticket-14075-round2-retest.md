# Ticket #14075 — Round 2 re-verification (2026-10-01)

Round 1 FAILs re-tested on preview; both fixed. RESULT: PASS 3/3.

## R1 (was F-C — browser change discarded OS): FIXED
iPhone 11 → OS 17.0 → Browser Safari 17.0 ⇒ summary "iPhone 11 · iOS 17.0 · Safari 17.0", OS select still "iOS 17.0" (previously jumped to iOS 26.0/Safari 26.0). Follow-up OS changes (17.0→26.0→18.3) all work; browser re-resolves per OS (Safari 26.0, Safari 18.3).

## R2 (was F-F — selects clipped @1024×768): FIXED
1024×768, expanded + "Browse all devices" open: .cd-form now 2×2 grid (129px selects); all four select rights ≤ 948 ≤ viewer right 963. No page h-overflow (scrollWidth 1024 = clientWidth). 1920×1080 also clean (selects ≤ 1834 ≤ 1849, no overflow). Round 1 saw #cd-os/#cd-browser at right=1222 outside the panel.

## R3 (staleness): FIXED
Fresh login (boot /api/environments 401 pre-login), expanded #choose-device without reload → after ~1.5s Device select populated with 79 options; #cd-empty hidden. Pre-fix it stayed on "Could not load the device catalog" until page reload.

Console: only the 5 known pre-login 401s (benign, already flagged).
