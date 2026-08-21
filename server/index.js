import 'dotenv/config';
import * as path from 'node:path';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { closeBrowser, ensureRuntime, runTurn } from './agent.js';
import { getConfig, getPublicConfig, saveConfig, testConnection } from './config.js';
import { testBrowserstackConnection } from './browserstackTest.js';
import { mountDemoSite } from './demoSite.js';
import { buildReportMarkdown } from './report.js';
import { clearSecrets, secretNames, storeSecrets, vaultFor } from './secrets.js';
import { validateDeviceRequest } from './deviceContext.js';
import {
	addMessage, bus, createSession, deleteSession, emit, getSession,
	listSessions, liveFor, loadSessions, setStatus, startWatchdog, pruneOldSessions
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
	finalizeMission, loadMissionsFromDisk, missionBus, recordIteration,
	getComparisonIterations, isTerminalStatus
} from './missions.js';
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
	createEvidence, getEvidence, getMissionEvidence, getSessionEvidence,
	getFindingEvidence, getEvidenceChainForApi, createObservation, getSessionObservations,
	linkEvidenceToFinding, collectSessionEvidence, computeEvidenceCoverage,
	computeEvidenceConfidence, determineEvidenceStatus, validateGraphIntegrity,
	detectOrphans, getGraphStats, compareIterationEvidence, getHistoricalEvidence,
	getEvidenceCount, getObservationCount, getEdgeCount,
	EVIDENCE_TYPES, EVIDENCE_STATUS
} from './evidenceGraph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(setAuthCookie);
app.use(express.static(path.join(here, '..', 'public')));

// Serve persisted run artifacts (screenshots, traces) from .qase/artifacts/
const artifactsRoot = path.join(here, '..', '.qase', 'artifacts');
app.get('/api/artifacts/:runId/:filename', (request, response) => {
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
			if (summary.status && !['running', 'awaiting_input'].includes(summary.status) && record?.browser) {
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

	response.status(401).json({ error: 'Invalid or missing API token. Set Authorization: Bearer <token> header.' });
}

/**
 * Sets the auth cookie on same-origin requests so the browser UI
 * works transparently.  The cookie is httpOnly so JavaScript can't
 * read it (XSS-resistant) and same-origin only.
 */
function setAuthCookie(request, response, next) {
	const token = getConfig().apiToken;
	if (token) {
		// Set cookie if not already present or matching.
		const cookieMatch = /(?:^|;\s*)qase_token=([^;]+)/.exec(request.headers.cookie ?? '');
		if (!cookieMatch || !safeEqual(cookieMatch[1], token)) {
			response.setHeader('Set-Cookie', `qase_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
		}
	}
	next();
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/i;

/** Pulls the site under test out of whatever the user typed. */
function extractUrl(text) {
	const match = text.match(URL_PATTERN);
	if (!match) {
		return undefined;
	}
	const raw = match[0].replace(/[.,;:)]+$/, '');
	try {
		return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
	} catch {
		return undefined;
	}
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

app.get('/api/config', (_request, response) => {
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

app.get('/api/sessions', (request, response) => {
	response.json(listSessions({ projectId: request.query.projectId }));
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

app.get('/api/sessions/:id', (request, response) => {
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

	const url = extractUrl(text);
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
app.get('/api/sessions/:id/detail', (request, response) => {
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

app.get('/api/sessions/:id/report.md', (request, response) => {
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

app.get('/api/sessions/:id/pipeline-status', (request, response) => {
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
app.get('/api/sessions/:id/dev-intelligence', (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	response.json(session.devIntelligence ?? null);
});

/** Application Understanding model for a session (Phase 2). */
app.get('/api/sessions/:id/app-understanding', (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const appModel = session.appModel || null;
	if (!appModel) return response.json(null);
	response.json(appModel);
});

/** Application Understanding summary for a session (Phase 2). */
app.get('/api/sessions/:id/app-understanding-summary', (request, response) => {
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
app.get('/api/sessions/:id/feature-gaps', (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const summary = session.pipeline?.summary;
	if (!summary?.featureGaps) return response.json(null);
	response.json(summary.featureGaps);
});

/** Per-finding intelligence: structured fix suggestion. */
app.get('/api/findings/:id/dev-analysis', async (request, response) => {
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
app.get('/api/findings/:id/fix-prompt', (request, response) => {
	const finding = getFinding(request.params.id);
	if (!finding) return response.status(404).json({ error: 'Finding not found' });
	const prompt = buildFixPrompt(finding, finding.devIntelligence ?? finding.intelligence ?? null);
	response.type('text/markdown').send(prompt);
});

/** App-level AI-ready improvement prompt (all findings in a session). */
app.get('/api/sessions/:id/app-improvement-prompt', (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const prompt = buildAppImprovementPromptText(session.findings ?? [], session.devIntelligence?.appReport ?? null);
	response.type('text/markdown').send(prompt);
});

/** Full developer intelligence markdown report. */
app.get('/api/sessions/:id/dev-report', (request, response) => {
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
app.get('/api/knowledge', (request, response) => {
	const stats = getKnowledgeStats();
	const allPatterns = getAllPatterns().map(p => summarizeKnowledgeItem(p));
	response.json({ patterns: allPatterns, stats });
});

/** Get a specific knowledge pattern with full provenance. */
app.get('/api/knowledge/:id', (request, response) => {
	const provenance = getPatternProvenance(request.params.id);
	if (!provenance) return response.status(404).json({ error: 'Knowledge pattern not found' });
	response.json(provenance);
});

/** Get knowledge patterns associated with a mission. */
app.get('/api/missions/:id/knowledge', (request, response) => {
	const patterns = getPatternsForMission(request.params.id);
	response.json({ patterns });
});

/** Get knowledge relevant to a session (hints that were injected). */
app.get('/api/sessions/:id/knowledge', (request, response) => {
	const session = requireSession(request, response);
	if (!session) return;
	const hints = session.knowledgeHints || [];
	const patternsUsed = session.knowledgePatternsUsed || [];
	const validation = session.pipeline?.summary?.knowledgeValidation || [];
	const conflicts = session.pipeline?.summary?.knowledgeConflicts || [];
	response.json({ hints, patternsUsed, validation, conflicts });
});

/** Get knowledge statistics. */
app.get('/api/knowledge-stats', (request, response) => {
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
app.get('/api/sessions/:id/decision', (request, response) => {
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
app.get('/api/sessions/:id/decisions', (request, response) => {
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
app.get('/api/missions/:id/decisions', (request, response) => {
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

app.get('/api/sessions/:id/workflow', (request, response) => {
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

app.get('/api/workflows', (request, response) => {
	response.json(listWorkflows({ projectId: request.query.projectId, targetUrl: request.query.targetUrl }));
});

app.get('/api/workflows/:id', (request, response) => {
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

app.get('/api/test-cases', (request, response) => {
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
	response.json(cases);
});

app.get('/api/test-cases/export', (request, response) => {
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

app.post('/api/test-cases', requireApiToken, (request, response) => {
	const data = request.body ?? {};
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

app.get('/api/test-cases/tags', (request, response) => {
	response.json(listTags({ projectId: request.query.projectId }));
});

app.get('/api/test-cases/:id', (request, response) => {
	const tc = getTestCase(request.params.id);
	if (!tc) {
		return response.status(404).json({ error: 'Test case not found' });
	}
	response.json(tc);
});

app.put('/api/test-cases/:id', requireApiToken, (request, response) => {
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

app.get('/api/suites', (request, response) => {
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

app.get('/api/test-cases/:id/runs', (request, response) => {
	response.json(listRuns(request.params.id));
});

/* ── Visual regression baseline routes ──────────────────────────── */

app.get('/api/test-cases/:id/baselines', (request, response) => {
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

app.get('/api/schedules', (request, response) => {
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

app.get('/api/schedules/:id/runs', (request, response) => {
	response.json(listRegressionRuns({ scheduleId: request.params.id }));
});

/* ── Regression trends ──────────────────────────────────────────── */

app.get('/api/regression/trend', (request, response) => {
	response.json(getTrend({
		projectId: request.query.projectId,
		scheduleId: request.query.scheduleId,
		targetUrl: request.query.targetUrl,
		limit: Number(request.query.limit) || 20
	}));
});

app.get('/api/regression/runs', (request, response) => {
	response.json(listRegressionRuns({
		projectId: request.query.projectId,
		scheduleId: request.query.scheduleId,
		targetUrl: request.query.targetUrl,
		limit: Number(request.query.limit) || 50
	}));
});

// Get a single regression run, optionally as JUnit XML.
app.get('/api/regression/runs/:id', (request, response) => {
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
app.get('/api/sessions/:id/events', (request, response) => {
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

app.get('/api/metrics/dashboard', (request, response) => {
	response.json(getDashboardMetrics({ projectId: request.query.projectId }));
});

/* ── Findings / Bugs Hub routes ──────────────────────────────────── */

// Phase 16/17/18 additive surface — mounted BEFORE the legacy findings
// routes so specific paths (e.g. /api/findings/grouped) win over the
// generic /api/findings/:id parameter route below.
import { phaseRouter } from './phaseRouter.js';
import { getAssessmentForMission, loadAssessments } from './uxAssessment.js';
app.use('/api', phaseRouter(requireApiToken));

app.get('/api/findings', (request, response) => {
	response.json(listFindings({
		projectId: request.query.projectId,
		severity: request.query.severity,
		status: request.query.status,
		category: request.query.category,
		assignee: request.query.assignee,
		sessionId: request.query.sessionId,
		q: request.query.q
	}));
});

app.get('/api/findings/stats', (request, response) => {
	response.json(getFindingStats({ projectId: request.query.projectId }));
});

/* Cross-session findings export — MUST be before /:id routes to avoid shadowing. */
app.get('/api/findings/export', (request, response) => {
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

app.get('/api/findings/:id', (request, response) => {
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

app.patch('/api/findings/:id/status', (request, response) => {
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

app.get('/api/sessions/:id/export/findings', (request, response) => {
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

app.get('/api/projects', (_request, response) => {
	response.json(listProjects());
});

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

/* ── Mission management routes (dashboard) ──────────────────────── */

app.get('/api/missions', (request, response) => {
	response.json(listMissions({
		projectId: request.query.projectId,
		status: request.query.status,
		type: request.query.type,
		source: request.query.source
	}));
});

app.post('/api/missions', requireApiToken, (request, response) => {
	const mission = createMission(request.body ?? {});
	response.status(201).json(mission);
});

app.get('/api/missions/:id', (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	response.json(mission);
});

app.put('/api/missions/:id', requireApiToken, (request, response) => {
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
app.post('/api/missions/:id/link-session', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	const session = getSession(request.body?.sessionId);
	if (!session) {
		return response.status(404).json({ error: 'Session not found' });
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

app.post('/api/v1/missions', requireApiToken, async (request, response) => {
	const body = request.body ?? {};

	// Validate required fields
	if (!body.targetUrl) {
		return response.status(400).json({ error: 'targetUrl is required' });
	}

	// Build mission context — testCredentials go to in-memory vault, not persisted JSON
	let contextForMission = {
		buildPrompt: body.buildPrompt || undefined,
		requirements: body.requirements || undefined,
		businessGoals: body.businessGoals || undefined
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
		context: contextForMission
	});

	// Optionally auto-start: create a session and kick off the agent
	if (body.autoStart !== false) {
		try {
			const session = createSession(mission.name || 'API Mission', mission.projectId, missionDevice ? { deviceRequest: missionDevice } : {});
			session.targetUrl = mission.targetUrl;

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
					status: 'running'
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

			// Build the agent task from mission type + objectives + knowledge hints
			const taskPrompt = buildMissionPrompt(mission) + knowledgeHints;

			// Start the agent (async — returns immediately)
			await ensureRuntime(session);
			startTurn(session, { task: taskPrompt });

			response.status(202).json({
				missionId: mission.id,
				sessionId: session.id,
				status: 'running',
				message: 'Mission started. Poll GET /api/v1/missions/:id for results.',
				reportUrl: `/api/v1/missions/${mission.id}/report`
			});
		} catch (error) {
			updateMission(mission.id, { status: 'failed' });
			response.status(500).json({
				missionId: mission.id,
				error: 'Failed to start agent',
				detail: error instanceof Error ? error.message : String(error)
			});
		}
	} else {
		response.status(201).json({
			missionId: mission.id,
			status: 'created',
			message: 'Mission created but not started. POST /api/v1/missions/:id/start to begin.'
		});
	}
});

/**
 * Starts a previously-created mission.
 */
app.post('/api/v1/missions/:id/start', requireApiToken, async (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}
	// Phase 1: prevent restarting a terminal mission
	if (isTerminalStatus(mission.status)) {
		return response.status(409).json({ error: `Mission is already ${mission.status}. Create a new mission or iterate.` });
	}
	if (mission.status === 'running') {
		return response.status(409).json({ error: 'Mission is already running' });
	}

	try {
		// B0.3 — the mission's stored device constraint drives the session.
		const missionDeviceCheck = validateDeviceRequest(mission.constraints?.device ?? null);
		if (!missionDeviceCheck.ok) {
			return response.status(400).json({ error: missionDeviceCheck.error });
		}
		const session = createSession(mission.name || 'API Mission', mission.projectId, missionDeviceCheck.deviceName ? { deviceRequest: missionDeviceCheck.deviceName } : {});
		session.targetUrl = mission.targetUrl;

		// Migrate temp vault credentials to session scope (for missions created with autoStart: false)
		if (mission.context?.testCredentials?.vaultKey === 'mission-temp') {
			const tempVault = vaultFor('mission-temp');
			if (tempVault.size > 0) {
				storeSecrets(session.id, Object.fromEntries(tempVault));
				clearSecrets('mission-temp');
				session.secretNames = [...tempVault.keys()];
			}
		}

		updateMission(mission.id, { sessionId: session.id, status: 'running' });

		// Phase 3: Query knowledge BEFORE exploration and inject as hints
		let knowledgeHints = '';
		let relevantPatterns = [];
		try {
			const appMeta = detectAppMetadata({ targetUrl: mission.targetUrl });
			const knowledgeResult = queryKnowledge(appMeta);
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

		const taskPrompt = buildMissionPrompt(mission) + knowledgeHints;
		await ensureRuntime(session);
		startTurn(session, { task: taskPrompt });

		response.status(202).json({
			missionId: mission.id,
			sessionId: session.id,
			status: 'running'
		});
	} catch (error) {
		updateMission(mission.id, { status: 'failed' });
		response.status(500).json({
			error: 'Failed to start agent',
			detail: error instanceof Error ? error.message : String(error)
		});
	}
});

/**
 * Gets mission status + results. External consumers poll this.
 */
app.get('/api/v1/missions/:id', requireApiToken, (request, response) => {
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
				// Session finished — finalize the mission
				finalizeMissionFromSession(mission, session);
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
		completedAt: mission.completedAt
	});
});

/**
 * Aborts a running mission.
 */
app.post('/api/v1/missions/:id/stop', requireApiToken, (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
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
	if (!mission.targetUrl) {
		return response.status(400).json({ error: 'Mission has no targetUrl' });
	}

	try {
		// B0.3 — carry the mission's device constraint into the iteration
		// session so mobile missions keep their device across iterations.
		const missionDeviceCheck = validateDeviceRequest(mission.constraints?.device ?? null);
		if (!missionDeviceCheck.ok) {
			return response.status(400).json({ error: missionDeviceCheck.error });
		}
		const session = createSession(
			`${mission.name} — Iteration ${mission.currentIteration + 1}`,
			mission.projectId,
			missionDeviceCheck.deviceName ? { deviceRequest: missionDeviceCheck.deviceName } : {}
		);
		session.targetUrl = mission.targetUrl;

		// Set status to running
		updateMission(mission.id, { sessionId: session.id, status: 'running' });

		// Build prompt — includes awareness of previous iterations
		const taskPrompt = buildMissionPrompt(mission);

		await ensureRuntime(session);
		startTurn(session, { task: taskPrompt });

		response.status(202).json({
			missionId: mission.id,
			sessionId: session.id,
			iteration: mission.currentIteration + 1,
			status: 'running',
			message: `Iteration ${mission.currentIteration + 1} started. Poll GET /api/v1/missions/:id for results, then GET /api/v1/missions/:id/comparison for delta.`
		});
	} catch (error) {
		updateMission(mission.id, { status: 'failed' });
		response.status(500).json({
			error: 'Failed to start iteration',
			detail: error instanceof Error ? error.message : String(error)
		});
	}
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
app.post('/api/v1/missions/:id/revalidate', requireApiToken, async (request, response) => {
	const mission = getMission(request.params.id);
	if (!mission) {
		return response.status(404).json({ error: 'Mission not found' });
	}

	// Guard: mission is already running — return existing session (idempotency)
	if (mission.status === 'running') {
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

	try {
		// Create session for the new iteration
		// B0.3 — preserve the mission device constraint across revalidations.
		const missionDeviceCheck = validateDeviceRequest(mission.constraints?.device ?? null);
		if (!missionDeviceCheck.ok) {
			return response.status(400).json({ error: missionDeviceCheck.error });
		}
		const iterationNumber = (mission.currentIteration || 0) + 1;
		const session = createSession(
			`${mission.name} — Revalidation ${iterationNumber}`,
			mission.projectId,
			missionDeviceCheck.deviceName ? { deviceRequest: missionDeviceCheck.deviceName } : {}
		);
		session.targetUrl = mission.targetUrl;

		// Update mission to running
		updateMission(mission.id, { sessionId: session.id, status: 'running' });

		// Phase 3: Query knowledge BEFORE exploration
		const knowledgeData = prepareKnowledgeForIteration(mission);
		session.knowledgeHints = knowledgeData.patterns;
		session.knowledgePatternsUsed = knowledgeData.patternIds;

		// Get previous iteration data for revalidation prompt
		const previousIterations = mission.iterations ?? [];
		const lastIteration = previousIterations.length > 0
			? previousIterations[previousIterations.length - 1]
			: null;

		// Build revalidation prompt with awareness of previous findings
		const taskPrompt = lastIteration
			? buildRevalidationPrompt(mission, lastIteration, knowledgeData.hints)
			: buildMissionPrompt(mission) + knowledgeData.hints;

		// Store iteration metadata
		const iterMeta = createIterationMetadata(mission, session);
		iterMeta.status = ITERATION_STATUS.RUNNING;
		const meta = mission.iterationMetadata ? [...mission.iterationMetadata] : [];
		meta.push(iterMeta);
		updateMission(mission.id, { iterationMetadata: meta });

		// Start the agent
		await ensureRuntime(session);
		startTurn(session, { task: taskPrompt });

		console.log(`[validation-loop] Started revalidation iteration ${iterationNumber} for mission ${mission.id} (session ${session.id})`);

		response.status(202).json({
			missionId: mission.id,
			sessionId: session.id,
			iteration: iterationNumber,
			status: 'running',
			message: `Revalidation iteration ${iterationNumber} started. Poll GET /api/v1/missions/:id for results, then GET /api/v1/missions/:id/loop-status for validation loop status.`,
			knowledgePatternsInjected: knowledgeData.patternIds.length,
			previousFindingsCount: lastIteration?.findings?.length ?? 0
		});
	} catch (error) {
		updateMission(mission.id, { status: 'failed' });
		response.status(500).json({
			error: 'Failed to start revalidation iteration',
			detail: error instanceof Error ? error.message : String(error)
		});
	}
});

/**
 * Phase 5: Get the validation loop status for a mission.
 *
 * Returns the complete iteration history, convergence analysis,
 * comparison, latest decision, and stop reason.
 */
app.get('/api/v1/missions/:id/loop-status', requireApiToken, (request, response) => {
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
	const evidence = getMissionEvidence(mission.id, { limit, offset });
	const total = getMissionEvidence(mission.id, { limit: 999999 }).length;

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
app.get('/api/v1/missions/:id/evidence-coverage', requireApiToken, (request, response) => {
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
app.get('/api/v1/evidence/stats', requireApiToken, (request, response) => {
	response.json(getGraphStats());
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
	const observations = getSessionObservations(session.id, { limit, offset });

	response.json({ sessionId: session.id, observations, total: observations.length });
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
	const evidence = getSessionEvidence(session.id, { limit, offset });

	response.json({ sessionId: session.id, evidence, total: evidence.length });
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
const webhooks = new Map(); // missionId -> [{ url, events }]

app.post('/api/v1/webhooks', requireApiToken, (request, response) => {
	const { missionId, url, events } = request.body ?? {};
	if (!url) {
		return response.status(400).json({ error: 'url is required' });
	}
	if (!missionId) {
		return response.status(400).json({ error: 'missionId is required' });
	}

	const entry = { url, events: events || ['mission.completed'], id: randomUUID() };
	if (!webhooks.has(missionId)) webhooks.set(missionId, []);
	webhooks.get(missionId).push(entry);

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
function finalizeMissionFromSession(mission, session) {
	// Idempotency: if the mission is already terminal, skip
	if (isTerminalStatus(mission.status)) {
		return getMission(mission.id);
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

	// Record this run as a new iteration (enables the validation loop)
	recordIteration(mission.id, {
		sessionId: session.id,
		findings,
		qualityScore: quality.score,
		verdict: quality.verdict,
		releaseReady: quality.releaseReady,
		improvementPrompt: report.improvementPrompt
	});

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
		const decision = session.pipeline?.summary?.decision
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

	// Phase 5: Record stop reason if the validation loop should terminate
	const updatedMission = getMission(mission.id);
	const stopReason = getStopReason(updatedMission);
	if (stopReason) {
		updateMission(mission.id, { stopReason });
		console.log(`[validation-loop] Mission ${mission.id} stop reason: ${stopReason}`);
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
 * Fires registered webhooks for a completed mission.
 * Blocks internal/loopback IPs to prevent SSRF.
 */
function fireMissionWebhooks(missionId, report) {
	const hooks = webhooks.get(missionId);
	if (!hooks?.length) return;

	for (const hook of hooks) {
		// Basic SSRF protection: block internal addresses
		let parsedUrl;
		try {
			parsedUrl = new URL(hook.url);
		} catch {
			continue;
		}
		const blockedPatterns = ['127.0.0.1', 'localhost', '169.254', '10.', '172.16.', '172.17.', '172.18.',
			'172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
			'172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '0.0.0.0', '::1', 'metadata'];
		if (blockedPatterns.some(pattern => parsedUrl.hostname.includes(pattern))) {
			continue;
		}

		fetch(hook.url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ missionId, ...report })
		}).catch(() => { /* non-fatal */ });
	}
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
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, async () => {
		if (shuttingDown) {
			process.exit(1);
		}
		shuttingDown = true;
		await Promise.all(listSessions().map(summary => {
			liveFor(summary.id).controller?.abort();
			return closeBrowser(summary.id);
		}));
		process.exit(0);
	});
}

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

// Listen for mission_finalized events from the capability orchestrator
// and fire webhooks (webhook registry lives here in index.js)
missionBus.on('finalized', ({ missionId, report }) => {
	if (missionId) {
		fireMissionWebhooks(missionId, report);
	}
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
