/**
 * BUILD B2 — Autonomous Control Loop (controller).
 *
 * Wiring: application state -> app understanding -> testContext/riskModel ->
 * decisionEngine -> resolveAction() -> safety/budget check -> execution ->
 * observation -> structured decision trace -> continue/re-plan/stop.
 *
 * HARD RULE (locked with the operator): autonomy gets the steering wheel,
 * not the fuel pump. The agent may REQUEST execution, but only budget
 * authority — the mission's ALREADY-AUTHORIZED envelope (B1 W6 maxTurns,
 * externally set) — answers ALLOWED/DENIED. This module never writes
 * session.maxTurns, never raises any ceiling, and never bypasses the shared
 * revalidation handler's guards. A source-level test (b2-decision-wiring)
 * proves no code path in this file writes session.maxTurns.
 *
 * Decision traces follow the locked 13-field schema. They contain structured
 * metadata only — no raw chain-of-thought, no prompts, no page content, no
 * secrets.
 */

import { makeDecisionSafe, DECISION_TYPES } from './decisionEngine.js';
import { resolveAction, hasReachedIterationLimit, hasNoImprovement } from './validationLoop.js';
import { recordDecisionTrace } from './decisionTraces.js';

/**
 * Integration seams. index.js registers the real implementations at boot;
 * tests inject fakes. This avoids a circular import (index.js <- controller).
 */
const hooks = {
	// async (missionId, opts) => boolean — dispatch a revalidation iteration
	// through the SHARED human/API handler (all guards enforced). Returns
	// true only when the handler accepted (202).
	dispatchRevalidation: null
};

export function registerAutonomyHooks(next) {
	Object.assign(hooks, next);
}

export function autonomyEnabled() {
	return String(process.env.QASE_AUTONOMY ?? 'on').toLowerCase() !== 'off';
}

/**
 * Per-mission autonomy switch (B2 W4 — real A/B without a server restart).
 * mission.context.autonomy === false disables the decision point for THAT
 * mission only; the process-wide env flag remains the global default.
 */
export function missionAutonomyEnabled(mission) {
	if (!autonomyEnabled()) return false;
	if (mission?.context?.autonomy === false) return false;
	return true;
}

function turnsRemaining(session) {
	const missionTurns = Number(session.maxTurns);
	const limit = Number.isInteger(missionTurns) && missionTurns >= 1 ? Math.min(missionTurns, 500) : null;
	return limit == null ? null : Math.max(0, limit - (session.turnCount ?? 0));
}

function stopOutcome(mission, session, decision, denial) {
	const trace = recordDecisionTrace({
		missionId: mission.id,
		iteration: mission.currentIteration ?? 0,
		state: `session:${session.status}`,
		signals: decision.factors ?? {},
		candidateAction: decision.decision,
		selectedAction: 'stop',
		reason: `Budget authority DENIED revalidation (${denial}) — stopping within authorized budget.`,
		budgetBefore: turnsRemaining(session) ?? -1,
		budgetRequested: 1,
		budgetGranted: 0,
		result: 'denied_and_stopped',
		nextDecision: 'final'
	});
	return {
		action: { shouldStop: true, stopReason: 'budget_exhausted', reason: denial },
		decision,
		trace
	};
}

/**
 * One autonomy decision. Read-only w.r.t. the mission envelope; returns the
 * outcome so the caller (a finalize path) knows whether to proceed or defer.
 *
 * @returns {Promise<{action, decision, trace}|null>} null = fail-open to the
 *   legacy finalization path (autonomy off, engine unavailable, etc.).
 */
export async function runAutonomyDecision({ mission, session, evidence = {} }) {
	if (!missionAutonomyEnabled(mission)) return null;
	if (!mission || !session) return null;

	// Idempotency: one decision per settled session per process run.
	if (session._autonomyDecisionAt) return null;

	const settled = ['done', 'idle', 'error', 'interrupted'].includes(session.status);
	if (!settled) return null;

	session._autonomyDecisionAt = Date.now();

	try {
		// 1. The decision engine consumes the REAL session state (read-only).
		//    C3: a mid-session probe hint REPLAN focus payload is adopted when
		//    the settle decision is REPLAN and the settle decision itself
		//    carries no payload (the probe saw the live state at turn K; the
		//    payload is only a hint — every guard still applies below).
		const decision = makeDecisionSafe(session, evidence, mission);
		if (!decision || !Object.values(DECISION_TYPES).includes(decision.decision)) {
			return null; // unknown type — fail-open to old path
		}
		if (decision.decision === DECISION_TYPES.REPLAN && !decision.focusPayload && session._probeHint?.focusPayload) {
			decision.focusPayload = session._probeHint.focusPayload;
		}

		// 2. resolveAction turns the decision into a concrete action with its
		//    own guard rails (iteration limit, no-improvement).
		const candidate = decision.decision;
		const action = resolveAction(candidate, mission);
		// C2: the engine's REPLAN decision carries the focus payload built
		// from the session's own coverage state — prefer it over the generic
		// derivation (resolveAction only sees the mission envelope).
		if (candidate === DECISION_TYPES.REPLAN && decision.focusPayload) {
			action.focusPayload = decision.focusPayload;
		}

		// 3. Budget authority. The engine may REQUEST more execution; only the
		//    externally-authorized budget answers. A request beyond what the
		//    mission already has is DENIED and downgraded to a stop.
		const remaining = turnsRemaining(session);
		const budgetBefore = remaining == null ? -1 : remaining;
		const requested = action.shouldRevalidate ? 1 : 0;
		let granted = 0;
		let denial = null;

		if (action.shouldRevalidate) {
			if (remaining != null && remaining <= 0) {
				denial = 'turn budget exhausted';
			} else if (hasReachedIterationLimit(mission) || hasNoImprovement(mission)) {
				denial = 'iteration guard refused';
			} else if (typeof hooks.dispatchRevalidation !== 'function') {
				denial = 'dispatch hook unavailable';
			} else {
				// PERMISSION ONLY — the handler re-checks every guard and the
				// new iteration runs under the mission's existing maxTurns.
				let accepted = false;
				try {
					accepted = await hooks.dispatchRevalidation(mission.id, {
						internal: true,
						// C2: focus mode/payload steer the new iteration's
						// prompt (investigate = verify findings; replan =
						// redirect coverage). Execution mechanics unchanged.
						focusMode: action.focusMode ?? null,
						focusPayload: action.focusPayload ?? null
					});
				} catch {
					accepted = false;
				}
				granted = accepted ? 1 : 0;
				if (!accepted) denial = 'guarded handler refused';
			}
		}

		if (denial) {
			return stopOutcome(mission, session, decision, denial);
		}

		const selectedAction = action.action === 'none' ? candidate : action.action;
		const trace = recordDecisionTrace({
			missionId: mission.id,
			iteration: mission.currentIteration ?? 0,
			state: `session:${session.status}`,
			signals: decision.factors ?? {},
			candidateAction: candidate,
			selectedAction,
			reason: action.reason ?? decision.reason ?? '',
			budgetBefore,
			budgetRequested: requested,
			budgetGranted: granted,
			result: granted
				? (action.focusMode === 'replan' ? 'replan_dispatched'
					: action.focusMode === 'investigate' ? 'investigate_dispatched'
					: 'revalidation_dispatched')
				: 'selected',
			nextDecision: granted
				? (action.focusMode === 'replan' ? 'next_iteration_replan'
					: action.focusMode === 'investigate' ? 'next_iteration_investigate'
					: 'next_iteration')
				: 'final'
		});

		return { action, decision, trace };
	} catch (error) {
		console.error(`[autonomy] decision failed: ${error?.message ?? error} — fail-open`);
		return null;
	}
}

/**
 * Synchronous facade for finalize paths that cannot await. Runs the decision
 * engine + budget authority; a granted REVALIDATE is dispatched via the
 * registered hook (fire-and-forget). The caller finalizes normally unless
 * the outcome is a REVALIDATE that was accepted ('deferred') — in which case
 * finalization is deferred to the new iteration's own settle path.
 *
 * @returns {{action, decision, trace, deferred: boolean}|null}
 */
export function runAutonomyDecisionSync(mission, session, evidence = {}) {
	if (!missionAutonomyEnabled(mission)) return null;
	if (!mission || !session) return null;
	if (session._autonomyDecisionAt) return null;
	if (!['done', 'idle', 'error', 'interrupted'].includes(session.status)) return null;

	// The synchronous facade defers to the async engine via a promise-driven
	// bridge: the decision is computed synchronously where possible, and a
	// granted dispatch is executed via the hook's fire-and-forget wrapper.
	return computeSyncDecision(mission, session, evidence);
}

function computeSyncDecision(mission, session, evidence) {
	const decision = makeDecisionSafe(session, evidence, mission);
	if (!decision || !Object.values(DECISION_TYPES).includes(decision.decision)) return null;
	session._autonomyDecisionAt = session._autonomyDecisionAt ?? Date.now();

	const action = resolveAction(decision.decision, mission);
	const remaining = turnsRemaining(session);
	let granted = 0;
	let denial = null;

	if (action.shouldRevalidate) {
		if (remaining != null && remaining <= 0) {
			denial = 'turn budget exhausted';
		} else if (hasReachedIterationLimit(mission) || hasNoImprovement(mission)) {
			denial = 'iteration guard refused';
		} else if (typeof hooks.dispatchRevalidation !== 'function') {
			denial = 'dispatch hook unavailable';
		} else {
			// Fire-and-forget internal dispatch through the guarded handler.
			// If the handler refuses, the mission finalizes normally on its
			// own settle path (the handler records its refusal).
			hooks.dispatchRevalidation(mission.id, { internal: true })
				.then(accepted => {
					if (accepted) {
						console.log(`[autonomy] mission ${mission.id}: decision ${decision.decision} -> revalidation iteration dispatched (guarded handler accepted)`);
					} else {
						console.log(`[autonomy] mission ${mission.id}: revalidation refused by guarded handler — finalizing normally`);
						session._autonomyFinalized = true;
						if (typeof hooks.finalizeFallback === 'function') {
							hooks.finalizeFallback(mission, session);
						}
					}
				})
				.catch(err => {
					console.error(`[autonomy] revalidation dispatch failed: ${err?.message ?? err} — finalizing normally`);
					session._autonomyFinalized = true;
					if (typeof hooks.finalizeFallback === 'function') {
						hooks.finalizeFallback(mission, session);
					}
				});
			granted = 1; // permission to use the mission's EXISTING authorization
		}
	}

	if (denial) {
		return stopOutcome(mission, session, decision, denial);
	}

	const selectedAction = action.action === 'none' ? decision.decision : action.action;
	const trace = recordDecisionTrace({
		missionId: mission.id,
		iteration: mission.currentIteration ?? 0,
		state: `session:${session.status}`,
		signals: decision.factors ?? {},
		candidateAction: decision.decision,
		selectedAction,
		reason: action.reason ?? decision.reason ?? '',
		budgetBefore: remaining == null ? -1 : remaining,
		budgetRequested: action.shouldRevalidate ? 1 : 0,
		budgetGranted: granted,
		result: granted ? 'revalidation_dispatched' : 'selected',
		nextDecision: granted ? 'next_iteration' : 'final'
	});

	return { action, decision, trace, deferred: granted === 1 };
}

/**
 * The autonomy gate every finalization path passes through. index.js keeps
 * its inline copy for the degraded paths; capabilities.js reaches this via
 * its own registered hook so the happy path (finish_qa_report ->
 * mission_finalize) also decides before the terminal write.
 *
 * @returns {'proceed'|'deferred'} 'deferred' = a new iteration took over.
 */
export function autonomyGateSync(mission, session) {
	if (!missionAutonomyEnabled(mission) || !mission || !session) return 'proceed';
	if (session._autonomyFinalized) return 'proceed';

	const outcome = computeSyncDecision(mission, session, {});
	if (!outcome) return 'proceed';

	const { action, deferred } = outcome;

	if (deferred) return 'deferred';

	if (action.shouldStop && action.stopReason) {
		// The iteration record + quality scoring still happen in the normal
		// path; the STOP only pins the stopReason (never fabricates a pass —
		// failed/blocked routes to status 'failed').
		session._autonomyStop = { stopReason: action.stopReason, reason: action.reason };
	}

	return 'proceed';
}

/**
 * Test/introspection helper — resets the one-decision-per-session stamp.
 */
export function resetAutonomyStampForTesting(session) {
	delete session._autonomyDecisionAt;
}
