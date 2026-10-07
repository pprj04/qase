# Postmortem · RT1 #14753 — branded browsers must live on the persistent volume

## What happened
Brave/Edge/Opera were `dpkg -i`-installed to `/usr/bin` and `/opt` during RT1.
Container idle-replacement wiped them (only `/workspace`, `$HOME`, mysql and
caddy certs survive). The registry then reported brands `present` from the
base-image cache or `absent` with install notes, and
`server/localBrowserRegistry.test.js` failed (`edge: 'absent', expected
'present'`) — an honest failure, but a broken RT1 claim.

## Fix
- Browsers are now EXTRACTED (`dpkg-deb -x`, no dpkg install) into
  `/workspace/.local-browsers/<brand>/…` — persistent across replacement.
  Versions verified: Edge 124.0.2478.67, Brave 154.1.96.61, Opera 136.0.6008.80
  (Google Chrome 151 ships with the base image at /usr/bin/google-chrome-stable).
- `server/localBrowserRegistry.js` BRANDS candidate paths updated to prefer the
  persistent path, falling back to system paths.
- Setup script re-extracts any missing browser from its official .deb
  (idempotent) and does NOT dpkg-install branded browsers anymore.
- WebKit shared libs (libgstreamer etc.) are ALSO ephemeral — the setup script
  re-runs `playwright install-deps webkit` on every boot (existing behavior).

## Gotchas
- One `dpkg-deb -x` extraction of Brave produced a BINARY WITH ZEROED CODE
  PAGES (segfault at ip …+ee40000, md5 mismatch vs a fresh extract). Re-extract
  to /tmp, verify `--version`, then copy into the persistent path; the first
  workspace-volume extraction can be corrupted. If a branded binary segfaults,
  re-download and re-extract — do not trust the first copy.
- The Brave wrapper script `opt/brave.com/brave/brave-browser` execs
  `"$HERE/brave"`. Probe the REAL binary, not the wrapper.

## Zombie process hazard (platform)
The container's init (drytis-init) does not reap orphaned children. Every
Playwright browser launch leaves zombie `cat` processes (from Chromium's
`exec > >(exec cat)` wrapper scripts) parented to PID 1. A full `npm test`
run (141 test files, browser-heavy) accumulates ~7,000 zombies and hits the
container process limit — `fork: Resource temporarily unavailable`, killing
bash AND the node service. Mitigation while testing:
- Run the suite in CHUNKS (≤15 files) with `--test-concurrency=1`.
- Watch `cat /sys/fs/cgroup/pids.current`; above ~5,000, restart the container
  (`restart_container`) to reap.
- `node --test` chunked runs leave zombies behind even when green — a clean
  final restart is needed before infra verification.
