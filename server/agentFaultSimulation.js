/**
 * Deterministic reproduction of the stuck-run failure modes (#10638).
 *
 * The QA interface has no way to make a real provider stall on demand, so the
 * two failure modes this ticket guards against — an unresponsive runtime that
 * will not shut down, and the runtime-reuse block that keeps a quarantined
 * runtime from being retried — could not be demonstrated or verified by
 * review. This module provides that demonstration with a controlled, inert
 * runtime: no model call is made, no browser is opened, nothing external is
 * touched.
 *
 * Both modes end in the same user-visible surface as a real incident:
 * an actionable error message on the session plus status `error`, and a
 * follow-up turn on the same run rejected by the reuse block.
 */

const TEST_COMMAND = '/qase-test';
export const AGENT_FAULT_USAGE = `${TEST_COMMAND} <unresponsive-runtime | runtime-reuse-block>`;
const SUBCOMMANDS = new Set(['unresponsive-runtime', 'runtime-reuse-block']);

/** Extracts a ${'`'}/qase-test${'`'} subcommand from a chat message, if present. */
export function parseAgentFaultCommand(text) {
	if (typeof text !== 'string') return undefined;
	const match = text.match(/\/qase-test(?:\s+([a-z0-9-]+))?/i);
	if (!match) return undefined;
	return match[1]?.toLowerCase();
}

/** The exact error a run surfaces when its runtime stops responding (#10638). */
export function unresponsiveRuntimeError() {
	return Object.assign(
		new Error('The agent stopped responding and could not shut down safely. Start a new run to continue; automatic retry was stopped to avoid repeating actions.'),
		{ code: 'QASE_STREAM_UNRESPONSIVE' }
	);
}

/**
 * Applies one fault to the session's live record through the run store.
 * Returns an explanation of what was done, or undefined when the requested
 * subcommand does not exist.
 */
export async function applyAgentFault(session, subcommand, runStore) {
	if (!SUBCOMMANDS.has(subcommand)) return undefined;
	const record = runStore?.liveFor?.(session.id) ?? runStore?.peekLive?.(session.id);	switch (subcommand) {
		case 'unresponsive-runtime':
			// The live path an incident takes: progressStream exhausts its 5-second
			// shutdown threshold, agent.js quarantines the runtime, and the turn
			// ends with the actionable error + status error.
			record.unresponsive = true;
			await runStore.addMessage(session, { role: 'system', text: unresponsiveRuntimeError().message, kind: 'error' });
			await runStore.setStatus(session, 'error', unresponsiveRuntimeError().message);
			return 'Simulated an unresponsive runtime: the run is marked failed with the actionable error and the runtime is quarantined. Send another message to see the runtime-reuse block.';
		case 'runtime-reuse-block':
			// Same quarantine without touching the transcript, so the block itself
			// can be observed in isolation on a clean-looking run.
			record.unresponsive = true;
			return 'Simulated the runtime-reuse block: this runtime is quarantined. The next turn on this run will be rejected. Send any message to see the rejection.';
		default:
			return undefined;
	}
}
