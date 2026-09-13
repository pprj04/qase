/**
 * BUILD 2 — Execution + Evidence experience for the session detail view.
 *
 * Renders:
 *  - the execution header meta line (provider/browser/OS/device/mode)
 *  - the EVIDENCE tab (real evidence cards from /api/v1/sessions/:id/evidence)
 *  - the FINDINGS tab (session findings with severity/status/confidence)
 *
 * Everything displayed comes from existing APIs. No fabricated data: unknown
 * values are rendered as "not recorded" or the row is hidden entirely.
 */

import { api, apiRaw, escapeHtml, state } from './shared.js';
import { openBugDetail } from './bugs.js';
import { canonicalRunPresentation, currentFindingPresentation, evidenceScreenshotUrl, executionHealthPresentation, isCurrentRunView, runViewSnapshot } from './runDetail.js';

/* ── Execution header meta ─────────────────────────────────────────── */

function fmtDuration(ms) {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

function classifyExecutionMode(session) {
	// B0.2/B0.3 truthfulness taxonomy. Agent sessions run local Chromium in
	// this container; a resolved device context means emulation. REAL_DEVICE
	// is only ever true when the provider was BrowserStack with a device —
	// agent sessions today can't claim it, so we don't.
	const device = session.device ?? null;
	// C4 — an explicitly-requested BrowserStack session that FAILED to attach
	// (missing/invalid credentials, CDP error) has execution:null and no
	// device. It must still label itself truthfully as a BrowserStack session
	// that never launched — never as a local Chromium run.
	if (!device && session.executionProvider === 'browserstack') return 'BROWSERSTACK_FAILED';
	if (!device) return 'DESKTOP';
	if (device.provider === 'browserstack') return 'REAL_DEVICE';
	return 'EMULATED_DEVICE';
}

export function renderExecMeta(session) {
	const metaEl = document.getElementById('exec-meta');
	const modeEl = document.getElementById('exec-mode-chip');
	if (!metaEl || !modeEl) return;

	const parts = [];
	if (session.createdAt && session.updatedAt) {
		const dur = fmtDuration(session.updatedAt - session.createdAt);
		if (dur) parts.push(`⏱ ${dur}`);
	}
	const device = session.device ?? null;
	const deviceName = device?.deviceName
		?? (typeof session.deviceRequest === 'string'
			? session.deviceRequest
			: session.deviceRequest?.device ?? null);
	// C4 — the provider label prefers the session's EXPLICIT provider
	// constraint (set at creation, survives failed launches) over the
	// resolved device context, so a failed BrowserStack session is never
	// mislabeled as a local Chromium run.
	const provider = session.executionProvider ?? device?.provider ?? 'local';
	parts.push(`☁ provider: ${provider === 'local' ? 'local (in-container Chromium)' : provider}`);
	parts.push(`🌐 browser: ${device?.browser ?? 'Chromium (bundled)'}`);
	parts.push(`💻 OS: ${device?.os ?? 'container Linux'}`);
	parts.push(`📱 device: ${deviceName ?? 'none (desktop)'}`);

	metaEl.textContent = parts.join('   ·   ');
	metaEl.hidden = !session.targetUrl && !session.title;

	const mode = classifyExecutionMode(session);
	modeEl.textContent = mode === 'EMULATED_DEVICE' && deviceName
		? `📱 ${deviceName} · EMULATED DEVICE`
		: mode === 'REAL_DEVICE' && deviceName
			? `📱 ${deviceName} · REAL DEVICE`
			: mode.replace('_', ' ');
	modeEl.dataset.mode = mode.toLowerCase();
	modeEl.hidden = false;
	modeEl.title = `Execution environment: ${provider === 'local' ? 'LOCAL' : provider.toUpperCase()}`
		+ (mode === 'EMULATED_DEVICE' ? ' — device profile emulated on in-container Chromium' : '')
		+ (mode === 'BROWSERSTACK_FAILED' ? ' — BrowserStack requested; launch failed, nothing executed' : '');
}

export function renderExecutionHealth(session) {
	const panel = document.getElementById('execution-health');
	const title = document.getElementById('execution-health-title');
	const summary = document.getElementById('execution-health-summary');
	const components = document.getElementById('execution-health-components');
	const action = document.getElementById('execution-health-action');
	if (!panel || !title || !summary || !components || !action) return;
	const health = session?.executionHealth ?? {};
	const view = executionHealthPresentation(session);
	panel.hidden = false;
	panel.dataset.status = view.overall.key;
	const retry = health.lastIssue?.retry;
	const retrySuffix = health.overall === 'retrying' && retry?.willRetry
		? ` Retry ${retry.attempt}/${retry.maxAttempts} scheduled.`
		: health.overall === 'failed' && retry?.exhausted
			? ` Retries exhausted (${retry.attempt}/${retry.maxAttempts}).`
			: '';
	title.textContent = health.overall === 'failed' ? 'Execution failed'
		: health.overall === 'retrying' ? 'Execution recovering'
			: health.overall === 'degraded' ? 'Execution warning' : 'Execution health';
	summary.textContent = (health.overall === 'healthy'
		? 'Execution completed without an infrastructure failure.'
		: health.overall === 'running' && health.lastIssue
			? `Recovered: ${view.reason}`
			: view.reason || 'No execution health reported.') + retrySuffix;
	components.replaceChildren(...view.components.map(({ name, key, label }) => {
		const chip = document.createElement('span');
		chip.className = 'execution-health-component';
		chip.dataset.status = key;
		chip.textContent = `${name}: ${label}`;
		return chip;
	}));
	action.textContent = ['failed', 'retrying', 'degraded'].includes(health.overall)
		? view.nextAction : '';
	action.hidden = !action.textContent;
}

/* ── EVIDENCE tab ──────────────────────────────────────────────────── */

const evState = {
	sessionId: null,
	items: [],
	filter: 'all',
	loaded: false,
	loading: false,
	error: null,
	artifactProbe: new Set() // artifactPaths already probed (exists / missing)
};

function artifactUrl(artifactPath) {
	return `/api/artifacts/${artifactPath}`;
}

function screenshotUrl(item) {
	return evidenceScreenshotUrl(item);
}

async function artifactExists(artifactPath) {
	if (evState.artifactProbe.has(artifactPath + ':ok')) return true;
	if (evState.artifactProbe.has(artifactPath + ':missing')) return false;
	try {
		const res = await fetch(artifactUrl(artifactPath), { method: 'HEAD' });
		const ok = res.ok;
		evState.artifactProbe.add(artifactPath + (ok ? ':ok' : ':missing'));
		return ok;
	} catch {
		return false;
	}
}

function fmtTime(ts) {
	if (!ts) return '—';
	const d = new Date(ts);
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function evidenceKind(item) {
	const t = item.type ?? '';
	const p = item.payload ?? {};
	if (t === 'screenshot') return 'screenshot';
	if (t === 'console' || p.consoleErrors) return 'console';
	if (t === 'network' || p.networkErrors || t === 'api_response') return 'network';
	if (t === 'trace') return 'trace';
	if (item.metadata?.tracePath || (t === 'step_outcome' && item.metadata?.trace)) return 'trace';
	// Display-level classification: a step_outcome whose action was a
	// screenshot capture counts as screenshot evidence for filtering. This is
	// presentation only — the stored evidence type is untouched.
	if (t === 'step_outcome' && (item.action === 'screenshot' || item.action === 'take_screenshot')) return 'screenshot';
	return 'steps';
}

function renderEvidenceCard(item) {
	const kind = evidenceKind(item);
	const card = document.createElement('div');
	card.className = `ev-card ev-${kind}`;

	// Head: kind + timestamp + integrity
	const head = document.createElement('div');
	head.className = 'ev-card-head';
	head.innerHTML = `<span class="ev-kind">${kindIcon(kind)} ${kind.toUpperCase()}</span>
		<span class="ev-ts" title="${escapeHtml(new Date(item.timestamp ?? item.createdAt ?? 0).toISOString())}">${fmtTime(item.timestamp ?? item.createdAt)}</span>`;
	card.append(head);

	// Body per kind
	const body = document.createElement('div');
	body.className = 'ev-card-body';

	if (kind === 'screenshot') {
		const imageUrl = screenshotUrl(item);
		if (imageUrl) {
			const link = document.createElement('a');
			link.href = imageUrl;
			link.target = '_blank';
			link.rel = 'noopener';
			link.title = 'Open full artifact';
			const img = document.createElement('img');
			img.className = 'ev-shot';
			img.loading = 'lazy';
			img.alt = item.observation ?? 'screenshot';
			img.src = imageUrl;
			img.addEventListener('error', () => {
				link.replaceWith(Object.assign(document.createElement('div'), {
					className: 'ev-shot-missing',
					textContent: '🖼 artifact unavailable'
				}));
			});
			link.append(img);
			body.append(link);
		} else {
			// step_outcome screenshot action: no artifact file recorded, but
			// the step card itself carries the info honestly.
			body.innerHTML = `<div class="ev-shot-missing">📸 Screenshot ${item.metadata?.screenshotAttempted ? 'attempted but not persisted' : 'has no persisted artifact reference'}<br>
				<span class="subtle">${escapeHtml(truncate(item.observation ?? 'screenshot captured', 100))}</span></div>`;
		}
	} else if (kind === 'console') {
		const errs = Array.isArray(item.payload?.consoleErrors)
			? item.payload.consoleErrors
			: [item.payload?.consoleErrors ?? item.observation ?? 'console error captured'];
		body.innerHTML = errs.slice(0, 5).map(e =>
			`<div class="ev-console-line">⚠ ${escapeHtml(String(e))}</div>`).join('');
	} else if (kind === 'network') {
		const errs = Array.isArray(item.payload?.networkErrors)
			? item.payload.networkErrors
			: [item.payload?.networkErrors ?? item.observation ?? 'network failure captured'];
		body.innerHTML = errs.slice(0, 5).map(e =>
			`<div class="ev-net-line">🔌 ${escapeHtml(String(e))}</div>`).join('');
	} else if (kind === 'trace') {
		const path = item.metadata?.tracePath ?? item.metadata?.artifactPath;
		if (path) {
			body.innerHTML = `<a class="ev-artifact-link" href="${escapeHtml(artifactUrl(path))}" target="_blank" rel="noopener">🔍 Open trace.zip (Playwright trace)</a>`;
			const link = body.querySelector('.ev-artifact-link');
			void artifactExists(path).then(exists => {
				if (!exists && link?.isConnected) {
					link.replaceWith(Object.assign(document.createElement('div'), {
						className: 'ev-shot-missing',
						textContent: '🔍 trace artifact unavailable'
					}));
				}
			});
		} else {
			body.innerHTML = `<div class="ev-shot-missing">🔍 trace recorded — no file link in this record</div>`;
		}
	} else {
		// step outcome
		const p = item.payload ?? {};
		const status = p.status === 'success' ? '✓' : (p.status ? '✕' : '·');
		const statusCls = p.status === 'success' ? 'ok' : p.status ? 'fail' : '';
		body.innerHTML = `
			<div class="ev-step"><span class="ev-status ${statusCls}">${status}</span>
			<b>${escapeHtml(item.action ?? 'step')}</b></div>
			<div class="ev-url">${escapeHtml(item.target ?? p.urlAfter ?? '')}</div>
			<div class="ev-obs">${escapeHtml(truncate(item.observation ?? '', 140))}</div>
			${p.titleAfter ? `<div class="ev-page subtle">page: ${escapeHtml(p.titleAfter)}</div>` : ''}`;
	}
	card.append(body);

	// Foot: step association + finding association + integrity
	const foot = document.createElement('div');
	foot.className = 'ev-card-foot';
	const stepId = item.metadata?.stepId;
	if (stepId) foot.innerHTML += `<span class="ev-stepref">step ${escapeHtml(String(stepId).slice(0, 8))}</span>`;
	const findingId = item.metadata?.findingId;
	if (findingId) {
		const findingLink = document.createElement('button');
		findingLink.className = 'ev-findingref';
		findingLink.textContent = `🐛 finding ${String(findingId).slice(0, 8)}`;
		findingLink.title = 'Open finding';
		findingLink.addEventListener('click', (e) => {
			e.stopPropagation();
			navigateToBugsAndOpen(findingId);
		});
		foot.append(findingLink);
	}
	if (item.integrity) {
		const integrity = document.createElement('span');
		integrity.className = 'ev-integrity'; integrity.title = 'evidence integrity id';
		integrity.textContent = `⛓ ${item.integrity}`; foot.append(integrity);
	}
	if (foot.childElementCount) card.append(foot);
	return card;
}

function truncate(s, n) {
	return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function kindIcon(kind) {
	return { screenshot: '📷', console: '🖥', network: '🌐', trace: '🔍', steps: '👣' }[kind] ?? '📎';
}

function renderEvidenceGrid() {
	const grid = document.getElementById('ev-grid');
	const countEl = document.getElementById('ev-count');
	const tabCountEl = document.getElementById('count-evidence-tab');
	if (!grid) return;

	const filtered = evState.filter === 'all'
		? evState.items
		: evState.items.filter(i => evidenceKind(i) === evState.filter);

	if (countEl) countEl.textContent = `${filtered.length} of ${evState.items.length} captured`;
	if (tabCountEl) tabCountEl.textContent = evState.items.length ? String(evState.items.length) : '';

	if (!evState.items.length) {
		grid.innerHTML = zeroEvidenceHtml();
		return;
	}
	if (!filtered.length) {
		grid.innerHTML = `<div class="ev-empty">No <b>${evState.filter}</b> evidence in this run. The agent captured ${evState.items.length} evidence items of other kinds.</div>`;
		return;
	}
	grid.replaceChildren(...filtered.slice(0, 200).map(renderEvidenceCard));
	if (filtered.length > 200) {
		const more = document.createElement('div');
		more.className = 'ev-empty';
		more.textContent = `… ${filtered.length - 200} more (showing first 200)`;
		grid.append(more);
	}
	// Agent sessions stream screenshots to the live view but don't persist
	// image files (test-case runs DO — those show real thumbnails). When the
	// grid contains only non-image screenshot records, explain that once at
	// the top so the area never reads as broken.
	const derived = evState.items.some(i => i.metadata?.derivedFromSteps);
	if (derived) {
		const note = document.createElement('div');
		note.className = 'ev-empty ev-note';
		note.innerHTML = `👣 Showing the run's <b>captured browser steps</b>. No published graph records were returned; these are the recorded actions, not independently published evidence.`;
		grid.prepend(note);
	}
	if (evState.filter === 'screenshots' || evState.filter === 'all') {
		const hasImage = filtered.some(i => screenshotUrl(i));
		const hasShotRecords = filtered.some(i => evidenceKind(i) === 'screenshot');
		if (hasShotRecords && !hasImage) {
			const note = document.createElement('div');
			note.className = 'ev-empty ev-note';
			note.textContent = 'Screenshot actions were recorded, but these records have no persisted image reference. See each capture status for details.';
			grid.prepend(note);
		}
	}
}

function zeroEvidenceHtml() {
	const session = state.session;
	const failed = session && ['error', 'interrupted'].includes(session.status);
	const reason = failed
		? 'The run ended with an error before evidence was collected.'
		: 'This run recorded no evidence items. Evidence is collected during mission execution — quick sessions and runs interrupted before the first browser step may have none.';
	return `<div class="ev-empty ev-empty-zero">
		<div class="ev-empty-icon">🗃</div>
		<div class="ev-empty-title">No evidence captured</div>
		<div class="ev-empty-why">${reason}</div>
		<button class="btn btn-ghost btn-sm" id="ev-retry">Retry</button>
	</div>`;
}
export async function loadSessionEvidence(sessionId, { force = false } = {}) {
	if (evState.loading && evState.sessionId === sessionId) return;
	if (evState.sessionId === sessionId && evState.loaded && !force) {
		renderEvidenceGrid();
		return;
	}
	const snapshot = runViewSnapshot(state, sessionId);
	const grid = document.getElementById('ev-grid');
	if (grid && (!evState.loaded || force)) grid.innerHTML = `<div class="ev-loading">Loading evidence…</div>`;
	evState.sessionId = sessionId;
	evState.items = [];
	evState.loaded = false;
	evState.loading = true;
	evState.error = null;
	window.dispatchEvent(new CustomEvent('qase:evidence-state', { detail: { sessionId, items: [], loading: true, loaded: false, error: null } }));
	try {
		// B1 W3 — authed read via the raw helper (token from Settings).
		const res = await apiRaw(`/v1/sessions/${sessionId}/evidence?limit=200`);
		if (!res.ok) throw new Error(`evidence API ${res.status}`);
		const data = await res.json();
		let items = data.evidence ?? [];
		if (!items.length) {
			// The evidence graph is populated when a mission FINALIZES. Runs
			// that end via the session watchdog settle in `idle` and never
			// finalize, so the graph stays empty even though the agent
			// captured dozens of structured steps. Fall back to the raw
			// captured steps (same data the graph itself is derived from)
			// so the tab reflects what actually happened.
			items = await deriveEvidenceFromSteps(sessionId);
		}
		if (!isCurrentRunView(state, snapshot)) return;
		evState.items = items;
		evState.loaded = true;
		renderEvidenceGrid();
		window.dispatchEvent(new CustomEvent('qase:evidence-state', { detail: { sessionId, items, loading: false, loaded: true, error: null } }));
	} catch (err) {
		if (!isCurrentRunView(state, snapshot)) return;
		evState.error = err;
		if (grid) grid.innerHTML = `<div class="ev-empty ev-empty-zero"><div class="ev-empty-title">Evidence unavailable</div>
			<div class="ev-empty-why">${escapeHtml(err.message)}</div>
			<button class="btn btn-ghost btn-sm" id="ev-retry">Retry</button></div>`;
		window.dispatchEvent(new CustomEvent('qase:evidence-state', { detail: { sessionId, items: [], loading: false, loaded: false, error: { message: err.message } } }));
	} finally {
		if (isCurrentRunView(state, snapshot)) evState.loading = false;
	}
}

/**
 * Presentation-only fallback: map captured workflow steps onto the same
 * evidence-card shape /api/v1/sessions/:id/evidence returns, so a
 * watchdog-ended run still shows its real browser actions. No server data
 * is mutated — this mirrors what collectSessionEvidence would have created.
 */
async function deriveEvidenceFromSteps(sessionId) {
	try {
		// B1 W3 — authed read via the raw helper.
		const res = await apiRaw(`/sessions/${sessionId}/detail?field=capturedSteps`);
		if (!res.ok) return [];
		const steps = await res.json();
		if (!Array.isArray(steps)) return [];
		return steps
			.filter(step => step && (step.outcome || step.label))
			.map(step => {
				const action = step.action ?? null;
				const isShot = action === 'screenshot' || action === 'take_screenshot';
				return {
					id: step.id,
					type: isShot ? 'screenshot' : 'step_outcome',
					source: 'browser',
					timestamp: step.ts,
					target: step.url || step.target || null,
					action,
					observation: step.displayLabel ? `${step.displayLabel}${step.label ? `: ${step.label}` : ''}` : (step.label ?? null),
					payload: step.outcome ? {
						status: step.outcome.status,
						urlAfter: step.outcome.urlAfter,
						titleAfter: step.outcome.titleAfter,
						error: step.outcome.error,
						consoleErrors: step.outcome.consoleErrors,
						networkErrors: step.outcome.networkErrors
					} : {},
					metadata: { stepId: step.id, toolCallId: step.toolCallId, derivedFromSteps: true,
						...(step.screenshot ? { artifact:step.screenshot.artifactId ? {id:step.screenshot.artifactId} : null,
							screenshotAttempted:step.screenshot.captureAttempted, screenshotPersisted:step.screenshot.persisted, screenshotStatus:step.screenshot.status } : {}) }
				};
			});
	} catch {
		return [];
	}
}

function wireEvidenceFilters() {
	const bar = document.getElementById('ev-filters');
	if (!bar || bar.dataset.wired) return;
	bar.dataset.wired = '1';
	bar.addEventListener('click', (e) => {
		const btn = e.target.closest('.ev-filter');
		if (!btn) return;
		bar.querySelectorAll('.ev-filter').forEach(b => b.classList.remove('is-active'));
		btn.classList.add('is-active');
		evState.filter = btn.dataset.evFilter;
		renderEvidenceGrid();
	});
}

/* ── FINDINGS tab ──────────────────────────────────────────────────── */

const SEV_CLASS = { critical: 'sev-critical', high: 'sev-high', medium: 'sev-medium', low: 'sev-low', info: 'sev-info' };

async function evidenceCountFor(findingId) {
	try {
		// B1 W3 — authed read via the raw helper.
		const res = await apiRaw(`/findings/${findingId}/evidence`);
		if (!res.ok) return 0;
		const arr = await res.json();
		return Array.isArray(arr) ? arr.length : 0;
	} catch {
		return 0;
	}
}

function renderFindingCard(finding) {
	const card = document.createElement('div');
	card.className = 'sf-card';
	const sev = (finding.severity ?? 'info').toLowerCase();
	const confidence = finding.confidence != null ? `${Math.round(finding.confidence * 100)}%` : '—';
	const status = finding.status ?? finding.review_status ?? 'open';
	const envBits = [];
	const fEnv = finding.environment;
	if (fEnv?.provider) envBits.push(fEnv.provider);
	if (fEnv?.browser) envBits.push(fEnv.browser);
	if (fEnv?.device) envBits.push(fEnv.device);
	if (finding.device?.deviceName) envBits.push(finding.device.deviceName);
	if (!envBits.length && finding.url) {
		// Honest fallback: this run executed desktop local — the session-level
		// environment is the affected environment until finding-level
		// provenance is recorded (B0.2 provenance applies to replay/validation
		// runs; agent-mission findings may only have the URL).
		const vp = (state.session?.viewportsExplored ?? []).some(v => v.width <= 480)
			? 'mobile viewport tested'
			: null;
		if (vp) envBits.push(vp);
	}

	card.innerHTML = `
		<div class="sf-head">
			<span class="sf-sev ${SEV_CLASS[sev] ?? 'sev-info'}">${sev.toUpperCase()}</span>
			<span class="sf-status">${escapeHtml(String(status))}</span>
			<span class="sf-conf" title="evidence-based confidence">${confidence}</span>
		</div>
		<div class="sf-title">${escapeHtml(finding.title ?? 'Untitled finding')}</div>
		<div class="sf-meta subtle">
			<span>🏷 ${escapeHtml(finding.category ?? 'uncategorized')}</span>
			<span class="sf-evcount" data-evcount>⛓ evidence: …</span>
			<span>🔁 ${escapeHtml(finding.reproducibility ?? 'unspecified')}</span>
		</div>
		${envBits.length ? `<div class="sf-env subtle">🖥 ${escapeHtml(envBits.slice(0, 3).join(' · '))}</div>` : ''}
	`;
	card.addEventListener('click', () => {
		// Deep links into #/bugs/:id aren't supported by the router yet —
		// open the existing Bugs detail modal directly instead.
		navigateToBugsAndOpen(finding.id);
	});
	card.title = 'Open in Bugs';
	const countSlot = card.querySelector('[data-evcount]');
	evidenceCountFor(finding.id).then(n => {
		if (!countSlot) return;
		if (n > 0) {
			countSlot.textContent = `⛓ evidence: ${n}`;
		} else {
			// No graph-linked evidence. Don't display a stark "0" — agent
			// findings usually carry inline evidence (observed/actual text)
			// instead of linked nodes. Say which case this is.
			const hasInline = Boolean(finding.observed || finding.actual || finding.evidence);
			countSlot.textContent = hasInline ? '⛓ inline evidence' : '⛓ evidence: none';
			countSlot.title = hasInline
				? 'This finding records its evidence as inline observations rather than linked evidence nodes.'
				: 'No evidence recorded for this finding.';
		}
	});
	return card;
}

export function renderSessionFindings(session) {
	const host = document.getElementById('session-findings');
	const countEl = document.getElementById('count-findings-tab');
	if (!host) return;
	const findings = session?.findings ?? [];
	const currentCount = currentFindingPresentation(session);
	if (countEl) {
		countEl.textContent = currentCount.value == null ? '' : String(currentCount.value);
		countEl.title = currentCount.canonical ? 'Canonical current finding count' : 'Historical session fallback';
	}

	if (!findings.length) {
		const outcome = canonicalRunPresentation(session).key;
		const failed = ['failed', 'blocked', 'partial', 'cancelled', 'interrupted'].includes(outcome);
		const completed = outcome === 'completed';
		host.innerHTML = failed
			? `<div class="sf-empty"><div class="sf-empty-title">No findings were reported before this run ended</div><div class="subtle">Review Activity and Evidence for the truthful execution state.</div></div>`
			: completed
				? `<div class="sf-empty"><div class="sf-empty-title">No defects found in this run</div><div class="subtle">The completed run reported zero current findings.</div></div>`
				: `<div class="sf-empty"><div class="sf-empty-title">No findings reported yet</div><div class="subtle">Findings will appear here as the run progresses.</div></div>`;
		return;
	}
	const sorted = [...findings].sort((a, b) =>
		(['critical', 'high', 'medium', 'low', 'info'].indexOf((a.severity ?? '').toLowerCase()) -
		 ['critical', 'high', 'medium', 'low', 'info'].indexOf((b.severity ?? '').toLowerCase())));

	// Collapse exact same-title repeats (the agent sometimes reports one
	// defect per viewport/iteration). Each group shows ONE card with a
	// "×N occurrences" badge — full list stays available in the Bugs hub.
	const seen = new Map();
	const cards = [];
	for (const finding of sorted) {
		const key = String(finding.title ?? '').trim().toLowerCase() || finding.id;
		if (seen.has(key)) {
			seen.get(key).count++;
			continue;
		}
		const entry = { finding, count: 1 };
		seen.set(key, entry);
		cards.push(entry);
	}
	host.replaceChildren(...cards.map(({ finding, count }) => {
		const card = renderFindingCard(finding);
		if (count > 1) {
			const badge = document.createElement('span');
			badge.className = 'sf-dup-badge';
			badge.textContent = `×${count} occurrences`;
			badge.title = `The agent reported this defect ${count} times (e.g. across viewports or retries). Open in Bugs for every instance.`;
			card.querySelector('.sf-head')?.append(badge);
		}
		return card;
	}));
}

async function navigateToBugsAndOpen(findingId) {
	if (window.location.hash !== '#/bugs') window.location.hash = '#/bugs';
	// Wait a tick for the route change, then open the shared detail modal.
	await new Promise(r => setTimeout(r, 60));
	openBugDetail(findingId);
}

/* ── Tab switch hook ───────────────────────────────────────────────── */

export function handleTabActivation(tabName) {
	if (tabName === 'plan' && state.sessionId) {
		wireEvidenceFilters();
		loadSessionEvidence(state.sessionId);
	}
}

export function initExecutionDetail() {
	wireEvidenceFilters();
	document.addEventListener('click', (e) => {
		if (e.target?.id === 'ev-retry' && state.sessionId) {
			loadSessionEvidence(state.sessionId, { force: true });
		}
	});
}
