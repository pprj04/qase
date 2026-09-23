import { closeBrowser, ensureRuntime, runTurn } from './agent.js';
import { getPublicConfig, saveConfig, testConnection, withUserConfiguration } from './config.js';
import { buildReportMarkdown } from './report.js';
import { clearSecrets, secretNames, storeSecrets } from './secrets.js';
import {
	addActivity, addMessage, bus, createSession, deleteSession, emit, getSession,
	dropLive, flushSessions, listSessions, liveEntries, liveFor, loadSessions, markExecutionStarted,
	markReportPhase, peekLive, setStatus, updateActivity, watchRunBus
} from './store.js';
import { purgeRunWorkspace } from './workspaceLifecycle.js';
import { createLocalAuthService } from './auth.js';
import { currentRequestActor } from './requestActor.js';

/**
 * Builds the non-persistence services around a run store. Both the rollback
 * file adapter and PostgreSQL adapter use this composition so the agent cannot
 * accidentally bypass the selected durable store. Authentication is injected
 * as a peer service so account data never enters the run aggregate.
 */
export function createRuntimeApplicationServices(runStore, options = {}) {
	async function inWorkspace(work, session) {
		const userId = session?.ownerUserId ?? currentRequestActor()?.actorUserId;
		if (!userId || !options.auth?.getSettings) return work();
		const settings = await options.auth.getSettings(userId);
		if (session) session.userMemory = await options.auth.listMemory(userId);
		return withUserConfiguration(settings, next => options.auth.saveSettings(userId, next), work);
	}
	const purgeWorkspace = options.purgeRunWorkspace ?? purgeRunWorkspace;
	// subscribeGlobal exists only in local mode; PostgreSQL deployments
	// fan events out through their realtime transport instead.
	const subscribeGlobal = typeof runStore.subscribeGlobal === 'function'
		? runStore.subscribeGlobal.bind(runStore)
		: undefined;
	const services = {
		runs: runStore,
		events: {
			publish: runStore.publish,
			subscribe: runStore.subscribe,
			...(subscribeGlobal ? { subscribeGlobal } : {})
		},
		configuration: {
			getPublic: () => inWorkspace(getPublicConfig),
			save: patch => inWorkspace(() => saveConfig(patch)),
			testConnection: patch => inWorkspace(() => testConnection(patch))
		},
		secrets: {
			clear: clearSecrets,
			names: secretNames,
			store: storeSecrets
		},
		reports: {
			buildMarkdown: buildReportMarkdown
		},
		agent: {
			closeBrowser: sessionId => closeBrowser(sessionId, runStore),
			async purgeArtifacts(sessionId) {
				const record = runStore.peekLive?.(sessionId);
				let disposalError;
				try {
					record?.controller?.abort();
					record?.dispose?.();
				} catch (error) {
					disposalError = error;
				} finally {
					runStore.dropLive?.(sessionId);
				}
				try {
					await purgeWorkspace(sessionId);
				} catch (workspaceError) {
					if (disposalError) {
						throw new AggregateError([disposalError, workspaceError], 'Run artifact cleanup failed.');
					}
					throw workspaceError;
				}
				if (disposalError) throw disposalError;
			},
			ensureRuntime: session => inWorkspace(() => ensureRuntime(session, runStore), session),
			runTurn: (session, turnOptions) => inWorkspace(() => runTurn(session, turnOptions, runStore), session),
			getLiveState(sessionId) {
				const record = runStore.peekLive?.(sessionId);
				return {
					running: Boolean(record?.running),
					frame: record?.bridge?.getLastFrame?.()
				};
			},
			stop(sessionId) {
				runStore.peekLive?.(sessionId)?.controller?.abort();
			},
			async invalidateIdleRuntimes() {
				let kept = 0;
				const entries = typeof runStore.listLive === 'function'
					? runStore.listLive()
					: (await runStore.list({ limit: 100 })).map(summary => ({ id: summary.id, record: runStore.peekLive?.(summary.id) }));
				for (const { id, record } of entries) {
					if (currentRequestActor()?.actorUserId && !(await runStore.get(id))) continue;
					if (!record) continue;
					if (!record.runtime) continue;
					if (record.running) {
						kept++;
						continue;
					}
					record.dispose?.();
					delete record.runtime;
					delete record.bridge;
					delete record.dispose;
				}
				return kept;
			}
		},
		readiness: {
			async check() {
				const runs = await runStore.check();
				if (!options.auth?.check) return runs;
				const auth = await options.auth.check();
				return {
					...runs,
					ready: runs?.ready === true && auth?.ready === true,
					checks: { ...(runs?.checks ?? {}), auth: auth?.ready === true ? 'ready' : 'error' }
				};
			}
		},
		lifecycle: {
			close: async () => {
				await runStore.close?.();
				await options.auth?.close?.();
				await options.close?.();
			}
		}
	};
	if (options.auth) services.auth = options.auth;
	return services;
}

/**
 * Adapts the existing file-backed aggregate store to the asynchronous Phase 2
 * run contract. Methods remain behavior-compatible, but callers now await them
 * just as they will await PostgreSQL transactions.
 */
export function createLocalApplicationServices(options = {}) {
	let initialized = false;
	let closed = false;
	const ownerUserId = () => currentRequestActor()?.actorUserId ?? options.tenantContext?.actorUserId;

	const runStore = {
		async load() {
			loadSessions();
			initialized = true;
		},
		async create(title, options = {}) {
			const session = createSession(title, { ...options, ownerUserId: options.ownerUserId ?? ownerUserId() });
			if (options.eventType) {
				emit(session, options.eventType, options.eventPayload ?? {});
			}
			return session;
		},
		async get(id) {
			return getSession(id, ownerUserId());
		},
		async list(options) {
			return listSessions({ ...options, ownerUserId: ownerUserId() });
		},
		// Duration analytics for the in-memory store: computed from loaded
		// sessions so dev-without-Postgres still shows real numbers.
		async durationAnalytics({ targetUrl } = {}) {
			const now = Date.now();
			const completed = listSessions({ limit: 100, ownerUserId: ownerUserId() })
				.filter(candidate => {
					const session = getSession(candidate.id, undefined);
					if (!session?.startedAt || !session.completedAt) return false;
					if (targetUrl !== undefined && session.targetUrl !== targetUrl) return false;
					return true;
				})
				.map(candidate => getSession(candidate.id, undefined));
			const durations = completed.map(session => (session.completedAt - session.startedAt) / 1000).sort((a, b) => a - b);
			const average = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined);
			const byTargetMap = new Map();
			for (const session of completed) {
				const entry = byTargetMap.get(session.targetUrl) ?? { runCount: 0, total: 0 };
				entry.runCount += 1;
				entry.total += (session.completedAt - session.startedAt) / 1000;
				byTargetMap.set(session.targetUrl, entry);
			}
			return {
				runCount: durations.length,
				minDurationSeconds: durations[0],
				maxDurationSeconds: durations[durations.length - 1],
				avgDurationSeconds: average(durations),
				medianDurationSeconds: durations.length
					? durations[Math.floor(durations.length / 2)]
					: undefined,
				avgSecondsPerItem: undefined,
				byTarget: [...byTargetMap.entries()].map(([url, entry]) => ({
					targetUrl: url,
					runCount: entry.runCount,
					avgDurationSeconds: entry.total / entry.runCount
				})),
				serverNow: now
			};
		},
		async targetDurationHistory(targetUrl, { limit = 20 } = {}) {
			return listSessions({ limit: 100, ownerUserId: ownerUserId() })
				.map(candidate => getSession(candidate.id, undefined))
				.filter(session => session?.startedAt && session.completedAt && session.targetUrl === targetUrl)
				.sort((a, b) => a.startedAt - b.startedAt)
				.slice(0, Math.min(100, Math.max(1, Number(limit) || 20)))
				.map(session => ({
					id: session.id,
					status: session.status,
					startedAt: session.startedAt,
					completedAt: session.completedAt,
					durationSeconds: (session.completedAt - session.startedAt) / 1000
				}));
		},
		/**
		 * Unscoped accessors for boot-time run recovery (runResume.js). The
		 * request-scoped list/get above filter by the current actor, which at
		 * boot is the default tenant actor — sessions owned by real users would
		 * be invisible and never resume. These deliberately bypass owner
		 * filtering; runResume re-enters each owner's actor context itself.
		 */
		async listInterrupted() {
			return listSessions({ limit: 100, ownerUserId: undefined })
				.filter(session => session.status === 'interrupted')
				.map(summary => getSession(summary.id, undefined))
				.filter(Boolean);
		},
		async getAny(id) {
			return getSession(id, undefined);
		},
		async delete(id) {
			return deleteSession(id, ownerUserId());
		},
		async commit(session, type, payload = {}) {
			emit(session, type, payload);
			return session;
		},
		async addMessage(session, message) {
			return addMessage(session, message);
		},
		async addActivity(session, activity) {
			return addActivity(session, activity);
		},
		async updateActivity(session, id, patch) {
			return updateActivity(session, id, patch);
		},
		async setStatus(session, status, detail) {
			setStatus(session, status, detail);
		},
		markReportPhase,
		markExecutionStarted,
		publish: emit,
		subscribe(sessionId, listener) {
			bus.on(sessionId, listener);
			return () => bus.off(sessionId, listener);
		},
		/** Global run-bus subscription: observes events from every session. */
		subscribeGlobal(listener) {
			return watchRunBus(listener);
		},
		liveFor,
		peekLive,
		dropLive,
		listLive: liveEntries,
		check() {
			return {
				ready: initialized && !closed,
				checks: { localRunStore: initialized && !closed ? 'ready' : 'initializing' }
			};
		},
		async close() {
			flushSessions();
			closed = true;
		}
	};

	const auth = createLocalAuthService({
		tenantContext: options.tenantContext,
		file: options.authFile
	});
	return createRuntimeApplicationServices(runStore, { auth });
}
