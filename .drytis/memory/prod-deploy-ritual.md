# Deploy ritual for qase.drytis.com (learned 2026-09-30, two deploys in a row)

Production (deployment 153) does NOT reliably pull the latest origin/DEV on
`restart_production` — the rolling restart reuses the persistent volume's existing
checkout and its drytis-init pull has twice left the workspace one-or-more commits
behind. Do NOT trust the restart alone. The working deploy ritual:

1. Pre-deploy gate (git_manager) — all commits on origin/DEV.
2. `update_production_config(project_id)`.
3. `restart_production(project_id)`.
4. **Always** verify prod actually serves the new code:
   `curl -s http://qase.drytis.com/ | grep -c <known-new-marker>` AND compare
   `curl -s http://qase.drytis.com/app.js | md5sum` vs `md5sum public/app.js`.
   Caddy/edge caches: check the HTML Last-Modified header of `/`, not just app.js —
   a fresh ETag/Last-Modified on `/` is the truth; app.js may show stale Last-Modified
   when unchanged between commits.
5. If stale, fix in-container via `prod_run_bash`:
   `cd /workspace && git fetch origin DEV && git reset --hard origin/DEV`
   then `procmgr restart service-bg-service-4182`.
6. **System libraries do NOT survive a new pod**: /root & /usr are per-container.
   After any restart, re-run the browser dep check:
   `ldd ~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome | grep -c "not found"`
   If >0, reinstall (see prod-browser-deps-after-pod-restart.md for the full package
   list incl. bookworm name quirks libjxl0.7 / libx264-164), then restart the service.
   The setup script is supposed to do this but its `|| WARN` guards hide package-name
   mismatches — do NOT assume it worked.

Symptom if you skip step 6: QA runs close as "blocked: libglib-2.0.so.0 missing"
exactly as in #14011 and the user's report.
