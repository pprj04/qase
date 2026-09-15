# Production selection and routing blocker — 2026-09-15, #10927

Project 3542 main and origin/main match 01591df5a7f8750318e8089271b7edcceeaa3e30. npm run verify: 468 passed, 9 skipped, zero failures. No deployment performed.

Drytis select_project returns a literal async_generator object. Project details fails for missing API_BASE_URL. Production status and production bash both report no selected project. Platform repair required; do not retry deployment mutations blindly.

Live domain fingerprint differs from preview: qase.drytis.com has public OpenAPI 3.1 v1.1.0 and health project Qase; /readyz 404. Preview /readyz 200, OpenAPI 404, health 401. Historical direct host prod-qase-2-1-mkqetf.drytis.dev returns plaintext 404. Historical notes identify an incumbent domain collision; current ownership needs platform confirmation. Preserve existing production data.

A login redirect or HTTP 200 does not prove the correct release. After platform repair, verify domain mapping, canonical config, actual production Git revision, readiness, and browser flows.
