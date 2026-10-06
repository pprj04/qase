# Incident: PID/zombie exhaustion — shell cannot fork (2025-06, post-RT1 review)

**Symptom:** `run_bash` fails with `fork/exec /bin/bash: resource temporarily unavailable` (EAGAIN). File tools (read/glob/list) still work — investigate via /proc and /sys directly.

**Diagnosis (verified via /proc, /sys):**
- Kernel `pid_max` = 4,194,304 — NOT the limiter.
- cgroup v2 `/sys/fs/cgroup/pids.max` = `max`, `pids.current` = 7722, `pids.events` = `max 0` — cgroup pids controller NOT the limiter either.
- **Actual limiter: RLIMIT_NPROC = 7684 (soft+hard) for uid 1000.** All container processes run as uid 1000; total threads ~7805 (`/proc/loadavg` field 4). Any fork by uid 1000 gets EAGAIN.
- ~7,700 zombies: `cat`, `chrome-headless`, `chrome`, `brave`, `opera`, `opera_crashrepo`, `chrome_crashpad` — **all PPid 1, state Z, uid 1000**. Real parents exited; reparented to `drytis-init` (PID 1, 16 threads), which never wait()s them.
- The browser zombies match the RT1 launch probes (brave/opera/chrome) reviewed in ticket #14680; the `[cat]` zombies match leaked shell-tool invocations.

**Still alive at time of check:** PID 43187 (qase-server node, comm "MainThread", 11 threads, ~503 MB RSS, uid 1000) with a live LISTEN on 0.0.0.0:5173 and established connections — the app was still serving despite fork exhaustion. PID 1 (drytis-init) alive.

**No in-container recovery possible:** no shell to fork `kill`/`ps`; the only zombie parent is PID 1 itself (signaling a non-reaping init with SIGCHLD wouldn't reap anyway). **Fix = container restart (host-side).** Preventive: drytis-init should reap orphans (wait()/SIGCHLD handler); shell/browser-probe subprocesses must be waited on.

**Read-only investigation tricks:** glob/grep tools fail on /proc (exit 101 / no matches) — use `read_file` on `/proc/<pid>/status`, `/proc/loadavg`, `/proc/net/tcp`, and `list_files /proc` (truncated at 100 entries, lexicographic).
