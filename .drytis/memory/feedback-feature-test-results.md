# QASE-2.1 — User Feedback section in QA Run Report: browser test results (2026-09-29)

All 6 delegated checks PASSED. Details:

1. Rated run (abca4326, qase.dev, ⭐3 badge in run list) → Report tab shows "USER FEEDBACK" section:
   `★★★☆☆ 3/5` / "OK run." / "Submitted By: QA FB2 · Submitted On: 9/28/2026, 6:07:21 PM" — matches rating given.
2. Report actions row shows "View Feedback" (not "Provide Feedback") for rated runs. Modal opens in submitted
   state: fields disabled, radio 3 checked, status "Thank you! Your feedback has been submitted successfully.",
   footer buttons Done / Edit feedback / "Feedback submitted ✓" (disabled).
3. Full page refresh: USER FEEDBACK section + View Feedback button persist identically (report persists server-side).
   Note: refresh resets the Run details panel to the Activity tab — must re-click Report tab.
4. Unrated completed run: NO USER FEEDBACK section, button reads "Provide Feedback" (isolation confirmed).
5. Submitting feedback on unrated run (4 stars + description): success message shown, modal flips to submitted
   state, USER FEEDBACK section appears immediately in report (★★★★☆ 4/5 + text + Submitted By/On),
   button changes to "View Feedback" without refresh.
6. Console: 0 errors, 0 warnings across entire session.

## Environment quirks found while testing (not bugs in the feedback feature)
- The seeded account had only ONE run; a second completed run had to be created live via "Start standard QA
  run" dialog (target https://qase.dev — browser safety allowlists only qase.dev; example.com is blocked
  with BROWSER_OUT_OF_SCOPE_NAVIGATION and typing a URL into the composer of a completed run appends to that
  same run rather than creating a new one).
- A QA run takes ~2.5 min (target site qase.dev is actually down with Cloudflare 525 — runs end "Blocked",
  which still counts as completed for feedback purposes).
- browser_wait_for with time param times out the MCP server (~25s limit); poll via snapshots instead.
- QA modal shows username "QA FB2" for account qa-fb2-…@qase.test.
