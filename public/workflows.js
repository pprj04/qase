/**
 * Qase — Workflows module (Phase 16B).
 *
 * Project-scoped workflow management page:
 *   - Lists all saved workflows for the active project
 *   - Search by name / target URL / tags
 *   - Expand a workflow to see its step timeline
 *   - Generate test cases from a workflow
 *   - Delete workflows
 *
 * The session-scoped "captured steps" live capture still runs in app.js
 * and auto-saves via the autonomy pipeline. This page is for browsing
 * and managing already-saved workflows across all sessions.
 */

import { el, state, api, toast, fail, STEP_ICONS, hostOf, relativeTime, showPageLoading, showPageError, clearPageState } from './shared.js';
import { parseMetricCollection } from './metricResponses.js';

/* ── State ───────────────────────────────────────────────────────── */

const workflowState = state.workflowState;

/* ── Loading ─────────────────────────────────────────────────────── */

async function loadWorkflowsPage() {
	const container = el.workflowsList;
	const firstLoad = !workflowState.loaded;
	if (firstLoad) showPageLoading(container);
	const projectId = state.projectId;
	const projectVersion = state.projectVersion;
	const query = '?includeMetrics=1' + (projectId ? '&projectId=' + encodeURIComponent(projectId) : '');
	try {
		const data = parseMetricCollection(await api('/workflows' + query), 'workflow');
		if (projectVersion !== state.projectVersion || projectId !== state.projectId) return;
		workflowState.workflows = data.items;
		workflowState.metrics = data.metrics;
	} catch (error) {
		if (projectVersion !== state.projectVersion) return;
		workflowState.workflows = [];
		workflowState.metrics = null;
		workflowState.loaded = true;
		showPageError(container, loadWorkflowsPage, 'Could not load workflows — ' + (error?.message ?? 'server unreachable') + '.');
		return;
	}
	workflowState.loaded = true;
	clearPageState(container);
	renderWorkflowsPage();
}

/* ── Rendering ───────────────────────────────────────────────────── */

function renderWorkflowsPage() {
	renderWorkflowsStats();
	renderWorkflowsList();
}

function filteredWorkflows() {
	const q = workflowState.search.toLowerCase().trim();
	return q
		? workflowState.workflows.filter(wf => {
				const name = (wf.name || '').toLowerCase();
				const url = (wf.targetUrl || '').toLowerCase();
				const tags = (wf.tags || []).join(' ').toLowerCase();
				return name.includes(q) || url.includes(q) || tags.includes(q);
			})
		: workflowState.workflows;
}

function renderWorkflowsStats() {
	const scoped = filteredWorkflows();
	const total = scoped.length;
	const totalSteps = scoped.reduce((sum, wf) => sum + (wf.stepCount || 0), 0);
	const hosts = new Set(scoped.map(wf => wf.targetUrl ? hostOf(wf.targetUrl) : '').filter(Boolean));
	const suffix = workflowState.search.trim() ? ' (filtered)' : '';
	el.workflowsStats.replaceChildren();
	const chips = [
		{ label: 'Workflows' + suffix, value: total },
		{ label: 'Steps', value: totalSteps },
		{ label: 'Targets', value: hosts.size }
	];
	for (const chip of chips) {
		const span = document.createElement('span');
		span.className = 'stat-chip';
		span.innerHTML = `<strong>${chip.value}</strong> ${chip.label}`;
		el.workflowsStats.append(span);
	}
}

function renderWorkflowsList() {
	const container = el.workflowsList;
	container.replaceChildren();

	const filtered = filteredWorkflows();

	if (filtered.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'wf-page-empty';
		if (workflowState.workflows.length === 0) {
			empty.innerHTML = '<p>No workflows saved yet.</p><small>Run the agent on a target site and it will auto-capture browser actions. Saved workflows appear here for reuse.</small>';
		} else {
			empty.innerHTML = '<p>No workflows match your search.</p>';
		}
		container.append(empty);
		return;
	}

	const scope = document.createElement('div');
	scope.className = 'schedules-section-title';
	scope.textContent = workflowState.search.trim()
		? 'Showing ' + filtered.length + ' of ' + (workflowState.metrics?.total ?? workflowState.workflows.length) + ' workflows'
		: 'Workflows (' + (workflowState.metrics?.total ?? filtered.length) + ')';
	container.append(scope);

	for (const wf of filtered) {
		container.append(renderWorkflowCard(wf));
	}
}

function renderWorkflowCard(wf) {
	const card = document.createElement('div');
	card.className = 'wf-card';

	// ── Header row ──
	const header = document.createElement('div');
	header.className = 'wf-card-header';

	const left = document.createElement('div');
	left.className = 'wf-card-left';

	const name = document.createElement('span');
	name.className = 'wf-card-name';
	name.textContent = wf.name;
	name.title = wf.name;

	const meta = document.createElement('span');
	meta.className = 'wf-card-meta';
	const parts = [];
	if (wf.stepCount) parts.push(`${wf.stepCount} steps`);
	if (wf.targetUrl) parts.push(hostOf(wf.targetUrl));
	parts.push(relativeTime(wf.updatedAt ?? wf.createdAt));
	meta.textContent = parts.join(' · ');
	if (wf.targetUrl) meta.title = wf.targetUrl;

	left.append(name, meta);

	// Tags
	if (wf.tags && wf.tags.length > 0) {
		const tagWrap = document.createElement('div');
		tagWrap.className = 'wf-card-tags';
		for (const tag of wf.tags) {
			const span = document.createElement('span');
			span.className = 'wf-tag';
			span.textContent = tag;
			tagWrap.append(span);
		}
		left.append(tagWrap);
	}

	// Action buttons
	const actions = document.createElement('div');
	actions.className = 'wf-card-actions';

	const expandBtn = document.createElement('button');
	expandBtn.className = 'btn btn-ghost btn-sm wf-expand-btn';
	expandBtn.textContent = workflowState.expanded.has(wf.id) ? '▾ Collapse' : '▸ Steps';

	const genBtn = document.createElement('button');
	genBtn.className = 'btn btn-ghost btn-sm';
	genBtn.textContent = '⚡ Gen Tests';
	genBtn.title = 'Generate test cases from this workflow';
	genBtn.onclick = async () => {
		try {
			genBtn.disabled = true;
			genBtn.textContent = 'Generating…';
			const created = await api(`/workflows/${wf.id}/generate-tests`, { method: 'POST' });
			if (Array.isArray(created)) {
				toast(`Generated ${created.length} test case${created.length === 1 ? '' : 's'} from "${wf.name}".`, 'good');
			}
		} catch (error) {
			fail(error);
		} finally {
			genBtn.disabled = false;
			genBtn.textContent = '⚡ Gen Tests';
		}
	};

	const delBtn = document.createElement('button');
	delBtn.className = 'btn btn-ghost btn-sm wf-card-del';
	delBtn.textContent = '🗑';
	delBtn.title = 'Delete workflow';
	delBtn.setAttribute('aria-label', `Delete workflow ${wf.name}`);
	delBtn.onclick = async () => {
		try {
			await api(`/workflows/${wf.id}`, { method: 'DELETE' });
			workflowState.workflows = workflowState.workflows.filter(w => w.id !== wf.id);
			workflowState.expanded.delete(wf.id);
			renderWorkflowsPage();
			toast(`Deleted "${wf.name}".`, 'good');
		} catch (error) {
			fail(error);
		}
	};

	actions.append(expandBtn, genBtn, delBtn);
	header.append(left, actions);
	card.append(header);

	// ── Expandable steps section ──
	if (workflowState.expanded.has(wf.id)) {
		card.append(renderWorkflowSteps(wf));
	}

	// Toggle expand
	expandBtn.onclick = async () => {
		if (workflowState.expanded.has(wf.id)) {
			workflowState.expanded.delete(wf.id);
			renderWorkflowsList();
		} else {
			// Need to fetch full workflow to get steps
			if (!wf._stepsLoaded) {
				try {
					expandBtn.textContent = 'Loading…';
					const full = await api(`/workflows/${wf.id}`);
					wf._steps = full.steps;
					wf._stepsLoaded = true;
				} catch (error) {
					fail(error);
					expandBtn.textContent = '▸ Steps';
					return;
				}
			}
			workflowState.expanded.add(wf.id);
			renderWorkflowsList();
		}
	};

	return card;
}

function renderWorkflowSteps(wf) {
	const section = document.createElement('div');
	section.className = 'wf-card-steps';

	if (!wf._steps || wf._steps.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'wf-steps-empty';
		empty.textContent = 'No steps recorded.';
		section.append(empty);
		return section;
	}

	const MAX_VISIBLE = 30;
	const total = wf._steps.length;
	const visibleSteps = wf._steps.slice(0, MAX_VISIBLE);

	const timeline = document.createElement('div');
	timeline.className = 'wf-timeline';

	for (const step of visibleSteps) {
		timeline.append(renderStepNode(step));
	}
	section.append(timeline);

	// "Show all" button if there are more steps
	if (total > MAX_VISIBLE) {
		const showMore = document.createElement('button');
		showMore.className = 'btn btn-ghost btn-sm wf-show-more';
		showMore.textContent = `Show all ${total} steps`;
		showMore.onclick = () => {
			// Clear and render ALL steps in chunks
			timeline.replaceChildren();
			for (const step of wf._steps) {
				timeline.append(renderStepNode(step));
			}
			showMore.remove();
		};
		section.append(showMore);
	}

	return section;
}

function renderStepNode(step) {
	const node = document.createElement('div');
	node.className = 'wf-step';

	const icon = document.createElement('span');
	icon.className = 'wf-step-icon';
	icon.textContent = STEP_ICONS[step.action] ?? '•';

	const body = document.createElement('div');
	body.className = 'wf-step-body';

	const action = document.createElement('span');
	action.className = 'wf-step-action';
	action.textContent = step.displayLabel ?? step.action;

	const detail = document.createElement('span');
	detail.className = 'wf-step-detail';
	if (step.target && step.value) {
		detail.textContent = `${step.target} = ${step.value}`;
	} else if (step.target) {
		detail.textContent = step.target;
	}

	body.append(action, detail);
	node.append(icon, body);
	return node;
}

/* ── Wiring ──────────────────────────────────────────────────────── */

function initWorkflowsWiring() {
	if (el.workflowsSearch) {
		el.workflowsSearch.addEventListener('input', () => {
			workflowState.search = el.workflowsSearch.value;
			renderWorkflowsPage();
		});
	}
}

export { loadWorkflowsPage, renderWorkflowsPage, initWorkflowsWiring };
