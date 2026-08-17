# Phase 16 — findings.json inode corruption + recovery (2026-08-16 ~13:20 UTC)

## What happened
Same filesystem corruption event as the .env clobber. `.qase/findings.json`
inode became unreadable (`-?????????` in ls, "Structure needs cleaning").
Server's `load()` silently swallowed the read failure → booted with empty
in-memory store → GET /api/findings returned [] and flush() risked
overwriting... (flush only fires on writes; the empty store never persisted
over our recovery because we stopped the service before swapping the file).

## Recovery performed
1. Base: `.drytis/backup-0816/findings.json` (1265 items, through Aug 15 20:57)
2. Merged 51 findings embedded in `.qase/sessions.json` (id-deduped)
3. Merged 9 findings embedded in `.qase/missions.json`
4. Result: 1325 items, coverage through Aug 16 06:39 (benchmark AFTER run intact)
5. Lost: 4 transient findings from 12:58 (2 unique issues × 2, "Missing feature:
   Contact form / Privacy policy" from a reval smoke) — not recoverable, acceptable.

## Hardening follow-up (NOT done in Phase 16 — future phase candidate)
- findings.js load() should surface read errors loudly (console.error + health flag)
  instead of silently starting empty.
- Periodic backup of .qase/*.json beyond the manual 04:13 snapshot.

## Procedure that worked
procmgr stop → os.unlink corrupted inode → copy merged JSON → procmgr restart
