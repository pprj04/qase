# Git fetch quirk on /workspace (project 3542)

- Plain `git fetch` / `git fetch origin` fails with "remote end hung up unexpectedly" (server returns empty upload-pack result). **Workaround: fetch with an explicit refspec — `git fetch origin DEV` works fine.** `--unshallow` and `--deepen` also fail the same way.
- `git fetch --depth=1 origin DEV` grafts the fetched tip as a false root in `.git/shallow` even when its parents exist locally. Symptom: `git status` shows absurd "ahead N, behind 1" and `merge-base` fails. Fix: delete the bogus line from `.git/shallow` if the commit's parent exists locally, then the graph is correct again.
- Repo is shallow by design (shallow=true in init.json); the true shallow root is `e7467bf` (Drytis "Initial commit").
- Commit identity: Mishal Muneer <mishmuneer2011@gmail.com>. Current working branch: DEV tracking origin/DEV.
- `.drytis/memory/` files show up as untracked in `git status`; they are agent memory, kept local (not committed alongside app changes) per existing convention — though note `badec7f` did commit a memory note once.
