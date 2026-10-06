# WhatsApp notifier: MANOJ → DEV merges

## Merge 1 (pre-fix, ticket #14732 context)
- origin/DEV 653fcdc = merge of MANOJ bringing in the original WhatsApp feedback
  notification feature (whatsappNotifier + dispatch on feedback.create).

## Merge 2 (the hardening FIX, ticket #15071, 2025-xx)
- MANOJ tip bf053c2 ("WhatsApp fix spec") merged into DEV with --noff → merge
  commit **b382093**, pushed to origin/DEV.
- Expected real conflicts did NOT materialize — git auto-merged ('ort' strategy)
  cleanly. Verified the auto-merge matched the intended resolutions anyway:
  - server/whatsappNotifier.js / .test.js: MANOJ rewrite taken wholesale
    (statuses PENDING/RETRYING/SENT/FAILED, retryNotification, listNotifications,
    template mode; 28 tests, synthetic +1555… recipients).
  - server/whatsappNotificationApi.test.js: new file (admin routes tests).
  - server/app.js: DEV's selectedTests/securityAuthorization in POST /api/sessions
    kept; MANOJ's GET /api/feedback/notifications + POST /api/feedback/notifications/:id/retry
    sit right after /api/feedback/stats; notifier built in createApplication
    (createConfiguredWhatsAppNotifier, options.whatsappNotifier override),
    dispatch-after-create in POST /api/feedback.
  - server/operationalLogger.js: SAFE_FIELDS unioned with
    state/recipients/notificationId/feedbackId.
  - .env.example: unioned with WhatsApp env section.
- Tests on merged tree: `node --test server/whatsappNotifier.test.js
  server/whatsappNotificationApi.test.js server/feedbackNotifyApi.test.js
  server/feedbackApi.test.js` → 51/51 pass.
- Workspace restored to MANOJ bf053c2, clean, 0/0 vs origin/MANOJ;
  origin/MANOJ fully contained in origin/DEV.

Note: untracked .drytis/memory notes are intentionally never committed.
