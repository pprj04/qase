# #14385 Theme coverage (T3) — DONE, 3 review rounds

- ~196 hardcoded dark rules migrated to tokens across styles.css. Keepers: entry-motion boot canvas, browserChrome brand colors, .btn-primary inverted design (dark+white text in both themes — intentional).
- Audit tooling: scripts/audit-theme-light.mjs (programmatic readability walk) + scripts/theme-layout-parity.mjs (geometry parity across themes). NOTE: the audit skips transparent-bg text — hardcoded TEXT colors on inherited backgrounds need eyeball/browser verification (that's how 3 round-1 misses were found: active run title, empty-state h2, env-summary).
- styles.css has DUPLICATED rule families where the LATER block wins the cascade — when migrating, fix ALL copies (dead + winning), and beware tokenizing a background while leaving a dark-tuned text color like #fff behind.
- Real bug fixed: --font-ui/--font-mono were only defined in the light layer → data-theme="dark" silently fell back to Times New Roman. Font tokens now on base :root. Lesson: token definitions that live only in one theme layer break the other.
- Light --text-faint lightened #a1a1aa→#8a8a92 (3.43:1 on white).
- Cache-bust discipline: EVERY styles.css content change needs a version bump (currently ?v=20261002-2) or returning users keep the stale sheet.
- Reviewer out-of-scope flags for a future sweep: .test-on-prompt amber (#fbbf24 ~1.7:1 on white), .dcl-empty #6d8095, dead duplicated block family ~L9598.
- Suite: 1123/1103/0/20. Layout parity PASS (byte-identical geometry).