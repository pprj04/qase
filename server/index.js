import 'dotenv/config';
import * as path from 'node:path';
import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { closeBrowser, ensureRuntime, runTurn, finalizeTurnLimitedRun } from './agent.js';
import { getConfig, getPublicConfig, saveConfig, testConnection } from './config.js';
import { testBrowserstackConnection } from './browserstackTest.js';
import { mountDemoSite } from './demoSite.js';
import { buildReportMarkdown } from './report.js';
import { clearSecrets, secretNames, storeSecrets, vaultFor } from './secrets.js';
import { validateDeviceRequest } from './deviceContext.js';
import {
	addMessage, bus, createSession, deleteSession, emit, getSession,
	listSessions, liveFor, loadSessions, setStatus, startWatchdog, pruneOldSessions,
	flushSessionsForShutdown
} from './store.js';
import {
	saveWorkflow, listWorkflows, getWorkflow, deleteWorkflow, updateWorkflow
} from './workflows.js';
import {
	createTestCases, createTestCase, cloneTestCase, listTags,
	listTestCases, getTestCase, updateTestCase, deleteTestCase
} from './testCases.js';
import { generateTestCasesFromWorkflow } from './testGen.js';
import { runTestCase, runTestSuite } from './replay.js';
import { addRun, listRuns } from './replayStore.js';
import {
	createSchedule, getSchedule, listSchedules, updateSchedule, deleteSchedule,
	executeSchedule, validateCron, startScheduler
} from './scheduler.js';
import { addRegressionRun, listRegressionRuns, getRegressionRun, getTrend } from './regressionStore.js';
import { getDashboardMetrics } from './metrics.js';
import {
	createProject, getProject, listProjects, updateProject, deleteProject,
	ensureDefaultProject, getDefaultProjectId, assignOrphanedEntities
} from './projects.js';
import {
	exportFindingsGitHub, exportFindingsJira, exportFindingsLinear,
	exportTestCasesJSON, exportTestCasesCSV
} from './exporters.js';
import {
	addFinding, listFindings, getFinding, updateFinding, deleteFinding,
	changeStatus, addComment, linkTestCase, unlinkTestCase,
	migrateFromSessions, getFindingStats
} from './findings.js';
import { flushFindingsForShutdown } from './findings.js';
import {
	exportFindingsBulkGitHub, exportFindingsBulkJira, exportFindingsBulkLinear,
	exportFindingsBulkMarkdown
} from './bugExporters.js';
import { runAutonomyPipeline } from './pipeline.js';
import {
	analyzeFinding, analyzeSessionFindings,
	buildAppImprovementReport, buildFixPrompt, buildAppImprovementPromptText,
	scoreFindingQuality, calculateMissionQuality, buildImprovementPrompt,
	compareIterations
} from './devIntelligence.js';
import {
	createMission, getMission, listMissions, updateMission, deleteMission,
	finalizeMission, loadMissionsFromDisk, recoverInterruptedMissions, missionBus, recordIteration,
	getComparisonIterations, isTerminalStatus, listQueuedMissionIds,
	flushMissionsForShutdown, findByIdempotencyKey
} from './missions.js';
// B1 W1/W2 — integration auth boundary + workspace ownership.
import {
	requireIntegrationAuth, workspaceMatches, hasScope, listIntegrations,
	getIntegration, upsertIntegration, flushIntegrations
} from './integrationAuth.js';
// M1-P4.4 Phase 2 — graceful-shutdown flush registry (SIGINT/SIGTERM).
import { registerStoreFlush, flushAllStores } from './shutdown.js';
import { flushEvidenceGraphForShutdown, pruneUnlinked } from './evidenceGraph.js';
import { flushFixValidationForShutdown, validationBus } from './fixValidation.js';
// B1 W7 — Phase 18 fix-validation primitives shared with the integration surface.
import {
	findByIdempotencyKey as findValidationByIdempotencyKey,
	getRunsForFinding as getValidationRunsForFinding,
	createRun as createValidationRun,
	transitionRun as transitionValidationRun,
	getFixValidationMetrics as getValidationMetrics
} from './fixValidation.js';
import { executeValidation } from './validationExecutorCore.js';
import { flushReplayRunsForShutdown, pruneRunsByIds } from './replayStore.js';
import { flushUxAssessmentsForShutdown, pruneAssessmentsByIds } from './uxAssessment.js';
import { flushRegressionRunsForShutdown } from './regressionStore.js';
import { flushTestCasesForShutdown } from './testCases.js';
import { flushWorkflowsForShutdown } from './workflows.js';
import { flushKnowledgeForShutdown } from './knowledge.js';
import { flushBaselinesForShutdown } from './baselines.js';
import { flushSchedulesForShutdown } from './scheduler.js';
// M1-P4.4 Phases 3–4 — store hygiene + artifact lifecycle diagnostics.
import { analyzeStoreHygiene, applyStoreHygiene } from './storeHygiene.js';
import { analyzeArtifacts, applyArtifactsCleanup } from './artifactLifecycle.js';
import { buildDevReportMarkdown } from './devReport.js';
import {
	createSuite, listSuites, getSuite, updateSuite, deleteSuite
} from './suites.js';
import { buildJUnitXml } from './junit.js';
import {
	getBaselines, getBaseline, approveBaseline, deleteBaselines,
	autoCaptureBaselines, getTestCaseIdsWithBaselines
} from './baselines.js';
import { summarizeAppModel } from './appModel.js';
import { queryKnowledge, detectAppMetadata, generateExplorationHints, validateKnowledge, detectKnowledgeConflicts, writeFixValidationKnowledge } from './knowledge.js';
import { getAllPatterns, getPatternProvenance, getPatternsForMission, deletePattern, getKnowledgeStats, applyDecay, clearAllPatterns } from './knowledge.js';
import { summarizeKnowledgeItem } from './knowledgeModel.js';
import {
	DEFAULT_MAX_ITERATIONS, STOP_REASONS, ITERATION_STATUS,
	analyzeConvergence, hasReachedIterationLimit, getStopReason,
	resolveAction, buildRevalidationPrompt, prepareKnowledgeForIteration,
	getLoopStatus, getComparisonSummary, getLatestIteration, updateIterationMetadata,
	createIterationMetadata
} from './validationLoop.js';
import {
	createEvidence, getEvidence, getMissionEvidence, getMissionEvidencePage, getSessionEvidence, getSessionEvidencePage,
	getFindingEvidence, getEvidenceChainForApi, createObservation, getSessionObservations, getSessionObservationsPage,
	linkEvidenceToFinding, collectSessionEvidence, computeEvidenceCoverage,
	computeEvidenceConfidence, determineEvidenceStatus, validateGraphIntegrity,
	detectOrphans, getGraphStats, compareIterationEvidence, getHistoricalEvidence,
	getEvidenceCount, getObservationCount, getEdgeCount,
	EVIDENCE_TYPES, EVIDENCE_STATUS
} from './evidenceGraph.js';
// B2 — Autonomous Control Loop
import { buildTestContext } from './autonomyContext.js';
import { runAutonomyDecision, autonomyEnabled, missionAutonomyEnabled, registerAutonomyHooks } from './autonomyController.js';
import { registerCapabilitiesAutonomyGate } from './autonomyBridge.js';
import { getDecisionTraces, recordDecisionTrace } from './decisionTraces.js';
import * as decisionEngineNs from './decisionEngine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// B1 W1 — capture the raw body BEFORE json parsing so HMAC signature
// verification signs the exact bytes that were sent (not a re-serialization).
app.use(express.json({
	limit: '1mb',
	verify: (request, _response, buf) => {
		request.rawIntegrationBody = buf?.toString('utf8') ?? '';
	}
}));
app.use(setAuthCookie);
app.use(correlationIdMiddleware); // B1 W4 — every response carries X-Correlation-Id
app.use(express.static(path.join(here, '..', 'public')));

// Serve persisted run artifacts (screenshots, traces) from .qase/artifacts/
const artifactsRoot = path.join(here, '..', '.qase', 'artifacts');
app.get('/api/artifacts/:runId/:filename', requireApiToken, (request, response) => {
	const { runId, filename } = request.params;
	// Prevent path traversal — only allow alphanumeric, dash, underscore, dot.
	if (!/^[\w.\-]+$/.test(runId) || !/^[\w.\-]+$/.test(filename)) {
		return response.status(400).json({ error: 'Invalid artifact path' });
	}
	const filePath = path.join(artifactsRoot, runId, filename);
	// Use readFile/sendFile with explicit root to avoid sendFile root resolution issues.
	response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
	response.sendFile(filename, { root: path.join(artifactsRoot, runId) }, (err) => {
		if (err) {
			console.error('[artifacts] sendFile failed:', filePath, err.message);
			response.status(404).json({ error: 'Artifact not found' });
		}
	});
});

// A deliberately broken practice site to point a first run at.
mountDemoSite(app);

loadSessions();
loadAssessments(); // Phase 17 UX assessment store (survives restarts)
// M1-P4.1: prune immediately after load so a store that ballooned during a
// long session (heavyweight multi-MB sessions created by the gate itself)
// settles to the byte budget right away, instead of waiting up to 30 minutes
// for the first resource-cleanup tick — RL-1 reads the file on disk.
pruneOldSessions();
startScheduler();
startWatchdog();

/* ── Phase 18: cross-module hooks (wired after stores are live) ───── */

// Targeted-regression case selection (validationExecutorCore) reads the test
// case store through this hook instead of importing a circular dependency.
globalThis.__qaseListTestCases = () => listTestCases();

// Validated fix outcomes are folded into the existing knowledge system.
globalThis.__qasePhase18KnowledgeWriter = (run, originalFinding) => {
	try {
		writeFixValidationKnowledge(run, originalFinding);
	} catch { /* knowledge capture is best-effort */ }
};

/* ── Phase 9.3: Resource Cleanup ──────────────────────────────────── */

/**
 * Phase 9.3: Periodic resource cleanup.
 *
 * 1. Closes browsers belonging to sessions that are no longer running
 *    (leaked Chromium processes were the main memory-leak source).
 * 2. Prunes the session list to the most recent 50 so sessions.json
 *    stays bounded as missions accumulate.
 */
function runResourceCleanup() {
	try {
		for (const summary of listSessions()) {
			const record = liveFor(summary.id);
			// M1-P4.2 fix: the old check `record?.browser` never matched — the
			// live record carries `bridge`/`runtime`, not `browser` — so this
			// browser-reclaim branch was dead code and idle Chromiums survived
			// until the next runTurn's closeOtherBrowsers.
			if (summary.status && !['running', 'awaiting_input'].includes(summary.status) && record?.bridge) {
				void closeBrowser(summary.id).catch(() => { /* best effort */ });
			}
		}
		const pruned = pruneOldSessions(50);
		if (pruned > 0) {
			console.log(`[resource-cleanup] Pruned ${pruned} old sessions (kept 50)`);
		}
	} catch (err) {
		console.error('[resource-cleanup] failed:', err?.message || err);
	}
}

setInterval(runResourceCleanup, 30 * 60 * 1000).unref?.();
runResourceCleanup();

/* ── Health endpoint (no auth) ──────────────────────────────────── */

const bootTime = Date.now();

app.get('/api/health', (_request, response) => {
	response.json({
		status: 'ok',
		uptime: Math.round((Date.now() - bootTime) / 1000),
		project: process.env.QASE_PROJECT_NAME ?? 'Qase'
	});
});

/* ── API token auth middleware ──────────────────────────────────── */

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a, b) {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/**
 * When QASE_API_TOKEN is set (via env or config file), protects mutating
 * endpoints from unauthenticated access. When not set, all routes are open
 * (backwards-compatible for single-user local usage).
 *
 * Authentication methods:
 *   1. Bearer token via Authorization header (for external API / CI-CD)
 *   2. qase_token cookie (set automatically for same-origin browser UI)
 *
 * Usage: apply to specific routes via `app.post('/path', requireApiToken, handler)`.
 */
/* ── B1 W4 — Correlation IDs ─────────────────────────────────────── */

/**
 * X-Correlation-Id: request → response → mission → logs → webhook.
 * Callers may supply one (validated: 1–128 chars, URL/header-safe subset);
 * otherwise one is generated. Attached to every response and stamped onto
 * every console log line for this request via a bound logger.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function correlationIdMiddleware(request, response, next) {
	const incoming = request.headers['x-correlation-id'];
	let cid;
	if (typeof incoming === 'string' && CORRELATION_ID_PATTERN.test(incoming)) {
		cid = incoming;
	} else {
		cid = `cid_${randomUUID()}`;
	}
	request.correlationId = cid;
	response.setHeader('X-Correlation-Id', cid);
	request.log = (...args) => console.log(`[${cid}]`, ...args);
	next();
}
function requireApiToken(request, response, next) {
	const token = getConfig().apiToken;
	if (!token) {
		return next(); // No token configured — open access.
	}

	// Method 1: Bearer header (external API / CI-CD).
	const auth = request.headers.authorization ?? '';
	const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	if (bearer && safeEqual(bearer, token)) {
		return next();
	}

	// Method 2: Cookie (same-origin browser UI).
	const cookieMatch = /(?:^|;\s*)qase_token=([^;]+)/.exec(request.headers.cookie ?? '');
	if (cookieMatch && safeEqual(cookieMatch[1], token)) {
		return next();
	}

	// Method 3 (B1 W3): ?token= query parameter — EventSource cannot set
	// headers, so the UI's live event stream authenticates via query string.
	// Same timing-safe comparison; the token never appears in server logs
	// (Express does not log query strings by default) and the SPA strips it
	// from the visible URL.
	const queryToken = request.query?.token;
	if (typeof queryToken === 'string' && queryToken && safeEqual(queryToken, token)) {
		return next();
	}

	response.status(401).json({ error: 'Invalid or missing API token. Set Authorization: Bearer <token> header.' });
}

/**
 * M1-P3 P0-5: the auth cookie is NO LONGER auto-granted on anonymous
 * responses. Previously this middleware handed the full mutation bearer
 * token to ANY visitor (including a first anonymous page load), making the
 * token gate cosmetic for anyone who could reach the origin.
 *
 * The SPA does not need the auto-grant to function: public reads remain open
 * (single-tenant posture) and the token for mutations is pasted once in
 * Settings → stored in localStorage (`qase_token`), which every fetch wrapper
 * already falls back to. Same-origin demo UX is preserved without
 * broadcasting the token to every request.
 */
function setAuthCookie(request, response, next) {
	const token = getConfig().apiToken;
	if (!token) return next();
	// Honor an existing valid cookie (no-op refresh keeps sessions stable),
	// but never SET the token cookie from scratch on an anonymous request.
	const cookieMatch = /(?:^|;\s*)qase_token=([^;]+)/.exec(request.headers.cookie ?? '');
	if (cookieMatch && safeEqual(cookieMatch[1], token)) {
		// Refresh the expiry of an already-valid cookie only.
		response.setHeader('Set-Cookie', `qase_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
	}
	next();
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/i;

/** Pulls the site under test out of whatever the user typed. */
async function extractUrl(text) {
	const match = text.match(URL_PATTERN);
	if (!match) {
		return undefined;
	}
	const raw = match[0].replace(/[.,;:)]+$/, '');
	let candidate;
	try {
		candidate = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
	} catch {
		return undefined;
	}
	// M1-P4.1 — the chat-side target must pass the same SSRF boundary as
	// mission creation. A blocked URL is ignored (treated as if no URL was
	// given) rather than erroring the whole chat turn.
	const check = await validateTargetUrl(candidate);
	return check.ok ? candidate : undefined;
}

function requireSession(request, response) {
	const session = getSession(request.params.id);
	if (!session) {
		response.status(404).json({ error: 'No such session.' });
		return undefined;
	}
	return session;
}

/** Runs a turn detached: the HTTP call returns at once, progress arrives by SSE. */
function startTurn(session, options) {
	runTurn(session, options).catch(error => {
		const message = error instanceof Error ? error.message : String(error);
		addMessage(session, { role: 'system', text: message, kind: 'error' });
		setStatus(session, 'error', message);
	});
}

/* ── M1-P4.2: mission execution governor ─────────────────────────── */

import {
	submitMission, releaseMission, cancelMission as governorCancelMission,
	startGovernorWatchdog, governorStats, queuePositionOf
} from './missionGovernor.js';

/**
 * The ONLY path from a mission to an agent execution. Every start route
 * (create+autoStart, /start, /iterate, /revalidate, boot requeue) hands its
 * "actually begin execution" closure to the governor; a slot is granted or
 * the mission waits in `queued`. A mission cannot bypass this and consume
 * an execution slot directly.
 *
 * `begin()` executes synchronously inside the slot grant: it creates the
 * session, links it, stamps running+startedAt, and kicks startTurn.
 */
function startMissionExecution(mission, begin) {
	return submitMission(mission.id, () => {
		// B1 W2 — stamp the session with its mission so session-born findings
		// can be linked to (and authorized through) the mission. Stamp BEFORE
		// begin() so the very first session-store write already carries it.
		//
		// B2 fix — several begin() call-sites return a summary object (not the
		// session), so stamping the return value silently linked NOTHING on
		// those paths: sessions.json had no missionId, the turn pool saw 0
		// spent after a restart, and capabilities' listMissions filter by
		// sessionId still worked but session-side lookups did not. The stamp
		// now lives on the session itself via a creation hook, which also
		// persists to disk (createSession snapshot).
		const seeded = begin();
		return seeded;
	});
}

app.get('/api/config', requireApiToken, (_request, response) => {
	response.json(getPublicConfig());
});

/**
 * Saves model settings. Runtimes capture their configuration at construction,
 * so idle sessions are torn down and rebuilt on their next turn; a session
 * mid-run keeps the settings it started with.
 */
app.put('/api/config', requireApiToken, (request, response) => {
	try {
		const config = saveConfig(request.body ?? {});
		let kept = 0;
		for (const summary of listSessions()) {
			const record = liveFor(summary.id);
			if (!record.runtime) {
				continue;
			}
			if (record.running) {
				kept++;
				continue;
			}
			record.dispose?.();
			delete record.runtime;
			delete record.bridge;
			delete record.dispose;
		}
		response.json({ ...config, runsKeepingOldSettings: kept });
	} catch (error) {
		response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
	}
});

/** Probes the configured endpoint so a wrong URL or key surfaces before a run. */
app.post('/api/config/test', requireApiToken, async (request, response) => {
	response.json(await testConnection(request.body ?? {}));
});

/**
 * BUILD B0.1 — REAL BrowserStack connection test (auth + CDP reachability).
 * Accepts unsaved Settings values (browserstackUser/browserstackKey in the
 * body); falls back to the effective config when they are blank. The access
 * key is used for the probe and never echoed back or logged.
 */
app.post('/api/config/test-browserstack', requireApiToken, async (request, response) => {
	try {
		const body = request.body ?? {};
		const effective = getConfig();
		const user = String(body.browserstackUser ?? '').trim() || effective.browserstackUser || '';
		const key = String(body.browserstackKey ?? '').trim() || effective.browserstackKey || '';
		const result = await testBrowserstackConnection({ user, key });
		// Persist the redacted outcome so the UI can show "last verified" and
		// so a restart does not silently lose it. Best-effort only.
		try {
			saveConfig({
				browserstackLastVerified: {
					ts: result.lastVerifiedTs,
					ok: result.ok,
					code: result.code,
					message: result.message,
					maskedUser: result.maskedUser
				}
			});
		} catch (persistError) {
			console.error('[config] could not persist browserstackLastVerified:', persistError?.message);
		}
		response.json(result);
	} catch (error) {
		// Never leak credential material through error paths.
		response.status(500).json({ ok: false, code: 'internal_error', message: 'Connection test failed unexpectedly. Check server logs.' });
		console.error('[config] browserstack test error:', error?.message);
	}
});

app.get('/api/sessions', requireApiToken, (request, response) => {
	// M1-P4.3 — optional pagination: no ?limit → full array (backward compat).
	// Ordered newest-first (lastActivity) so pages are stable.
	const list = listSessions({ projectId: request.query.projectId })
		.slice()
		.sort((a, b) => (b.lastActivity ?? b.createdAt ?? 0) - (a.lastActivity ?? a.createdAt ?? 0));
	const { body } = paginateList(list, request.query);
	response.json(body);
});

app.post('/api/sessions', requireApiToken, (request, response) => {
	const projectId = request.body?.projectId ?? getDefaultProjectId();
	// B0.3 — optional deviceRequest ('iPhone 15 Pro', { device: 'Pixel 8' },
	// class 'mobile'/'tablet'). Unsupported names → 400 (never silent desktop).
	const deviceInput = request.body?.deviceRequest ?? null;
	const deviceCheck = deviceInput != null ? validateDeviceRequest(deviceInput) : null;
	if (deviceCheck && !deviceCheck.ok) {
		return response.status(400).json({ error: deviceCheck.error });
	}
	response.status(201).json(createSession('New test run', projectId, deviceCheck?.deviceName ? { deviceRequest: deviceCheck.deviceName } : {}));
});

app.get('/api/sessions/:id', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	const record = liveFor(session.id);

	// For "done" or "idle" sessions, strip heavy arrays from the initial response.
	// The frontend lazy-loads messages, steps, and findings as needed.
	const isHeavy = session.messages.length > 50 || session.capturedSteps.length > 30;
	const stripHeavy = request.query.summary === '1' || (isHeavy && request.query.full !== '1');

	const payload = {
		id: session.id,
		title: session.title,
		projectId: session.projectId,
		status: session.status,
		targetUrl: session.targetUrl,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		findingCount: (session.findings ?? []).length,
		messageCount: (session.messages ?? []).length,
		stepCount: (session.capturedSteps ?? []).length,
		// BUILD 2: honest environment display — expose the resolved device
		// context (or the request if the runtime never applied it) so the
		// session header can show DESKTOP vs EMULATED_DEVICE vs REAL_DEVICE.
		device: session.device ?? null,
		deviceRequest: session.deviceRequest ?? null,
		viewportsExplored: session.viewportsExplored ?? [],
		secretNames: secretNames(session.id),
		running: Boolean(record.running),
		frame: record.bridge?.getLastFrame?.(),
		pipeline: session.pipeline ?? null,
		devIntelligence: session.devIntelligence ?? null
	};

	if (!stripHeavy) {
		// Include everything for active sessions or small sessions.
		Object.assign(payload, {
			messages: session.messages,
			capturedSteps: session.capturedSteps,
			findings: session.findings,
			activities: session.activities,
			todos: session.todos
		});
	} else {
		// Even for heavy sessions, include activities + todos (they're small) so
		// the reasoning log and evidence tabs work without a second round-trip.
		Object.assign(payload, {
			activities: session.activities,
			todos: session.todos
		});
	}

	response.json(payload);
});

app.delete('/api/sessions/:id', requireApiToken, (request, response) => {
	clearSecrets(request.params.id);
	response.json({ deleted: deleteSession(request.params.id) });
});

/** The chat entry point: a URL starts a run, anything else steers the current one. */
app.post('/api/sessions/:id/message', requireApiToken, async (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	const text = String(request.body?.text ?? '').trim();
	if (!text) {
		response.status(400).json({ error: 'Message is empty.' });
		return;
	}
	if (liveFor(session.id).running) {
		response.status(409).json({ error: 'The agent is still working. Stop it before sending another instruction.' });
		return;
	}

	addMessage(session, { role: 'user', text });

	const url = await extractUrl(text);
	if (url && !session.targetUrl) {
		session.targetUrl = url;
		session.title = new URL(url).host;
		emit(session, 'session', { targetUrl: url, title: session.title });
	}

	try {
		await ensureRuntime(session);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		addMessage(session, { role: 'system', text: message, kind: 'error' });
		setStatus(session, 'error', message);
		response.status(500).json({ error: message });
		return;
	}

	// A pending question means the user typed instead of using the answer form.
	const pending = session.pendingQuestion;
	startTurn(session, pending ? { resumeAnswer: text } : { task: text });
	response.json({ ok: true });
});

/** Answers a blocking ask_question with a plain option or free-text reply. */
app.post('/api/sessions/:id/answer', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	if (!session.pendingQuestion) {
		response.status(409).json({ error: 'Nothing is waiting on an answer.' });
		return;
	}
	const answer = String(request.body?.answer ?? '').trim();
	if (!answer) {
		response.status(400).json({ error: 'Answer is empty.' });
		return;
	}
	addMessage(session, { role: 'user', text: answer, kind: 'answer' });
	startTurn(session, { resumeAnswer: answer });
	response.json({ ok: true });
});

/**
 * Answers a credential question without the values ever reaching the model.
 * They go into the session vault; the agent gets placeholder names back.
 */
app.post('/api/sessions/:id/credentials', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	if (!session.pendingQuestion) {
		response.status(409).json({ error: 'Nothing is waiting on an answer.' });
		return;
	}

	const fields = request.body?.fields;
	if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
		response.status(400).json({ error: 'No credentials supplied.' });
		return;
	}

	const names = storeSecrets(session.id, fields);
	if (names.length === 0) {
		response.status(400).json({ error: 'No usable credentials supplied.' });
		return;
	}
	session.secretNames = secretNames(session.id);

	const note = String(request.body?.note ?? '').trim();
	const placeholders = names.map(name => `{{${name}}}`).join(', ');
	const answer = [
		`The credentials are stored in the host vault. You will not be shown the values.`,
		`Fill the sign-in form using these literal placeholders as the browser_fill value: ${placeholders}.`,
		`The host substitutes the real secret at the keyboard. Never print, repeat or report a credential value.`,
		note && `Note from the user: ${note}`
	].filter(Boolean).join(' ');

	addMessage(session, {
		role: 'user',
		kind: 'credentials',
		text: `Provided ${names.length} credential${names.length === 1 ? '' : 's'} securely: ${placeholders}`
	});
	emit(session, 'secrets', { secretNames: session.secretNames });

	startTurn(session, { resumeAnswer: answer });
	response.json({ ok: true, secretNames: names });
});

app.post('/api/sessions/:id/stop', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	const record = liveFor(session.id);
	record?.controller?.abort();
	// Phase 1: close browser resources on stop to prevent orphaned Chromium.
	void closeBrowser(session.id);
	response.json({ ok: true });
});

/** Lazy-load heavy session arrays (messages, steps, findings) for large sessions. */
app.get('/api/sessions/:id/detail', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const field = request.query.field; // 'messages' | 'capturedSteps' | 'findings'
	if (field === 'messages') return response.json(session.messages ?? []);
	if (field === 'capturedSteps') return response.json(session.capturedSteps ?? []);
	if (field === 'findings') return response.json(session.findings ?? []);
	response.json({
		messages: session.messages ?? [],
		capturedSteps: session.capturedSteps ?? [],
		findings: session.findings ?? []
	});
});

app.get('/api/sessions/:id/report.md', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	response.type('text/markdown').send(buildReportMarkdown(session));
});

/* ── Pipeline routes (Phase 12) ──────────────────────────────────── */

app.post('/api/sessions/:id/run-pipeline', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	// Fire-and-forget; progress flows via SSE events.
	runAutonomyPipeline(session, { force: true }).catch(() => {});
	response.json({ ok: true, message: 'Pipeline triggered' });
});

app.get('/api/sessions/:id/pipeline-status', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	response.json(session.pipeline ?? null);
});

/* ── Dev Intelligence routes (Phase 13) ──────────────────────────── */

/**
 * Trigger per-finding and app-level intelligence analysis for a session.
 */
app.post('/api/sessions/:id/analyze-dev', requireApiToken, async (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;

	try {
		const dev = await analyzeSessionFindings(session.findings ?? [], { targetUrl: session.targetUrl });
		session.devIntelligence = dev;
		emit(session, 'dev_intelligence_complete', { devIntelligence: dev });
		response.json(dev);
	} catch (err) {
		console.error('[analyze-dev] error:', err.message);
		response.status(500).json({ error: 'Dev intelligence analysis failed', message: err.message });
	}
});

/** Fetch persisted dev intelligence for a session. */
app.get('/api/sessions/:id/dev-intelligence', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	response.json(session.devIntelligence ?? null);
});

/** Application Understanding model for a session (Phase 2). */
app.get('/api/sessions/:id/app-understanding', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const appModel = session.appModel || null;
	if (!appModel) return response.json(null);
	response.json(appModel);
});

/** Application Understanding summary for a session (Phase 2). */
app.get('/api/sessions/:id/app-understanding-summary', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const summary = session.pipeline?.summary?.appUnderstanding ?? null;
	if (!summary) {
		// Try to generate from stored model
		if (session.appModel) {
			try {
				response.json(summarizeAppModel(session.appModel));
				return;
			} catch { /* fall through */ }
		}
		return response.json(null);
	}
	response.json(summary);
});

/** Feature gap analysis for the Application Understanding card. */
app.get('/api/sessions/:id/feature-gaps', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const summary = session.pipeline?.summary;
	if (!summary?.featureGaps) return response.json(null);
	response.json(summary.featureGaps);
});

/** Per-finding intelligence: structured fix suggestion. */
app.get('/api/findings/:id/dev-analysis', requireApiToken, async (request, response) => {
	const finding = getFinding(request.params.id);
	if (!finding) return response.status(404).json({ error: 'Finding not found' });
	if (!finding.devIntelligence || request.query.force === '1') {
		try {
			const intel = await analyzeFinding(finding, {}, request.query.force === '1');
			return response.json(intel);
		} catch (err) {
			return response.status(500).json({ error: 'Analysis failed', message: err.message });
		}
	}
	response.json(finding.devIntelligence);
});

/** Per-finding AI-ready fix prompt. */
app.get('/api/findings/:id/fix-prompt', requireApiToken, (request, response) => {
	const finding = getFinding(request.params.id);
	if (!finding) return response.status(404).json({ error: 'Finding not found' });
	const prompt = buildFixPrompt(finding, finding.devIntelligence ?? finding.intelligence ?? null);
	response.type('text/markdown').send(prompt);
});

/** App-level AI-ready improvement prompt (all findings in a session). */
app.get('/api/sessions/:id/app-improvement-prompt', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const prompt = buildAppImprovementPromptText(session.findings ?? [], session.devIntelligence?.appReport ?? null);
	response.type('text/markdown').send(prompt);
});

/** Full developer intelligence markdown report. */
app.get('/api/sessions/:id/dev-report', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	if (!session.devIntelligence) return response.status(404).json({ error: 'No dev intelligence for this session yet. Trigger analysis first.' });
	const format = request.query.format || 'markdown';
	if (format === 'json') {
		return response.json({
			session: { id: session.id, targetUrl: session.targetUrl },
			devIntelligence: session.devIntelligence
		});
	}
	const md = buildDevReportMarkdown(session, session.devIntelligence);
	response.type('text/markdown').send(md);
});

/* ── Knowledge routes (Phase 3) ─────────────────────────────────── */

/** Get all knowledge patterns with stats. */
app.get('/api/knowledge', requireApiToken, (request, response) => {
	const stats = getKnowledgeStats();
	const allPatterns = getAllPatterns().map(p => summarizeKnowledgeItem(p));
	response.json({ patterns: allPatterns, stats });
});

/** Get a specific knowledge pattern with full provenance. */
app.get('/api/knowledge/:id', requireApiToken, (request, response) => {
	const provenance = getPatternProvenance(request.params.id);
	if (!provenance) return response.status(404).json({ error: 'Knowledge pattern not found' });
	response.json(provenance);
});

/** Get knowledge patterns associated with a mission. */
app.get('/api/missions/:id/knowledge', requireApiToken, (request, response) => {
	const patterns = getPatternsForMission(request.params.id);
	response.json({ patterns });
});

/** Get knowledge relevant to a session (hints that were injected). */
app.get('/api/sessions/:id/knowledge', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const hints = session.knowledgeHints || [];
	const patternsUsed = session.knowledgePatternsUsed || [];
	const validation = session.pipeline?.summary?.knowledgeValidation || [];
	const conflicts = session.pipeline?.summary?.knowledgeConflicts || [];
	response.json({ hints, patternsUsed, validation, conflicts });
});

/** Get knowledge statistics. */
app.get('/api/knowledge-stats', requireApiToken, (request, response) => {
	response.json(getKnowledgeStats());
});

/** Delete a knowledge pattern. */
app.delete('/api/knowledge/:id', requireApiToken, (request, response) => {
	const deleted = deletePattern(request.params.id);
	if (!deleted) return response.status(404).json({ error: 'Pattern not found' });
	response.json({ deleted: true });
});

/** Apply confidence decay to all patterns. */
app.post('/api/knowledge/decay', requireApiToken, (request, response) => {
	applyDecay();
	response.json({ applied: true });
});

/* ── Decision Engine routes (Phase 4) ───────────────────────────── */

/**
 * Get the current/latest decision for a session.
 * Read-only — returns the most recent decision from history.
 */
app.get('/api/sessions/:id/decision', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const history = session.decisionHistory ?? [];
	const latest = history.length > 0 ? history[history.length - 1] : null;
	const pipelineDecision = session.pipeline?.summary?.decision ?? null;
	response.json({
		decision: latest ?? pipelineDecision,
		history,
		historyCount: history.length
	});
});

/**
 * Get all decisions for a session (full history).
 */
app.get('/api/sessions/:id/decisions', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const history = session.decisionHistory ?? [];
	response.json({
		decisions: history,
		count: history.length
	});
});

/**
 * Get decisions for a mission — looks up the linked session(s).
 */
app.get('/api/missions/:id/decisions', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) return response.status(404).json({ error: 'Mission not found' });

	const decisions = [];
	// Check current session
	if (mission.sessionId) {
		const session = getSession(mission.sessionId);
		if (session?.decisionHistory) {
			decisions.push(...session.decisionHistory);
		}
	}
	// Check iteration sessions
	for (const iter of (mission.iterations ?? [])) {
		if (iter.sessionId && iter.sessionId !== mission.sessionId) {
			const session = getSession(iter.sessionId);
			if (session?.decisionHistory) {
				decisions.push(...session.decisionHistory);
			}
		}
	}
	// Also check pipeline summary
	const pipelineDecision = mission.sessionId
		? getSession(mission.sessionId)?.pipeline?.summary?.decision ?? null
		: null;

	response.json({
		decisions,
		count: decisions.length,
		latest: decisions.length > 0 ? decisions[decisions.length - 1] : pipelineDecision
	});
});

/* ── Workflow routes ────────────────────────────────────────────── */

app.get('/api/sessions/:id/workflow', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	response.json({
		steps: session.capturedSteps ?? [],
		savedWorkflows: listWorkflows({ projectId: session.projectId, targetUrl: session.targetUrl })
	});
});

app.post('/api/sessions/:id/workflow', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	try {
		const { name, tags } = request.body ?? {};
		const workflow = saveWorkflow(session, { name, tags });
		response.status(201).json(workflow);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.get('/api/workflows', requireApiToken, (request, response) => {
	// M1-P4.3 — optional pagination: no ?limit → full array (backward compat).
	const { body } = paginateList(listWorkflows({ projectId: request.query.projectId, targetUrl: request.query.targetUrl }), request.query);
	response.json(body);
});

app.get('/api/workflows/:id', requireApiToken, (request, response) => {
	const wf = getWorkflow(request.params.id);
	if (!wf) {
		return response.status(404).json({ error: 'Workflow not found' });
	}
	response.json(wf);
});

app.put('/api/workflows/:id', requireApiToken, (request, response) => {
	const wf = updateWorkflow(request.params.id, request.body ?? {});
	if (!wf) {
		return response.status(404).json({ error: 'Workflow not found' });
	}
	response.json(wf);
});

app.delete('/api/workflows/:id', requireApiToken, (request, response) => {
	const deleted = deleteWorkflow(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

/* ── Test case routes ───────────────────────────────────────────── */

app.post('/api/workflows/:id/generate-tests', requireApiToken, async (request, response) => {
	const workflow = getWorkflow(request.params.id);
	if (!workflow) {
		return response.status(404).json({ error: 'Workflow not found' });
	}
	try {
		// Pull findings from the origin session if available.
		const session = getSession(workflow.sessionId);
		const findings = session?.findings ?? [];
		const generated = await generateTestCasesFromWorkflow(workflow, findings);
		const saved = createTestCases(generated, {
			projectId: workflow.projectId,
			workflowId: workflow.id,
			targetUrl: workflow.targetUrl
		});
		response.status(201).json(saved);
	} catch (error) {
		response.status(500).json({ error: error.message });
	}
});

app.get('/api/test-cases', requireApiToken, (request, response) => {
	const cases = listTestCases({
		projectId: request.query.projectId,
		targetUrl: request.query.targetUrl,
		workflowId: request.query.workflowId,
		suiteId: request.query.suiteId,
		tag: request.query.tag
	});
	// Batch-annotate hasBaselines to eliminate N+1 per-card API calls.
	const idsWithBaselines = getTestCaseIdsWithBaselines();
	for (const tc of cases) {
		tc.hasBaselines = idsWithBaselines.has(tc.id);
	}
	// M1-P4.3 — optional pagination: no ?limit → full array (backward compat).
	const { body } = paginateList(cases, request.query);
	response.json(body);
});

app.get('/api/test-cases/export', requireApiToken, (request, response) => {
	const format = request.query.format ?? 'json';
	const testCases = listTestCases({ projectId: request.query.projectId });

	if (format === 'json') {
		const data = exportTestCasesJSON(testCases);
		response.type('application/json')
			.set('Content-Disposition', 'attachment; filename="test-cases.json"')
			.json(data);
		return;
	}

	if (format === 'csv') {
		const csv = exportTestCasesCSV(testCases);
		response.type('text/csv')
			.set('Content-Disposition', 'attachment; filename="test-cases.csv"')
			.send(csv);
		return;
	}

	response.status(400).json({ error: `Unknown format: ${format}` });
});

/* ── Manual test case create + clone + tags ─────────────────────── */

app.post('/api/test-cases', requireApiToken, async (request, response) => {
	const data = request.body ?? {};
	// M1-P4.1 — stored targetUrl is executed later by the replay runner; it
	// must pass the SSRF boundary at ingest.
	if (data.targetUrl && String(data.targetUrl).trim() !== '') {
		const check = await validateTargetUrl(String(data.targetUrl));
		if (!check.ok) {
			return response.status(400).json({ error: check.message, code: check.code });
		}
	}
	const tc = createTestCase({
		projectId: data.projectId ?? getDefaultProjectId(),
		suiteId: data.suiteId ?? null,
		name: data.name,
		targetUrl: data.targetUrl ?? '',
		preconditions: data.preconditions,
		steps: data.steps,
		assertions: data.assertions,
		severity: data.severity,
		tags: data.tags,
		viewport: data.viewport,
		viewports: data.viewports
	});
	response.status(201).json(tc);
});

app.post('/api/test-cases/:id/clone', requireApiToken, (request, response) => {
	const clone = cloneTestCase(request.params.id);
	if (!clone) {
		return response.status(404).json({ error: 'Test case not found' });
	}
	response.status(201).json(clone);
});

app.get('/api/test-cases/tags', requireApiToken, (request, response) => {
	response.json(listTags({ projectId: request.query.projectId }));
});

app.get('/api/test-cases/:id', requireApiToken, (request, response) => {
	const tc = getTestCase(request.params.id);
	if (!tc) {
		return response.status(404).json({ error: 'Test case not found' });
	}
	response.json(tc);
});

app.put('/api/test-cases/:id', requireApiToken, async (request, response) => {
	// M1-P4.1 — targetUrl updates pass the SSRF boundary before persisting.
	if (request.body?.targetUrl && String(request.body.targetUrl).trim() !== '') {
		const check = await validateTargetUrl(String(request.body.targetUrl));
		if (!check.ok) {
			return response.status(400).json({ error: check.message, code: check.code });
		}
	}
	const tc = updateTestCase(request.params.id, request.body ?? {});
	if (!tc) {
		return response.status(404).json({ error: 'Test case not found' });
	}
	response.json(tc);
});

app.delete('/api/test-cases/:id', requireApiToken, (request, response) => {
	const deleted = deleteTestCase(request.params.id);
	if (deleted) {
		deleteBaselines(request.params.id);
	}
	response.status(deleted ? 204 : 404).end();
});

/* ── Suite routes ──────────────────────────────────────────────── */

app.get('/api/suites', requireApiToken, (request, response) => {
	response.json(listSuites({ projectId: request.query.projectId }));
});

app.post('/api/suites', requireApiToken, (request, response) => {
	try {
		const suite = createSuite({
			projectId: request.body?.projectId ?? getDefaultProjectId(),
			parentId: request.body?.parentId,
			name: request.body?.name
		});
		response.status(201).json(suite);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.put('/api/suites/:id', requireApiToken, (request, response) => {
	try {
		const suite = updateSuite(request.params.id, request.body ?? {});
		if (!suite) {
			return response.status(404).json({ error: 'Suite not found' });
		}
		response.json(suite);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.delete('/api/suites/:id', requireApiToken, (request, response) => {
	const deleted = deleteSuite(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

/* ── Replay routes ──────────────────────────────────────────────── */

app.post('/api/test-cases/:id/run', requireApiToken, async (request, response) => {
	const tc = getTestCase(request.params.id);
	if (!tc) {
		return response.status(404).json({ error: 'Test case not found' });
	}
	try {
		const { credentials, browser, device } = request.body ?? {};
		// B0.3 — device may be a name, class string, or { device: 'Pixel 8' }.
		// Unsupported → 400 (deterministic, no substitution/downgrade).
		const deviceCheck = device != null ? validateDeviceRequest(device) : null;
		if (deviceCheck && !deviceCheck.ok) {
			return response.status(400).json({ error: deviceCheck.error });
		}
		const result = await runTestCase(tc, { credentials, browser, device: deviceCheck?.deviceName });
		// Clean internal healing artifacts before storing/returning.
		delete result._domSnapshot;
		delete result._failedStepIndex;
		delete result._failedStep;
		const stored = addRun(result);
		response.json({ result, history: stored });
	} catch (error) {
		response.status(500).json({ error: error.message });
	}
});

app.post('/api/test-cases/run', requireApiToken, async (request, response) => {

// ── B1 W2 test support (token-gated, test-only) ─────────────────────────
// Injects a synthetic SESSION-BORN finding (sessionId set, missionId absent)
// linked to a mission via its sessionId, so the integration linkage contract
// can be regression-tested without a full agent run. Token auth required;
// never exposed on the integration surface.
app.post('/api/test-support/session-born-finding', requireApiToken, (request, response) => {
	const { missionId, title, severity } = request.body ?? {};
	const mission = missionId && getMission(missionId);
	if (!mission) {
		return response.status(404).json({ error: { code: 'mission_not_found', message: 'Mission not found.' } });
	}
	// The mission must have a sessionId for the linkage to be exercised; if
	// it hasn't started, synthesize one without starting the agent.
	let sessionId = mission.sessionId;
	if (!sessionId) {
		const session = createSession(`${mission.name || 'fixture'} (synthetic session)`, mission.projectId, {});
		session.targetUrl = mission.targetUrl;
		updateMission(mission.id, { sessionId: session.id });
		sessionId = session.id;
	}
	const finding = addFinding({
		id: `sfnd_${randomUUID().slice(0, 8)}`,
		ts: Date.now(),
		sessionId,
		projectId: mission.projectId,
		title: title || 'Synthetic session-born finding',
		severity: severity || 'low',
		category: 'functional',
		url: mission.targetUrl,
		steps: [], expected: 'fixture', actual: 'fixture',
		evidence: []
	});
	response.json({ findingId: finding.id, sessionId });
});

app.post('/api/test-support/session-born-finding/cleanup', requireApiToken, (request, response) => {
	const { findingId, missionId } = request.body ?? {};
	let removed = 0;
	if (findingId) { try { deleteFinding(findingId); removed++; } catch { /* gone */ } }
	if (missionId) { try { deleteMission(missionId); removed++; } catch { /* gone */ } }
	response.json({ removed });
});
// ── end test support ────────────────────────────────────────────────────


	const { testCaseIds, credentials, browsers, device } = request.body ?? {};
	// B0.3 — suite-level device override, same validation as single-run.
	const deviceCheck = device != null ? validateDeviceRequest(device) : null;
	if (deviceCheck && !deviceCheck.ok) {
		return response.status(400).json({ error: deviceCheck.error });
	}
	const config = getConfig();
	const concurrency = Number(request.body?.concurrency) || config.concurrentRuns;
	const retries = Number.isFinite(Number(request.body?.retries)) ? Number(request.body.retries) : config.retriesCount;
	if (!Array.isArray(testCaseIds) || testCaseIds.length === 0) {
		return response.status(400).json({ error: 'testCaseIds array is required' });
	}
	try {
		const cases = testCaseIds
			.map(id => getTestCase(id))
			.filter(Boolean);
		if (cases.length === 0) {
			return response.status(404).json({ error: 'No test cases found for the given IDs' });
		}
		const summary = await runTestSuite(cases, { credentials, concurrency, retries, browsers, device: deviceCheck?.deviceName });
		// Persist each individual result.
		for (const result of summary.results) {
			addRun(result);
		}

		// JUnit XML format for CI consumption.
		if (request.query.format === 'junit') {
			response.type('application/xml')
				.set('Content-Disposition', 'attachment; filename="qase-results.xml"')
				.send(buildJUnitXml(summary));
			return;
		}

		response.json(summary);
	} catch (error) {
		response.status(500).json({ error: error.message });
	}
});

app.get('/api/test-cases/:id/runs', requireApiToken, (request, response) => {
	response.json(listRuns(request.params.id));
});

/* ── Visual regression baseline routes ──────────────────────────── */

app.get('/api/test-cases/:id/baselines', requireApiToken, (request, response) => {
	response.json(getBaselines(request.params.id));
});

app.post('/api/test-cases/:id/approve-baseline', requireApiToken, async (request, response) => {
	const tc = getTestCase(request.params.id);
	if (!tc) {
		return response.status(404).json({ error: 'Test case not found' });
	}
	try {
		const { screenshots } = request.body ?? {};

		// If screenshots not provided, use the most recent run's screenshots.
		if (!Array.isArray(screenshots) || screenshots.length === 0) {
			const runs = listRuns(request.params.id);
			if (runs.length > 0 && runs[0].screenshotPaths?.length > 0) {
				const latest = runs[0];
				const labels = latest.stepResults
					?.filter(sr => sr.status === 'fail')
					.map(sr => `step-${sr.stepIndex}`) || [];
				// Reconstruct screenshot objects from stored paths
				screenshots = latest.screenshotPaths.map((p, i) => ({
					label: labels[i] || `screenshot-${i}`,
					artifactPath: p
				}));
			}
		}

		if (!Array.isArray(screenshots) || screenshots.length === 0) {
			return response.status(400).json({ error: 'No screenshots available to approve' });
		}

		const result = approveBaseline(request.params.id, screenshots);
		response.json({ approved: result.length, baselines: result });
	} catch (error) {
		response.status(500).json({ error: error.message });
	}
});

app.delete('/api/test-cases/:id/baselines', requireApiToken, (request, response) => {
	deleteBaselines(request.params.id);
	response.json({ deleted: true });
});

/* ── Schedule routes ────────────────────────────────────────────── */

app.get('/api/schedules', requireApiToken, (request, response) => {
	response.json(listSchedules({ projectId: request.query.projectId }));
});

app.post('/api/schedules', requireApiToken, (request, response) => {
	try {
		const body = { ...request.body };
		if (!body.projectId) body.projectId = getDefaultProjectId();
		const sched = createSchedule(body);
		response.status(201).json(sched);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.put('/api/schedules/:id', requireApiToken, (request, response) => {
	try {
		const sched = updateSchedule(request.params.id, request.body ?? {});
		if (!sched) {
			return response.status(404).json({ error: 'Schedule not found' });
		}
		response.json(sched);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.delete('/api/schedules/:id', requireApiToken, (request, response) => {
	const deleted = deleteSchedule(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

app.post('/api/schedules/:id/run', requireApiToken, async (request, response) => {
	const sched = getSchedule(request.params.id);
	if (!sched) {
		return response.status(404).json({ error: 'Schedule not found' });
	}
	try {
		const summary = await executeSchedule(sched);
		response.json(summary);
	} catch (error) {
		response.status(500).json({ error: error.message });
	}
});

app.get('/api/schedules/:id/runs', requireApiToken, (request, response) => {
	response.json(listRegressionRuns({ scheduleId: request.params.id }));
});

/* ── Regression trends ──────────────────────────────────────────── */

app.get('/api/regression/trend', requireApiToken, (request, response) => {
	response.json(getTrend({
		projectId: request.query.projectId,
		scheduleId: request.query.scheduleId,
		targetUrl: request.query.targetUrl,
		limit: Number(request.query.limit) || 20
	}));
});

app.get('/api/regression/runs', requireApiToken, (request, response) => {
	response.json(listRegressionRuns({
		projectId: request.query.projectId,
		scheduleId: request.query.scheduleId,
		targetUrl: request.query.targetUrl,
		limit: Number(request.query.limit) || 50
	}));
});

// Get a single regression run, optionally as JUnit XML.
app.get('/api/regression/runs/:id', requireApiToken, (request, response) => {
	const run = getRegressionRun(request.params.id);
	if (!run) {
		return response.status(404).json({ error: 'Regression run not found' });
	}
	if (request.query.format === 'junit') {
		response.type('application/xml')
			.set('Content-Disposition', 'attachment; filename="qase-run.xml"')
			.send(buildJUnitXml(run, { suiteName: `Qase Run ${run.id.slice(0, 8)}` }));
		return;
	}
	response.json(run);
});

app.post('/api/validate-cron', requireApiToken, (request, response) => {
	const { cronExpr } = request.body ?? {};
	response.json({ valid: validateCron(cronExpr) });
});

/** Server-sent events: one stream per session, carrying state and browser frames. */
app.get('/api/sessions/:id/events', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}

	response.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no'
	});
	response.write(': connected\n\n');

	const send = event => {
		response.write(`data: ${JSON.stringify(event)}\n\n`);
	};
	bus.on(session.id, send);

	// Reconnecting clients want the last frame immediately, not in 300ms.
	const frame = liveFor(session.id).bridge?.getLastFrame?.();
	if (frame) {
		send({ type: 'frame', sessionId: session.id, frame });
	}

	const heartbeat = setInterval(() => response.write(': ping\n\n'), 15_000);
	request.on('close', () => {
		clearInterval(heartbeat);
		bus.off(session.id, send);
	});
});

/* ── Metrics dashboard ──────────────────────────────────────────── */

app.get('/api/metrics/dashboard', requireApiToken, (request, response) => {
	response.json(getDashboardMetrics({ projectId: request.query.projectId }));
});

/* M1-P3 P0-5 follow-up: the projects LIST and findings LIST are public reads
 * (Bugs hub + boot fetches — same single-tenant posture as /api/config and
 * /api/sessions). Both worked anonymously ONLY because the S1 auto-cookie
 * authorized the SPA's boot fetches; registered BEFORE the phaseRouter mount
 * (whose router.use(auth) gates everything under /api) so they stay public.
 * All mutations on these resources remain token-gated. */
app.get('/api/projects', requireApiToken, (_request, response) => {
	response.json(listProjects());
});

app.get('/api/findings', requireApiToken, (request, response) => {
	// M1-P4.3 — optional pagination: no ?limit → full array (backward compat).
	const { body } = paginateList(listFindings({
		projectId: request.query.projectId,
		severity: request.query.severity,
		status: request.query.status,
		category: request.query.category,
		assignee: request.query.assignee,
		sessionId: request.query.sessionId,
		q: request.query.q
	}), request.query);
	response.json(body);
});

app.get('/api/missions', requireApiToken, (request, response) => {
	// M1-P4.3 — optional pagination: no ?limit → full array (backward compat).
	const { body } = paginateList(listMissions({
		projectId: request.query.projectId,
		status: request.query.status,
		type: request.query.type,
		source: request.query.source
	}), request.query);
	response.json(body);
});

/* ── Findings / Bugs Hub routes ──────────────────────────────────── */

// Phase 16/17/18 additive surface — mounted BEFORE the legacy findings
// routes so specific paths (e.g. /api/findings/grouped) win over the
// generic /api/findings/:id parameter route below.
import { phaseRouter } from './phaseRouter.js';
import { pulseV2Router } from './pulseV2Router.js';
import { buildOpenApiDocument } from './openapiDocument.js';
import { initApiUsageTracker, apiUsageCounter } from './apiUsage.js';
import { getAssessmentForMission, loadAssessments } from './uxAssessment.js';
// M1-P4.1 — target URL security boundary (SSRF).
import { validateTargetUrl, classifyUrlFast, validateWebhookUrl } from './targetGuard.js';
// M1-P4.3 — mission status transition validation (PATCH contract).
import { isLegalMissionTransition } from './stateTransitions.js';
// M1-P4.3 — cross-store integrity diagnostic.
import { checkStateIntegrity } from './stateIntegrity.js';
// M1-P4.3 — backward-compatible pagination for large collections.
import { paginateList } from './pagination.js';
// B1 W3 — anonymous read surface closed. The M1-P3 public-read exemptions
// are removed: every phaseRouter route now requires the bearer/cookie token
// (the SPA attaches it from localStorage), EXCEPT the HMAC-signed
// /api/v1/integration/* surface which authenticates itself.
const PUBLIC_READ_GET = [];
app.use('/api', phaseRouter(requireApiToken, PUBLIC_READ_GET));

/* ═══════════════ Pulse read surface (OpenAPI v2) ═══════════════ */

// Versioned read façade for external analytics agents (Drytis Pulse): JSON
// document + /api/v2 GET endpoints shaped exactly as the document declares.
// Legacy routes above are untouched.
// C1 G3 — init the bounded request-usage tracker; mount the counter AFTER
// requireApiToken inside the router so only authenticated v2 reads are counted.
initApiUsageTracker();
app.use('/api/v2', pulseV2Router(requireApiToken, apiUsageCounter()));

app.get('/openapi.json', (_request, response) => {
	const serverUrl = (process.env.QASE_PUBLIC_URL || '').trim() || `${_request.protocol}://${_request.get('host')}`;
	response.setHeader('Cache-Control', 'no-store');
	response.type('application/json');
	response.json(buildOpenApiDocument({ serverUrl }));
});

/* ═══════════════ B1 — Integration API (HMAC-signed) ═══════════════ */

/**
 * B1 W1/W2/W4 — the external integration surface. Requests authenticate
 * with QASE-HMAC-SHA256 signatures (QASE_INTEGRATION_SECRET), identify as
 * admin or integration principals bound to a workspace, and carry
 * workspace-scoped idempotency + correlation semantics. The legacy UI
 * bearer-token surface is untouched.
 */

// Bootstrap: seed the admin principal once (idempotent) so a fresh server
// has an operator identity. keyId is logged at boot ONLY in the form of a
// hint — the operator derives the same keyId from their own records.
function bootstrapIntegrationPrincipals() {
	const adminKeyId = process.env.QASE_ADMIN_KEY_ID?.trim() || 'qase-admin';
	if (!getIntegration(adminKeyId)) {
		upsertIntegration({ keyId: adminKeyId, principal: 'admin', workspaceId: '*', label: 'operator admin' });
		console.log(`[integrations] bootstrapped admin principal (keyId: ${adminKeyId.slice(0, 6)}…)`);
	}
}
bootstrapIntegrationPrincipals();

/* ── Integration: who am I (auth check) ── */
app.get('/api/v1/integration/whoami', requireIntegrationAuth, (request, response) => {
	response.json({
		keyId: request.integration.keyId,
		principal: request.integration.principal,
		workspaceId: request.integration.workspaceId,
		label: request.integration.label,
		scopes: request.integration.principal === 'admin'
			? ['*']
			: ['mission:create', 'mission:read', 'mission:stop', 'findings:read', 'evidence:read', 'revalidate']
	});
});

/* ── Integration: register an integration principal (ADMIN only) ── */
app.post('/api/v1/integration/keys', requireIntegrationAuth, (request, response) => {
	if (request.integration.principal !== 'admin') {
		return response.status(403).json({ error: { code: 'admin_required', message: 'Only the admin principal may register integrations.' } });
	}
	const { keyId, workspaceId, label } = request.body ?? {};
	if (!keyId || typeof keyId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(keyId)) {
		return response.status(400).json({ error: { code: 'invalid_key_id', message: 'keyId: 4–64 chars [A-Za-z0-9_-].' } });
	}
	if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.length > 100) {
		return response.status(400).json({ error: { code: 'invalid_workspace', message: 'workspaceId required (≤100 chars).' } });
	}
	const record = upsertIntegration({ keyId, principal: 'integration', workspaceId, label });
	response.status(201).json({ keyId: record.keyId, principal: record.principal, workspaceId: record.workspaceId, label: record.label });
});

/* ── Integration: list principals (ADMIN only; no secrets — there are none) ── */
app.get('/api/v1/integration/keys', requireIntegrationAuth, (_request, response) => {
	if (_request.integration.principal !== 'admin') {
		return response.status(403).json({ error: { code: 'admin_required', message: 'Admin only.' } });
	}
	response.json({ integrations: listIntegrations() });
});

/* ── Integration: workspace-scoped mission create ── */
app.post('/api/v1/integration/missions', requireIntegrationAuth, async (request, response) => {
	const body = request.body ?? {};
	if (!hasScope(request.integration, 'mission:create')) {
		return response.status(403).json({ error: { code: 'scope_forbidden', message: 'Principal lacks mission:create.' } });
	}
	if (!body.targetUrl) {
		return response.status(400).json({ error: { code: 'target_required', message: 'targetUrl is required.' } });
	}
	const targetCheck = await validateTargetUrl(body.targetUrl);
	if (!targetCheck.ok) {
		return response.status(400).json({ error: { code: targetCheck.code, message: targetCheck.message } });
	}
	// maxTurns contract — same validation as the UI route.
	const rawMaxTurns = body.context?.maxTurns ?? body.maxTurns ?? null;
	let missionMaxTurns = null;
	if (rawMaxTurns !== null) {
		const n = Number(rawMaxTurns);
		if (!Number.isInteger(n) || n < 1 || n > 500) {
			return response.status(400).json({ error: { code: 'invalid_max_turns', message: 'context.maxTurns must be an integer 1–500.' } });
		}
		missionMaxTurns = n;
	}
	// Device constraint validation — same as UI route.
	const missionDeviceInput = body.constraints?.device ?? body.deviceRequest ?? null;
	const missionDeviceCheck = missionDeviceInput != null ? validateDeviceRequest(missionDeviceInput) : null;
	if (missionDeviceCheck && !missionDeviceCheck.ok) {
		return response.status(400).json({ error: { code: 'invalid_device', message: missionDeviceCheck.error } });
	}
	const missionDevice = missionDeviceCheck ? missionDeviceCheck.deviceName : null;

	// Idempotency (workspace-scoped, restart-safe via missions.json).
	const idemHeader = typeof request.headers['idempotency-key'] === 'string'
		? request.headers['idempotency-key'].trim().slice(0, 200) : null;
	const compositeKey = idemHeader ? `${request.integration.workspaceId}:${idemHeader}` : null;
	// B1 review — request fingerprint for idempotency conflict detection.
	// Semantically-relevant request fields only (name/type/target/context/
	// constraints/autoStart), NOT volatile fields like correlationId or the
	// Idempotency-Key itself. Credentials are excluded from the fingerprint
	// (they live in the vault), but a credential-vs-no-credential difference
	// IS part of the shape.
	const fingerprintSource = {
		name: body.name ?? null,
		type: body.type ?? null,
		targetUrl: body.targetUrl ?? null,
		objectives: body.objectives ?? null,
		capabilities: body.capabilities ?? null,
		constraints: body.constraints ?? null,
		successCriteria: body.successCriteria ?? null,
		context: body.context ?? null,
		autoStart: body.autoStart !== false
	};
	if (body.testCredentials) {
		fingerprintSource.testCredentialsShape = Object.keys(body.testCredentials).sort().join(',');
	}
	const requestFingerprint = compositeKey
		? createHash('sha256').update(JSON.stringify(fingerprintSource)).digest('hex')
		: null;
	if (compositeKey) {
		const existing = findByIdempotencyKey(compositeKey);
		if (existing) {
			// Same key + DIFFERENT request body → the caller is misusing the
			// key (a retry must replay the SAME request). 409, never silently
			// return the original mission. (B1 review MUST-FIX #3.)
			if (existing.idempotencyFingerprint && existing.idempotencyFingerprint !== requestFingerprint) {
				return response.status(409).json({
					error: {
						code: 'idempotency_key_reused',
						message: 'Idempotency-Key was already used with a different request body.',
						missionId: existing.id
					},
					correlationId: request.correlationId
				});
			}
			return response.status(200).json({
				missionId: existing.id, status: existing.status,
				idempotentReplay: true, createdAt: existing.createdAt,
				correlationId: request.correlationId
			});
		}
	}

	let contextForMission = {
		buildPrompt: body.buildPrompt || undefined,
		requirements: body.requirements || undefined,
		businessGoals: body.businessGoals || undefined,
		...(missionMaxTurns !== null ? { maxTurns: missionMaxTurns } : {})
	};
	if (body.testCredentials && typeof body.testCredentials === 'object') {
		const credEntries = {};
		if (body.testCredentials.username) credEntries.QA_USERNAME = body.testCredentials.username;
		if (body.testCredentials.password) credEntries.QA_PASSWORD = body.testCredentials.password;
		if (Object.keys(credEntries).length > 0) {
			storeSecrets(`mission-temp`, credEntries);
			contextForMission.testCredentials = { vaultKey: 'mission-temp', placeholders: Object.keys(credEntries).map(k => `{{${k}}}`) };
		}
	}

	const mission = createMission({
		projectId: body.projectId,
		type: body.type,
		name: body.name,
		targetUrl: body.targetUrl,
		objectives: body.objectives,
		capabilities: body.capabilities,
		source: body.source || 'integration',
		generationId: body.generationId,
		constraints: { ...(body.constraints || {}), ...(missionDevice ? { device: missionDevice } : {}) },
		successCriteria: body.successCriteria,
		context: contextForMission,
		workspaceId: request.integration.workspaceId === '*' ? (body.workspaceId || undefined) : request.integration.workspaceId,
		correlationId: request.correlationId,
		idempotencyKey: compositeKey || undefined,
		idempotencyFingerprint: requestFingerprint || undefined
	});

	if (body.autoStart !== false) {
		const outcome = startMissionExecution(mission, () => {
			// B2 — missionId is passed at creation so it PERSISTS on the
			// session record (turn pool + finding linkage survive restarts).
			const session = createSession(mission.name || 'Integration Mission', mission.projectId, {
				...(missionDevice ? { deviceRequest: missionDevice } : {}),
				missionId: mission.id
			});
			session.targetUrl = mission.targetUrl;
			const missionTurns = Number(mission.context?.maxTurns);
			if (Number.isInteger(missionTurns) && missionTurns >= 1) {
				session.maxTurns = Math.min(missionTurns, 500);
			}
			if (mission.context?.testCredentials?.vaultKey === 'mission-temp') {
				const tempVault = vaultFor('mission-temp');
				if (tempVault.size > 0) {
					storeSecrets(session.id, Object.fromEntries(tempVault));
					clearSecrets('mission-temp');
					session.secretNames = [...tempVault.keys()];
				}
			}
			updateMission(mission.id, { sessionId: session.id, status: 'running', startedAt: Date.now() });
			buildTestContext(session, mission); // B2 W1 — risk/priority context for the per-turn prompt
			const taskPrompt = buildMissionPrompt(mission);
			ensureRuntime(session).then(() => {
				startTurn(session, { task: taskPrompt });
			}).catch(startError => {
				addMessage(session, { role: 'system', text: `Agent runtime failed to start: ${startError.message}`, kind: 'error' });
				setStatus(session, 'error', startError.message);
				updateMission(mission.id, { status: 'failed', failureReason: `runtime start: ${startError.message}` });
			});
		});
		if (outcome === 'queued') {
			updateMission(mission.id, { status: 'queued', queuedAt: Date.now() });
		}
		return response.status(202).json({
			missionId: mission.id,
			status: outcome === 'queued' ? 'queued' : 'running',
			queuePosition: outcome === 'queued' ? queuePositionOf(mission.id) : undefined,
			correlationId: request.correlationId
		});
	}
	response.status(201).json({
		missionId: mission.id,
		status: 'created',
		correlationId: request.correlationId,
		message: 'Mission created but not started. POST /api/v1/integration/missions/:id/start to begin.'
	});
});

/* ── Integration: start / revalidate — see handlers further down.
 * (Registered after the shared handler definitions; keep route table tidy.) ── */

/* ── Integration: mission status ── */
app.get('/api/v1/integration/missions/:id', requireIntegrationAuth, (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	const session = mission.sessionId ? getSession(mission.sessionId) : null;
	response.json({
		id: mission.id,
		status: mission.status,
		type: mission.type,
		targetUrl: mission.targetUrl,
		qualityScore: mission.qualityScore,
		verdict: mission.verdict,
		releaseReady: mission.releaseReady,
		findingsCount: (mission.findings ?? []).length,
		sessionId: mission.sessionId,
		turnCount: session?.turnCount ?? null,
		maxTurns: mission.context?.maxTurns ?? null,
		correlationId: mission.correlationId,
		createdAt: mission.createdAt,
		completedAt: mission.completedAt,
		failureReason: mission.failureReason ?? null
	});
});

/* ── Integration: mission report (json | markdown) ── */
app.get('/api/v1/integration/missions/:id/report', requireIntegrationAuth, (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	const findings = mission.findings ?? [];
	const quality = calculateMissionQuality(findings);
	const report = buildImprovementPrompt(mission, findings, quality);
	if (request.query.format === 'markdown' || request.query.format === 'md') {
		response.type('text/markdown').send(buildMissionReportMarkdown(mission, report));
		return;
	}
	response.json({ missionId: mission.id, missionType: mission.type, targetUrl: mission.targetUrl, ...report });
});

/* ── Integration: B2 autonomy decision trace (13-field schema, sanitized) ── */
app.get('/api/v1/integration/missions/:id/decision-trace', requireIntegrationAuth, (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	const traces = getDecisionTraces(mission.id);
	response.json({ missionId: mission.id, autonomyEnabled: autonomyEnabled(), count: traces.length, decisions: traces });
});

/* ── Integration: findings (mission-scoped, paginated) ── */
app.get('/api/v1/integration/missions/:id/findings', requireIntegrationAuth, (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	const limit = Math.min(parseInt(request.query.limit) || 50, 200);
	const offset = parseInt(request.query.offset) || 0;
	// B1 W2 — merge three sources: mission-inline findings, findings indexed
	// by missionId, and (critically) findings persisted by the autonomous
	// run's sessionId — the agent reports findings keyed to its session, and
	// only the session→mission stamp links them. Deduped by finding id.
	const all = [
		...(mission.findings ?? []),
		...(mission.id ? listFindings({ missionId: mission.id }) : []),
		...(mission.sessionId ? listFindings({ sessionId: mission.sessionId }) : [])
	];
	const dedup = new Map();
	for (const f of all) dedup.set(f.id, f);
	const items = [...dedup.values()].slice(offset, offset + limit);
	response.json({ missionId: mission.id, findings: items, total: dedup.size, limit, offset });
});

/* ── Integration: evidence (mission-scoped, paginated) ── */
app.get('/api/v1/integration/missions/:id/evidence', requireIntegrationAuth, (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	const limit = Math.min(parseInt(request.query.limit) || 100, 500);
	const offset = parseInt(request.query.offset) || 0;
	const { items: evidence, total } = getMissionEvidencePage(mission.id, { limit, offset });
	response.json({ missionId: mission.id, evidence, total, limit, offset });
});

/* ── Integration: stop a mission ── */
app.post('/api/v1/integration/missions/:id/stop', requireIntegrationAuth, (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	if (!hasScope(request.integration, 'mission:stop')) {
		return response.status(403).json({ error: { code: 'scope_forbidden', message: 'Principal lacks mission:stop.' } });
	}
	if (mission.sessionId) {
		const record = liveFor(mission.sessionId);
		record?.controller?.abort();
		void closeBrowser(mission.sessionId);
	}
	updateMission(mission.id, { status: 'aborted', completedAt: Date.now(), stopReason: 'integration_stop' });
	releaseMission(mission.id);
	response.json({ missionId: mission.id, status: 'aborted', stopReason: 'integration_stop' });
});

/* ── Integration: start a previously-created (autoStart:false) mission ──
 * Wraps the same logic as POST /api/v1/missions/:id/start but under the
 * integration identity (scope + ownership checked via the mission lookup).
 * Re-issues the request against the token-gated handler with the server's
 * own bearer token context is NOT acceptable — instead the handler body is
 * shared by calling the internal start path directly. */
app.post('/api/v1/integration/missions/:id/start', requireIntegrationAuth, async (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	if (!hasScope(request.integration, 'mission:create')) {
		return response.status(403).json({ error: { code: 'scope_forbidden', message: 'Principal lacks mission:create.' } });
	}
	// Delegate to the shared start implementation (same guards: terminal
	// status, already running/queued, target re-validation, governor slots).
	await startMissionByIdHandler(request, response, mission);
});

/* ── Integration: register a webhook for this workspace's missions ── */
app.post('/api/v1/integration/webhooks', requireIntegrationAuth, async (request, response) => {
	const { url, events } = request.body ?? {};
	if (!url || typeof url !== 'string') {
		return response.status(400).json({ error: { code: 'url_required', message: 'url is required.' } });
	}
	const check = await validateWebhookUrl(url);
	if (!check.ok) {
		return response.status(400).json({ error: { code: check.code ?? 'invalid_url', message: check.message } });
	}
	const hook = registerWebhookSubscription({
		url,
		events: Array.isArray(events) && events.length ? events : ['mission.completed', 'mission.failed'],
		workspaceId: request.integration.workspaceId === '*' ? null : request.integration.workspaceId,
		label: request.body?.label || request.integration.label
	});
	response.status(201).json({ webhookId: hook.id, url: hook.url, events: hook.events });
});

/* ── Integration: mission revalidation (new validation-loop iteration) ──
 * Wraps the Phase 5 revalidation loop under the integration identity.
 * Ownership via requireMissionForIntegration; scope revalidate. */
app.post('/api/v1/integration/missions/:id/revalidate', requireIntegrationAuth, async (request, response) => {
	const mission = requireMissionForIntegration(request, response);
	if (!mission) return;
	if (!hasScope(request.integration, 'revalidate')) {
		return response.status(403).json({ error: { code: 'scope_forbidden', message: 'Principal lacks revalidate.' } });
	}
	await revalidateMissionByIdHandler(request, response, mission);
});

/* ── Integration: finding revalidation (Phase 18 fix-validation run) ──
 * Ownership: the finding's mission workspace must match the principal. */
app.post('/api/v1/integration/findings/:id/revalidate', requireIntegrationAuth, (request, response) => {
	if (!hasScope(request.integration, 'revalidate')) {
		return response.status(403).json({ error: { code: 'scope_forbidden', message: 'Principal lacks revalidate.' } });
	}
	// B1 W2 — ownership is resolved through the finding's mission, directly
	// (finding.missionId) or via its session (finding.sessionId → mission),
	// because autonomous-run findings are persisted by sessionId only.
	const finding = getFinding(request.params.id);
	if (!finding) {
		return response.status(404).json({ error: { code: 'finding_not_found', message: 'Finding not found.' } });
	}
	let owningMission = finding.missionId ? getMission(finding.missionId) : null;
	if (!owningMission && finding.sessionId) {
		// Session-born findings never carried missionId; resolve the mission
		// by sessionId instead. Missions store sessionId on start.
		owningMission = listMissions({}).find(m => m.sessionId === finding.sessionId) ?? null;
	}
	if (request.integration && !workspaceMatches(request.integration, owningMission ? workspaceOfMission(owningMission) || null : null)) {
		return response.status(403).json({ error: { code: 'workspace_forbidden', message: 'Finding belongs to another workspace.' } });
	}
	// Same contract as the token-gated /v1/findings/:id/revalidate — but the
	// idempotency key is WORKSPACE-SCOPED (same scheme as mission create) so
	// one tenant's key can never suppress another tenant's validation run.
	const idemKey = typeof request.headers['idempotency-key'] === 'string'
		? request.headers['idempotency-key'].trim().slice(0, 200) : null;
	const compositeKey = idemKey ? `${request.integration.workspaceId}:${idemKey}` : null;
	if (compositeKey) {
		const existing = findValidationByIdempotencyKey(compositeKey);
		if (existing) {
			return response.status(200).json({ duplicate: true, validationId: existing.id, status: existing.status });
		}
	}
	const active = getValidationRunsForFinding(finding.id).find(r => ['REQUESTED', 'QUEUED', 'RUNNING'].includes(r.status));
	if (active) {
		return response.status(409).json({ error: { code: 'validation_in_progress', validationId: active.id } });
	}
	const run = createValidationRun({ finding, requestedBy: `integration:${request.integration.keyId}`, idempotencyKey: compositeKey, trigger: 'integration' });
	transitionValidationRun(run.id, { status: 'QUEUED' }, 'queued by integration');
	executeValidation(run.id, { getFinding }).catch(err => {
		console.error(`[fix-validation] run ${run.id} crashed:`, err?.message || err);
		transitionValidationRun(run.id, { status: 'FAILED', error: String(err?.message || err) }, 'crashed');
	});
	response.status(202).json({ validationId: run.id, status: run.status, pollUrl: `/api/v1/integration/findings/${finding.id}/validation`, correlationId: request.correlationId });
});

/* ── Integration: finding validation status (Phase 18 run history) ── */
app.get('/api/v1/integration/findings/:id/validation', requireIntegrationAuth, (request, response) => {
	const finding = getFinding(request.params.id);
	if (!finding) {
		return response.status(404).json({ error: { code: 'finding_not_found', message: 'Finding not found.' } });
	}
	let owningMission = finding.missionId ? getMission(finding.missionId) : null;
	if (!owningMission && finding.sessionId) {
		// B1 W2 — session-born findings: resolve ownership via sessionId.
		owningMission = listMissions({}).find(m => m.sessionId === finding.sessionId) ?? null;
	}
	if (request.integration && !workspaceMatches(request.integration, owningMission ? workspaceOfMission(owningMission) || null : null)) {
		return response.status(403).json({ error: { code: 'workspace_forbidden', message: 'Finding belongs to another workspace.' } });
	}
	const runs = getValidationRunsForFinding(finding.id);
	if (!runs.length) {
		return response.status(404).json({ error: { code: 'no_runs', message: 'No validation runs.' } });
	}
	response.json({ latest: runs[0], history: runs.slice(1, 21), metrics: getValidationMetrics(), correlationId: request.correlationId });
});

// NOTE: GET /api/findings is registered ABOVE the phaseRouter mount (M1-P3
// public-read fix) — this duplicate registration is unreachable; left as a
// pointer to the legacy findings block (detail/mutation routes below).

app.get('/api/findings/stats', requireApiToken, (request, response) => {
	response.json(getFindingStats({ projectId: request.query.projectId }));
});

/* Cross-session findings export — MUST be before /:id routes to avoid shadowing. */
app.get('/api/findings/export', requireApiToken, (request, response) => {
	const format = request.query.format ?? 'markdown';
	const matched = listFindings({
		projectId: request.query.projectId,
		severity: request.query.severity,
		status: request.query.status,
		category: request.query.category,
		q: request.query.q
	});

	if (matched.length === 0) {
		return response.status(404).json({ error: 'No findings match the current filters' });
	}

	if (format === 'markdown') {
		const md = exportFindingsBulkMarkdown(matched);
		response.type('text/markdown')
			.set('Content-Disposition', 'attachment; filename="bugs-report.md"')
			.send(md);
		return;
	}

	let data;
	let filename;

	switch (format) {
		case 'github':
			data = exportFindingsBulkGitHub(matched);
			filename = 'bugs-github.json';
			break;
		case 'jira':
			data = exportFindingsBulkJira(matched);
			filename = 'bugs-jira.json';
			break;
		case 'linear':
			data = exportFindingsBulkLinear(matched);
			filename = 'bugs-linear.json';
			break;
		default:
			return response.status(400).json({ error: `Unknown format: ${format}` });
	}

	response.type('application/json')
		.set('Content-Disposition', `attachment; filename="${filename}"`)
		.json(data);
});

app.post('/api/findings', requireApiToken, (request, response) => {
	const data = request.body ?? {};
	const finding = addFinding({
		...data,
		projectId: data.projectId ?? getDefaultProjectId(),
		createdBy: 'user'
	});
	response.status(201).json(finding);
});

app.get('/api/findings/:id', requireApiToken, (request, response) => {
	const finding = getFinding(request.params.id);
	if (!finding) {
		return response.status(404).json({ error: 'Finding not found' });
	}
	// Enrich with linked test case names.
	const linkedTests = (finding.testCaseIds ?? [])
		.map(id => getTestCase(id))
		.filter(Boolean)
		.map(tc => ({ id: tc.id, name: tc.name, severity: tc.severity }));
	response.json({ ...finding, linkedTests });
});

app.put('/api/findings/:id', requireApiToken, (request, response) => {
	const finding = updateFinding(request.params.id, request.body ?? {});
	if (!finding) {
		return response.status(404).json({ error: 'Finding not found' });
	}
	response.json(finding);
});

app.delete('/api/findings/:id', requireApiToken, (request, response) => {
	const deleted = deleteFinding(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

// M1-P3 P0-6: mutation endpoints require the token (was open).
app.patch('/api/findings/:id/status', requireApiToken, (request, response) => {
	const { status, by } = request.body ?? {};
	const finding = changeStatus(request.params.id, status, by);
	if (!finding) {
		return response.status(404).json({ error: 'Finding not found or invalid status' });
	}
	response.json(finding);
});

app.post('/api/findings/:id/comments', requireApiToken, (request, response) => {
	const { author, text } = request.body ?? {};
	const comment = addComment(request.params.id, author, text);
	if (!comment) {
		return response.status(404).json({ error: 'Finding not found or empty comment' });
	}
	response.status(201).json(comment);
});

app.post('/api/findings/:id/link/:testCaseId', requireApiToken, (request, response) => {
	const finding = linkTestCase(request.params.id, request.params.testCaseId);
	if (!finding) {
		return response.status(404).json({ error: 'Finding not found' });
	}
	// Bi-directional: add findingId to the test case.
	const tc = getTestCase(request.params.testCaseId);
	if (tc && !(tc.findingIds ?? []).includes(request.params.id)) {
		tc.findingIds = [...(tc.findingIds ?? []), request.params.id];
		// Persist via updateTestCase (triggers persistSoon).
		updateTestCase(request.params.testCaseId, { findingIds: tc.findingIds });
	}
	response.json(finding);
});

app.delete('/api/findings/:id/link/:testCaseId', requireApiToken, (request, response) => {
	const finding = unlinkTestCase(request.params.id, request.params.testCaseId);
	if (!finding) {
		return response.status(404).json({ error: 'Finding not found' });
	}
	// Bi-directional: remove findingId from the test case.
	const tc = getTestCase(request.params.testCaseId);
	if (tc && (tc.findingIds ?? []).includes(request.params.id)) {
		tc.findingIds = (tc.findingIds ?? []).filter(fid => fid !== request.params.id);
		updateTestCase(request.params.testCaseId, { findingIds: tc.findingIds });
	}
	response.json(finding);
});

/* ── Export routes ──────────────────────────────────────────────── */

app.get('/api/sessions/:id/export/findings', requireApiToken, (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;

	const format = request.query.format ?? 'markdown';

	if (format === 'markdown') {
		response.type('text/markdown')
			.set('Content-Disposition', `attachment; filename="findings-${session.id}.md"`)
			.send(buildReportMarkdown(session));
		return;
	}

	let data;
	let filename;
	let contentType = 'application/json';

	switch (format) {
		case 'github':
			data = exportFindingsGitHub(session);
			filename = `findings-${session.id}-github.json`;
			break;
		case 'jira':
			data = exportFindingsJira(session);
			filename = `findings-${session.id}-jira.json`;
			break;
		case 'linear':
			data = exportFindingsLinear(session);
			filename = `findings-${session.id}-linear.json`;
			break;
		default:
			return response.status(400).json({ error: `Unknown format: ${format}` });
	}

	response.type(contentType)
		.set('Content-Disposition', `attachment; filename="${filename}"`)
		.json(data);
});

/* ── Project routes ─────────────────────────────────────────────── */

app.post('/api/projects', requireApiToken, (request, response) => {
	const project = createProject(request.body ?? {});
	response.status(201).json(project);
});

app.put('/api/projects/:id', requireApiToken, (request, response) => {
	const project = updateProject(request.params.id, request.body ?? {});
	if (!project) {
		return response.status(404).json({ error: 'Project not found' });
	}
	response.json(project);
});

app.delete('/api/projects/:id', requireApiToken, (request, response) => {
	const deleted = deleteProject(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

// NOTE: GET /api/missions is registered ABOVE the phaseRouter mount (M1-P3
// public-read fix) — this duplicate is unreachable; mission detail reads +
// gated mutations follow.

app.post('/api/missions', requireApiToken, async (request, response) => {
	// M1-P4.1 — same SSRF boundary as the v1 route.
	if (request.body?.targetUrl) {
		const legacyTargetCheck = await validateTargetUrl(request.body.targetUrl);
		if (!legacyTargetCheck.ok) {
			return response.status(400).json({ error: legacyTargetCheck.message, code: legacyTargetCheck.code });
		}
	}
	const mission = createMission(request.body ?? {});
	response.status(201).json(mission);
});

app.get('/api/missions/:id', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	response.json(mission);
});

app.put('/api/missions/:id', requireApiToken, async (request, response) => {
	// M1-P4.1 — targetUrl is in the update allowlist; it must pass the SSRF
	// boundary before being persisted (stored URLs are executed later).
	if (typeof request.body?.targetUrl === 'string' && request.body.targetUrl.trim() !== '') {
		const check = await validateTargetUrl(request.body.targetUrl);
		if (!check.ok) {
			return response.status(400).json({ error: check.message, code: check.code });
		}
	}
	// M1-P4.3 — status changes via PUT must be legal transitions; the store
	// silently drops illegal ones, so detect the attempt here and 409 so API
	// clients get truthful feedback instead of a silently-unchanged record.
	if (request.body?.status != null) {
		const current = getMission(request.params.id);
		if (current && request.body.status !== current.status) {
			// The ONE sanctioned resurrection (completed→running) belongs to the
			// revalidate route, which creates a new session/iteration. Plain PUT
			// must not re-open a completed mission around a stale sessionId.
			if (current.status === 'completed' && request.body.status === 'running') {
				return response.status(409).json({
					error: 'Completed missions are re-opened via POST /api/v1/missions/:id/revalidate (creates a new session/iteration), not via status update.',
					code: 'ILLEGAL_MISSION_TRANSITION',
					from: current.status,
					to: request.body.status
				});
			}
			if (!isLegalMissionTransition(current.status, request.body.status)) {
				return response.status(409).json({
					error: `Illegal mission status transition ${current.status} → ${request.body.status}`,
					code: 'ILLEGAL_MISSION_TRANSITION',
					from: current.status,
					to: request.body.status
				});
			}
		}
	}
	const mission = updateMission(request.params.id, request.body ?? {});
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	response.json(mission);
});

app.delete('/api/missions/:id', requireApiToken, (request, response) => {
	const deleted = deleteMission(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

/**
 * Links a mission to an existing session and copies session findings
 * into the mission, then runs quality scoring.
 */
app.post('/api/missions/:id/link-session', requireApiToken, async (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	const session = getSession(request.body?.sessionId);
	if (!session) {
		return response.status(404).json({ error: 'Session not found' });
	}

	// M1-P4.1 — session.targetUrl passes through the SSRF boundary before it
	// can be adopted by a mission (stored URLs can outlive policy changes).
	if (session.targetUrl) {
		const check = await validateTargetUrl(session.targetUrl);
		if (!check.ok) {
			return response.status(400).json({ error: check.message, code: check.code });
		}
	}

	updateMission(mission.id, {
		sessionId: session.id,
		status: 'running',
		findings: session.findings ?? [],
		targetUrl: session.targetUrl ?? mission.targetUrl
	});

	response.json(getMission(mission.id));
});

/* ── Public API v1 (external integration) ──────────────────────── */

/**
 * The public API is the integration contract for external consumers
 * (Drytis dev team, AI Studio, CI/CD pipelines).
 *
 * All routes under /api/v1/ require Bearer token auth.
 * Pattern: submit mission → poll status → get report (or webhook).
 */

/* ── B1 W2 — workspace ownership resolution ─────────────────────── */

/**
 * Resolves the owning workspace of a mission: mission.workspaceId if set,
 * else the mission's project's workspaceId (projects carry the workspace
 * from first integration), else null (pre-B1 legacy data → admin-only read
 * for integration principals; UI bearer token still sees everything).
 */
function workspaceOfMission(mission) {
	if (!mission) return undefined;
	if (mission.workspaceId) return mission.workspaceId;
	const project = getProject(mission.projectId);
	return project?.workspaceId ?? null;
}

/** 404 for missing, 403 for wrong workspace — never leak existence. */
function requireMissionForIntegration(request, response) {
	const mission = getMission(request.params.id);
	if (!mission) {
		response.status(404).json({ error: { code: 'mission_not_found', message: 'Mission not found.' } });
		return undefined;
	}
	const identity = request.integration;
	if (identity && !workspaceMatches(identity, workspaceOfMission(mission))) {
		response.status(403).json({ error: { code: 'workspace_forbidden', message: 'Mission belongs to another workspace.' } });
		return undefined;
	}
	return mission;
}

app.post('/api/v1/missions', requireApiToken, async (request, response) => {
	const body = request.body ?? {};

	// B1 W4 — idempotent mission creation. Same (workspace, key) → same
	// mission, 200 with existing record; keys are workspace-scoped so two
	// workspaces may use the same key independently. Survives restart because
	// the key is stored on the mission itself (missions.json).
	const idempotencyKey = typeof request.headers['idempotency-key'] === 'string'
		? request.headers['idempotency-key'].trim().slice(0, 200)
		: null;
	if (idempotencyKey) {
		const callerWorkspace = request.integration?.workspaceId ?? '__ui__';
		const compositeKey = `${callerWorkspace}:${idempotencyKey}`;
		const existing = findByIdempotencyKey(compositeKey);
		if (existing) {
			response.setHeader('X-Correlation-Id', request.correlationId);
			return response.status(200).json({
				missionId: existing.id,
				status: existing.status,
				idempotentReplay: true,
				createdAt: existing.createdAt
			});
		}
	}

	// B1 W4 — maxTurns contract: mission context wins, clamped to the hard
	// ceiling of 500; the stored-config default applies when not supplied.
	// Anything > 500 or < 1 is a 400 — the API must not lie about budget.
	const rawMaxTurns = body.context?.maxTurns ?? body.maxTurns ?? null;
	let missionMaxTurns = null;
	if (rawMaxTurns !== null) {
		const n = Number(rawMaxTurns);
		if (!Number.isInteger(n) || n < 1 || n > 500) {
			return response.status(400).json({
				error: { code: 'invalid_max_turns', message: 'context.maxTurns must be an integer 1–500.' }
			});
		}
		missionMaxTurns = n;
	}

	// Validate required fields
	if (!body.targetUrl) {
		return response.status(400).json({ error: 'targetUrl is required' });
	}

	// M1-P4.1 — SSRF boundary: validate the target URL BEFORE creating the
	// mission. Public http(s) targets pass; loopback only on QASE's own
	// practice ports (demo + benchmarks); everything private/link-local/
	// reserved/metadata is rejected with a deterministic code.
	const targetCheck = await validateTargetUrl(body.targetUrl);
	if (!targetCheck.ok) {
		return response.status(400).json({ error: targetCheck.message, code: targetCheck.code });
	}

	// Build mission context — testCredentials go to in-memory vault, not persisted JSON
	let contextForMission = {
		buildPrompt: body.buildPrompt || undefined,
		requirements: body.requirements || undefined,
		businessGoals: body.businessGoals || undefined,
		// B1 W6 — mission-scoped turn budget reaches execution (see startMissionExecution)
		...(missionMaxTurns !== null ? { maxTurns: missionMaxTurns } : {}),
		// B2 W4 — per-mission autonomy switch (context.autonomy=false disables
		// the decision engine for THIS mission only; default on).
		...(body.context?.autonomy === false ? { autonomy: false } : {})
	};

	if (body.testCredentials && typeof body.testCredentials === 'object') {
		const credEntries = {};
		if (body.testCredentials.username) credEntries.QA_USERNAME = body.testCredentials.username;
		if (body.testCredentials.password) credEntries.QA_PASSWORD = body.testCredentials.password;
		if (Object.keys(credEntries).length > 0) {
			storeSecrets(`mission-temp`, credEntries);
			contextForMission.testCredentials = { vaultKey: 'mission-temp', placeholders: Object.keys(credEntries).map(k => `{{${k}}}`) };
		}
	}

	// B0.3 — validate the mission's device constraint BEFORE creating a
	// session, so an unsupported device fails the mission create with 400
	// instead of silently running desktop. Class strings ('mobile'/'tablet')
	// and named devices pass through; desktop/empty stay desktop.
	const missionDeviceInput = body.constraints?.device ?? body.deviceRequest ?? null;
	const missionDeviceCheck = missionDeviceInput != null ? validateDeviceRequest(missionDeviceInput) : null;
	if (missionDeviceCheck && !missionDeviceCheck.ok) {
		return response.status(400).json({ error: missionDeviceCheck.error });
	}
	const missionDevice = missionDeviceCheck ? missionDeviceCheck.deviceName : null;

	// Create the mission
	const mission = createMission({
		projectId: body.projectId,
		type: body.type,
		name: body.name,
		targetUrl: body.targetUrl,
		objectives: body.objectives,
		capabilities: body.capabilities,
		source: body.source || 'api',
		generationId: body.generationId,
		constraints: { ...(body.constraints || {}), ...(missionDevice ? { device: missionDevice } : {}) },
		successCriteria: body.successCriteria,
		context: contextForMission,
		// B1 W2/W4 — identity traceability: workspace + correlation + idempotency
		workspaceId: request.integration?.workspaceId && request.integration.workspaceId !== '*'
			? request.integration.workspaceId
			: (body.workspaceId || undefined),
		correlationId: request.correlationId,
		idempotencyKey: idempotencyKey
			? `${request.integration?.workspaceId ?? '__ui__'}:${idempotencyKey}`
			: (body.idempotencyKey || undefined)
	});

	// Optionally auto-start: create a session and kick off the agent
	if (body.autoStart !== false) {
		// M1-P4.2 — route through the execution governor. The heavy work
		// (session + Chromium + LLM) only begins when a slot is granted;
		// otherwise the mission waits in `queued`.
		const outcome = startMissionExecution(mission, () => {
			const session = createSession(mission.name || 'API Mission', mission.projectId, {
				...(missionDevice ? { deviceRequest: missionDevice } : {}),
				missionId: mission.id
			});
			session.targetUrl = mission.targetUrl;

			// B1 W6 — the mission's turn budget reaches the agent runtime.
			// Precedence (operator decision): mission context > stored config
			// default (120). The create-route already rejected >500, and the
			// agent enforces both the SDK limit AND an independent hard abort.
			const missionTurns = Number(mission.context?.maxTurns);
			if (Number.isInteger(missionTurns) && missionTurns >= 1) {
				session.maxTurns = Math.min(missionTurns, 500);
			}

			// Migrate temp vault credentials to session scope
			if (mission.context?.testCredentials?.vaultKey === 'mission-temp') {
				const tempVault = vaultFor('mission-temp');
				if (tempVault.size > 0) {
					storeSecrets(session.id, Object.fromEntries(tempVault));
					clearSecrets('mission-temp');
					session.secretNames = [...tempVault.keys()];
				}
			}

			// Link mission to session
			updateMission(mission.id, {
				sessionId: session.id,
				status: 'running',
				startedAt: Date.now()
			});

			// Phase 3: Query knowledge BEFORE exploration and inject as hints
			let knowledgeHints = '';
			let relevantPatterns = [];
			try {
				const appMeta = detectAppMetadata({ targetUrl: mission.targetUrl });
				console.log(`[knowledge] detectAppMetadata for ${mission.targetUrl}:`, JSON.stringify(appMeta));
				const knowledgeResult = queryKnowledge(appMeta);
				console.log(`[knowledge] queryKnowledge returned ${knowledgeResult.patterns?.length || 0} patterns, ${knowledgeResult.hints?.length || 0} hints, summary: ${knowledgeResult.summary}`);
			relevantPatterns = knowledgeResult.patterns || [];
			knowledgeHints = generateExplorationHints(relevantPatterns);
			// Store for post-mission validation
			session.knowledgeHints = knowledgeResult.hints || [];
			session.knowledgePatternsUsed = relevantPatterns.map(p => p.id);
			if (knowledgeHints) {
				console.log(`[knowledge] Injected ${relevantPatterns.length} historical pattern(s) as exploration hints for session ${session.id}`);
			}
		} catch (err) {
			console.warn('[knowledge] Pre-exploration query failed:', err.message);
		}

		// B2 W1 — build the risk/priority context the per-turn prompt renders
		// (was the dead consumer: prompt.js read testContext nobody assigned).
		buildTestContext(session, mission);

			// Build the agent task from mission type + objectives + knowledge hints
			const taskPrompt = buildMissionPrompt(mission) + knowledgeHints;

			// Start the agent (async — returns immediately)
			ensureRuntime(session).then(() => {
				startTurn(session, { task: taskPrompt });
			}).catch(startError => {
				addMessage(session, { role: 'system', text: `Agent runtime failed to start: ${startError.message}`, kind: 'error' });
				setStatus(session, 'error', startError.message);
				updateMission(mission.id, { status: 'failed', failureReason: `runtime start: ${startError.message}` });
			});
		});

		if (outcome === 'queued') {
			updateMission(mission.id, { status: 'queued', queuedAt: Date.now() });
		}

		response.status(202).json({
			missionId: mission.id,
			status: outcome === 'queued' ? 'queued' : 'running',
			queuePosition: outcome === 'queued' ? queuePositionOf(mission.id) : undefined,
			governor: governorStats()
		});
		return;
	}
	response.status(201).json({
		missionId: mission.id,
		status: 'created',
		message: 'Mission created but not started. POST /api/v1/missions/:id/start to begin.'
	});
});

/**
 * Starts a previously-created mission.
 * B1: the body lives in startMissionByIdHandler so the integration surface
 * (POST /api/v1/integration/missions/:id/start) shares the exact guards.
 */
async function startMissionByIdHandler(request, response, mission) {
	// Phase 1: prevent restarting a terminal mission
	if (isTerminalStatus(mission.status)) {
		return response.status(409).json({ error: `Mission is already ${mission.status}. Create a new mission or iterate.` });
	}
	if (mission.status === 'running') {
		return response.status(409).json({ error: 'Mission is already running' });
	}
	if (mission.status === 'queued') {
		return response.status(409).json({ error: 'Mission is already queued' });
	}

	// M1-P4.1 — re-validate the stored targetUrl at execution time (stored
	// values can predate the guard or change DNS posture later).
	const targetCheck = await validateTargetUrl(mission.targetUrl);
	if (!targetCheck.ok) {
		return response.status(400).json({ error: targetCheck.message, code: targetCheck.code });
	}

	// M1-P4.2 — through the governor; execution begins only on slot grant.
	const outcome = startMissionExecution(mission, () => {
		try {
			// B0.3 — the mission's stored device constraint drives the session.
			const missionDeviceCheck = validateDeviceRequest(mission.constraints?.device ?? null);
			if (!missionDeviceCheck.ok) {
				throw new Error(missionDeviceCheck.error);
			}
			const session = createSession(mission.name || 'API Mission', mission.projectId, {
				...(missionDeviceCheck.deviceName ? { deviceRequest: missionDeviceCheck.deviceName } : {}),
				missionId: mission.id
			});
			session.targetUrl = mission.targetUrl;

			// B1 W6 — the mission's turn budget follows it onto EVERY execution
			// path (create+autoStart stamps this in the create route; start and
			// revalidate go through this handler). Values >500 are impossible
			// (validated at create), but clamp defensively anyway.
			const missionTurnBudget = Number(mission.context?.maxTurns);
			if (Number.isInteger(missionTurnBudget) && missionTurnBudget >= 1) {
				session.maxTurns = Math.min(missionTurnBudget, 500);
			}

			// Migrate temp vault credentials to session scope (for missions created with autoStart: false)
			if (mission.context?.testCredentials?.vaultKey === 'mission-temp') {
				const tempVault = vaultFor('mission-temp');
				if (tempVault.size > 0) {
					storeSecrets(session.id, Object.fromEntries(tempVault));
					clearSecrets('mission-temp');
					session.secretNames = [...tempVault.keys()];
				}
			}

			updateMission(mission.id, { sessionId: session.id, status: 'running', startedAt: Date.now() });

			// Phase 3: Query knowledge BEFORE exploration and inject as hints
			let knowledgeHints = '';
			try {
				const appMeta = detectAppMetadata({ targetUrl: mission.targetUrl });
				const knowledgeResult = queryKnowledge(appMeta);
				knowledgeHints = generateExplorationHints(knowledgeResult.patterns || []);
				session.knowledgeHints = knowledgeResult.hints || [];
				session.knowledgePatternsUsed = (knowledgeResult.patterns || []).map(p => p.id);
			} catch (err) {
				console.warn('[knowledge] Pre-exploration query failed:', err.message);
			}

			buildTestContext(session, mission); // B2 W1 — risk/priority context for the per-turn prompt

			const taskPrompt = buildMissionPrompt(mission) + knowledgeHints;
			ensureRuntime(session).then(() => {
				startTurn(session, { task: taskPrompt });
			}).catch(startError => {
				addMessage(session, { role: 'system', text: `Agent runtime failed to start: ${startError.message}`, kind: 'error' });
				setStatus(session, 'error', startError.message);
				updateMission(mission.id, { status: 'failed', failureReason: `runtime start: ${startError.message}` });
			});
		} catch (error) {
			updateMission(mission.id, { status: 'failed', failureReason: error instanceof Error ? error.message : String(error) });
			throw error; // let the governor release the slot
		}
	});

	if (outcome === 'queued') {
		updateMission(mission.id, { status: 'queued', queuedAt: Date.now() });
	}
	const current = getMission(mission.id);
	response.status(202).json({
		missionId: mission.id,
		status: outcome === 'queued' ? 'queued' : (current?.status ?? 'running'),
		sessionId: current?.sessionId,
		queuePosition: outcome === 'queued' ? queuePositionOf(mission.id) : undefined,
		governor: governorStats()
	});
}

app.post('/api/v1/missions/:id/start', requireApiToken, async (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	await startMissionByIdHandler(request, response, mission);
});

/**
 * Gets mission status + results. External consumers poll this.
 */
app.get('/api/v1/missions/:id', requireApiToken, async (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	// If mission has a linked session, sync session state
	if (mission.sessionId) {
		const session = getSession(mission.sessionId);
		if (session) {
			const isRunning = Boolean(liveFor(session.id)?.running);
			const sessionStatus = session.status;
			const isComplete = ['done', 'error', 'interrupted'].includes(sessionStatus) && !isRunning;

			if (isRunning && mission.status !== 'completed') {
				// Update mission with live session findings
				updateMission(mission.id, { findings: session.findings ?? [] });
			} else if (isComplete && mission.status === 'running') {
				// Session finished — finalize the mission. B2: a turn-budget
				// exhausted session is closed out DETERMINISTICALLY (zero
				// model turns) before finalization, so the budget can never
				// be exceeded by the close-out itself.
				finalizeTurnLimitedRun(session);
				await finalizeMissionFromSession(mission, session);
			}
		}
	}

	// Build pipeline stage summary if available — exposes capability failures
	// so consumers don't need a separate query to see if stages failed.
	let pipelineStages = null;
	if (mission.sessionId) {
		const pipelineSession = getSession(mission.sessionId);
		if (pipelineSession?.pipeline?.stages) {
			pipelineStages = {};
			for (const [key, val] of Object.entries(pipelineSession.pipeline.stages)) {
				pipelineStages[key] = val.status;
			}
		}
	}

	response.json({
		id: mission.id,
		status: mission.status,
		type: mission.type,
		targetUrl: mission.targetUrl,
		qualityScore: mission.qualityScore,
		verdict: mission.verdict,
		releaseReady: mission.releaseReady,
		improvementPrompt: mission.improvementPrompt ? true : false,
		findingsCount: (mission.findings ?? []).length,
		findings: mission.findings ?? [],
		sessionId: mission.sessionId,
		pipelineStages,
		// Phase 5: Continuous Validation Loop fields
		currentIteration: mission.currentIteration ?? 0,
		iterations: mission.iterations ?? [],
		iterationMetadata: mission.iterationMetadata ?? [],
		stopReason: mission.stopReason ?? null,
		constraints: mission.constraints ?? {},
		createdAt: mission.createdAt,
		completedAt: mission.completedAt,
		// M1-P4.2: execution-governor fields
		queuedAt: mission.queuedAt ?? null,
		startedAt: mission.startedAt ?? null,
		queuePosition: mission.status === 'queued' ? queuePositionOf(mission.id) : null,
		failureReason: mission.failureReason ?? null,
		cancelledAt: mission.cancelledAt ?? null,
		cancellationReason: mission.cancellationReason ?? null,
		executionDurationMs: (mission.startedAt && mission.completedAt)
			? mission.completedAt - mission.startedAt
			: null
	});
});

/**
 * Aborts a running mission or cancels a queued one.
 */
app.post('/api/v1/missions/:id/stop', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	// M1-P4.2 — QUEUED missions cancel without ever executing.
	if (mission.status === 'queued') {
		const result = governorCancelMission(mission.id);
		if (result === 'cancelled-queued') {
			updateMission(mission.id, {
				status: 'cancelled',
				cancelledAt: Date.now(),
				cancellationReason: 'cancelled_before_execution'
			});
			return response.json({ missionId: mission.id, status: 'cancelled', cancelledWhile: 'queued' });
		}
		return response.status(409).json({ error: 'Mission is not tracked by the execution queue' });
	}

	if (mission.status !== 'running') {
		return response.status(409).json({ error: 'Mission is not running' });
	}

	if (mission.sessionId) {
		const record = liveFor(mission.sessionId);
		record?.controller?.abort();
		// Phase 1: close browser resources to prevent orphaned Chromium.
		void closeBrowser(mission.sessionId);
	}

	updateMission(mission.id, { status: 'aborted', completedAt: Date.now(), stopReason: 'manual_stop' });
	// M1-P4.2 — aborted is terminal: free the slot immediately so the queue
	// pumps (the governor watchdog would also catch it within 30s).
	releaseMission(mission.id);
	response.json({ missionId: mission.id, status: 'aborted', stopReason: 'manual_stop' });
});

/**
 * Triggers the next validation iteration. Creates a new session,
 * runs the agent, and records results as a new iteration on mission
 * completion. The comparison between iterations powers the loop:
 * validate → improve → validate again → compare → approve.
 */
app.post('/api/v1/missions/:id/iterate', requireApiToken, async (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	if (mission.status === 'running') {
		return response.status(409).json({ error: 'Mission is already running. Stop it first.' });
	}
	if (mission.status === 'queued') {
		return response.status(409).json({ error: 'Mission is already queued. Stop it first.' });
	}
	if (!mission.targetUrl) {
		return response.status(400).json({ error: 'Mission has no targetUrl' });
	}

	// M1-P4.1 — re-validate at iteration time (same boundary as start).
	const iterateTargetCheck = await validateTargetUrl(mission.targetUrl);
	if (!iterateTargetCheck.ok) {
		return response.status(400).json({ error: iterateTargetCheck.message, code: iterateTargetCheck.code });
	}

	// M1-P4.2 — through the governor.
	const outcome = startMissionExecution(mission, () => {
		try {
			// B0.3 — carry the mission's device constraint into the iteration
			// session so mobile missions keep their device across iterations.
			const missionDeviceCheck = validateDeviceRequest(mission.constraints?.device ?? null);
			if (!missionDeviceCheck.ok) {
				throw new Error(missionDeviceCheck.error);
			}
			const session = createSession(
				`${mission.name} — Iteration ${mission.currentIteration + 1}`,
				mission.projectId,
				{
					...(missionDeviceCheck.deviceName ? { deviceRequest: missionDeviceCheck.deviceName } : {}),
					missionId: mission.id
				}
			);
			session.targetUrl = mission.targetUrl;

			// Set status to running
			updateMission(mission.id, { sessionId: session.id, status: 'running', startedAt: Date.now() });

			// Build prompt — includes awareness of previous iterations
			const taskPrompt = buildMissionPrompt(mission);

			ensureRuntime(session).then(() => {
				startTurn(session, { task: taskPrompt });
			}).catch(startError => {
				addMessage(session, { role: 'system', text: `Agent runtime failed to start: ${startError.message}`, kind: 'error' });
				setStatus(session, 'error', startError.message);
				updateMission(mission.id, { status: 'failed', failureReason: `runtime start: ${startError.message}` });
			});
		} catch (error) {
			updateMission(mission.id, { status: 'failed', failureReason: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	});

	if (outcome === 'queued') {
		updateMission(mission.id, { status: 'queued', queuedAt: Date.now() });
	}
	const current = getMission(request.params.id);
	response.status(202).json({
		missionId: mission.id,
		sessionId: current?.sessionId,
		iteration: mission.currentIteration + 1,
		status: outcome === 'queued' ? 'queued' : (current?.status ?? 'running'),
		queuePosition: outcome === 'queued' ? queuePositionOf(mission.id) : undefined,
		message: `Iteration ${mission.currentIteration + 1} ${outcome === 'queued' ? 'queued (execution slots full — starts automatically when one frees)' : 'started'}. Poll GET /api/v1/missions/:id for results, then GET /api/v1/missions/:id/comparison for delta.`,
		governor: governorStats()
	});
});

/**
 * Phase 5: Trigger a controlled revalidation iteration.
 *
 * This is the Continuous Validation Loop's manual trigger. Unlike the
 * existing /iterate endpoint, this:
 *   1. Checks iteration limits (maxIterations, no-improvement)
 *   2. Injects knowledge hints (Phase 3) for each iteration
 *   3. Builds a revalidation prompt that includes awareness of previous findings
 *   4. Prevents duplicate concurrent iterations
 *   5. Records iteration metadata (decision, comparison, convergence)
 *
 * The endpoint is idempotent: repeated identical requests while an
 * iteration is already running return the existing session.
 */
/**
 * Shared revalidation body (B1): the token-gated route and the integration
 * route run the exact same guards + governor path.
 */
async function revalidateMissionByIdHandler(request, response, mission) {
	// B2 — begin()-closure throws with an attached statusCode (e.g. pool
	// exhausted → 409 budget_exhausted) are CONTRACT answers, not server
	// errors. Catch here (closest frame to the router) so Express's default
	// 500 handler never sees them.
	let guarded;
	try {
		guarded = await revalidateMissionByIdHandlerInner(request, response, mission);
		return guarded;
	} catch (error) {
		if (error?.statusCode && !response.headersSent) {
			return response.status(error.statusCode).json({
				error: error.message,
				code: error.code ?? 'revalidation_refused',
				missionId: mission.id
			});
		}
		throw error;
	}
}

async function revalidateMissionByIdHandlerInner(request, response, mission) {
	// BUILD B2 — internal autonomy dispatch marker. The autonomy gate fires
	// BEFORE the terminal write, so mission.status is still 'running' even
	// though its session is settled. Only the internal caller may pass the
	// marker; an EXTERNAL request carrying it is rejected outright (it is not
	// a header/param — it is a module-private object field the router never
	// populates from the wire).
	if (request.__qaseInternalAutonomy === true) {
		const session = mission.sessionId ? getSession(mission.sessionId) : null;
		const settled = session && ['done', 'idle', 'error', 'interrupted'].includes(session.status)
			&& !liveFor(session.id)?.running;
		if (!settled) {
			return response.status(409).json({ error: 'Internal autonomy dispatch refused: session not settled.' });
		}
	} else if (mission.status === 'running') {
		// Guard: mission is already running — return existing session (idempotency)
		return response.status(409).json({
			error: 'Mission is already running. Wait for the current iteration to complete.',
			missionId: mission.id,
			sessionId: mission.sessionId,
			iteration: mission.currentIteration
		});
	}

	if (!mission.targetUrl) {
		return response.status(400).json({ error: 'Mission has no targetUrl' });
	}

	// M1-P4.1 — re-validate at revalidate time (fix-validation executes the
	// stored target; same boundary as start/iterate).
	const revalTargetCheck = await validateTargetUrl(mission.targetUrl);
	if (!revalTargetCheck.ok) {
		return response.status(400).json({ error: revalTargetCheck.message, code: revalTargetCheck.code });
	}

	// Guard: iteration limit reached
	if (hasReachedIterationLimit(mission)) {
		const limit = mission.constraints?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
		return response.status(409).json({
			error: `Maximum iterations (${limit}) reached. Mission validation loop is complete.`,
			stopReason: STOP_REASONS.MAX_ITERATIONS,
			missionId: mission.id,
			iterations: mission.currentIteration
		});
	}

	// Guard: no-improvement detected
	const convergence = analyzeConvergence(mission);
	const stopReason = getStopReason(mission);
	if (stopReason === STOP_REASONS.NO_IMPROVEMENT) {
		return response.status(409).json({
			error: `No meaningful improvement detected for ${convergence.iterationsWithoutImprovement} iteration(s). Validation loop should stop.`,
			stopReason: STOP_REASONS.NO_IMPROVEMENT,
			convergence,
			missionId: mission.id
		});
	}

	// M1-P4.2 — through the governor.
	const outcome = startMissionExecution(mission, () => {
		try {
			// B2 — pool exhaustion is a CONTRACT state, not a server error:
			// the mission spent its whole authorized budget and a caller
			// asked for another iteration. Surface as 409 budget_exhausted
			// (the same envelope the other guards use), not a thrown 500.
			const revalBudgetCheck = Number(mission.context?.maxTurns);
			if (Number.isInteger(revalBudgetCheck) && revalBudgetCheck >= 1) {
				const spentNow = listSessions()
					.map(s => getSession(s.id))
					.filter(s => s && s.missionId === mission.id)
					.reduce((sum, s) => sum + (Number(s?.turnCount) || 0), 0);
				if (spentNow >= Math.min(revalBudgetCheck, 500)) {
					const exhausted = new Error(`Mission turn pool exhausted (${spentNow}/${revalBudgetCheck}) — no budget for another iteration.`);
					exhausted.statusCode = 409;
					exhausted.code = 'budget_exhausted';
					throw exhausted;
				}
			}
			// Create session for the new iteration
			// B0.3 — preserve the mission device constraint across revalidations.
			const missionDeviceCheck = validateDeviceRequest(mission.constraints?.device ?? null);
			if (!missionDeviceCheck.ok) {
				throw new Error(missionDeviceCheck.error);
			}
			const iterationNumber = (mission.currentIteration || 0) + 1;
			const session = createSession(
				`${mission.name} — Revalidation ${iterationNumber}`,
				mission.projectId,
				{
					...(missionDeviceCheck.deviceName ? { deviceRequest: missionDeviceCheck.deviceName } : {}),
					// B2 — persist the mission link so the turn-pool debit
					// survives restarts.
					missionId: mission.id
				}
			);
			session.targetUrl = mission.targetUrl;

			// B1 W6 — revalidation runs under the mission's turn budget too
			// (same clamp as the create/start paths).
			const revalTurnBudget = Number(mission.context?.maxTurns);
			if (Number.isInteger(revalTurnBudget) && revalTurnBudget >= 1) {
				// B2 budget-asymmetry — the mission's turn budget is a POOL
				// shared across iterations, not a fresh grant each time. Debit
				// from the mission's LINKED SESSIONS (ground truth at dispatch
				// time) — NOT from mission.iterations, which only fills at
				// finalize and is empty while the autonomy gate defers it.
				// A mission authorized for 3 turns can never spend more than
				// 3 in TOTAL across all its revalidation iterations.
				const spent = listSessions()
					.map(s => getSession(s.id))
					.filter(s => s && s.missionId === mission.id)
					.reduce((sum, s) => sum + (Number(s?.turnCount) || 0), 0);
				const remainingPool = Math.max(0, Math.min(revalTurnBudget, 500) - spent);
				if (remainingPool < 1) {
					const exhausted = new Error(`Mission turn pool exhausted (${spent}/${revalTurnBudget}) — no budget for another iteration.`);
					exhausted.statusCode = 409;
					exhausted.code = 'budget_exhausted';
					throw exhausted;
				}
				session.maxTurns = remainingPool;
			}

			// Update mission to running
			updateMission(mission.id, { sessionId: session.id, status: 'running', startedAt: Date.now() });

			// Phase 3: Query knowledge BEFORE exploration
			const knowledgeData = prepareKnowledgeForIteration(mission);
			session.knowledgeHints = knowledgeData.patterns;
			session.knowledgePatternsUsed = knowledgeData.patternIds;

			// Get previous iteration data for revalidation prompt
			// B2 fix — a deferred (autonomy-chained) mission has not recorded
			// iterations yet, so the prompt used to explore from scratch and
			// never revalidated the findings it had already produced. Fall
			// back to the findings STORE for this mission (session-born
			// findings are linked via missionId) so chained revalidations
			// verify prior findings even before the first finalize records
			// an iteration.
			const previousIterations = mission.iterations ?? [];
			let lastIteration = previousIterations.length > 0
				? previousIterations[previousIterations.length - 1]
				: null;
			if (!lastIteration || !Array.isArray(lastIteration.findings) || lastIteration.findings.length === 0) {
				const storedFindings = listFindings({ missionId: mission.id });
				if (storedFindings.length > 0) {
					lastIteration = {
						...(lastIteration ?? {}),
						number: lastIteration?.number ?? (mission.currentIteration || 0),
						findings: storedFindings.slice(0, 15),
						qualityScore: lastIteration?.qualityScore ?? mission.qualityScore ?? null,
						verdict: lastIteration?.verdict ?? mission.verdict ?? null
					};
				}
			}

			// Build revalidation prompt with awareness of previous findings.
			// C2: an autonomy dispatch carries a focus mode —
			//   'investigate' → verify previous findings (default behavior,
			//                  same prompt as a human-triggered revalidation)
			//   'replan'      → redirect exploration toward uncovered areas;
			//                  the focus payload replaces the findings-verify
			//                  framing with a coverage-focused briefing.
			let taskPrompt;
			if (request.__qaseFocusMode === 'replan' && request.__qaseFocusPayload) {
				const focusLines = (request.__qaseFocusPayload.focusAreas ?? [])
					.slice(0, 12)
					.map(a => `- ${a}`);
				taskPrompt = buildMissionPrompt(mission)
					+ (knowledgeData.hints || '')
					+ `\n\n── RE-PLAN FOCUS (iteration ${mission.currentIteration + 1}) ──\n`
					+ `Previous exploration was too narrow. Redirect testing toward:\n`
					+ (focusLines.length > 0 ? focusLines.join('\n') : '- broaden coverage to untested sections')
					+ `\nDo not re-verify previously reported findings this iteration; extend coverage first.`;
			} else if (request.__qaseFocusMode === 'continue') {
				// C2 CONTINUE: same approach — the plain mission prompt, no
				// findings-verify framing (nothing to verify yet).
				taskPrompt = buildMissionPrompt(mission) + knowledgeData.hints;
			} else if (lastIteration) {
				taskPrompt = buildRevalidationPrompt(mission, lastIteration, knowledgeData.hints);
			} else {
				taskPrompt = buildMissionPrompt(mission) + knowledgeData.hints;
			}
			// Record which focus the iteration ran under (provenance).
			session.autonomyFocus = {
				mode: request.__qaseFocusMode ?? 'investigate',
				focusAreas: (request.__qaseFocusPayload?.focusAreas ?? []).slice(0, 12),
				at: new Date().toISOString()
			};

			// Store iteration metadata
			const iterMeta = createIterationMetadata(mission, session);
			iterMeta.status = ITERATION_STATUS.RUNNING;
			const meta = mission.iterationMetadata ? [...mission.iterationMetadata] : [];
			meta.push(iterMeta);
			updateMission(mission.id, {
				iterationMetadata: meta,
				// B2 fix — currentIteration now advances at DISPATCH time, not
				// only at finalize (recordIteration). A deferred (autonomy-
				// chained) mission used to keep currentIteration 0 while real
				// iterations ran, which (a) made hasReachedIterationLimit inert
				// on chains and (b) mislabeled every revalidation "iteration 1".
				// recordIteration still guards against double-counting by
				// session id; its `number` stays aligned because it uses
				// currentIteration+1 at record time.
				currentIteration: (mission.currentIteration || 0) + 1
			});

			// Start the agent
			const injectedPatterns = knowledgeData.patternIds.length;
			const previousFindings = lastIteration?.findings?.length ?? 0;
			ensureRuntime(session).then(() => {
				startTurn(session, { task: taskPrompt });
				console.log(`[validation-loop] Started revalidation iteration ${iterationNumber} for mission ${mission.id} (session ${session.id})`);
			}).catch(startError => {
				addMessage(session, { role: 'system', text: `Agent runtime failed to start: ${startError.message}`, kind: 'error' });
				setStatus(session, 'error', startError.message);
				updateMission(mission.id, { status: 'failed', failureReason: `runtime start: ${startError.message}` });
			});
			return { injectedPatterns, previousFindings };
		} catch (error) {
			// B2 — a CONTRACT refusal (budget exhausted) must not corrupt the
			// mission state: the mission already holds its terminal verdict
			// from the settled iteration; only the EXTRA iteration request
			// was refused. Restore the prior status and rethrow with the
			// attached status code so the router answers 409, not 500.
			if (error?.statusCode === 409) {
				const fresh = getMission(mission.id);
				if (fresh && fresh.status === 'failed') {
					const priorStatus = (fresh.iterations ?? []).length > 0 || fresh.verdict ? 'completed' : 'failed';
					updateMission(mission.id, {
						status: priorStatus,
						failureReason: priorStatus === 'completed' ? null : fresh.failureReason
					});
				}
				throw error;
			}
			updateMission(mission.id, { status: 'failed', failureReason: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	});

	if (outcome === 'queued') {
		updateMission(mission.id, { status: 'queued', queuedAt: Date.now() });
	}
	const current = getMission(mission.id);
	const queuedNow = current?.status === 'queued';
	response.status(202).json({
		missionId: mission.id,
		sessionId: current?.sessionId,
		iteration: (mission.currentIteration || 0) + 1,
		status: current?.status ?? 'running',
		queuePosition: queuedNow ? queuePositionOf(mission.id) : undefined,
		message: `Revalidation iteration ${(mission.currentIteration || 0) + 1} ${queuedNow ? 'queued (execution slots full — starts automatically when one frees)' : 'started'}. Poll GET /api/v1/missions/:id for results, then GET /api/v1/missions/:id/loop-status for validation loop status.`,
		governor: governorStats()
	});
}

app.post('/api/v1/missions/:id/revalidate', requireApiToken, async (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	await revalidateMissionByIdHandler(request, response, mission);
});

/**
 * Phase 5: Get the validation loop status for a mission.
 *
 * Returns the complete iteration history, convergence analysis,
 * comparison, latest decision, and stop reason.
 */
/**
 * BUILD B2 — the autonomy decision trace for a mission.
 * Structured metadata only (13-field schema): no prompts, no CoT, no secrets.
 */
app.get('/api/v1/missions/:id/decision-trace', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	const traces = getDecisionTraces(mission.id);
	response.json({
		missionId: mission.id,
		autonomyEnabled: autonomyEnabled(),
		count: traces.length,
		decisions: traces
	});
});

app.get('/api/v1/missions/:id/loop-status', requireApiToken, (request, response) => { // M1-P3 public read (pipeline validation loop panel)
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	const loopStatus = getLoopStatus(mission);
	response.json(loopStatus);
});

/**
 * Phase 5: Get comparison summary with convergence analysis.
 *
 * Extends the existing /comparison endpoint with convergence detection,
 * trend analysis, and iteration context.
 */
app.get('/api/v1/missions/:id/validation-comparison', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	const summary = getComparisonSummary(mission);
	if (!summary) {
		return response.status(400).json({ error: 'No iterations have been run yet' });
	}

	response.json(summary);
});

/**
 * Returns the comparison between the last two iterations.
 * Shows what was fixed, what remains, and what's new.
 *
 * This is the output that tells a product owner:
 *   "Is the app improving? Is it ready for release?"
 */
app.get('/api/v1/missions/:id/comparison', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	if (mission.iterations.length === 0) {
		return response.status(400).json({ error: 'No iterations have been run yet' });
	}

	if (mission.iterations.length === 1) {
		// Only one iteration — baseline, nothing to compare
		const onlyIter = mission.iterations[0];
		const quality = calculateMissionQuality(onlyIter.findings);
		return response.json({
			iteration: 1,
			type: 'baseline',
			message: 'First iteration — no previous run to compare against.',
			currentScore: onlyIter.qualityScore,
			verdict: onlyIter.verdict,
			releaseReady: onlyIter.releaseReady,
			risk: quality.risk,
			confidence: quality.confidence,
			recommendations: quality.recommendations,
			criticalIssues: quality.criticalIssues,
			findingsCount: onlyIter.findings.length
		});
	}

	const pair = getComparisonIterations(mission.id);
	const comparison = compareIterations(pair.previous.findings, pair.current.findings);

	// Enrich with product-facing quality from current iteration
	const currQuality = calculateMissionQuality(pair.current.findings);

	response.json({
		iteration: pair.current.number,
		type: 'comparison',
		comparison,
		productQuality: {
			releaseReady: pair.current.releaseReady ?? currQuality.releaseReady,
			confidence: currQuality.confidence,
			risk: currQuality.risk,
			recommendations: currQuality.recommendations,
			criticalIssues: currQuality.criticalIssues
		}
	});
});

/**
 * Full mission report — structured for AI Studio / developer consumption.
 *
 * This is the AI Studio integration contract endpoint:
 *   verdict, qualityScore, findings with fixPrompt, improvementPrompt, regressionReady
 */
app.get('/api/v1/missions/:id/report', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	const findings = mission.findings ?? [];
	const quality = calculateMissionQuality(findings);
	const report = buildImprovementPrompt(mission, findings, quality);

	const format = request.query.format || 'json';

	if (format === 'markdown' || format === 'md') {
		const md = buildMissionReportMarkdown(mission, report);
		response.type('text/markdown').send(md);
	} else {
		response.json({
			missionId: mission.id,
			missionType: mission.type,
			targetUrl: mission.targetUrl,
			source: mission.source,
			generationId: mission.generationId,
			...report,
			createdAt: mission.createdAt,
			completedAt: mission.completedAt
		});
	}
});

/* ── Phase 6: Evidence Graph API ─────────────────────────────────── */

/**
 * Phase 6: Get all evidence for a mission.
 * Supports pagination via ?limit= and ?offset=.
 */
app.get('/api/v1/missions/:id/evidence', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	const limit = Math.min(parseInt(request.query.limit) || 100, 500);
	const offset = parseInt(request.query.offset) || 0;
	const { items: evidence, total } = getMissionEvidencePage(mission.id, { limit, offset });

	response.json({ missionId: mission.id, evidence, total, limit, offset });
});

/**
 * Phase 6: Get evidence for a specific finding.
 * Returns the provenance chain (finding → observation → evidence → session → iteration → decision).
 */
app.get('/api/v1/missions/:id/findings/:findingId/evidence-chain', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	const findingId = request.params.findingId;
	const allFindings = mission.findings ?? [];
	const quality = calculateMissionQuality(allFindings);
	const decision = mission.iterationMetadata?.[mission.iterationMetadata.length - 1]?.decision ?? null;
	const latestSession = mission.sessionId;
	const latestIteration = mission.iterations?.[mission.iterations.length - 1];

	const chain = getEvidenceChainForApi(findingId, {
		mission,
		findings: allFindings,
		quality,
		decision,
		sessionId: latestSession,
		iteration: latestIteration
	});

	response.json(chain);
});

/**
 * Phase 6: Get evidence coverage for a mission.
 * Returns the percentage of findings backed by evidence.
 */
app.get('/api/v1/missions/:id/evidence-coverage', requireApiToken, (request, response) => { // M1-P3 public read (pipeline evidence panel)
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	const findings = mission.findings ?? [];
	const coverage = computeEvidenceCoverage(findings);

	response.json({ missionId: mission.id, ...coverage });
});

/**
 * Phase 6: Get graph integrity report for a mission.
 */
app.get('/api/v1/missions/:id/evidence-integrity', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	const result = validateGraphIntegrity({
		findings: mission.findings ?? [],
		missions: undefined, // no direct map access from here
		sessions: undefined
	});

	response.json({ missionId: mission.id, ...result });
});

/**
 * Phase 6: Get evidence graph stats.
 */
app.get('/api/v1/evidence/stats', requireApiToken, (request, response) => { // M1-P3 public read (pipeline evidence panel)
	response.json(getGraphStats());
});

/**
 * M1-P4.3 — Cross-store state integrity diagnostic (read-only).
 * Structured orphan/consistency report across missions/sessions/findings/
 * evidence graph. Token-gated (mutations-grade data exposure).
 */
app.get('/api/v1/diagnostics/state-integrity', requireApiToken, (request, response) => {
	const deep = request.query.deep === '1' || request.query.deep === 'true';
	const result = checkStateIntegrity({ deep });
	response.status(200).json(result);
});

/**
 * M1-P4.4 Phase 3 — store hygiene DRY-RUN report (read-only, token-gated).
 * Never mutates; reports reclaimable bytes/records per store.
 */
app.get('/api/v1/diagnostics/store-hygiene', requireApiToken, (request, response) => {
	const t0 = Date.now();
	const report = analyzeStoreHygiene();
	response.status(200).json({ ...report, analysisMs: Date.now() - t0 });
});

/**
 * M1-P4.4 Phase 3 — EXECUTE store hygiene cleanup. Requires explicit
 * { apply: true }; a bare POST is a 400 no-op (safety interlock).
 */
app.post('/api/v1/diagnostics/store-hygiene/cleanup', requireApiToken, (request, response) => {
	if (request.body?.apply !== true) {
		return response.status(400).json({
			error: 'Cleanup requires { "apply": true } — this endpoint deletes data.',
			hint: 'Call GET /api/v1/diagnostics/store-hygiene first for the dry-run report.'
		});
	}
	const result = applyStoreHygiene({}, {
		deleteMission,
		pruneRunsByIds,
		pruneAssessmentsByIds,
		pruneUnlinked
	});
	response.status(200).json({
		appliedAt: result.appliedAt,
		pruned: {
			missions: result.pruned.missions?.length ?? 0,
			'replay-runs': result.pruned['replay-runs']?.length ?? 0,
			'ux-assessments': result.pruned['ux-assessments']?.length ?? 0,
			'evidence-graph': result.pruned['evidence-graph'] ?? { prunedEvidence: 0, prunedObservations: 0 }
		},
		skipped: result.skipped
	});
});

/**
 * M1-P4.4 Phase 4 — artifact orphan report (read-only, token-gated).
 */
app.get('/api/v1/diagnostics/artifacts/orphans', requireApiToken, (request, response) => {
	const t0 = Date.now();
	const report = analyzeArtifacts();
	response.status(200).json({
		totalDirs: report.totalDirs,
		referenced: report.referenced,
		orphanCount: report.orphans.length,
		orphanBytes: report.orphans.reduce((n, o) => n + o.bytes, 0),
		unreadableCount: report.unreadable.length,
		unreadable: report.unreadable,
		note: report.note,
		analysisMs: Date.now() - t0
	});
});

/**
 * M1-P4.4 Phase 4 — EXECUTE artifact cleanup. Requires explicit { apply: true }.
 */
app.post('/api/v1/diagnostics/artifacts/cleanup', requireApiToken, (request, response) => {
	if (request.body?.apply !== true) {
		return response.status(400).json({
			error: 'Cleanup requires { "apply": true } — this endpoint deletes artifact directories.',
			hint: 'Call GET /api/v1/diagnostics/artifacts/orphans first.'
		});
	}
	const result = applyArtifactsCleanup(null, { orphanOlderThanDays: 0 });
	response.status(200).json({
		deletedCount: result.deleted.length,
		reclaimedBytes: result.reclaimedBytes,
		failed: result.failed
	});
});

/**
 * Phase 6: Get a specific evidence item by ID.
 */
app.get('/api/v1/evidence/:id', requireApiToken, (request, response) => {
	const evidence = getEvidence(request.params.id);
	if (!evidence) {
		return response.status(404).json({ error: 'Evidence not found' });
	}
	response.json(evidence);
});

/**
 * Phase 6: Get all observations for a session.
 */
app.get('/api/v1/sessions/:id/observations', requireApiToken, (request, response) => {
	const session = getSession(request.params.id);
	if (!session) {
		return response.status(404).json({ error: 'Session not found' });
	}

	const limit = Math.min(parseInt(request.query.limit) || 100, 500);
	const offset = parseInt(request.query.offset) || 0;
	const { items: observations, total } = getSessionObservationsPage(session.id, { limit, offset });

	response.json({ sessionId: session.id, observations, total, limit, offset });
});

/**
 * Phase 6: Get evidence for a specific session.
 */
app.get('/api/v1/sessions/:id/evidence', requireApiToken, (request, response) => {
	const session = getSession(request.params.id);
	if (!session) {
		return response.status(404).json({ error: 'Session not found' });
	}

	const limit = Math.min(parseInt(request.query.limit) || 100, 500);
	const offset = parseInt(request.query.offset) || 0;
	const { items: evidence, total } = getSessionEvidencePage(session.id, { limit, offset });

	response.json({ sessionId: session.id, evidence, total, limit, offset });
});

/**
 * Phase 6: Get evidence for a specific iteration of a mission.
 */
app.get('/api/v1/missions/:id/evidence/iterations/:iteration', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	const iteration = parseInt(request.params.iteration);
	if (!iteration || iteration < 1) {
		return response.status(400).json({ error: 'Invalid iteration number' });
	}
	const evidence = getHistoricalEvidence(mission.id, iteration);
	response.json({ missionId: mission.id, iteration, evidence, total: evidence.length });
});

/**
 * Phase 6: Compare evidence across two iterations.
 */
app.get('/api/v1/missions/:id/evidence/compare/:iter1/:iter2', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	const iter1 = parseInt(request.params.iter1);
	const iter2 = parseInt(request.params.iter2);
	if (!iter1 || !iter2 || iter1 < 1 || iter2 < 1) {
		return response.status(400).json({ error: 'Invalid iteration numbers' });
	}
	const comparison = compareIterationEvidence(mission.id, iter1, iter2);
	response.json({ missionId: mission.id, iteration1: iter1, iteration2: iter2, comparison });
});

/**
 * Phase 6: Validate evidence graph integrity (POST — triggers a fresh validation pass).
 */
app.post('/api/v1/evidence/validate', requireApiToken, (request, response) => {
	const { missions, sessions, findings } = request.body ?? {};
	const context = {};
	if (missions) context.missions = new Map(Object.entries(missions));
	if (sessions) context.sessions = new Map(Object.entries(sessions));
	if (findings) context.findings = findings;
	const result = validateGraphIntegrity(context);
	response.json(result);
});

/**
 * Webhook registration — register a callback URL to receive mission
 * results when complete. Simple in-memory store (sufficient for now).
 */
// B1 W5 — webhooks are persisted, signed, retried deliveries now
// (server/webhookDelivery.js). The legacy in-memory per-mission map is gone.
import {
	registerWebhookSubscription, listWebhookSubscriptions, removeWebhookSubscription,
	enqueueDelivery, deliveryLedger, getDelivery, signWebhookPayload,
	WEBHOOK_EVENTS
} from './webhookDelivery.js';

app.post('/api/v1/webhooks', requireApiToken, async (request, response) => {
	const { missionId, url, events } = request.body ?? {};
	if (!url) {
		return response.status(400).json({ error: 'url is required' });
	}
	if (!missionId) {
		return response.status(400).json({ error: 'missionId is required' });
	}
	const check = await validateWebhookUrl(url);
	if (!check.ok) {
		return response.status(400).json({ error: check.message, code: check.code ?? 'invalid_url' });
	}
	const entry = registerWebhookSubscription({
		url,
		events: events?.includes('*') ? WEBHOOK_EVENTS : (events || ['mission.completed']),
		missionId,
		label: 'legacy per-mission registration'
	});
	response.status(201).json({ webhookId: entry.id, missionId, url, events: entry.events });
});

/* ── Mission helpers ───────────────────────────────────────────── */

/**
 * Builds the agent prompt from mission type and objectives.
 * The mission type determines the testing strategy.
 */
function buildMissionPrompt(mission) {
	const typeDescriptions = {
		full_audit: 'Perform a comprehensive quality audit of this application. Test all major user flows, forms, navigation, and interactive elements.',
		security: 'Focus on security validation. Check for authentication boundaries, data exposure, session handling, and common vulnerabilities (OWASP).',
		ux: 'Focus on UX validation. Test responsive behavior, interaction patterns, accessibility, and overall user experience.',
		regression: 'Perform regression testing. Verify existing functionality still works correctly after recent changes.',
		feature_gap: 'Analyze feature completeness. Compare against expected functionality and identify missing features.',
		accessibility: 'Focus on accessibility validation. Check WCAG compliance, keyboard navigation, screen reader compatibility, and visual contrast.'
	};

	const lines = [
		typeDescriptions[mission.type] || typeDescriptions.full_audit,
		'',
		`Target: ${mission.targetUrl}`
	];

	if (mission.objectives?.length) {
		lines.push('', 'Specific objectives:');
		for (const obj of mission.objectives) {
			lines.push(`- ${obj}`);
		}
	}

	if (mission.constraints && Object.keys(mission.constraints).length > 0) {
		lines.push('', 'Constraints:');
		for (const [key, value] of Object.entries(mission.constraints)) {
			lines.push(`- ${key}: ${value}`);
		}
	}

	return lines.join('\n');
}

/**
 * Finalizes a mission from a completed session — records the iteration,
 * scores quality, generates improvement prompt, fires webhooks.
 *
 * This is called both for the first run AND subsequent iterations.
 * Each run is recorded as a new iteration for the validation loop.
 *
 * Phase 1 reliability: idempotency guard prevents double-finalization.
 * The race between pipeline completion and lazy finalization on GET
 * /api/v1/missions/:id means this function can be called twice. The
 * mission's finalizeMission() and recordIteration() both have their own
 * guards, but we add one here too so the expensive quality scoring and
 * webhook firing only happen once.
 */
/**
 * BUILD B2 — guarded autonomy dispatch used by finalizeMissionFromSession.
 *
 * The decision engine evaluates the settled session and may:
 *   - STOP early (pins stopReason; never fabricates a pass), or
 *   - REVALIDATE → dispatched through the EXACT same revalidateMissionByIdHandler
 *     the human/API path uses (all guards enforced: iteration limit,
 *     no-improvement, target re-validation, budget). Budget asymmetry: the
 *     controller never grants turns; the new iteration runs under the
 *     mission's EXISTING maxTurns authorization (B1 W6).
 *   - CONTINUE / engine off / failure → falls through to the original
 *     finalization unchanged (fail-open).
 *
 * @returns {'proceed'|'deferred'} 'deferred' when a new iteration took over.
 */
async function attemptAutonomyBeforeFinalize(mission, session) {
	try {
		const outcome = await runAutonomyDecision({ mission, session });
		if (!outcome) return 'proceed';
		const { action, decision } = outcome;
		if (action.shouldRevalidate) {
			// Dispatch happened inside runAutonomyDecision (guarded handler
			// accepted) — finalization is deferred to the new iteration's own
			// settle path.
			console.log(`[autonomy] mission ${mission.id}: decision ${decision.decision} -> revalidation iteration dispatched (guarded handler accepted)`);
			return 'deferred';
		}
		if (action.shouldStop && action.stopReason) {
			const isFail = action.stopReason === STOP_REASONS.FAILED
				|| action.stopReason === STOP_REASONS.ESCALATED
				|| action.stopReason === STOP_REASONS.BLOCKED;
			// The iteration record + quality scoring still happen below in the
			// normal path; the STOP only pins the stopReason (never fabricates
			// a pass — failed/blocked routes to status 'failed').
			session._autonomyStop = { stopReason: action.stopReason, reason: action.reason };
			if (!isFail) {
				// Budget/coverage/approved stops finalize through the NORMAL
				// path below (findings + quality scoring preserved, verdict
				// computed from the real evidence).
				return 'proceed';
			}
			// Route through the honesty guard semantics: a failed/blocked
			// decision finalizes as failed — but the CONFIRMED FINDINGS that
			// justified the stop are preserved (they are the evidence for the
			// verdict; discarding them would hide the very issues the
			// decision engine acted on).
			const preservedFindings = session.findings ?? [];
			finalizeMission(mission.id, {
				status: 'failed',
				failureReason: action.reason ?? `Autonomy decision: ${action.stopReason}`,
				findings: preservedFindings,
				summary: null
			});
			session._autonomyFinalized = true;
			return 'deferred';
		}
		return 'proceed';
	} catch (error) {
		console.error(`[autonomy] pre-finalize decision failed: ${error?.message ?? error} — proceeding with normal finalization`);
		return 'proceed';
	}
}

async function finalizeMissionFromSession(mission, session) {
	if (isTerminalStatus(mission.status)) {
		return getMission(mission.id);
	}

	// B2 — a session that settled without a report (turn budget exhausted,
	// honest abort) gets its DETERMINISTIC close-out compiled here, once,
	// before any decision/finalization runs. Zero model turns by design.
	if (['done', 'idle'].includes(session.status) && !session.report) {
		finalizeTurnLimitedRun(session);
	}
	// The close-out (if any) kicked off a CURATED capability pipeline
	// (application understanding → feature gaps → findings → mission
	// finalize). Racing it would finalize the mission BEFORE the pipeline
	// writes its findings — observed live as 'pass/100 with 0 findings'
	// while the pipeline later surfaced 20 gap findings. Wait (bounded) for
	// the close-out pipeline to finish; finalization below then sees the
	// REAL finding set.
	if (session._closeOutPipeline) {
		for (let i = 0; i < 36 && session._closeOutPipeline && session._pipelineRunning; i++) {
			await new Promise(resolve => setTimeout(resolve, 5_000));
		}
	}

	// BUILD B2 — the autonomy decision point. Before the terminal write, the
	// decision engine evaluates the REAL settled session and may:
	//   - STOP early (saves turns, records stopReason), or
	//   - REVALIDATE (guarded dispatch — same handler/guards as the human path),
	// in which case finalization is deferred to the new iteration's own
	// settle path and we return here. Any internal failure or QASE_AUTONOMY=off
	// falls through to the original finalization unchanged (fail-open).
	if (missionAutonomyEnabled(mission) && !session._autonomyFinalized) {
		const outcome = await attemptAutonomyBeforeFinalize(mission, session);
		if (outcome === 'deferred') return getMission(mission.id);
		session._autonomyFinalized = true;
	}

	// BUILD 1 honesty guard: a session that ended in error/interrupted never ran
	// its agent to completion — finalizing it as "completed/pass" fabricates a
	// success. Route dead sessions to mission status 'failed' with a minimal
	// report instead of a quality score.
	if (session.status === 'error' || session.status === 'interrupted') {
		const firstErr = (session.transcript ?? []).find((m) => m.role === 'system' && /error/i.test(m.text ?? ''));
		finalizeMission(mission.id, {
			status: 'failed',
			failureReason: firstErr ? String(firstErr.text).slice(0, 300)
				: session.status === 'interrupted'
					? 'Session interrupted (watchdog limit or manual stop) before the mission could finish its report.'
					: `Session ended ${session.status} before the agent could run.`,
			findings: [],
			summary: null
		});
		return getMission(mission.id);
	}

	const findings = session.findings ?? [];

	// Score each finding inline
	for (const f of findings) {
		const scored = scoreFindingQuality(f, findings);
		if (f.confidence == null) f.confidence = scored.confidence;
		if (f.isDuplicate == null) f.isDuplicate = scored.isDuplicate;
		if (f.duplicateOf == null && scored.duplicateOf) f.duplicateOf = scored.duplicateOf;
		if (f.reproducibility == null) f.reproducibility = scored.reproducibility;
	}

	const quality = calculateMissionQuality(findings);
	const report = buildImprovementPrompt(mission, findings, quality);

	// Record this run as a new iteration (enables the validation loop).
	// B2 fix — currentIteration now also advances at DISPATCH time (see the
	// revalidate handler), so recordIteration must not blindly push another
	// number: if the dispatch-time bookkeeping already counted this session's
	// iteration, update THAT record instead of appending a duplicate.
	const alreadyDispatched = (mission.iterationMetadata ?? [])
		.some(m => m.sessionId === session.id);
	if (alreadyDispatched) {
		// The iteration slot exists from dispatch; fill in the results.
		updateIterationMetadata(mission, (getMission(mission.id)?.iterationMetadata ?? [])
			.find(m => m.sessionId === session.id)?.number, {
			status: ITERATION_STATUS.COMPLETED,
			completedAt: Date.now(),
			qualityScore: quality.score,
			verdict: quality.verdict,
			turnCount: session.turnCount ?? null
		});
		// Keep the canonical iterations array in sync for convergence checks.
		recordIteration(mission.id, {
			sessionId: session.id,
			findings,
			qualityScore: quality.score,
			verdict: quality.verdict,
			releaseReady: quality.releaseReady,
			improvementPrompt: report.improvementPrompt,
			// B2 — debit the mission's turn pool with what this iteration spent.
			turnCount: session.turnCount ?? null
		});
	} else {
		recordIteration(mission.id, {
			sessionId: session.id,
			findings,
			qualityScore: quality.score,
			verdict: quality.verdict,
			releaseReady: quality.releaseReady,
			improvementPrompt: report.improvementPrompt,
			// B2 — debit the mission's turn pool with what this iteration spent.
			turnCount: session.turnCount ?? null
		});
	}

	// Also update mission top-level fields
	finalizeMission(mission.id, {
		status: 'completed',
		qualityScore: quality.score,
		verdict: quality.verdict,
		improvementPrompt: report.improvementPrompt,
		releaseReady: quality.releaseReady,
		findings,
		summary: session.report?.summary || session.pipeline?.summary || null
	});

	// Phase 5: Update iteration metadata with decision + quality + completion
	const latestMeta = getLatestIteration(getMission(mission.id));
	if (latestMeta) {
		const decision = session._autonomyDecision?.decision
			?? session.pipeline?.summary?.decision
			?? session.decisionHistory?.[session.decisionHistory.length - 1]
			?? null;
		updateIterationMetadata(getMission(mission.id), latestMeta.number, {
			status: ITERATION_STATUS.COMPLETED,
			completedAt: Date.now(),
			qualityScore: quality.score,
			verdict: quality.verdict,
			decision: decision,
			duration: latestMeta.startedAt ? Date.now() - latestMeta.startedAt : null
		});
	}

	// Phase 5: Record stop reason if the validation loop should terminate.
	// B2: an autonomy STOP decision pins its own stop reason FIRST — the
	// deterministic loop check still runs and wins only if it also fires.
	const updatedMission = getMission(mission.id);
	const autonomyStop = session._autonomyStop?.stopReason;
	const stopReason = getStopReason(updatedMission) ?? autonomyStop;
	if (stopReason) {
		updateMission(mission.id, { stopReason });
		console.log(`[validation-loop] Mission ${mission.id} stop reason: ${stopReason}${autonomyStop && !getStopReason(updatedMission) ? ' (autonomy decision)' : ''}`);
	}

	// Phase 6: Collect evidence from session into the evidence graph
	try {
		const iterNum = getMission(mission.id)?.currentIteration ?? 1;
		const iterId = `iter_${iterNum}`;
		const evidenceResult = collectSessionEvidence(session, getMission(mission.id), iterId);
		if (evidenceResult.evidenceCreated > 0) {
			console.log(`[evidence-graph] Collected ${evidenceResult.evidenceCreated} evidence items, ${evidenceResult.observationsCreated} observations, ${evidenceResult.linksCreated} links for mission ${mission.id} iteration ${iterNum}`);
		}
	} catch (egErr) {
		console.error(`[evidence-graph] Failed to collect evidence for mission ${mission.id}:`, egErr.message);
	}

	// Phase 17: fire-and-forget UX + application-quality assessment after
	// finalize. Runs off the request path so mission completion latency is
	// unaffected; persists its own record in the UX assessment store.
	setImmediate(() => {
		import('./uxAssessment.js')
			.then(({ runUxAssessment }) => runUxAssessment(session, mission, {}))
			.catch(err => console.error(`[ux-assessment] background run failed for ${mission.id}:`, err?.message || err));
	});

	// Phase 9.3: Close browser when the session is not done — sessions that
	// complete normally have their browser closed by the pipeline, but
	// error/interrupted/idle leftovers used to leak a Chromium process after
	// mission finalization. Only actively-running sessions keep theirs.
	try {
		const sessionStatus = session.status;
		if (sessionStatus !== 'done' && sessionStatus !== 'running' && sessionStatus !== 'awaiting_input') {
			void closeBrowser(session.id);
		}
	} catch (cleanupErr) {
		console.error(`[resource-cleanup] finalizer browser cleanup failed for ${session.id}:`, cleanupErr?.message || cleanupErr);
	}

	// Fire webhooks
	fireMissionWebhooks(mission.id, report);

	return getMission(mission.id);
}

/**
 * B1 W5 — enqueues signed webhook deliveries for a mission event.
 * The delivery engine (webhookDelivery.js) owns retries, persistence and
 * per-attempt SSRF re-validation through the existing targetGuard.
 */
function fireMissionWebhooks(missionId, report, event = 'mission.completed') {
	const mission = getMission(missionId);
	if (!mission) return;
	enqueueDelivery(event, {
		missionId,
		name: mission.name,
		type: mission.type,
		targetUrl: mission.targetUrl,
		status: event === 'mission.failed' ? 'failed' : 'completed',
		verdict: report?.verdict ?? mission.verdict ?? null,
		qualityScore: report?.qualityScore ?? mission.qualityScore ?? null,
		findingsCount: (report?.findings ?? mission.findings ?? []).length,
		completedAt: Date.now()
	}, {
		workspaceId: workspaceOfMission(mission),
		missionId,
		correlationId: mission.correlationId
	});
}

/**
 * Builds a markdown mission report for the report endpoint.
 */
function buildMissionReportMarkdown(mission, report) {
	const lines = [
		`# Mission Report: ${mission.name || mission.id}`,
		'',
		`**Type:** ${mission.type}  `,
		`**Target:** ${mission.targetUrl || 'N/A'}  `,
		`**Verdict:** ${report.verdict}  `,
		`**Quality Score:** ${report.qualityScore}/100  `,
		`**Release Ready:** ${report.regressionReady ? 'Yes' : 'No'}`,
		'',
		'---',
		'',
		'## Findings',
		''
	];

	for (const f of report.findings) {
		lines.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
		if (f.observed) lines.push(`- **Observed:** ${f.observed}`);
		if (f.expected) lines.push(`- **Expected:** ${f.expected}`);
		if (f.impact) lines.push(`- **Impact:** ${f.impact}`);
		if (f.evidence) lines.push(`- **Evidence:** ${f.evidence}`);
		if (f.recommendation) lines.push(`- **Recommendation:** ${f.recommendation}`);
		if (f.confidence != null) lines.push(`- **Confidence:** ${(f.confidence * 100).toFixed(0)}%`);
		if (f.reproducibility) lines.push(`- **Reproducibility:** ${f.reproducibility}`);
		lines.push('');
	}

	if (report.improvementPrompt) {
		lines.push('---', '', '## Improvement Prompt', '', '```', report.improvementPrompt, '```');
	}

	// Phase 17: append APPLICATION QUALITY section when a UX assessment exists.
	try {
		const a = getAssessmentForMission(mission.id);
		if (a) {
			const overall = a.quality?.overall ?? {};
			const dims = a.quality?.dimensions ?? [];
			lines.push(
				'---', '',
				'## APPLICATION QUALITY', '',
				`**Overall:** ${(overall.score != null ? (overall.score * 100).toFixed(0) : 'N/A')}%  `,
				`**Recorded:** ${a.recordedAt ? new Date(a.recordedAt).toISOString() : 'N/A'}  `,
				`**Evidence Coverage:** ${overall.evidenceCoverage != null ? `${(overall.evidenceCoverage * 100).toFixed(0)}%` : 'N/A'}`,
				'',
			);
			for (const d of dims) {
				const bar = d.score != null ? `${(d.score * 100).toFixed(0)}%` : 'N/A';
				lines.push(`- **${d.dimension}**: ${bar}`);
			}
			const issues = (a.ux?.issues ?? a.issues ?? []).filter(i => i.reviewState !== 'REJECTED');
			if (issues.length) {
				lines.push('', '### UX ISSUES', '');
				for (const i of issues) {
					lines.push(`#### ${i.title || i.checkId}`);
					lines.push(`- **Severity:** ${i.severity}  `);
					lines.push(`- **Confidence:** ${i.confidence != null ? `${(i.confidence * 100).toFixed(0)}%` : 'N/A'}  `);
					lines.push(`- **Expected:** ${i.expected ?? 'N/A'}  `);
					lines.push(`- **Actual:** ${i.actual ?? 'N/A'}  `);
					const ev = (i.evidence ?? []).slice(0, 3);
					if (ev.length) lines.push(`- **Evidence:** ${ev.map(e => e.detail || e.kind).join(' | ')}`);
					lines.push('');
				}
			}
		}
	} catch { /* assessment optional — report still renders */ }
	return lines.join('\n');
}

// Chromium is a child process; without this it outlives the server that
// started it and the user is left closing browsers by hand.
let shuttingDown = false;

// B2 fix — abort-originating SDK exceptions must never kill the server.
// The agent's turn-budget backstop aborts in-flight model requests; the
// SDK's SSE emitter then surfaces "Request was aborted." from an event
// handler on the process tick, which the for-await catch in runTurn can
// never see — an unhandled throw there crashed the whole process (observed
// live: wrap-up continuation aborted at limit+2 → server exit). Abort
// errors are EXPECTED budget enforcement; log and continue serving.
process.on('uncaughtException', error => {
	if (/abort/i.test(String(error?.message ?? ''))) {
		console.warn(`[agent] expected abort surfaced outside the stream (${error?.message}) — contained, server continues`);
		return;
	}
	// B2 — budget-exhausted errors from the autonomy dispatch are CONTRACT
	// answers, not crashes. The governor's begin() closure throws them; they
	// should be caught by the caller, but if one escapes to here, contain it.
	if (error?.statusCode === 409 || /turn pool exhausted/i.test(String(error?.message ?? ''))) {
		console.warn(`[agent] budget-exhausted error contained at process level: ${error?.message}`);
		return;
	}
	console.error('[agent] uncaught exception — flushing stores and exiting', error);
	try { flushAllStores(); } catch { /* best effort */ }
	process.exit(1);
});
// M1-P4.4 Phase 2 — register every debounced store with the shutdown
// registry so SIGINT/SIGTERM flushes pending writes BEFORE exit. Each
// flusher is idempotent and reports { dirty, ok } for per-store logging.
registerStoreFlush('sessions', flushSessionsForShutdown);
registerStoreFlush('missions', flushMissionsForShutdown);
registerStoreFlush('findings', flushFindingsForShutdown);
registerStoreFlush('evidence-graph', flushEvidenceGraphForShutdown);
registerStoreFlush('fix-validations', flushFixValidationForShutdown);
registerStoreFlush('replay-runs', flushReplayRunsForShutdown);
registerStoreFlush('ux-assessments', flushUxAssessmentsForShutdown);
registerStoreFlush('regression-runs', flushRegressionRunsForShutdown);
registerStoreFlush('test-cases', flushTestCasesForShutdown);
registerStoreFlush('workflows', flushWorkflowsForShutdown);
registerStoreFlush('knowledge', flushKnowledgeForShutdown);
registerStoreFlush('baselines', flushBaselinesForShutdown);
registerStoreFlush('schedules', flushSchedulesForShutdown);
// B1 W1 — integrations registry (persists via its own load/boot block; the
// flush registration mirrors the others). webhookDelivery.js registers its
// own 'webhook-subscriptions' + 'webhook-deliveries' flushes at module load.
registerStoreFlush('integrations', () => { flushIntegrations(); return { dirty: false, ok: true }; });
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, async () => {
		if (shuttingDown) {
			// Second signal during a wedged shutdown: exit immediately.
			process.exit(1);
		}
		shuttingDown = true;
		// 1) Flush every dirty store (synchronous atomic writes; failures are
		//    logged per store and never abort the remaining stores).
		const t0 = Date.now();
		const { flushed, failed, clean } = flushAllStores();
		console.log(
			`[shutdown] store flush complete in ${Date.now() - t0}ms — ` +
			`${flushed.length} flushed, ${clean.length} clean, ${failed.length} failed`
		);
		// 2) Abort in-flight agent turns and close browsers (existing behavior).
		await Promise.all(listSessions().map(summary => {
			liveFor(summary.id).controller?.abort();
			return closeBrowser(summary.id);
		}));
		process.exit(0);
	});
}

process.on('unhandledRejection', reason => {
	if (/abort/i.test(String(reason?.message ?? reason))) {
		console.warn(`[agent] expected abort rejection contained (${reason?.message ?? reason}) — server continues`);
		return;
	}
	console.error('[agent] unhandled rejection — contained, server continues', reason);
});

// Ensure Default project exists on boot.
ensureDefaultProject();

// One-time migration: assign pre-Phase-7 entities to the Default project.
await assignOrphanedEntities().catch(err => console.error('[projects] Migration error:', err));

// Phase 11: one-time migration of session-embedded findings into global store.
try {
	const allSessions = listSessions({ includeFindings: true });
	const fullSessions = allSessions.map(s => getSession(s.id)).filter(Boolean);
	migrateFromSessions(fullSessions);
} catch (err) {
	console.error('[findings] Migration error:', err.message);
}

// Load missions from disk + backfill project IDs
loadMissionsFromDisk();
// M1-P3 P0-4: reap missions stranded in running/awaiting_input whose session
// was pruned or lost before lazy finalization could settle them.
recoverInterruptedMissions(getSession);
// B2 fix — a server crash mid-run can leave a mission 'running' with its
// session STILL resolvable from disk (recoverInterruptedMissions only
// reaps missions whose session is gone). loadSessions() already flips a
// mid-run session to 'interrupted' at boot, but nothing re-adopts the
// mission itself: the governor never resubmits a 'running' mission, and
// the watchdog only watches missions it submitted — the mission hangs
// 'running' forever (observed live after the abort-crash). Re-adopt every
// persisted 'running' mission whose linked session is settled and not
// live, routing it through the honesty finalizer so it settles honestly
// (interrupted/error sessions → 'failed', never a fabricated pass).
{
	const adopted = [];
	for (const mission of listMissions({ status: 'running' })) {
		const session = mission.sessionId ? getSession(mission.sessionId) : null;
		if (!session) continue; // recoverInterruptedMissions handled these
		if (liveFor(session.id).running) continue; // actually executing
		const settled = ['idle', 'done', 'error', 'interrupted'].includes(session.status);
		if (!settled) continue; // awaiting_input on a live pause — leave alone
		// Defer to the next tick: finalizeMissionFromSession runs the autonomy
		// gate + honesty guard and is idempotent on terminal missions.
		adopted.push(mission.id);
		setImmediate(() => {
			finalizeMissionFromSession(mission, session).catch(err =>
				console.error(`[missions] restart recovery: adopt finalize failed for ${mission.id}:`, err?.message ?? err));
		});
	}
	if (adopted.length > 0) {
		console.log(`[missions] restart recovery: re-adopted ${adopted.length} running mission(s) with settled sessions for honest finalization`);
	}
}

/* ── M1-P4.2: execution governor wiring ──────────────────────────── */

// Any terminal write releases the mission's slot immediately (completed,
// failed, aborted, cancelled, timeout, interrupted via finalizeMission).
missionBus.on('mission:updated', (mission) => {
	if (['completed', 'failed', 'aborted', 'cancelled', 'timeout'].includes(mission.status)) {
		releaseMission(mission.id);
	}
});
// B2 fix — updateMission(...) on a settled revalidation session re-emits
// mission:updated with status 'running', and that used to release the
// governor slot EARLY (mid-flight). The watchdog sweep then saw a released
// mission with a fresh session and re-released; in some interleavings the
// mission ended up untracked while the agent was still running. Only the
// explicit TERMINAL writes above may release a slot — running writes never do.
missionBus.on('mission:finalized', (mission) => {
	releaseMission(mission.id);
});
missionBus.on('mission:deleted', (id) => {
	releaseMission(id);
});

/**
 * Re-submit persisted `queued` missions after a restart (M1-P4.2 Phase 6).
 * A queued mission never had a worker — requeueing is safe, deterministic,
 * and honest. FIFO by queuedAt. The mission goes through the SAME path as a
 * fresh /start, so it cannot bypass validation (target re-check happens at
 * grant time via the standard start flow).
 */
function requeuePersistedMissions() {
	const queuedIds = listQueuedMissionIds();
	if (queuedIds.length === 0) return;
	console.log(`[governor] restart: re-queueing ${queuedIds.length} persisted queued mission(s)`);
	for (const missionId of queuedIds) {
		const mission = getMission(missionId);
		if (!mission || mission.status !== 'queued') continue;
		submitMission(missionId, () => {
			// Identical to the /start grant path — validated, session-created,
			// running-stamped. Reuse by issuing the same internal flow.
			startQueuedMission(mission);
		});
	}
}

/** Grant-path executor shared by requeue and the /start route (via closures). */
async function startQueuedMission(mission) {
	try {
		const targetCheck = await validateTargetUrl(mission.targetUrl);
		if (!targetCheck.ok) {
			updateMission(mission.id, { status: 'failed', failureReason: `blocked target: ${targetCheck.code}` });
			return;
		}
		const missionDeviceCheck = validateDeviceRequest(mission.constraints?.device ?? null);
		if (!missionDeviceCheck.ok) {
			updateMission(mission.id, { status: 'failed', failureReason: missionDeviceCheck.error });
			return;
		}
		const session = createSession(mission.name || 'API Mission', mission.projectId, {
			...(missionDeviceCheck.deviceName ? { deviceRequest: missionDeviceCheck.deviceName } : {}),
			missionId: mission.id
		});
		session.targetUrl = mission.targetUrl;

		if (mission.context?.testCredentials?.vaultKey === 'mission-temp') {
			const tempVault = vaultFor('mission-temp');
			if (tempVault.size > 0) {
				storeSecrets(session.id, Object.fromEntries(tempVault));
				clearSecrets('mission-temp');
				session.secretNames = [...tempVault.keys()];
			}
		}

		updateMission(mission.id, { sessionId: session.id, status: 'running', startedAt: Date.now() });

		let knowledgeHints = '';
		try {
			const appMeta = detectAppMetadata({ targetUrl: mission.targetUrl });
			const knowledgeResult = queryKnowledge(appMeta);
			knowledgeHints = generateExplorationHints(knowledgeResult.patterns || []);
			session.knowledgeHints = knowledgeResult.hints || [];
			session.knowledgePatternsUsed = (knowledgeResult.patterns || []).map(p => p.id);
		} catch { /* knowledge is best-effort */ }

		buildTestContext(session, mission); // B2 W1 — risk/priority context for the per-turn prompt

		const taskPrompt = buildMissionPrompt(mission) + knowledgeHints;
		await ensureRuntime(session);
		startTurn(session, { task: taskPrompt });
		console.log(`[governor] mission ${mission.id} started from queue`);
	} catch (error) {
		updateMission(mission.id, { status: 'failed', failureReason: error instanceof Error ? error.message : String(error) });
	}
}

// BUILD B2 — capabilities pipeline gate registration. The happy path
// (finish_qa_report → mission_finalize) finalizes missions through this gate
// instead of bypassing the autonomy decision.
registerCapabilitiesAutonomyGate({
	gate: async (mission, session) => attemptAutonomyBeforeFinalize(mission, session),
	getSession: (id) => getSession(id)
});

// BUILD B2 — autonomy controller integration seams. The dispatch hook runs
// the SHARED revalidateMissionByIdHandler with an internal marker; the
// handler skips ONLY its first guard (mission already running) because the
// autonomy gate fires BEFORE the terminal write, while status is still
// 'running'. Every other guard (iteration limit, no-improvement, target
// re-validation, budget) still applies identically. A spoofed external
// request carrying the marker is rejected (403) below.
registerAutonomyHooks({
	dispatchRevalidation: async (missionId, options = {}) => {
		const mission = getMission(missionId);
		if (!mission) return false;
		const session = mission.sessionId ? getSession(mission.sessionId) : null;
		if (!session) return false;
		// The gate may only fire for a genuinely settled, non-running session.
		const settled = ['done', 'idle', 'error', 'interrupted'].includes(session.status)
			&& !liveFor(session.id)?.running;
		if (!settled) return false;
		// The governor still holds the mission's slot from the settled
		// iteration (slots release on the terminal mission:updated event,
		// which happens AFTER this gate). Release it first so the new
		// iteration actually starts instead of submitMission returning
		// 'already-tracked' (a silent no-op dispatch).
		releaseMission(missionId);
		const verdict = { statusCode: null, sessionBefore: mission.sessionId ?? null };
		const mockResponse = {
			status(code) { verdict.statusCode = code; return this; },
			json() { return this; },
			setHeader() { return this; }
		};
		const mockRequest = {
			params: { id: missionId },
			body: {},
			__qaseInternalAutonomy: true,
			// C2: the autonomy decision's focus mode + payload ride along.
			// Module-private — the wire router never populates these fields,
			// so an external caller cannot inject a focus.
			__qaseFocusMode: options?.focusMode ?? null,
			__qaseFocusPayload: options?.focusPayload ?? null
		};
		try {
			await revalidateMissionByIdHandler(mockRequest, mockResponse, getMission(missionId));
		} catch (dispatchError) {
			// B2 — a 409 budget_exhausted from the guarded dispatch is an
			// expected CONTRACT refusal (the mission spent its pool). The
			// mock response captured the status code; return false so the
			// autonomy controller falls through to the stop/finalize path.
			if (dispatchError?.statusCode === 409 || verdict.statusCode === 409) {
				console.log(`[autonomy] dispatch refused with 409 (budget exhausted) for ${missionId} — falling through to stop`);
				return false;
			}
			// Unexpected error — log and return false (fail-open to finalize).
			console.error(`[autonomy] dispatch threw for ${missionId}:`, dispatchError?.message ?? dispatchError);
			return false;
		}
		// 202 alone is not enough — submitMission may have returned
		// 'already-tracked' (a no-op), and createSession inside the begin()
		// closure can complete slightly after the 202 (the governor pump may
		// defer it). Poll briefly (≤5s) for the reliable synchronous signals
		// of a REAL new iteration: a fresh sessionId, or the mission being
		// live/queued again after the release.
		let iterationStarted = false;
		for (let probe = 0; probe < 10 && !iterationStarted; probe++) {
			const fresh = getMission(missionId);
			iterationStarted = verdict.statusCode === 202
				&& fresh != null
				&& ((fresh.sessionId ?? null) !== verdict.sessionBefore || ['running', 'queued'].includes(fresh.status))
				&& fresh.status !== 'failed';
			if (!iterationStarted) await new Promise(r => setTimeout(r, 500));
		}
		if (process.env.QASE_DEBUG_AUTONOMY) {
			const fresh = getMission(missionId);
			console.log(`[autonomy:debug] dispatch verdict=${verdict.statusCode} sessionBefore=${verdict.sessionBefore?.slice(0, 8) ?? null} fresh=${fresh ? `${fresh.sessionId?.slice(0, 8) ?? null}/${fresh.status}` : 'gone'} → ${iterationStarted}`);
		}
		return iterationStarted;
	},
	finalizeFallback: (mission, session) => {
		// Handler refused the internal dispatch — authority spoke; finalize
		// normally on the settle path (idempotent: terminal check inside).
		Promise.resolve(finalizeMissionFromSession(mission, session)).catch(() => {});
	}
});

startGovernorWatchdog({
	getMissionStatus: (id) => getMission(id)?.status,
	getMissionStartedAt: (id) => getMission(id)?.startedAt,
	getSessionIdFor: (id) => getMission(id)?.sessionId ?? null,
	probeSession: (sessionId) => {
		const session = getSession(sessionId);
		if (!session) return { settled: true, running: false, settledAt: Date.now(), status: 'gone' };
		const record = liveFor(sessionId);
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
	},
	onStuck: (missionId) => {
		// Same honesty finalizer the lazy GET path uses — no duplicate logic.
		const mission = getMission(missionId);
		if (!mission || mission.status !== 'running' || !mission.sessionId) return;
		const session = getSession(mission.sessionId);
		if (!session) return;
		// B2 — deterministic close-out (zero model turns), then finalize.
		finalizeTurnLimitedRun(session);
		Promise.resolve(finalizeMissionFromSession(mission, session)).catch(() => {});
	},
	onTimeout: (missionId) => {
		const mission = getMission(missionId);
		if (!mission || !isTerminalStatus(mission.status)) {
			finalizeMission(missionId, {
				status: 'failed',
				failureReason: `execution_timeout: exceeded the ${getConfig().missionTimeoutMinutes}-minute wall clock`,
				findings: [],
				summary: null
			});
			if (mission?.sessionId) {
				const record = liveFor(mission.sessionId);
				record?.controller?.abort();
				void closeBrowser(mission.sessionId);
			}
		}
	},
	log: (message) => console.log(message)
});

requeuePersistedMissions();

// Listen for mission_finalized events from the capability orchestrator
// and fire webhooks (webhook registry lives here in index.js)
missionBus.on('finalized', ({ missionId, report }) => {
	if (missionId) {
		fireMissionWebhooks(missionId, report);
	}
});

// B1 W5 — mission.failed webhooks: one listener catches every failure path
// (runtime start, governor catch, blocked target) because they all funnel
// through updateMission → mission:updated.
const failedWebhookSent = new Set(); // missionId — once per process per mission
missionBus.on('updated', (mission) => {
	if (mission?.status === 'failed' && !failedWebhookSent.has(mission.id)) {
		failedWebhookSent.add(mission.id);
		fireMissionWebhooks(mission.id, {
			verdict: 'fail',
			qualityScore: null,
			findings: [],
			failureReason: mission.failureReason ?? null
		}, 'mission.failed');
	}
});

// B2 — the autonomy STOP_FAIL path finalizes through finalizeMission() which
// emits 'mission:finalized' (not 'mission:updated'), so it needs its own
// failure listener or B2-introduced failures would fire NO webhook.
missionBus.on('mission:finalized', (mission) => {
	if (mission?.status === 'failed' && !failedWebhookSent.has(mission.id)) {
		failedWebhookSent.add(mission.id);
		fireMissionWebhooks(mission.id, {
			verdict: 'fail',
			qualityScore: null,
			findings: [],
			failureReason: mission.failureReason ?? null
		}, 'mission.failed');
	}
});

// B1 W5 — finding.revalidated webhooks: fired when a Phase 18 fix-validation
// run completes (VERIFIED_FIXED / NOT_FIXED / REGRESSED / PARTIAL_FIX …).
validationBus.on('run:completed', ({ runId, findingId, fixStatus, validationConfidence }) => {
	const finding = findingId ? getFinding(findingId) : null;
	const mission = finding?.missionId ? getMission(finding.missionId) : null;
	enqueueDelivery('finding.revalidated', {
		runId,
		findingId,
		findingTitle: finding?.title ?? null,
		fixStatus,
		validationConfidence,
		completedAt: Date.now()
	}, {
		workspaceId: mission ? workspaceOfMission(mission) : null,
		missionId: finding?.missionId ?? null,
		correlationId: mission?.correlationId ?? null
	});
});

const port = Number(process.env.PORT ?? 5173);
app.listen(port, () => {
	const config = getPublicConfig();
	console.log(`\n  Qase — autonomous QA agent`);
	console.log(`  http://localhost:${port}`);
	console.log(`  ${config.provider} · ${config.model}${config.baseUrl ? ` · ${config.baseUrl}` : ''}`);
	console.log(`  practice target: http://localhost:${port}/demo  (demo@qase.dev / demo1234)\n`);
	if (config.problem) {
		console.log(`  ! ${config.problem} Set it in the dashboard under Settings, or in .env.\n`);
	}
});
