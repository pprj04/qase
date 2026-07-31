import 'dotenv/config';
import * as path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { closeBrowser, ensureRuntime, runTurn } from './agent.js';
import { getConfig, getPublicConfig, saveConfig, testConnection } from './config.js';
import { mountDemoSite } from './demoSite.js';
import { buildReportMarkdown } from './report.js';
import { clearSecrets, secretNames, storeSecrets } from './secrets.js';
import {
	addMessage, bus, createSession, deleteSession, emit, getSession,
	listSessions, liveFor, loadSessions, setStatus
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
	buildAppImprovementReport, buildFixPrompt, buildAppImprovementPromptText
} from './devIntelligence.js';
import { buildDevReportMarkdown } from './devReport.js';
import {
	createSuite, listSuites, getSuite, updateSuite, deleteSuite
} from './suites.js';
import { buildJUnitXml } from './junit.js';
import {
	getBaselines, getBaseline, approveBaseline, deleteBaselines,
	autoCaptureBaselines
} from './baselines.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
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
startScheduler();

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
 * Usage: apply to specific routes via `app.post('/path', requireApiToken, handler)`.
 */
function requireApiToken(request, response, next) {
	const token = getConfig().apiToken;
	if (!token) {
		return next(); // No token configured — open access.
	}
	const auth = request.headers.authorization ?? '';
	const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	if (safeEqual(bearer, token)) {
		return next();
	}
	response.status(401).json({ error: 'Invalid or missing API token. Set Authorization: Bearer <token> header.' });
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
app.post('/api/config/test', async (request, response) => {
	response.json(await testConnection(request.body ?? {}));
});

app.get('/api/sessions', (request, response) => {
	response.json(listSessions({ projectId: request.query.projectId }));
});

app.post('/api/sessions', (request, response) => {
	const projectId = request.body?.projectId ?? getDefaultProjectId();
	response.status(201).json(createSession('New test run', projectId));
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
			findings: session.findings
		});
	}

	response.json(payload);
});

app.delete('/api/sessions/:id', (request, response) => {
	clearSecrets(request.params.id);
	response.json({ deleted: deleteSession(request.params.id) });
});

/** The chat entry point: a URL starts a run, anything else steers the current one. */
app.post('/api/sessions/:id/message', async (request, response) => {
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
app.post('/api/sessions/:id/answer', (request, response) => {
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
app.post('/api/sessions/:id/credentials', (request, response) => {
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

app.post('/api/sessions/:id/stop', (request, response) => {
	const session = requireSession(request, response);
	if (!session) {
		return;
	}
	liveFor(session.id).controller?.abort();
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

app.post('/api/sessions/:id/run-pipeline', (request, response) => {
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
app.post('/api/sessions/:id/analyze-dev', async (request, response) => {
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

app.post('/api/sessions/:id/workflow', (request, response) => {
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

app.put('/api/workflows/:id', (request, response) => {
	const wf = updateWorkflow(request.params.id, request.body ?? {});
	if (!wf) {
		return response.status(404).json({ error: 'Workflow not found' });
	}
	response.json(wf);
});

app.delete('/api/workflows/:id', (request, response) => {
	const deleted = deleteWorkflow(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

/* ── Test case routes ───────────────────────────────────────────── */

app.post('/api/workflows/:id/generate-tests', async (request, response) => {
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
	response.json(listTestCases({
		projectId: request.query.projectId,
		targetUrl: request.query.targetUrl,
		workflowId: request.query.workflowId,
		suiteId: request.query.suiteId,
		tag: request.query.tag
	}));
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

app.post('/api/test-cases', (request, response) => {
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

app.post('/api/test-cases/:id/clone', (request, response) => {
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

app.put('/api/test-cases/:id', (request, response) => {
	const tc = updateTestCase(request.params.id, request.body ?? {});
	if (!tc) {
		return response.status(404).json({ error: 'Test case not found' });
	}
	response.json(tc);
});

app.delete('/api/test-cases/:id', (request, response) => {
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

app.post('/api/suites', (request, response) => {
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

app.put('/api/suites/:id', (request, response) => {
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

app.delete('/api/suites/:id', (request, response) => {
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
		const { credentials } = request.body ?? {};
		const result = await runTestCase(tc, { credentials });
		const stored = addRun(result);
		response.json({ result, history: stored });
	} catch (error) {
		response.status(500).json({ error: error.message });
	}
});

app.post('/api/test-cases/run', requireApiToken, async (request, response) => {
	const { testCaseIds, credentials } = request.body ?? {};
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
		const summary = await runTestSuite(cases, { credentials, concurrency, retries });
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

app.delete('/api/test-cases/:id/baselines', (request, response) => {
	deleteBaselines(request.params.id);
	response.json({ deleted: true });
});

/* ── Schedule routes ────────────────────────────────────────────── */

app.get('/api/schedules', (request, response) => {
	response.json(listSchedules({ projectId: request.query.projectId }));
});

app.post('/api/schedules', (request, response) => {
	try {
		const body = { ...request.body };
		if (!body.projectId) body.projectId = getDefaultProjectId();
		const sched = createSchedule(body);
		response.status(201).json(sched);
	} catch (error) {
		response.status(400).json({ error: error.message });
	}
});

app.put('/api/schedules/:id', (request, response) => {
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

app.delete('/api/schedules/:id', (request, response) => {
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

app.post('/api/validate-cron', (request, response) => {
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

app.post('/api/findings', (request, response) => {
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

app.put('/api/findings/:id', (request, response) => {
	const finding = updateFinding(request.params.id, request.body ?? {});
	if (!finding) {
		return response.status(404).json({ error: 'Finding not found' });
	}
	response.json(finding);
});

app.delete('/api/findings/:id', (request, response) => {
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

app.post('/api/findings/:id/comments', (request, response) => {
	const { author, text } = request.body ?? {};
	const comment = addComment(request.params.id, author, text);
	if (!comment) {
		return response.status(404).json({ error: 'Finding not found or empty comment' });
	}
	response.status(201).json(comment);
});

app.post('/api/findings/:id/link/:testCaseId', (request, response) => {
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

app.delete('/api/findings/:id/link/:testCaseId', (request, response) => {
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

app.post('/api/projects', (request, response) => {
	const project = createProject(request.body ?? {});
	response.status(201).json(project);
});

app.put('/api/projects/:id', (request, response) => {
	const project = updateProject(request.params.id, request.body ?? {});
	if (!project) {
		return response.status(404).json({ error: 'Project not found' });
	}
	response.json(project);
});

app.delete('/api/projects/:id', (request, response) => {
	const deleted = deleteProject(request.params.id);
	response.status(deleted ? 204 : 404).end();
});

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
