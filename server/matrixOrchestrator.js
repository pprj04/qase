/**
 * Matrix run orchestrator (2027.03.0, #14633 NI02 Phase 1).
 *
 * Drives an existing matrix run: for each PENDING item, launch the standard
 * session machinery (the same path POST /api/sessions + message uses), tag the
 * session with matrixRunId, and record honest per-item outcomes. Sequential
 * execution — the local agent's closeOtherBrowsers makes one-browser-at-a-time
 * the de-facto contract; distributed mode can later drain items via the
 * execution queue instead.
 */

import { BROWSER_SUPPORT_STATUS, resolveBrowserSupport } from './browserSupportResolution.js';
import { checkEnvironmentHealth } from './environmentHealth.js';
import { fixtureExpectation } from './defectFixtures.js';

// Concurrency is runtime-configured (see configuredParallelism at the bottom);
// local mode keeps one browser at a time (closeOtherBrowsers contract).

/**
 * @param {object} services { runs, agent, matrix, deviceRuntime }
 * @param {object} hooks { startSession(session, matrixRun, item) -> Promise<session>,
 *                         sendTask(session, matrixRun) -> Promise<void>,
 *                         emit(matrixRunId, payload) }
 */
export function createMatrixOrchestrator(services, hooks) {
	const running = new Map(); // matrixRunId -> in-flight execution promise
	const cancelledRuns = new Set(); // #15043 (B1): cancel flags per run
	const MAX_MATRIX_CONCURRENT = 2; // a second run may prepare while one executes
	// Stale-run sweep: any run left `running` by a dead process (container
	// restart, crash) is transitioned to error before this orchestrator runs.
	// Same logic as the boot-time resumeRecovery() — both entry points use it.
	async function sweepStaleRuns() {
		await resumeRecovery().catch((error) => {
			console.error('[matrix] stale-run sweep failed', error);
		});
	}

	/**
	 * Start a matrix run: PENDING items execute; NOT_RUN / NOT_SUPPORTED /
	 * UNAVAILABLE / BLOCKED items keep their honest state — they NEVER launch.
	 */
	function start(matrixRunId, options = {}) {
		if (running.has(matrixRunId)) {
			return { ok: false, error: `Matrix run ${matrixRunId} is already running.` };
		}
		const execution = executeRun(matrixRunId, options).catch((error) => {
			// Never leave an in-flight item as PASS-ready or dangling RUNNING.
			console.error('[matrix] orchestration failure', matrixRunId, error);
		}).finally(() => running.delete(matrixRunId));
		running.set(matrixRunId, execution);
		return { ok: true };
	}

	/** Resume-scan: see resumeRecovery below. Exposed for boot wiring. */
	function startResumeRecovery() {
		return resumeRecovery().catch((error) => {
			console.error('[matrix] resume recovery failed', error);
		});
	}

	/**
	 * #14633 (NI02 Phase 1) resume scan: a container restart kills in-flight
	 * orchestration. Any matrix run left in `running` state — or any item left
	 * RUNNING — is marked ERROR "interrupted" so no dangling state can be
	 * mistaken for a live execution or a pass. Idempotent; call once on boot
	 * (or after attach) before any new matrix run starts.
	 */
	async function resumeRecovery() {
		const runs = await services.matrix.list();
		for (const run of runs ?? []) {
			// #15043 (B1): a cancelled run keeps its cancelled state across
			// restarts — never flipped to error.
			if (run.status === 'running') {
				await services.matrix._setStatus(run.id, 'error', {});
			}
			const interrupted = (run.items ?? []).filter((item) => item.status === 'RUNNING');
			if (!interrupted.length && run.status !== 'running') continue;
			for (const item of interrupted) {
				await services.matrix.updateItem(run.id, item.id, {
					status: 'ERROR',
					error: 'Interrupted — the server restarted before this profile finished.',
					finishedAt: new Date().toISOString(),
					durationMs: null
				});
			}
		}
	}

	function isActive(matrixRunId) {
		return running.has(matrixRunId);
	}

	/**
	 * #15043 (B1): cancel a running (or pending) run. Queued/pending items are
	 * immediately CANCELLED; an in-flight item finishes its current turn and
	 * keeps its honest outcome. Safe to call when not running.
	 */
	async function cancel(matrixRunId) {
		cancelledRuns.add(matrixRunId);
		try {
			const result = await services.matrix.cancel(matrixRunId, {});
			hooks.emit?.(matrixRunId, { type: 'matrix_run_cancelled', matrixRunId, cancelled: result.cancelled });
			return result;
		} catch (error) {
			console.error('[matrix] cancel failed', matrixRunId, error);
			return { run: null, cancelled: 0 };
		}
	}

	/**
	 * #15043 (B1): retry a single terminal item (FAILED/ERROR/BLOCKED/CANCELLED).
	 * Bounded at MAX_ITEM_RETRIES; the previous verdict is cleared so a fresh
	 * outcome must arrive from a real execution.
	 */
	async function retryItem(matrixRunId, itemId) {
		const run = await services.matrix.get(matrixRunId);
		if (!run) return { ok: false, error: `Unknown matrix run "${matrixRunId}".` };
		const item = (run.items ?? []).find((candidate) => candidate.id === itemId);
		if (!item) return { ok: false, error: `Unknown matrix item "${itemId}".` };
		if (!['FAILED', 'ERROR', 'BLOCKED', 'CANCELLED'].includes(item.status)) {
			return { ok: false, error: `Item is ${item.status}; only failed/error/blocked/cancelled items can be retried.` };
		}
		if ((item.retryCount ?? 0) >= MAX_ITEM_RETRIES) {
			return { ok: false, error: `Retry limit reached (${MAX_ITEM_RETRIES}).` };
		}
		await services.matrix.updateItem(matrixRunId, itemId, {
			status: 'QUEUED',
			reason: null,
			error: null,
			sessionId: null,
			verdict: null,
			findings: [],
			artifactRefs: [],
			startedAt: null,
			finishedAt: null,
			durationMs: null,
			retryCount: (item.retryCount ?? 0) + 1
		});
		// Re-kick execution if the run is not already running; if it is, the
		// worker pool picks the queued item up on its next loop.
		if (!running.has(matrixRunId) && run.status !== 'running') {
			cancelledRuns.delete(matrixRunId);
			start(matrixRunId);
		}
		hooks.emit?.(matrixRunId, { type: 'matrix_item', itemId, ordinal: item.ordinal, status: 'QUEUED' });
		return { ok: true };
	}

	async function executeRun(matrixRunId) {
		// #14649: sweep runs a previous process left `running` (container
		// restart mid-flight) so this run cannot collide with zombie state.
		await sweepStaleRuns();
		const run = await services.matrix.get(matrixRunId);
		if (!run) throw new Error(`Unknown matrix run "${matrixRunId}"`);
		if (run.status === 'running') {
			throw new Error(`Matrix run ${matrixRunId} is already running.`);
		}
		await services.matrix._setStatus(matrixRunId, 'running', { startedAt: run.startedAt ?? new Date().toISOString() });
		hooks.emit?.(matrixRunId, { type: 'matrix_run_started', matrixRunId });

		// #15043 (B1): PENDING items become QUEUED (explicitly scheduled); the
		// worker pool then claims QUEUED items. Honest pre-terminal states
		// (NOT_RUN / NOT_SUPPORTED / UNAVAILABLE / BLOCKED / CANCELLED / ERROR)
		// NEVER launch.
		const schedulable = run.items.filter((item) => item.status === 'PENDING' || item.status === 'QUEUED');
		for (const item of schedulable) {
			if (item.status === 'PENDING') {
				await services.matrix.updateItem(matrixRunId, item.id, { status: 'QUEUED' });
			}
		}
		await drainQueued(matrixRunId, run);

		const finalRun = await services.matrix.get(matrixRunId);
		const counts = statusCounts(finalRun.items);
		if (cancelledRuns.has(matrixRunId) || finalRun.status === 'cancelled') {
			// cancel() already set status/timing; just announce completion.
			// (Keep the cancellation marker until the run fully settles.)
			hooks.emit?.(matrixRunId, { type: 'matrix_run_done', matrixRunId, counts, cancelled: true });
			return;
		}
		await services.matrix._setStatus(matrixRunId, 'done', { finishedAt: new Date().toISOString(), counts });
		hooks.emit?.(matrixRunId, { type: 'matrix_run_done', matrixRunId, counts });
	}

	/** Worker pool over QUEUED items; cancellation stops claiming new work. */
	async function drainQueued(matrixRunId, run) {
		const claim = async () => {
			const current = await services.matrix.get(matrixRunId);
			const next = (current.items ?? []).find(
				(item) => item.status === 'QUEUED' && !claimed.has(item.id)
			);
			if (!next) return null;
			claimed.add(next.id);
			return next;
		};
		const claimed = new Set();
		const worker = async () => {
			for (;;) {
				if (cancelledRuns.has(matrixRunId)) return;
				const item = await claim();
				if (!item) return;
				await executeItem(run, item);
			}
		};
		await Promise.all(
			Array.from({ length: Math.max(1, Math.min(configuredParallelism(), 16)) }, () => worker())
		);
	}

	async function executeItem(run, item) {
		const startedAt = new Date().toISOString();
		const mark = async (patch) => {
			await services.matrix.updateItem(run.id, item.id, {
				...patch,
				updatedAt: new Date().toISOString()
			});
			hooks.emit?.(run.id, { type: 'matrix_item', itemId: item.id, ordinal: item.ordinal, status: patch.status ?? item.status });
		};

		try {
			// Capability gate re-resolved at execution time — credentials may
			// have changed since creation. Falls back to the frozen
			// creation-time verdict (item.browserSupport) when present.
			const support = await resolveBrowserSupport(item.platform, item.browserCode);
			if (support.status === BROWSER_SUPPORT_STATUS.NOT_SUPPORTED
				|| item.browserSupport?.status === BROWSER_SUPPORT_STATUS.NOT_SUPPORTED) {
				await mark({ status: 'NOT_SUPPORTED', reason: support.reason ?? item.browserSupport?.reason, finishedAt: startedAt });
				return;
			}
			// RT2 (#14704): pre-execution health gate. REAL probes (engine
			// launch, network, emulation) run before any session starts; a
			// failed check blocks the item with the exact reason — never
			// launched, never Passed.
			if (hooks.checkEnvironmentHealth) {
				const environment = await (services.environments?.get?.(item.environmentId) ?? null);
				const health = await hooks.checkEnvironmentHealth(environment ?? item, { targetUrl: run.targetUrl ?? null });
				if (health?.verdict === 'BLOCKED') {
					await mark({
						status: 'UNAVAILABLE',
						reason: `Health check blocked execution: ${health.reason}`,
						healthChecks: health.checks,
						finishedAt: new Date().toISOString(),
						durationMs: 0
					});
					return;
				}
			}
			// REAL_DEVICE / VIRTUAL_DEVICE requests without a configured remote
			// runtime BLOCK — the existing agent path enforces this; the item
			// records the honest outcome rather than emulating silently.
			await mark({ status: 'RUNNING', startedAt });

			const session = await hooks.startSession(run, item);
			await mark({ sessionId: session.id });

			await hooks.sendTask(session, run);

			// Poll until the session reaches a terminal state (the agent turn is
			// fire-and-forget inside startTurn). Timeout → ERROR, other items run.
			const outcome = await waitForSession(session.id, options => options);
			const finishedAt = new Date().toISOString();
			const durationMs = Date.now() - Date.parse(startedAt);

			if (outcome.status === 'error' || outcome.status === 'interrupted') {
				await mark({ status: 'ERROR', error: outcome.detail ?? outcome.status, finishedAt, durationMs });
				return;
			}
			if (outcome.status === 'awaiting_input') {
				// The workflow paused for a human answer — it did not finish, so
				// the honest state is BLOCKED (needs input), never PASSED.
				await mark({
					status: 'BLOCKED',
					error: 'Session paused awaiting user input — matrix items run unattended.',
					finishedAt, durationMs
				});
				return;
			}
			const verdict = outcome.report?.verdict ?? null;
			const status = verdict === 'pass' ? 'PASSED'
				: verdict === 'pass_with_issues' ? 'PASSED'
				: verdict === 'fail' ? 'FAILED'
				: verdict === 'blocked' ? 'BLOCKED'
				: outcome.status === 'done' ? 'PASSED' : null;
			if (!status) {
				await mark({ status: 'ERROR', error: `Unexpected session state "${outcome.status}" without report verdict.`, finishedAt, durationMs });
				return;
			}
			// #14650 (NI02 Phase 2): evidence per profile — runner identity,
			// execution level actually used (never the requested one), and
			// artifact refs (screenshots/videos the session actually produced).
			// Missing artifacts stay absent — never fabricated.
			const artifacts = hooks.collectArtifacts
				? (await hooks.collectArtifacts(session, item).catch(() => []))
				: [];
			// #14650 (NI02 Phase 2): known-defect fixture verification per
			// profile. The shared workflow runs first; fixtures are then
			// probed under this profile's own emulated context. NOT_VERIFIED
			// when the probe cannot run — never a guess, never fabricated.
			let fixtureVerdicts = [];
			if (Array.isArray(hooks.verifyFixtures) && hooks.verifyFixtures.length > 0) {
				const environment = await hooks.resolveEnvironment(item);
				fixtureVerdicts = await Promise.all(hooks.verifyFixtures.map(async (fixture) => {
					const verdict = await hooks.runFixtureVerification({ fixture, environment });
					return {
						fixtureId: fixture.id,
						// `expected` prefers the verdict's own resolution (the
						// app wiring resolves the FULL fixture — with its
						// predicate — there); falls back to the summary-level
						// expectation when the hook did not provide one.
						expected: verdict.expected ?? fixtureExpectation(fixture, environment),
						...verdict
					};
				}));
			}
			await mark({
				status,
				verdict,
				finishedAt,
				durationMs,
				executionLevel: outcome.runtimeFacts?.executionLevel ?? outcome.executionLevel ?? null,
				executionProvider: outcome.runtimeFacts?.provider ?? outcome.executionProviderActual ?? null,
				fixtureVerdicts,
				runtimeFacts: outcome.runtimeFacts ? {
					userAgent: outcome.runtimeFacts.userAgent ?? null,
					viewport: outcome.runtimeFacts.viewport ?? null,
					devicePixelRatio: outcome.runtimeFacts.devicePixelRatio ?? null,
					executionLevel: outcome.runtimeFacts.executionLevel ?? null,
					provider: outcome.runtimeFacts.provider ?? null
				} : null,
				artifactRefs: artifacts.map((meta) => ({
					artifactId: meta.artifactId,
					type: meta.type,
					contentType: meta.contentType,
					bytes: meta.bytes,
					capturedAt: meta.capturedAt,
					label: meta.label ?? null
				})),
				findings: (outcome.findings ?? []).map((finding) => ({
					title: finding.title,
					severity: finding.severity,
					category: finding.category,
					url: finding.url ?? finding.pageUrl ?? null,
					expected: finding.expected ?? null,
					actual: finding.actual ?? null,
					// RT5 (#14757): the EXACT environment the finding occurred
					// on — runtime-detected identity, not the catalog label.
					environment: {
						profileId: item.profileId,
						device: item.device,
						os: item.os,
						osVersion: item.osVersion,
						browser: item.browser,
						browserVersion: item.browserVersion,
						// Runtime-detected truth when present (the launched
						// engine/brand + observed UA); falls back to the
						// item-level execution facts.
						executionLevel: outcome.runtimeFacts?.executionLevel ?? item.executionLevel ?? null,
						executionProvider: outcome.runtimeFacts?.provider ?? item.executionProvider ?? null,
						launchedEngine: outcome.runtimeFacts?.launchedEngineId ?? null,
						userAgent: outcome.runtimeFacts?.userAgent ?? null,
						viewport: outcome.runtimeFacts?.viewport ?? null,
						brandedBinary: outcome.runtimeFacts?.brandedBinary ?? null
					},
					sessionId: session.id,
					matrixRunId: run.id
				}))
			});
		} catch (error) {
			const finishedAt = new Date().toISOString();
			const message = error?.code === 'RUNTIME_UNAVAILABLE'
				? `Blocked: ${error.message}`
				: (error instanceof Error ? error.message : String(error));
			const status = error?.code === 'RUNTIME_UNAVAILABLE' ? 'BLOCKED' : 'ERROR';
			await mark({ status, error: message, finishedAt, durationMs: Date.now() - Date.parse(startedAt) });
		}
	}

	/** Poll the run store until the session is terminal (or timeout → throws). */
	async function waitForSession(sessionId, _ignored) {
		const deadline = Date.now() + MAX_ITEM_MS;
		for (;;) {
			const session = await services.runs.get(sessionId);
			if (!session) throw new Error(`Session ${sessionId} disappeared during matrix run.`);
			if (['done', 'error', 'interrupted', 'awaiting_input'].includes(session.status)) {
				return session;
			}
			if (Date.now() > deadline) {
				throw Object.assign(new Error(`Matrix item timed out after ${Math.round(MAX_ITEM_MS / 1000)}s.`), { code: 'MATRIX_ITEM_TIMEOUT' });
			}
			await sleep(POLL_INTERVAL_MS);
		}
	}

	return { start, cancel, retryItem, isActive, resumeRecovery: startResumeRecovery };
}

const MAX_ITEM_RETRIES = 2;

const POLL_INTERVAL_MS = 2000;
const MAX_ITEM_MS = 8 * 60 * 1000;

// #14649: concurrency is configurable (env), clamped to a sane range. Local
// mode runs one browser at a time (closeOtherBrowsers), so the default stays
// sequential; distributed mode may raise it.
function configuredParallelism() {
	const raw = Number(process.env.QASE_MATRIX_PARALLEL ?? 1);
	if (!Number.isFinite(raw)) return 1;
	return Math.min(4, Math.max(1, Math.floor(raw)));
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function statusCounts(items) {
	const counts = { PASSED: 0, FAILED: 0, NOT_RUN: 0, UNAVAILABLE: 0, NOT_SUPPORTED: 0, BLOCKED: 0, ERROR: 0, PENDING: 0, RUNNING: 0, QUEUED: 0, CANCELLED: 0 };
	for (const item of items ?? []) {
		if (counts[item.status] !== undefined) counts[item.status] += 1;
	}
	return counts;
}
