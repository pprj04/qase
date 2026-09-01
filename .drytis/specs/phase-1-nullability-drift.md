# Phase 1 — Nullability drift fix (spec-only)

## Goal
Make the live OpenAPI document declare nullability for every field whose projector can emit `null`, so strict OpenAPI 3.1 consumers accept every response. **Spec changes only — zero API behavior change.**

## Files to change
- `server/openapiDocument.js` (schema consts, lines ~99-330)

## Work
1. Add a `nullable(base)` helper alongside the existing `dtOrNull` pattern (line 49): `anyOf: [base, { type: 'null' }]`. The file's rule (line 15) forbids standalone `type: "null"` — use unions only.
2. Apply to the audited field list (verified against `server/pulseProjection.js` `?? null` emissions):
   - **Project** (:99-110): `base_url`, `workspace_id`, `created_at`, `updated_at` (ms() returns null for non-numeric)
   - **Mission** (:112-135): `source`, `project_id`, `project_name`, `target_url`, `session_id`, `quality_score`, `verdict`, `release_ready`, `failure_reason`
   - **Session** (:137-154): `status`, `project_id`, `project_name`, `target_url`, `mission_id`, `mission_name`
   - **Finding** (:156-190): `primary_category`, `reproducibility`, `confidence`, `url`, `expected`, `actual`, `observed`, `impact`, `recommendation`, id/name joins, `duplicate_of`
   - **TestCase** (:192-212): `project_id`, `project_name`, `workflow_id`, `suite_id`, `target_url`
   - **Workflow** (:214-228): `project_id`, `project_name`, `target_url`
   - **Suite** (:230-243): `project_id`, `project_name`, `parent_id`
   - **Schedule** (:245-269): `project_id`, `project_name`, `target_url`, `last_run` (bare object today, projector returns null when absent)
   - **RegressionRun** (:271-291): `schedule_id`, `schedule_name`, `project_id`, `project_name`, `target_url`
   - **FixValidationRun** (:293-313): `finding_id`, `finding_title`, `mission_id`, `project_id`, `project_name`, `fix_status`, `validation_confidence`, `trigger`, `requested_by`
   - **KnowledgePattern** (:315-328): `pattern`, `category`, `confidence`
   - Enums (severity/status/etc.) keep their bare enum where projectors apply defaults; only `?? null` fields become nullable.
3. Declare emitted-but-undeclared fields: `Mission.correlation_id` (pulseProjection.js:83), `FixValidationRun.partial_fix` (:281).
4. Commit immediately: `server/openapiDocument.js` is on the protected-files git-clean list (tests-real/c4-agent-browserstack.test.js:359). Pre-existing uncommitted browserstack files must be committed FIRST (separate concern, but the gate checks the whole tree for that file — verify scope).

## Acceptance criteria (true in the running app)
- [ ] `GET /api/v2/projects` response validates against the live spec when any project has `workspace_id: null` (black-box validator returns 0 errors)
- [ ] `/openapi.json` schemas for all 12 components declare `anyOf`-union nullability for the audited fields; no standalone `{"type":"null"}` entries (existing rule upheld)
- [ ] API responses themselves are byte-identical to before the change (no projector/handler edits)
- [ ] `npm run test:openapi` passes; `tests-real/pulse-openapi-document.test.js` and `pulse-openapi-api.test.js` pass
- [ ] `/workspace/handoff-test/golden-flow-runner.mjs` check `flow.4` now PASSES (32/32)

## Tests
- Extend `tests-real/pulse-openapi-document.test.js`: every audited field's schema accepts null (anyOf union present)
- No new runtime tests needed — behavior untouched

## Edge cases
- OpenAPI 3.0 consumers read `anyOf` unions fine; `nullable: true` is not 3.1-canonical — stick to unions per file precedent
- Keep `required` arrays unchanged — required+nullable is legal and matches reality (field present, value null)
