# Feedback panel render defect — FIXED

Earlier defect: /api/feedback returned a bare array but the component expected `{records}` — list showed "No feedback matches the current filters." under every filter (stats block still worked). Fixed by handling the bare-array response.

Re-test 2026-10-01 (accounts[0], admin): PASS 4/4.
- 3 cards render (★★☆☆☆ Test Execution Speed, ★★★★☆ UI/UX Experience, ★★★★★ Test Accuracy), all selects reading New.
- rating=5★ → exactly 1 card; category=ui_ux → exactly the 4★ card; reset → 3 cards.
- Status change New→Reviewed on run 8d211d58: PUT /api/feedback/<id> → 200, toast "Feedback status updated.", select persists as Reviewed after refresh (left as Reviewed per task).
- Console: only pre-login 401s + known favicon 404.
