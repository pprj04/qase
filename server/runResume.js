/**
 * Boot-time run recovery.
 *
 * When the process dies mid-run (container pause/restart) the run store marks
 * the session `interrupted` with `interruptedFromRun: true`. On boot, any such
 * run whose agent snapshot was persisted (see server/agent.js) is restored
 * into a fresh runtime and driven forward with a recovery instruction, so the
 * run completes instead of being stranded.
 *
 * Everything here is defensive by design: recovery must NEVER crash the boot,
 * must never resume a run more than a bounded number of times, and must always
 * run inside the original owner's actor context.
 */

const MAX_AUTO_RESUME_ATTEMPTS = 3;

/** Default dependency bundle for createRunResume(). */
const defaults = () => ({
	logger: {
		info: () => {},
		warn: () => {}
	},
	attemptDelayMs: 0,
	withRequestActor: actor => work => work(),
	loadSnapshot: () => null
});

/**
 * Factory so tests can inject a logger, actor runner, snapshot loader, and a
 * small attempt delay without touching timers or the filesystem.
 *
 * @param {object} overrides
 * @returns {{ isResumable, recoveryInstruction, resumeAll }}
 */
export function createRunResume(overrides = {}) {
	const deps = { ...defaults(), ...overrides };
	const { logger, attemptDelayMs, withRequestActor, loadSnapshot } = deps;

	/**
	 * A run is resumable only if it was actively running when the process died
	 * and has not exhausted its auto-resume budget or already reached a
	 * terminal/published state.
	 */
	function isResumable(session) {
		if (!session || typeof session !== 'object') return false;
		if (session.interruptedFromRun !== true) return false;
		if (session.status !== 'interrupted') return false;
		if ((session.autoResumeCount ?? 0) >= MAX_AUTO_RESUME_ATTEMPTS) return false;
		if (session.report?.publishedAt) return false;
		if (session.mode === 'sqa' && session.sqa?.finalizedAt) return false;
		if (session.mode === 'founder' && session.founder?.finalizedAt) return false;
		return true;
	}

	/**
	 * The instruction handed to the agent for the recovery turn. It points the
	 * agent at the original target, forbids repeating completed/irreversible
	 * steps, and directs it to finish and publish the final report.
	 */
	function recoveryInstruction(session) {
		const targetUrl = session?.targetUrl || '(unknown target)';
		return [
			`Your run was interrupted by a server restart. Target: ${targetUrl}`,
			'Do not repeat completed or irreversible steps.',
			'Continue from where your prior progress left off, verify remaining items, then publish the final report.'
		].join(' ');
	}

	/**
	 * Scan persisted run snapshots, pick the most recent resumable candidate,
	 * restore its snapshot into a fresh runtime, and run exactly one recovery
	 * turn inside the owner's actor context. All failures are swallowed and
	 * logged — boot must continue regardless.
	 *
	 * @param {object} api host services: listSnapshots, get, ensureRuntime,
	 *   runTurn, addMessage, setStatus
	 * @returns {Promise<number>} how many runs were resumed (0 or 1)
	 */
	async function resumeAll(api) {
		let snapshots;
		try {
			snapshots = await api.listSnapshots();
		} catch (error) {
			logger.warn?.('runresume.list_failed', { error: String(error) });
			return 0;
		}
		if (!Array.isArray(snapshots) || snapshots.length === 0) return 0;

		const candidates = [...snapshots]
			.filter(s => s && typeof s.sessionId === 'string')
			.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

		for (const candidate of candidates) {
			// Capped candidates get one explanatory system message, once.
			const session = await api.get(candidate.sessionId).catch(() => null);
			if (session && session.status === 'interrupted' && session.interruptedFromRun === true
				&& (session.autoResumeCount ?? 0) >= MAX_AUTO_RESUME_ATTEMPTS
				&& !session.autoResumeCapNoted) {
				try {
					await api.addMessage(session, {
						role: 'system',
						text: `Auto-resume stopped after 3 attempts. Resume manually if this run is still needed.`
					});
					session.autoResumeCapNoted = true;
				} catch {
					// Messaging a capped session is best-effort.
				}
			}

			if (!isResumable(session)) continue;

			const snapshot = await Promise.resolve()
				.then(() => loadSnapshot(candidate.sessionId))
				.catch(() => null);
			if (!snapshot) {
				logger.info?.('runresume.skipped_no_snapshot', { runId: candidate.sessionId });
				continue;
			}

			const { runtime } = await api.ensureRuntime(session).catch(error => {
				logger.warn?.('runresume.runtime_failed', { runId: candidate.sessionId, error: String(error) });
				return {};
			}) || {};
			if (!runtime || typeof runtime.restoreSessionSnapshot !== 'function') {
				logger.info?.('runresume.skipped_no_restore', { runId: candidate.sessionId });
				continue;
			}

			try {
				runtime.restoreSessionSnapshot(snapshot);
			} catch (error) {
				logger.warn?.('runresume.restore_failed', { runId: candidate.sessionId, error: String(error) });
				continue;
			}

			// Exactly one recovery turn, inside the owner's actor context so
			// per-user model configuration, memory, and ownership resolve.
			session.autoResumeCount = (session.autoResumeCount ?? 0) + 1;
			session.interruptedFromRun = false;
			await withRequestActor({ actorUserId: candidate.ownerUserId })(async () => {
				await api.runTurn(session, {
					task: recoveryInstruction(session),
					recovery: true,
					...(attemptDelayMs ? { attemptDelayMs } : {})
				});
			});
			logger.info?.('runresume.resumed', { runId: session.id });
			return 1;
		}
		return 0;
	}

	return { isResumable, recoveryInstruction, resumeAll };
}
