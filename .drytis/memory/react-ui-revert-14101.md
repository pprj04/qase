# React UI revert (#14101, Oct 1 2026)

User requested: undo the React UI changes, revert to the commit before the UI change.

## What was done
- Last pre-React commit identified: 6d5affa (idle-chip fix). Everything after = React rebuild (ef0805d..5ce0791, tickets #14023-#14029).
- Reverted the whole range with ONE revert commit 9442c99 (git revert --no-commit ef0805d^..HEAD), keeping shared history; .drytis memory notes intentionally preserved.
- Post-revert cleanup commit 66d7f85: re-applied the environment-aware split-horizon test fix (DNS drift, not UI-related), removed built public/app-react output. Pushed to origin/DEV (5ce0791..66d7f85).
- Setup script updated: build:react step removed.
- Preview verified: legacy title 'Qase — autonomous QA agent', 200.
- Production (qase.drytis.com, deployment 153): pod reset to 66d7f85, npm ci, app-react output removed, browser deps reinstalled (CHROMIUM_MISSING=0), service restarted. Playwright in prod verified title + single #status-chip. Suite: 768 tests / 748 pass / 0 fail / 20 skipped. npm run verify green.

## Notes
- The React work is fully recoverable: commits ef0805d..5ce0791 remain on origin/DEV history (revert commit on top, not a force-push). To restore, revert the revert.
- react-ui-*.md memory notes retained on purpose (history/documentation).
- Tickets #14023-#14029 remain Done (they were genuinely completed); #14101 tracks the revert.