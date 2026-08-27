/**
 * C3 (build order Phase 5) — Mid-session decision probe.
 *
 * C2 proved the autonomy engine fires only when a session SETTLES. When
 * iteration 1 consumes the whole turn pool — the common full_audit case —
 * the engine never gets a chance to decide anything earlier. This module
 * adds the smallest safe mid-session decision opportunity:
 *
 *   • Trigger: the per-turn boundary in agent.js (deterministic, exactly
 *     where the turn budget is already enforced). Every K turns.
 *   • Engine: the SAME makeDecisionSafe rule cascade (no LLM, deterministic).
 *   • Authority: NONE. The probe can hint (trace + a settle-gate note) and,
 *     only for decision-grade STOP evidence, request an early settle via the
 *     EXISTING abort seam. It never touches maxTurns, never dispatches an
 *     iteration, never mutates findings.
 *
 * Invariants (C3 contract §P5):
 *   - budget authority remains external — probes are read-only on budget
 *   - one probe in flight at a time + cooldown
 *   - anti-churn: identical input signature with no new findings is suppressed
 *   - probe failures are swallowed (probe must NEVER break a running mission)
 *   - traces use the existing 13-field schema with state 'session:running:probe'
 */

import { makeDecisionSafe, DECISION_TYPES } from './decisionEngine.js';
import { recordDecisionTrace } from './decisionTraces.js';

/** Probe cadence: run at every K-th turn boundary. */
export const PROBE_TURN_INTERVAL = 4;
/** Minimum wall-clock gap between probes (ms) — never probe-spam a fast model. */
const PROBE_COOLDOWN_MS = 5_000;

const inFlight = new WeakSet();
const lastProbeAt = new WeakMap();
const lastSignature = new WeakMap();
const lastFindingCount = new WeakMap();

/**
 * Returns true when this turn boundary should host a probe.
 * Deterministic: mission-linked sessions only, every K-th turn.
 */
export function shouldProbeAtTurn(session, turnCount) {
	if (!session?.missionId) return false; // ad-hoc sessions are not autonomous missions
	if (!Number.isInteger(turnCount) || turnCount < PROBE_TURN_INTERVAL) return false;
	if (turnCount % PROBE_TURN_INTERVAL !== 0) return false;
	return true;
}

/**
 * The probe itself. Read-only on the session (except the settle-gate hint +
 * trace side-channels). Never throws to the caller — agent.js treats the
 * probe as best-effort.
 *
 * @returns {Promise<{probed:boolean, decision?:string, earlyStopRequested?:boolean, suppressed?:string}>}
 */
export async function runMidSessionProbe(session, mission, turnCount) {
	if (!session?.missionId || !mission) return { probed: false };
	if (inFlight.has(session)) return { probed: false, suppressed: 'in-flight' };
	const lastAt = lastProbeAt.get(session) ?? 0;
	if (Date.now() - lastAt < PROBE_COOLDOWN_MS) return { probed: false, suppressed: 'cooldown' };
	if (session.status !== 'running') return { probed: false, suppressed: 'not-running' };

	inFlight.add(session);
	try {
		lastProbeAt.set(session, Date.now());

		// Same deterministic engine, same vocabulary, live session state — but
		// on a SHALLOW-FROZEN VIEW: the engine's trackBudget() mutates
		// session.budget counters in place; the probe must be read-only, so it
		// evaluates against a copy. Findings/steps/activity arrays are shared
		// read-only (the engine does not mutate them).
		const probeView = Object.assign(Object.create(Object.getPrototypeOf(session)), session, {
			budget: session.budget ? { ...session.budget } : session.budget
		});
		const decision = makeDecisionSafe(probeView, {}, mission);
		const input = {};
		// The decision carries its input signature on factors (RULE paths) —
		// fall back to a findings-count+turn stamp when absent.
		const signature = decision?.factors?.inputSignature ?? `${(session.findings ?? []).length}:${turnCount}`;

		// Anti-churn: identical engine input with no new findings since the
		// last probe → suppress (no trace, no hint churn).
		const findings = session.findings ?? [];
		if (lastSignature.get(session) === signature && lastFindingCount.get(session) === findings.length) {
			return { probed: false, suppressed: 'churn-guard', decision: decision.decision };
		}
		lastSignature.set(session, signature);
		lastFindingCount.set(session, findings.length);

		// Auditable via the EXISTING 13-field trace schema (no new fields).
		recordDecisionTrace({
			missionId: mission.id,
			iteration: mission.iterations?.length ?? 0,
			state: 'session:running:probe',
			// KEYS ONLY — no values, no chain-of-thought, no secrets.
			signals: input,
			candidateAction: decision.decision,
			selectedAction: 'hint',
			reason: decision.reason ?? `probe: ${decision.decision}`,
			budgetBefore: probeView.turnBudgetRemaining ?? null,
			budgetRequested: 0,
			budgetGranted: 0, // probes NEVER request/grant budget
			result: 'recorded',
			nextDecision: 'settle-gate'
		});

		// Hint consumed by the settle gate (index.js finalize path).
		// REPLAN focus payload passes through for the next iteration focus.
		session._probeHint = {
			decision: decision.decision,
			reason: decision.reason ?? null,
			ts: Date.now(),
			turnCount,
			...(decision.decision === DECISION_TYPES.REPLAN && decision.focusPayload
				? { focusPayload: decision.focusPayload }
				: {})
		};

		// Early-stop request — ONLY for decision-grade fail evidence, and only
		// a REQUEST: the caller (agent.js) applies it through the EXISTING
		// AbortController seam; the authoritative decision still happens at
		// the settle gate (finalizeMissionFromSession → runAutonomyDecision).
		// The C3 policy made criticalCount decision-grade, so STOP_FAIL here
		// already implies confirmed evidence, not classification noise.
		const earlyStopRequested =
			decision.decision === DECISION_TYPES.STOP_FAIL ||
			decision.decision === DECISION_TYPES.ESCALATE;

		return { probed: true, decision: decision.decision, earlyStopRequested };
	} catch (error) {
		// Probe must never break a running mission.
		console.error(`[c3-probe] mission ${mission?.id}: probe failed (non-fatal): ${error?.message ?? error}`);
		return { probed: false, suppressed: 'error' };
	} finally {
		inFlight.delete(session);
	}
}
