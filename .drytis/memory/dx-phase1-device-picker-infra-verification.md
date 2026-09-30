# DX Phase 1 (ONE Device Picker) — infra verification, 2026-09-30

**Verdict: PASS** (0 FAIL, 6 WARN). All checks green; blockers none.

## What was verified
- New files on disk: `public/activeTestEnvironment.js` (3.1KB), `public/devicePicker.js` (13.5KB), `public/devicePicker.test.js` (4.3KB). `node --test public/devicePicker.test.js` → 5/5 pass.
- Markup: `<dialog id="device-picker" class="modal dp-modal">` at index.html:1038. CSS `dp-*` block appended at styles.css:8613+.
- Wiring: app.js:10-11 imports; `createActiveTestEnvironmentStore` L4561; `createDevicePicker` L4562 (guarded by `$('device-picker')`); `setData`/`hydrate` L4595/4599; quick-action `devicePicker?.open?.()` L4466. Old drawer still on disk but Devices quick-action now routes to the picker.
- Preview 200 at root; page contains device-picker ×2; `/devicePicker.js` serves 200 (served via app.js module import — not a separate <script> tag).
- Services: `qase-server` = `exec node server/index.js` (production), procmgr all RUNNING, no dev-mode processes. Caddy root `/` → 5173; node binds 0.0.0.0:5173.

## Standing WARNs (unchanged + new)
1. `/workspace/.env` is zero bytes — deploy env materializes at `/drytis-config/environments/b90ad02700c6.env` instead (service sources it). Fine for dotenv (no override) but direct file readers see nothing.
2. `QASE_BROWSER_ALLOWED_PRIVATE_HOSTS` (key 50925, static tag) contains **stale literal preview host** `qase-2-1-jywqe4.drytis.dev`; current preview is `qase-2-1-cvtryq`. Won't survive project recreation.
3. `/workspace/.env.example` has no backend env_key representation (placeholder-only).
4. **Phase 1 changes are UNCOMMITTED** on branch PUSHKAR (HEAD 257acfc predates Phase 1; 10+ modified files + 3 new files in working tree). Must commit+push before any git-based release.
