/**
 * Pipeline & Dev Intelligence module — pipeline stages visualization and dev analysis.
 */
import { $, el, state, api, toast, fail, escapeHtml } from './shared.js';

const pipelineState = {
	stages: null,
	summary: null
};

const PIPELINE_STAGE_META = [
	{ key: 'workflow_save',   icon: '📋', label: 'Workflow' },
	{ key: 'test_generation', icon: '🧪', label: 'Tests' },
	{ key: 'smoke_run',       icon: '💨', label: 'Smoke' },
	{ key: 'schedule_create', icon: '📅', label: 'Schedule' },
	{ key: 'dev_intelligence',icon: '🧠', label: 'Dev Report' }
];

const STATUS_ICONS = {
	pending: '–', running: '⟳', done: '✓', skipped: '⊘', failed: '✕'
};

function renderPipeline() {
	if (!pipelineState.stages) {
		el.pipelinePanel.hidden = true;
		return;
	}

	el.pipelinePanel.hidden = false;
	el.pipelineStages.innerHTML = '';

	for (let i = 0; i < PIPELINE_STAGE_META.length; i++) {
		const meta = PIPELINE_STAGE_META[i];
		const stage = pipelineState.stages[meta.key] ?? { status: 'pending', detail: 'Not run yet' };

		if (i > 0) {
			const arrow = document.createElement('span');
			arrow.className = 'pipeline-arrow';
			arrow.textContent = '→';
			el.pipelineStages.append(arrow);
		}

		const chip = document.createElement('div');
		chip.className = `pipeline-stage stage-${stage.status ?? 'pending'}`;

		const icon = document.createElement('span');
		icon.className = 'pipeline-stage-icon';
		if (stage.status === 'running') {
			icon.classList.add('spinning');
			icon.textContent = '⟳';
		} else {
			icon.textContent = STATUS_ICONS[stage.status] ?? '–';
		}

		const text = document.createElement('span');
		text.innerHTML = `<span class="pipeline-stage-label">${meta.icon} ${meta.label}</span>`;
		if (stage.detail) {
			text.innerHTML += `<div class="pipeline-stage-detail">${escapeHtml(stage.detail)}</div>`;
		}

		chip.append(icon, text);
		el.pipelineStages.append(chip);
	}

	if (pipelineState.summary) {
		const s = pipelineState.summary;
		const parts = [];
		if (s.workflowId) parts.push('Workflow saved');
		if (s.testCaseCount) parts.push(`${s.testCaseCount} tests generated`);
		if (s.smokeResults) parts.push(`Smoke: ${s.smokeResults.passed}/${s.smokeResults.total} passed`);
		if (s.scheduleId) parts.push('Schedule created');
		if (s.devIntelligence?.findingsAnalyzed) parts.push(`Dev report: ${s.devIntelligence.findingsAnalyzed} analyzed`);
		el.pipelineSummary.textContent = parts.join(' · ');
	} else {
		el.pipelineSummary.textContent = '';
	}
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
			el.pipelinePanel.hidden = true;
		}
	} catch {
		el.pipelinePanel.hidden = true;
	}
}

el.pipelineRerun?.addEventListener('click', async () => {
	if (!state.sessionId) return;
	try {
		await api(`/sessions/${state.sessionId}/run-pipeline`, { method: 'POST' });
		toast('Pipeline triggered');
	} catch (error) {
		fail(error);
	}
});

/* ── Dev Intelligence (Phase 13) ──────────────────────────────────── */

const devIntelState = {
	data: null,
	sessionId: null
};

const devIntelElements = {
	panel: $('dev-intel-panel'),
	body: $('dev-intel-body'),
	refresh: $('dev-intel-refresh'),
	download: $('dev-intel-download'),
	copyPrompt: $('dev-intel-copy-prompt')
};

function renderDevIntel() {
	if (!devIntelElements.panel) return;

	const data = devIntelState.data;
	if (!data || (!data.results?.length && !data.appReport)) {
		devIntelElements.panel.hidden = true;
		return;
	}

	devIntelElements.panel.hidden = false;
	const html = [];

	// App-level improvement report
	if (data.appReport) {
		const report = data.appReport;

		// Priority actions
		if (report.priority?.length) {
			html.push('<div class="dev-intel-priority">');
			html.push('<h4>🎯 Priority Actions</h4>');
			report.priority.forEach((item, i) => {
				html.push(`<div class="dev-intel-priority-item">`);
				html.push(`<span class="dev-intel-priority-num">${i + 1}</span>`);
				html.push(`<div>`);
				html.push(`<div class="dev-intel-priority-action">${escapeHtml(item.action || '')}</div>`);
				html.push(`<div class="dev-intel-priority-meta">${escapeHtml(item.rationale || '')} · Impact: ${escapeHtml(item.impact || '—')}</div>`);
				html.push(`</div></div>`);
			});
			html.push('</div>');
		}

		// Improvement categories
		const cats = [
			['ux', 'UX Issues'],
			['accessibility', 'Accessibility'],
			['performance', 'Performance'],
			['security', 'Security']
		];
		for (const [key, label] of cats) {
			const items = report[key];
			if (items?.length) {
				html.push(`<div class="dev-intel-category">`);
				html.push(`<h4>${label}</h4>`);
				items.forEach(item => {
					html.push(`<div class="dev-intel-category-item">`);
					html.push(`<div class="dev-intel-category-issue">${escapeHtml(item.issue || '')}</div>`);
					html.push(`<div class="dev-intel-category-rec">${escapeHtml(item.recommendation || '')}</div>`);
					html.push(`</div>`);
				});
				html.push('</div>');
			}
		}

		// Recurring patterns
		if (report.patterns?.length) {
			html.push('<div class="dev-intel-category">');
			html.push('<h4>🔁 Recurring Patterns</h4>');
			report.patterns.forEach(p => {
				html.push(`<div class="dev-intel-category-item">`);
				html.push(`<div class="dev-intel-category-issue">${escapeHtml(p.pattern || '')} (${p.occurrences || 0}×)</div>`);
				html.push(`<div class="dev-intel-category-rec">${escapeHtml(p.recommendation || '')}</div>`);
				html.push(`</div>`);
			});
			html.push('</div>');
		}
	}

	// Per-finding fix suggestions
	if (data.results?.length) {
		html.push('<div class="dev-intel-category">');
		html.push('<h4>🔧 Fix Suggestions</h4>');
		for (const r of data.results) {
			if (r.status === 'failed') continue;
			const f = r.finding;
			const intel = r.intelligence;
			if (!intel) continue;
			html.push(`<div class="dev-intel-finding severity-${escapeHtml(f.severity || 'low')}">`);
			html.push(`<div class="dev-intel-finding-title">${escapeHtml(f.title || 'Untitled')}</div>`);
			html.push(`<div class="dev-intel-finding-cause"><strong>Root cause:</strong> ${escapeHtml(intel.rootCause || '—')}</div>`);
			html.push(`<div class="dev-intel-finding-fix"><strong>Fix:</strong> ${escapeHtml(intel.fixApproach || '—')}</div>`);
			html.push(`<div class="dev-intel-finding-meta">`);
			html.push(`<span>${escapeHtml(intel.affectedArea || '—')}</span>`);
			html.push(`<span>${escapeHtml(intel.estimatedComplexity || '—')}</span>`);
			html.push(`<span>${Math.round((intel.confidence || 0) * 100)}% confidence</span>`);
			html.push(`<span class="dev-intel-finding-copy" data-finding-id="${escapeHtml(f.id)}">📋 Copy fix prompt</span>`);
			html.push(`</div></div>`);
		}
		html.push('</div>');
	}

	if (html.length === 0) {
		html.push('<div class="dev-intel-empty">No dev intelligence available yet.</div>');
	}

	devIntelElements.body.innerHTML = html.join('');
}

async function loadDevIntelFromSession(sessionId) {
	devIntelState.sessionId = sessionId;
	try {
		const data = await api(`/sessions/${sessionId}/dev-intelligence`);
		devIntelState.data = data;
		renderDevIntel();
	} catch {
		devIntelState.data = null;
		if (devIntelElements.panel) devIntelElements.panel.hidden = true;
	}
}

devIntelElements.refresh?.addEventListener('click', async () => {
	if (!state.sessionId) return;
	devIntelElements.body.innerHTML = '<div class="dev-intel-empty">Analyzing findings…</div>';
	try {
		const data = await api(`/sessions/${state.sessionId}/analyze-dev`, { method: 'POST' });
		devIntelState.data = data;
		renderDevIntel();
		toast('Dev intelligence updated');
	} catch (error) {
		fail(error);
	}
});

devIntelElements.download?.addEventListener('click', async () => {
	if (!state.sessionId) return;
	try {
		const res = await fetch(`/api/sessions/${state.sessionId}/dev-report`);
		if (!res.ok) throw new Error('Report not available. Run analysis first.');
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `dev-intelligence-${state.sessionId.slice(0, 8)}.md`;
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
	} catch (error) {
		toast('Failed to copy prompt', 'bad');
	}
});

// Copy per-finding fix prompt
document.addEventListener('click', async (e) => {
	const target = e.target.closest('[data-finding-id]');
	if (!target || !target.classList.contains('dev-intel-finding-copy')) return;
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
