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

/**
 * Maps backend pipeline stages to human-readable activities.
 * These are activities the user cares about, not internal stage names.
 */
const ACTIVITY_MAP = {
	workflow_save:    { verb: 'Understanding application', doneVerb: 'Application understood' },
	test_generation:  { verb: 'Generating test scenarios', doneVerb: 'Test scenarios generated' },
	smoke_run:        { verb: 'Running validation', doneVerb: 'Validation complete' },
	schedule_create:  { verb: 'Preparing schedule', doneVerb: 'Schedule ready' },
	dev_intelligence: { verb: 'Analyzing root causes', doneVerb: 'Root cause analysis done' },
	feature_gap:      { verb: 'Detecting feature gaps', doneVerb: 'Feature gap analysis done' },
	mission_finalize: { verb: 'Assessing release readiness', doneVerb: 'Release assessment done' },
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
		} else {
			pipelineState.stages = null;
			pipelineState.summary = null;
			renderPipeline();
		}
	} catch {
		pipelineState.stages = null;
		pipelineState.summary = null;
		renderPipeline();
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
	devIntelElements.body.innerHTML = narrativeHtml || '<div class="dev-intel-empty">Waiting for analysis…</div>';
}

async function loadDevIntelFromSession(sessionId) {
	devIntelState.sessionId = sessionId;
	try {
		const data = await api(`/sessions/${sessionId}/dev-intelligence`);
		devIntelState.data = data;
	} catch {
		devIntelState.data = null;
	}
	await loadGapAnalysis(sessionId);
	renderDevIntel();
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

export { renderPipeline, loadPipelineFromSession, renderDevIntel, loadDevIntelFromSession, pipelineState, devIntelState };
