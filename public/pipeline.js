/**
 * Mission Status + Application Analysis module.
 *
 * MISSION_STATUS is now rendered as a compact stage strip at the top of the
 * REASONING_LOG tab — high-level mission progress above the detailed steps.
 *
 * APPLICATION_ANALYSIS renders into its own tab in the right panel.
 */

import { $, el, state, api, toast, fail, escapeHtml } from './shared.js';

const pipelineState = {
	stages: null,
	summary: null,
	startTime: null
};

// Phase 2: Application Understanding model data
let cachedAppModel = null;

/**
 * Maps backend pipeline stages to human-readable activities.
 * These are activities the user cares about, not internal stage names.
 */
const ACTIVITY_MAP = {
	application_understanding: { verb: 'Understanding application', doneVerb: 'Application model built' },
	workflow_save:    { verb: 'Saving workflow', doneVerb: 'Workflow saved' },
	test_generation:  { verb: 'Generating test scenarios', doneVerb: 'Test scenarios generated' },
	smoke_run:        { verb: 'Running validation', doneVerb: 'Validation complete' },
	schedule_create:  { verb: 'Preparing schedule', doneVerb: 'Schedule ready' },
	dev_intelligence: { verb: 'Analyzing root causes', doneVerb: 'Root cause analysis done' },
	feature_gap:      { verb: 'Detecting feature gaps', doneVerb: 'Feature gap analysis done' },
	mission_finalize: { verb: 'Assessing release readiness', doneVerb: 'Release assessment done' },
	decision_engine:  { verb: 'Evaluating decision', doneVerb: 'Decision evaluated' },
	knowledge_write:  { verb: 'Updating knowledge base', doneVerb: 'Knowledge updated' }
};

/**
 * Renders MISSION_STATUS as a compact stage strip at the top of REASONING_LOG.
 * Shows the current running stage inline, with an expandable full-history section.
 */
function renderPipeline() {
	const strip = document.getElementById('mission-stage-strip');
	if (!strip) return;

	if (!pipelineState.stages) {
		strip.innerHTML = '';
		return;
	}

	// Build activity entries from stage data
	const activities = [];
	let currentActivity = null;

	for (const [key, config] of Object.entries(ACTIVITY_MAP)) {
		const stage = pipelineState.stages[key];
		if (!stage) continue;
		const status = stage.status ?? 'pending';
		if (status === 'pending') continue;

		if (status === 'running') {
			currentActivity = { config, stage, key };
		}
		activities.push({ config, stage, key, status });
	}

	const html = [];

	// Current status line
	if (currentActivity) {
		html.push(`<div class="mss-current">`);
		html.push(`<span class="ms-status running">[ RUNNING ]</span>`);
		html.push(`<span class="ms-action">${escapeHtml(currentActivity.config.verb)}…</span>`);
		// Elapsed time
		if (pipelineState.startTime) {
			const elapsed = Math.floor((Date.now() - pipelineState.startTime) / 1000);
			const mins = Math.floor(elapsed / 60);
			const secs = elapsed % 60;
			html.push(`<span class="mss-elapsed">${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}</span>`);
		}
		html.push(`</div>`);
	} else {
		const allDone = activities.length > 0 && activities.every(a => a.status === 'done' || a.status === 'skipped');
		if (allDone) {
			html.push(`<div class="mss-current">`);
			html.push(`<span class="ms-status done">[ COMPLETE ]</span>`);
			html.push(`<span class="ms-action">Mission finished</span>`);
			// Show confidence if available
			const conf = pipelineState.summary?.confidence;
			if (conf != null) {
				html.push(`<span class="mss-elapsed">${Math.round(conf * 100)}% confidence</span>`);
			}
			html.push(`</div>`);
		}
	}

	// Compact stage chips for completed activities
	if (activities.length > 0) {
		html.push(`<div class="mss-chips">`);
		for (const act of activities) {
			if (act.status === 'running') continue;
			const icon = act.status === 'done' ? '[ OK ]' : act.status === 'failed' ? '[ FAIL ]' : '[ SKIP ]';
			const cls = act.status === 'done' ? 'done' : act.status === 'failed' ? 'failed' : 'skipped';
			html.push(`<span class="mss-chip ${cls}">${icon} ${escapeHtml(act.config.doneVerb)}</span>`);
		}
		html.push(`</div>`);
	}

	strip.innerHTML = html.join('');
}

async function loadPipelineFromSession(sessionId) {
	try {
		const pipeline = await api(`/sessions/${sessionId}/pipeline-status`);
		if (pipeline) {
			pipelineState.stages = pipeline.stages;
			pipelineState.summary = pipeline.summary;
			renderPipeline();
			// Restore the persisted mission summary bar on hydration (Phase 15).
			if (pipeline.summary && pipeline.summary.qualityScore != null) {
				window.dispatchEvent(new CustomEvent('pipeline:summary-restored', { detail: pipeline.summary }));
			}
		} else {
			pipelineState.stages = null;
			pipelineState.summary = null;
			renderPipeline();
		}
	} catch {
		// Pipeline data is supplementary — don't block the UI on failure.
		// Leave any existing pipeline data in place.
	}
}

/* ── Application Analysis ──────────────────────────────────────── */

const devIntelState = {
	data: null,
	sessionId: null
};

const devIntelElements = {
	body: $('dev-intel-body'),
	refresh: $('dev-intel-refresh'),
	download: $('dev-intel-download'),
	copyPrompt: $('dev-intel-copy-prompt')
};

let cachedGapData = null;

/**
 * Renders Application Analysis as an AI narrative summary.
 * Reads like an engineer's notes, not a data table.
 */
function renderDevIntel() {
	if (!devIntelElements.body) return;

	const data = devIntelState.data;

	if (!data || (!data.results?.length && !data.appReport)) {
		renderAppUnderstandingFromGaps();
		return;
	}

	const html = [];

	// Per-finding fix suggestions (compact)
	if (data.results?.length) {
		html.push('<div class="au-fix-list">');
		const valid = data.results.filter(r => r.status !== 'failed' && r.intelligence);
		if (valid.length > 0) {
			html.push(`<div class="au-fix-count">${valid.length} fix suggestion${valid.length === 1 ? '' : 's'}</div>`);
			for (const r of valid) {
				const f = r.finding;
				const intel = r.intelligence;
				html.push(`<div class="au-fix-item severity-${escapeHtml(f.severity || 'low')}">`);
				html.push(`<div class="au-fix-title">${escapeHtml(f.title || 'Untitled')}</div>`);
				html.push(`<div class="au-fix-detail"><strong>Root cause:</strong> ${escapeHtml(intel.rootCause || '—')}</div>`);
				html.push(`<div class="au-fix-detail"><strong>Fix:</strong> ${escapeHtml(intel.fixApproach || '—')}</div>`);
				html.push(`<span class="au-fix-copy" data-finding-id="${escapeHtml(f.id)}">Copy fix prompt</span>`);
				html.push('</div>');
			}
		}
		html.push('</div>');
	}

	if (html.length === 0) {
		html.push('<div class="dev-intel-empty">Waiting for analysis…</div>');
	}

	// Prepend narrative summary
	const narrativeHtml = buildNarrativeHtml();
	devIntelElements.body.innerHTML = narrativeHtml + html.join('');
}

async function loadGapAnalysis(sessionId) {
	try {
		const data = await api(`/sessions/${sessionId}/feature-gaps`);
		cachedGapData = data;
		renderDevIntel();
	} catch {
		cachedGapData = null;
	}
}

/**
 * Builds the AI narrative summary for Application Analysis.
 * Reads like an engineer describing what they found.
 */
function buildNarrativeHtml() {
	if (!cachedGapData) return '';

	const gap = cachedGapData;
	const purpose = gap.purpose?.name || 'Unknown';
	const appType = gap.inventory?.appType || '';
	const conf = gap.purpose?.confidence;
	const confPct = conf != null ? Math.round(conf * 100) : null;
	const caps = gap.inventory?.capabilities || {};
	const detectedNames = gap.detectedFeatures || [];
	const allCaps = [
		['search', 'Search'], ['dashboard', 'Dashboard'], ['settings', 'Settings'],
		['payment', 'Payment'], ['contact', 'Contact'], ['notifications', 'Notifications'],
		['media', 'Media'], ['apiDocs', 'API Docs']
	];
	const foundLabels = allCaps.filter(([k]) => caps[k]).map(([, l]) => l);
	const allDetected = [...new Set([...foundLabels, ...detectedNames])];
	const expected = gap.expectedFeatures || [];
	const missingLabels = expected.filter(e => !allDetected.some(d => d.toLowerCase().includes(e.toLowerCase())));
	const gaps = gap.featureGaps || gap.gapAnalysis?.gaps || [];
	const journey = gap.journey || [];

	const html = [];

	html.push('<div class="au-narrative">');

	// Detected application type
	html.push('<div class="au-line">');
	html.push(`<span class="au-line-label">Detected application type:</span>`);
	html.push(`<span class="au-line-value">${escapeHtml(purpose)}${appType ? ` (${appType})` : ''}</span>`);
	html.push('</div>');

	// Confidence with reasoning
	if (confPct != null) {
		html.push('<div class="au-line">');
		html.push(`<span class="au-line-label">Confidence:</span>`);
		html.push(`<span class="au-line-value">${confPct}%</span>`);
		html.push('</div>');
		html.push('<div class="au-conf-reason">');
		const reasons = [];
		if (allDetected.length > 0) reasons.push(`verified through ${allDetected.slice(0, 3).join(', ')}`);
		if (journey.length > 0) reasons.push('workflow exploration');
		if (caps.hasLogin || detectedNames.some(d => d.toLowerCase().includes('auth'))) reasons.push('authentication testing');
		html.push(`<span class="au-conf-reason-label">Reason:</span> ${escapeHtml(reasons.join('; ') || 'heuristic analysis')}`);
		html.push('</div>');
	}

	// Summary sentence
	html.push('<div class="au-summary-text">');
	const summaryParts = [];
	if (appType) summaryParts.push(appType.toLowerCase());
	else summaryParts.push(purpose.toLowerCase());
	if (allDetected.length > 0) {
		summaryParts.push(`with ${allDetected.slice(0, 4).join(', ')}`);
	}
	html.push(`<span class="au-summary-label">Summary</span>`);
	html.push(`<span class="au-summary-body">${escapeHtml(summaryParts.join(' '))}${allDetected.length > 4 ? ` and ${allDetected.length - 4} more` : ''}.</span>`);
	html.push('</div>');

	// Compact counts: Detected N / Missing M
	html.push('<div class="au-counts">');
	html.push(`<span class="au-count detected">Detected ${allDetected.length}</span>`);
	if (missingLabels.length > 0 || gaps.length > 0) {
		const missingCount = Math.max(missingLabels.length, gaps.length);
		html.push(`<span class="au-count missing">Missing ${missingCount}</span>`);
	}
	html.push('</div>');

	// Expandable detected features
	if (allDetected.length > 0) {
		html.push('<details class="au-expandable">');
		html.push('<summary>Detected features</summary>');
		html.push('<div class="au-features">');
		for (const feat of allDetected) {
			html.push(`<span class="au-feature found">✓ ${escapeHtml(feat)}</span>`);
		}
		html.push('</div></details>');
	}

	// Expandable missing features
	if (missingLabels.length > 0 || gaps.length > 0) {
		const allMissing = missingLabels.length > 0 ? missingLabels : gaps.map(g => g.name || g.feature || g.description || 'Unknown');
		html.push('<details class="au-expandable">');
		html.push('<summary>Expected but missing</summary>');
		html.push('<div class="au-features">');
		for (const feat of allMissing) {
			html.push(`<span class="au-feature missing">✗ ${escapeHtml(feat)}</span>`);
		}
		html.push('</div></details>');
	}

	// Workflow as vertical chain
	if (journey.length > 0) {
		html.push('<details class="au-expandable" open>');
		html.push('<summary>Primary workflow</summary>');
		html.push('<div class="au-workflow">');
		for (let i = 0; i < journey.length; i++) {
			const step = journey[i];
			html.push(`<div class="au-wf-step">${escapeHtml(step.label || step.name || step)}</div>`);
			if (i < journey.length - 1) html.push('<div class="au-wf-arrow">↓</div>');
		}
		html.push('</div></details>');
	}

	html.push('</div>');
	return html.join('');
}

function renderAppUnderstandingFromGaps() {
	if (!devIntelElements.body) return;
	if (!cachedGapData) {
		devIntelElements.body.innerHTML = '<div class="dev-intel-empty">No application analysis yet. Run a mission to see insights.</div>';
		return;
	}
	const narrativeHtml = buildNarrativeHtml();
	const auModelHtml = buildAppModelHtml();
	devIntelElements.body.innerHTML = auModelHtml + narrativeHtml || '<div class="dev-intel-empty">Waiting for analysis…</div>';
}

/**
 * Phase 2: Renders the structured Application Understanding model.
 * Displays purpose, confidence, roles, features (expected/observed/verified),
 * workflows, unknowns, and conflicts — all with evidence references.
 */
function buildAppModelHtml() {
	if (!cachedAppModel) return '';

	const m = cachedAppModel;
	const u = m.understanding || {};
	const c = m.confidence || {};
	const f = u.features || {};
	const html = [];

	html.push('<div class="au-model-section">');
	html.push('<div class="au-model-header">🧭 Application Understanding</div>');

	// Status badge
	const statusColors = { understood: '#4ade80', partially_understood: '#fbbf24', uncertain: '#f87171', discovered: '#94a3b8' };
	const statusColor = statusColors[m.status] || '#94a3b8';
	html.push(`<div class="au-model-status" style="color:${statusColor}">Status: ${escapeHtml(m.status || 'unknown')}</div>`);

	// Purpose with confidence
	if (u.purpose?.id) {
		html.push('<div class="au-model-row">');
		html.push(`<span class="au-model-label">Purpose:</span>`);
		html.push(`<span class="au-model-value">${escapeHtml(u.purpose.name || u.purpose.id)}</span>`);
		const pc = c.purpose || {};
		if (pc.value != null) {
			html.push(`<span class="au-model-conf">${Math.round(pc.value * 100)}%</span>`);
		}
		html.push('</div>');
		// Confidence basis
		if (c.purpose?.basis?.length > 0) {
			html.push(`<div class="au-model-basis">${escapeHtml(c.purpose.basis.join('; '))}</div>`);
		}
		// Source
		if (u.purpose.source) {
			html.push(`<div class="au-model-source">Source: ${escapeHtml(u.purpose.source)}</div>`);
		}
	}

	// Heuristic baseline preserved
	if (u.purpose?.heuristicBaseline) {
		const hb = u.purpose.heuristicBaseline;
		html.push(`<div class="au-model-heuristic">Heuristic baseline: ${escapeHtml(hb.name || hb.id)} (${Math.round((hb.confidence || 0) * 100)}%)</div>`);
	}

	// Roles
	if (u.roles?.length > 0) {
		html.push('<div class="au-model-row">');
		html.push('<span class="au-model-label">Roles:</span>');
		const rolesHtml = u.roles.map(r => `<span class="au-role-tag ${r.source}">${escapeHtml(r.name)} <small>(${r.source})</small></span>`);
		html.push(`<span class="au-model-roles">${rolesHtml.join(' ')}</span>`);
		html.push('</div>');
	}

	// Features summary
	const expCount = f.expected?.length || 0;
	const obsCount = f.observed?.length || 0;
	const verCount = f.verified?.length || 0;
	const broCount = f.broken?.length || 0;
	const unvCount = f.unverified?.length || 0;
	if (expCount > 0 || obsCount > 0) {
		html.push('<div class="au-model-features">');
		html.push(`<div class="au-model-row"><span class="au-model-label">Features:</span></div>`);
		html.push('<div class="au-feature-grid">');
		html.push(`<span class="au-fcat expected">Expected ${expCount}</span>`);
		html.push(`<span class="au-fcat observed">Observed ${obsCount}</span>`);
		html.push(`<span class="au-fcat verified">Verified ${verCount}</span>`);
		if (broCount > 0) html.push(`<span class="au-fcat broken">Broken ${broCount}</span>`);
		if (unvCount > 0) html.push(`<span class="au-fcat unverified">Unverified ${unvCount}</span>`);
		html.push('</div>');

		// Verified features detail
		if (f.verified?.length > 0) {
			html.push('<details class="au-expandable"><summary>Verified features</summary><div class="au-features">');
			for (const feat of f.verified) {
				html.push(`<span class="au-feature verified">✓ ${escapeHtml(feat.name)}</span>`);
			}
			html.push('</div></details>');
		}
		// Expected features detail
		if (f.expected?.length > 0) {
			html.push('<details class="au-expandable"><summary>Expected features</summary><div class="au-features">');
			for (const feat of f.expected) {
				const sourceTag = feat.source === 'context' ? '📌' : feat.source === 'heuristic' ? '🔍' : '';
				html.push(`<span class="au-feature expected">${sourceTag} ${escapeHtml(feat.name)}</span>`);
			}
			html.push('</div></details>');
		}
		// Unverified features detail
		if (f.unverified?.length > 0) {
			html.push('<details class="au-expandable"><summary>Unverified expected</summary><div class="au-features">');
			for (const feat of f.unverified) {
				html.push(`<span class="au-feature unverified">? ${escapeHtml(feat.name)}</span>`);
			}
			html.push('</div></details>');
		}
		html.push('</div>');
	}

	// Workflows
	if (u.workflows?.length > 0) {
		html.push('<details class="au-expandable" open>');
		html.push('<summary>Workflows</summary>');
		for (const wf of u.workflows) {
			const observed = wf.expectedSteps?.filter(s => s.status === 'observed' || s.status === 'verified').length || 0;
			const total = wf.expectedSteps?.length || 0;
			html.push(`<div class="au-model-wf">${escapeHtml(wf.name)} (${observed}/${total} steps, ${Math.round((wf.confidence || 0) * 100)}%)</div>`);
			if (wf.expectedSteps) {
				html.push('<div class="au-wf-steps">');
				for (const step of wf.expectedSteps) {
					const icons = { verified: '✓', observed: '○', not_found: '✗', not_tested: '?' };
					const icon = icons[step.status] || '?';
					html.push(`<span class="au-wf-step ${step.status}">${icon} ${escapeHtml(step.name)}</span>`);
				}
				html.push('</div>');
			}
		}
		html.push('</details>');
	}

	// Unknowns
	if (m.unknowns?.length > 0) {
		html.push('<details class="au-expandable" open>');
		html.push(`<summary>Unknowns (${m.unknowns.length})</summary>`);
		for (const u of m.unknowns) {
			const icon = u.blocking ? '⛔' : 'ℹ️';
			html.push(`<div class="au-model-unknown">${icon} ${escapeHtml(u.description)}</div>`);
			if (u.reason) html.push(`<div class="au-model-unknown-reason">${escapeHtml(u.reason)}</div>`);
		}
		html.push('</details>');
	}

	// Conflicts
	if (m.conflicts?.length > 0) {
		html.push('<details class="au-expandable" open>');
		html.push(`<summary>⚠️ Conflicts (${m.conflicts.length})</summary>`);
		for (const cf of m.conflicts) {
			html.push(`<div class="au-model-conflict">${escapeHtml(cf.description)}</div>`);
			html.push(`<div class="au-model-conflict-detail">Expected: ${escapeHtml(cf.expectedValue)} | Observed: ${escapeHtml(cf.observedValue)}</div>`);
		}
		html.push('</details>');
	}

	// Evidence count
	if (m.evidence?.length > 0) {
		html.push(`<div class="au-model-evidence">${m.evidence.length} evidence items collected</div>`);
	}

	// Overall confidence
	if (c.overall?.value != null) {
		html.push(`<div class="au-model-overall">Overall confidence: ${Math.round(c.overall.value * 100)}%`);
		if (c.overall.basis?.length > 0) {
			html.push(` <small>(${escapeHtml(c.overall.basis.join('; '))})</small>`);
		}
		html.push('</div>');
	}

	html.push('</div>');
	return html.join('');
}

async function loadAppUnderstanding(sessionId) {
	try {
		const data = await api(`/sessions/${sessionId}/app-understanding`);
		cachedAppModel = data;
	} catch {
		cachedAppModel = null;
	}
}

/* ── Knowledge Layer (Phase 3) ────────────────────────────────── */

let cachedKnowledge = null;

async function loadKnowledge(sessionId) {
	try {
		const data = await api(`/sessions/${sessionId}/knowledge`);
		cachedKnowledge = data;
	} catch {
		cachedKnowledge = null;
	}
}

function renderKnowledgeSection() {
	const container = document.getElementById('knowledge-section');
	if (!container) return;

	if (!cachedKnowledge || (!cachedKnowledge.hints?.length && !cachedKnowledge.validation?.length)) {
		container.innerHTML = `
			<div class="knowledge-empty">
				<span class="knowledge-icon">📚</span>
				<p>No historical knowledge signals for this mission.</p>
				<p class="knowledge-sub">As more missions complete, patterns will accumulate and guide future exploration.</p>
			</div>`;
		return;
	}

	const parts = [];

	// Relevant Knowledge / Historical Signals
	if (cachedKnowledge.hints?.length > 0) {
		parts.push('<div class="knowledge-hints">');
		parts.push('<h4>Historical Knowledge Signals</h4>');
		parts.push('<p class="knowledge-disclaimer">Historical guidance from previous missions — validate independently.</p>');
		for (const hint of cachedKnowledge.hints) {
			const confPct = Math.round((hint.confidence || 0) * 100);
			const relPct = Math.round((hint.relevance || 0) * 100);
			const statusBadge = hint.occurrences >= 3
				? '<span class="k-badge k-supported">SUPPORTED</span>'
				: '<span class="k-badge k-weak">WEAK</span>';
			parts.push(`
				<div class="knowledge-card">
					<div class="k-header">
						<span class="k-pattern">${escapeHtml(hint.pattern)}</span>
						${statusBadge}
					</div>
					<div class="k-meta">
						<span>Confidence: ${confPct}%</span>
						<span>Relevance: ${relPct}%</span>
						<span>Observed: ${hint.occurrences || 1} mission(s)</span>
					</div>
					<div class="k-reason">Matched: ${escapeHtml(hint.reason || 'keyword match')}</div>
					${hint.recommendation ? `<div class="k-rec">Suggestion: ${escapeHtml(hint.recommendation)}</div>` : ''}
				</div>`);
		}
		parts.push('</div>');
	}

	// Validation Results
	if (cachedKnowledge.validation?.length > 0) {
		parts.push('<div class="knowledge-validation">');
		parts.push('<h4>Current Mission Validation</h4>');
		const valIcons = { confirmed: '✅', supported: '🟡', contradicted: '❌', not_tested: '⬜', irrelevant: '⏭️' };
		for (const v of cachedKnowledge.validation) {
			const icon = valIcons[v.result] || '❓';
			parts.push(`
				<div class="k-val-row">
					<span class="k-val-icon">${icon}</span>
					<span class="k-val-result">${v.result.toUpperCase()}</span>
					<span class="k-val-pattern">${escapeHtml(v.pattern)}</span>
				</div>`);
		}
		parts.push('</div>');
	}

	// Conflicts
	if (cachedKnowledge.conflicts?.length > 0) {
		parts.push('<div class="knowledge-conflicts">');
		parts.push('<h4>⚠️ Knowledge Conflicts</h4>');
		for (const c of cachedKnowledge.conflicts) {
			parts.push(`
				<div class="k-conflict">
					<div><strong>Historical:</strong> ${escapeHtml(c.historicalClaim)}</div>
					<div><strong>Current evidence:</strong> ${escapeHtml(c.currentEvidence)}</div>
					<div class="k-resolution">Resolution: ${escapeHtml(c.resolution)}</div>
				</div>`);
		}
		parts.push('</div>');
	}

	container.innerHTML = parts.join('');
}

async function loadDevIntelFromSession(sessionId) {
	devIntelState.sessionId = sessionId;
	try {
		const data = await api(`/sessions/${sessionId}/dev-intelligence`);
		devIntelState.data = data;
	} catch {
		// Non-critical: dev intelligence is supplementary.
		// Don't null out existing data on failure.
	}
	// Parallelize all sub-loads instead of 8 sequential awaits.
	await Promise.allSettled([
		loadGapAnalysis(sessionId),
		loadAppUnderstanding(sessionId),
		loadKnowledge(sessionId),
		loadDecision(sessionId),
		loadLoopStatus(),
		loadEvidence(),
	]);
	renderDevIntel();
	renderKnowledgeSection();
	renderDecisionSection();
	renderLoopSection();
	renderEvidenceSection();
}

/* ── Decision Engine (Phase 4) ─────────────────────────────────── */

let cachedDecision = null;

async function loadDecision(sessionId) {
	try {
		const data = await api(`/sessions/${sessionId}/decision`);
		cachedDecision = data;
	} catch {
		cachedDecision = null;
	}
}

function renderDecisionSection() {
	const container = document.getElementById('decision-section');
	if (!container) return;

	if (!cachedDecision || !cachedDecision.decision) {
		container.innerHTML = `
			<div class="decision-empty">
				<span class="decision-icon">🎯</span>
				<p>No decision recorded for this mission yet.</p>
				<p class="decision-sub">The Decision Engine evaluates after quality assessment completes.</p>
			</div>`;
		return;
	}

	const d = cachedDecision.decision;
	const parts = [];

	// Decision badge
	const badgeClass = {
		CONTINUE: 'decision-badge-continue',
		REVALIDATE: 'decision-badge-revalidate',
		ESCALATE: 'decision-badge-escalate',
		STOP_PASS: 'decision-badge-pass',
		STOP_FAIL: 'decision-badge-fail',
		STOP_BUDGET: 'decision-badge-budget',
		STOP_BLOCKED: 'decision-badge-blocked'
	}[d.decision] || 'decision-badge-unknown';

	parts.push('<div class="decision-panel">');

	// Header with decision type + confidence
	parts.push(`
		<div class="decision-header">
			<span class="decision-badge ${badgeClass}">${escapeHtml(d.decision)}</span>
			<span class="decision-confidence">Confidence: ${(d.confidence * 100).toFixed(0)}%</span>
		</div>`);

	// Reason — the "Why?"
	parts.push(`
		<div class="decision-reason">
			<strong>Why?</strong>
			<p>${escapeHtml(d.reason)}</p>
		</div>`);

	// Key factors
	if (d.factors && Object.keys(d.factors).length > 0) {
		parts.push('<div class="decision-factors"><h4>Key Factors</h4><dl>');
		for (const [key, value] of Object.entries(d.factors)) {
			if (key === 'confidenceBasis' || key === 'inputSignature') continue;
			const display = typeof value === 'number' && value <= 1 && value >= 0
				? `${(value * 100).toFixed(0)}%`
				: escapeHtml(String(value));
			parts.push(`<dt>${escapeHtml(key)}</dt><dd>${display}</dd>`);
		}
		parts.push('</dl></div>');
	}

	// Confidence basis (auditability)
	if (d.factors?.confidenceBasis) {
		const basis = Array.isArray(d.factors.confidenceBasis) ? d.factors.confidenceBasis : [d.factors.confidenceBasis];
		parts.push('<div class="decision-confidence-basis"><h4>Confidence Basis</h4><ul>');
		for (const b of basis) {
			parts.push(`<li>${escapeHtml(String(b))}</li>`);
		}
		parts.push('</ul></div>');
	}

	// Recommended action
	if (d.recommendedAction) {
		parts.push(`
			<div class="decision-action">
				<strong>Recommended Action:</strong>
				<p>${escapeHtml(d.recommendedAction)}</p>
			</div>`);
	}

	// Safety override notice
	if (d.factors?.safetyOverride) {
		parts.push(`
			<div class="decision-safety-override">
				⚠️ <strong>Safety override:</strong> ${escapeHtml(d.factors.safetyOverride)} — original decision was ${escapeHtml(d.factors.originalDecision || 'unknown')}
			</div>`);
	}

	// Evidence references
	if (d.evidenceRefs?.length > 0) {
		parts.push(`<div class="decision-evidence-refs"><strong>Evidence:</strong> ${d.evidenceRefs.length} finding(s) referenced</div>`);
	}

	// Knowledge references
	if (d.knowledgeRefs?.length > 0) {
		parts.push(`<div class="decision-knowledge-refs"><strong>Knowledge:</strong> ${d.knowledgeRefs.length} historical pattern(s) considered</div>`);
	}

	// Policy version
	parts.push(`<div class="decision-policy-version">Policy v${escapeHtml(d.policyVersion || '?')} · ${escapeHtml(d.timestamp || '')}</div>`);

	parts.push('</div>'); // .decision-panel

	// Decision history
	if (cachedDecision.historyCount > 1) {
		parts.push('<div class="decision-history-section">');
		parts.push(`<h4>Decision History (${cachedDecision.historyCount})</h4>`);
		for (const h of (cachedDecision.history ?? []).slice(-10)) {
			const hBadgeClass = {
				CONTINUE: 'decision-badge-continue',
				REVALIDATE: 'decision-badge-revalidate',
				ESCALATE: 'decision-badge-escalate',
				STOP_PASS: 'decision-badge-pass',
				STOP_FAIL: 'decision-badge-fail',
				STOP_BUDGET: 'decision-badge-budget',
				STOP_BLOCKED: 'decision-badge-blocked'
			}[h.decision] || 'decision-badge-unknown';
			parts.push(`
				<div class="decision-history-item">
					<span class="decision-badge decision-badge-sm ${hBadgeClass}">${escapeHtml(h.decision)}</span>
					<span class="decision-history-time">${escapeHtml(h.timestamp || '')}</span>
					<span class="decision-history-conf">${(h.confidence * 100).toFixed(0)}%</span>
				</div>`);
		}
		parts.push('</div>');
	}

	container.innerHTML = parts.join('');
}

/* ── Continuous Validation Loop (Phase 5) ───────────────────────── */

let cachedLoopStatus = null;

async function loadLoopStatus(missionId) {
	try {
		// The loop status needs a mission ID — get it from the session's linked mission
		// We need to find the mission for the current session
		let mId = missionId;
		if (!mId) {
			// Try to find the mission linked to this session
			const missions = await api('/missions');
			const linked = missions.find(m => m.sessionId === state.sessionId);
			if (!linked) return;
			mId = linked.id;
		}

		const data = await api(`/v1/missions/${mId}/loop-status`);
		cachedLoopStatus = { ...data, missionId: mId };
	} catch {
		cachedLoopStatus = null;
	}
}

function renderLoopSection() {
	const container = document.getElementById('loop-section');
	if (!container) return;

	if (!cachedLoopStatus || cachedLoopStatus.totalIterations === 0) {
		container.innerHTML = `
			<div class="loop-empty">
				<span class="loop-icon">🔄</span>
				<p>No validation iterations yet.</p>
				<p class="loop-sub">After a mission completes, revalidate to start a continuous validation loop.</p>
			</div>`;
		return;
	}

	const ls = cachedLoopStatus;
	const parts = [];

	parts.push('<div class="loop-panel">');

	// Header
	parts.push(`
		<div class="loop-header">
			<h4>Validation Loop — Iteration ${ls.currentIteration}</h4>
			<span class="loop-max">Max: ${ls.maxIterations}</span>
		</div>`);

	// Convergence badge
	if (ls.convergence) {
		const convState = ls.convergence.state;
		const convClass = {
			improving: 'loop-badge-improving',
			declining: 'loop-badge-declining',
			regression: 'loop-badge-regression',
			no_improvement: 'loop-badge-no-improvement',
			stable: 'loop-badge-stable',
			insufficient_data: 'loop-badge-unknown'
		}[convState] || 'loop-badge-unknown';
		parts.push(`
			<div class="loop-convergence">
				<span class="loop-badge ${convClass}">${escapeHtml(convState.replace(/_/g, ' ').toUpperCase())}</span>
				<span class="loop-detail">${escapeHtml(ls.convergence.detail || '')}</span>
			</div>`);
	}

	// Score comparison
	if (ls.comparison) {
		const c = ls.comparison;
		const deltaStr = c.scoreDelta > 0 ? `+${c.scoreDelta}` : `${c.scoreDelta}`;
		const deltaClass = c.scoreDelta > 0 ? 'loop-delta-up' : c.scoreDelta < 0 ? 'loop-delta-down' : 'loop-delta-flat';
		parts.push(`
			<div class="loop-comparison">
				<div class="loop-comp-item">
					<span class="loop-comp-label">Score Delta</span>
					<span class="loop-comp-value ${deltaClass}">${deltaStr}</span>
				</div>
				<div class="loop-comp-item">
					<span class="loop-comp-label">Fixed</span>
					<span class="loop-comp-value loop-fixed">${c.fixedCount}</span>
				</div>
				<div class="loop-comp-item">
					<span class="loop-comp-label">Remaining</span>
					<span class="loop-comp-value">${c.remainingCount}</span>
				</div>
				<div class="loop-comp-item">
					<span class="loop-comp-label">New / Regressions</span>
					<span class="loop-comp-value ${c.newRegressionCount > 0 ? 'loop-regression' : ''}">${c.newRegressionCount}</span>
				</div>
			</div>`);
	}

	// Latest decision
	if (ls.latestDecision) {
		parts.push(`
			<div class="loop-decision">
				<strong>Latest Decision:</strong> ${escapeHtml(ls.latestDecision.decision || 'N/A')}
				<span class="loop-decision-conf">${ls.latestDecision.confidence != null ? `${(ls.latestDecision.confidence * 100).toFixed(0)}% confidence` : ''}</span>
			</div>`);
	}

	// Stop reason
	if (ls.stopReason) {
		parts.push(`
			<div class="loop-stop-reason">
				⏹ <strong>Stop:</strong> ${escapeHtml(ls.stopReason.replace(/_/g, ' '))}
			</div>`);
	}

	// Revalidate button
	if (ls.canRevalidate && !ls.stopReason && cachedLoopStatus.missionId) {
		parts.push(`
			<button class="btn btn-sm loop-revalidate-btn" id="loop-revalidate-btn">
				🔄 Start Revalidation (Iteration ${ls.currentIteration + 1})
			</button>`);
	}

	// Iteration history
	if (ls.iterations && ls.iterations.length > 0) {
		parts.push('<div class="loop-iterations">');
		parts.push('<h4>Iteration History</h4>');
		for (const iter of ls.iterations) {
			const scoreColor = iter.qualityScore >= 85 ? 'loop-score-pass' : iter.qualityScore >= 60 ? 'loop-score-warn' : 'loop-score-fail';
			parts.push(`
				<div class="loop-iter-item">
					<span class="loop-iter-num">#${iter.number}</span>
					<span class="loop-iter-score ${scoreColor}">${iter.qualityScore ?? '—'}</span>
					<span class="loop-iter-verdict">${escapeHtml(iter.verdict || '—')}</span>
					<span class="loop-iter-findings">${iter.findingCount} findings</span>
				</div>`);
		}
		parts.push('</div>');
	}

	parts.push('</div>'); // .loop-panel

	container.innerHTML = parts.join('');

	// Wire up revalidate button
	const revalidateBtn = document.getElementById('loop-revalidate-btn');
	if (revalidateBtn) {
		revalidateBtn.addEventListener('click', async () => {
			if (!cachedLoopStatus?.missionId) return;
			revalidateBtn.disabled = true;
			revalidateBtn.textContent = 'Starting...';
			try {
				const token = localStorage.getItem('qase_api_token') || '';
				await api(`/v1/missions/${cachedLoopStatus.missionId}/revalidate`, { method: 'POST' });
				toast('Revalidation iteration started');
				setTimeout(() => loadLoopStatus(cachedLoopStatus.missionId).then(renderLoopSection), 3000);
			} catch (error) {
				toast(error.message || 'Failed to start revalidation', 'bad');
				revalidateBtn.disabled = false;
				revalidateBtn.textContent = '🔄 Start Revalidation';
			}
		});
	}
}

devIntelElements.refresh?.addEventListener('click', async () => {
	if (!state.sessionId) return;
	if (devIntelElements.body) devIntelElements.body.innerHTML = '<div class="dev-intel-empty">Analyzing findings…</div>';
	try {
		const data = await api(`/sessions/${state.sessionId}/analyze-dev`, { method: 'POST' });
		devIntelState.data = data;
		renderDevIntel();
		toast('Analysis updated');
	} catch (error) {
		fail(error);
	}
});

devIntelElements.download?.addEventListener('click', async () => {
	if (!state.sessionId) return;
	try {
		const res = await fetch(`/api/sessions/${state.sessionId}/dev-report`);
		if (!res.ok) throw new Error('Report not available.');
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `qase-report-${state.sessionId.slice(0, 8)}.md`;
		a.click();
		URL.revokeObjectURL(url);
	} catch (error) {
		toast(error.message, 'bad');
	}
});

devIntelElements.copyPrompt?.addEventListener('click', async () => {
	if (!state.sessionId) return;
	try {
		const res = await fetch(`/api/sessions/${state.sessionId}/app-improvement-prompt`);
		const text = await res.text();
		await navigator.clipboard.writeText(text);
		toast('AI improvement prompt copied to clipboard');
	} catch {
		toast('Failed to copy prompt', 'bad');
	}
});

// Copy per-finding fix prompt
document.addEventListener('click', async (e) => {
	const target = e.target.closest('[data-finding-id]');
	if (!target || !target.classList.contains('au-fix-copy')) return;
	e.stopPropagation();
	const findingId = target.dataset.findingId;
	try {
		const res = await fetch(`/api/findings/${findingId}/fix-prompt`);
		const text = await res.text();
		await navigator.clipboard.writeText(text);
		toast('Fix prompt copied to clipboard');
	} catch {
		toast('Failed to copy', 'bad');
	}
});

let cachedEvidence = null;

async function loadEvidence(missionId) {
	try {
		let mId = missionId;
		if (!mId) {
			const missions = await api('/missions');
			const linked = missions.find(m => m.sessionId === state.sessionId);
			if (!linked) return;
			mId = linked.id;
		}
		const [statsRes, coverageRes] = await Promise.all([
			api(`/v1/evidence/stats`),
			api(`/v1/missions/${mId}/evidence-coverage`).catch(() => null)
		]);
		cachedEvidence = { stats: statsRes, coverage: coverageRes, missionId: mId };
	} catch {
		cachedEvidence = null;
	}
}

function renderEvidenceSection() {
	const container = document.getElementById('evidence-section');
	if (!container) return;

	if (!cachedEvidence) {
		container.innerHTML = '';
		return;
	}

	const { stats, coverage } = cachedEvidence;

	if (!stats || (stats.totalEvidence === 0 && !coverage)) {
		container.innerHTML = '';
		return;
	}

	let html = '<div class="evidence-panel">';
	html += '<h3 class="section-title">Evidence Graph</h3>';

	// Stats row
	if (stats.totalEvidence > 0) {
		html += '<div class="evidence-stats-row">';
		html += `<div class="evidence-stat"><span class="evidence-stat-value">${stats.totalEvidence}</span><span class="evidence-stat-label">Evidence</span></div>`;
		html += `<div class="evidence-stat"><span class="evidence-stat-value">${stats.totalObservations || 0}</span><span class="evidence-stat-label">Observations</span></div>`;
		html += `<div class="evidence-stat"><span class="evidence-stat-value">${stats.totalEdges || 0}</span><span class="evidence-stat-label">Links</span></div>`;
		html += '</div>';
	}

	// Coverage bar
	if (coverage && coverage.total > 0) {
		const pct = Math.round(coverage.coverage);
		const barColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
		html += '<div class="evidence-coverage">';
		html += '<div class="evidence-coverage-header">';
		html += `<span>Evidence Coverage</span><span style="font-weight:600;color:${barColor}">${pct}%</span>`;
		html += '</div>';
		html += `<div class="evidence-coverage-bar"><div class="evidence-coverage-fill" style="width:${pct}%;background:${barColor}"></div></div>`;
		html += '<div class="evidence-coverage-detail">';
		html += `<span>✓ ${coverage.verified || 0} verified</span>`;
		html += `<span>◐ ${coverage.partiallyVerified || 0} partial</span>`;
		html += `<span>○ ${coverage.unverified || 0} unverified</span>`;
		html += `<span>of ${coverage.total} total</span>`;
		html += '</div>';
		html += '</div>';
	}

	// Evidence by type
	if (stats.evidenceByType && Object.keys(stats.evidenceByType).length > 0) {
		html += '<div class="evidence-types">';
		html += '<div class="evidence-types-title">By Type</div>';
		html += '<div class="evidence-type-grid">';
		for (const [type, count] of Object.entries(stats.evidenceByType)) {
			html += `<div class="evidence-type-chip"><span class="evidence-type-icon">${getEvidenceIcon(type)}</span> ${escapeHtml(type)} <span class="evidence-type-count">${count}</span></div>`;
		}
		html += '</div>';
		html += '</div>';
	}

	html += '</div>';
	container.innerHTML = html;
}

function getEvidenceIcon(type) {
	const icons = {
		screenshot: '📷', network: '🌐', console: '🖥', dom: '📄',
		api_response: '🔌', log: '📋', trace: '🔍', assertion: '✓',
		observation: '👁', step_outcome: '👣', finding_detail: '🔍',
		video: '🎥'
	};
	return icons[type] || '📎';
}

export { renderPipeline, loadPipelineFromSession, renderDevIntel, loadDevIntelFromSession, pipelineState, devIntelState, renderKnowledgeSection, loadKnowledge, renderDecisionSection, loadDecision, renderLoopSection, loadLoopStatus, renderEvidenceSection, loadEvidence };
