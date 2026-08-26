/**
 * BUILD B2 — autonomy bridge for the capabilities pipeline.
 *
 * The happy path (agent files its QA report → autonomy pipeline →
 * mission_finalize capability) previously finalized the mission DIRECTLY,
 * bypassing the B2 autonomy gate. index.js registers the real gate here at
 * boot; capabilities.js calls autonomyGateForCapabilities() before its
 * terminal write. If no gate is registered (tests that import capabilities
 * without the server), the bridge is a no-op pass-through — old behavior.
 *
 * Budget asymmetry is preserved: the gate never grants turns; a granted
 * REVALIDATE dispatches through the shared guarded handler and finalization
 * is deferred to the new iteration's own settle path.
 */

let registeredGate = null;
let registeredSessionLookup = null;

export function registerCapabilitiesAutonomyGate({ gate, getSession }) {
	registeredGate = gate;
	registeredSessionLookup = getSession;
}

/**
 * @returns {Promise<'proceed'|'deferred'>} 'deferred' = a revalidation
 *   iteration took over; the caller must NOT write the terminal state.
 */
export async function autonomyGateForCapabilities(session) {
	if (typeof registeredGate !== 'function') return 'proceed';
	try {
		const mission = (await import('./missions.js')).listMissions({})
			.find(m => m.sessionId === session.id && m.status === 'running');
		if (!mission) return 'proceed'; // no running mission to gate
		const settledSession = typeof registeredSessionLookup === 'function'
			? registeredSessionLookup(session.id)
			: session;
		const outcome = await registeredGate(mission, settledSession ?? session);
		return outcome === 'deferred' ? 'deferred' : 'proceed';
	} catch (error) {
		// Fail-open: autonomy must never break finalization.
		console.error(`[autonomy] capabilities gate failed: ${error?.message ?? error} — proceeding`);
		return 'proceed';
	}
}
