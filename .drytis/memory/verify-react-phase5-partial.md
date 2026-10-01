# Infra verification — Phase 4 + partial Phase 5 (#14027), 2026-10-01

RESULT: PASS (0 FAIL). Preview / (legacy) and /app-react/ (React bundle index-react-C4xg6iPv.js, matches disk build output) both 200. All 21 env keys present in /workspace/.env; no DB_* keys (local JSON store — spot-check N/A). Only service qase-server (exec node server/index.js) RUNNING; no dev-mode processes. Caddy root → 5173 matches PORT. Setup script includes npm ci + build:react + output verification + conditional db:migrate; identical md5 on /project-config and /drytis-config copies. No raw SQL outside migrations dirs.

Standing WARNs (unchanged): QASE_METRICS_TOKEN + QASE_API_KEY use static tag with literal secrets as default_value; .env.example unmanaged (doc-only); grep hits for preview URL only in .drytis/cred.json (runtime data, not source).

New WARN this round: Phase 5 surface (QaLauncher.tsx, ViewerPanel.tsx, src/lib/qaKickoff.ts, server/reactStageCollapse.test.js, App.tsx/shell.css/reactShell.test.js edits) is UNCOMMITTED on top of b7ca58f — same delivery gap as Phases 2–4 were; HEAD is Phase 4 commit b7ca58f, Phase 3 commit d517756 present.
