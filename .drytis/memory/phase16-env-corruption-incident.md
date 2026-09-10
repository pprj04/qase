# Phase 16 — .env corruption incident (2026-08-16 ~12:55 UTC)

## What happened
Container paused ~12:44 and resumed ~12:55. On resume, `/workspace/.env`
(3.2MB) contained the **findings-store JSON array** (1316 items, ts ≤ 1786862382453
= 06:39 snapshot) instead of the 27 registered env vars. `/home/coder/.gitconfig`
also returned "Structure needs cleaning" (filesystem-level corruption).

## Effect
- `dotenv/config` parsed garbage → server booted with NO QASE_API_KEY
- POST /missions with autoStart → 500 "No API key set"
- POST /missions/:id/revalidate → 500 "No API key set"
- 7 test failures in full regression (phase5-api: 2, phase9.2-revalidate-e2e: 5)

## Root cause
Filesystem corruption from container pause mid-IO (same class of issue the
setup script comments about re: npm cache). QASE's own atomicWrite protects
.qase/*.json but nothing protects /workspace/.env — it is owned by the
Drytis backend, which regenerates it on container start.

## Fix
Restart container → backend regenerates .env from 27 registered env keys
(backend env_keys are the source of truth, verified via get_project_details).

## Lesson
If missions/tests suddenly 500 with "No API key set" after a container resume,
check `cut -d= -f1 /workspace/.env` FIRST. Corrupted .env looks like JSON.
Do not hand-write .env — always let the backend regenerate it.
