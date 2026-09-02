/**
 * R1 — Mission watchdog handlers (extracted from index.js, PURE MOVE).
 *
 * The governor's sweep timer (missionGovernor.js) fires these three handlers
 * for every active mission on its 30s tick:
 *
 *   probeSession — is this mission's session still alive?
 *   onStuck      — mission says running, session settled ≥90s ago → honesty
 *                  finalizer (deterministic close-out, then finalize).
 *   onTimeout    — mission exceeded the wall-clock limit → abort runtime,
 *                  deterministic close-out + evidence, then fail finalize.
 *
 * WHY A MODULE: index.js previously defined these inline at the
 * startGovernorWatchdog call-site, which made them impossible to unit-test
 * in isolation (importing index.js boots the whole server). Extracting them
 * changes ZERO behavior — same functions, same dependencies, now injected.
 *
 * R1 fixes carried here:
 *   G5  — onTimeout previously had an INVERTED terminal guard (it only
 *         "acted" when the mission was already terminal — a no-op — and did
 *         NOTHING for the live over-limit mission). Now: abort runtime
 *         FIRST, run the D1 close-out pair (finalizeTurnLimitedRun +
 *         collectEvidenceForSession), then finalize failed.
 *   G7  — probeSession reports settled:false while a runtime kick is
 *         pending (record.pendingRuntimeKick), so a slow — not stuck —
 *         construction is never mis-finalized by the 90s detector.
 */

import { closeBrowser, finalizeTurnLimitedRun } from './agent.js';
import { isTerminalStatus } from './missions.js';

/**
 * Build the handler set for startGovernorWatchdog().
 * Every dependency is injected — no store imports, no config imports.
 */
export function createMissionWatchdogHandlers({
	getMission,
	getSession,
	liveFor,
	finalizeMission,
	finalizeMissionFromSession,
	collectEvidenceForSession,
	getConfig,
	log = () => {}
} = {}) {
	if (typeof getMission !== 'function') throw new TypeError('createMissionWatchdogHandlers: getMission required');
	if (typeof getSession !== 'function') throw new TypeError('createMissionWatchdogHandlers: getSession required');

	const probeSession = (sessionId) => {
		const session = getSession(sessionId);
		if (!session) return { settled: true, running: false, settledAt: Date.now(), status: 'gone' };
		const record = liveFor(sessionId);
		// R1-G7 — a runtime kick still pending means the session LOOKS settled
		// (idle, not running) but construction is in flight; the 90s stuck
		// detector must not finalize a mission whose execution is about to
		// begin. Report not-settled so sweep skips it entirely.
		if (record?.pendingRuntimeKick) {
			return { settled: false, running: false, status: session.status };
		}
		const settledStatuses = ['idle', 'done', 'error', 'interrupted'];
		const settled = settledStatuses.includes(session.status);
		return {
			settled,
			running: Boolean(record?.running),
			// updatedAt as the settle timestamp: session records are re-stamped
			// on every mutation, so updatedAt ≈ when it last changed state.
			settledAt: session.updatedAt ?? Date.now(),
			status: session.status
		};
	};

	const onStuck = (missionId) => {
		// Same honesty finalizer the lazy GET path uses — no duplicate logic.
		const mission = getMission(missionId);
		if (!mission || mission.status !== 'running' || !mission.sessionId) return;
		const session = getSession(mission.sessionId);
		if (!session) return;
		// B2 — deterministic close-out (zero model turns), then finalize.
		finalizeTurnLimitedRun(session);
		Promise.resolve(finalizeMissionFromSession(mission, session)).catch(() => {});
	};

	const onTimeout = (missionId) => {
		const mission = getMission(missionId);
		// Guard is terminal-status REFUSAL: finalize only when the mission is
		// still live. The original inverted guard only "acted" when there was
		// nothing to act on — for a live over-limit mission it did NOTHING,
		// so the sweep freed the slot with the mission left 'running' until
		// some other path (if any) finalized it.
		if (!mission || isTerminalStatus(mission.status)) return;

		// Hard-stop the runtime FIRST: abort the in-flight turn and close the
		// browser so no further model turns can race the close-out below.
		if (mission.sessionId) {
			const record = liveFor(mission.sessionId);
			record?.controller?.abort();
			void closeBrowser(mission.sessionId);
		}

		// R1-G5 — a timed-out run still produced real evidence. Same D1 close-
		// out pair the error/interrupted finalizer path uses: deterministic
		// budget close-out (zero model turns) + evidence collection, THEN the
		// failed finalize. Previously this path wrote failed WITHOUT either,
		// so timed-out missions got no report and zero evidence nodes.
		const session = mission.sessionId ? getSession(mission.sessionId) : null;
		if (session) {
			try {
				finalizeTurnLimitedRun(session);
				collectEvidenceForSession(mission, session);
			} catch (error) {
				log(`[watchdog] timeout close-out failed for ${missionId}: ${error?.message ?? error}`);
				// Best-effort close-out: the failed finalize below is the
				// guarantee.
			}
		}

		finalizeMission(missionId, {
			status: 'failed',
			failureReason: `execution_timeout: exceeded the ${getConfig().missionTimeoutMinutes}-minute wall clock`,
			findings: [],
			summary: null
		});
	};

	return { probeSession, onStuck, onTimeout };
}
