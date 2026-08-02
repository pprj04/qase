/**
 * Bugs Hub module — bug finding management, board, detail drawer, editor.
 */
import { el, state, api, toast, fail, escapeHtml, markdown, relativeTime } from './shared.js';

const bugState = {
	findings: [],
	detailId: null,
	view: 'grid'  // 'grid' or 'list'
};

const SEV_LABELS = {
	critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium',
	low: '🔵 Low', info: '⚪ Info'
};

const STATUS_LABELS = {
	open: 'Open', in_testing: 'In Testing', resolved: 'Resolved', closed: 'Closed'
};

function timeAgo(ts) {
	const diff = Date.now() - ts;
	const days = Math.floor(diff / 86400000);
	if (days > 0) return `${days}d ago`;
	const hrs = Math.floor(diff / 3600000);
	if (hrs > 0) return `${hrs}h ago`;
	const mins = Math.floor(diff / 60000);
	if (mins > 0) return `${mins}m ago`;
	return 'just now';
}

async function loadBugs() {
	const projectId = state.projectId ?? '';
	const params = new URLSearchParams();
	if (projectId) params.set('projectId', projectId);
	const query = params.toString() ? `?${params.toString()}` : '';
	bugState.findings = await api(`/findings${query}`);

	// Populate category dropdown from data.
	const cats = [...new Set(bugState.findings.map(f => f.category).filter(Boolean))].sort();
	el.bugFilterCategory.innerHTML = '<option value="">All categories</option>' +
		cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

	// Update badge count.
	const openCount = bugState.findings.filter(f => f.status === 'open').length;
	el.navCountBugs.textContent = openCount > 0 ? openCount : '';

	renderBugsBoard();
	renderBugsStats();
}

function getFilteredBugs() {
	let filtered = bugState.findings;
	const sev = el.bugFilterSeverity.value;
	const status = el.bugFilterStatus.value;
	const cat = el.bugFilterCategory.value;
	const q = el.bugSearch.value.trim().toLowerCase();
	if (sev) filtered = filtered.filter(f => f.severity === sev);
	if (status) filtered = filtered.filter(f => f.status === status);
	if (cat) filtered = filtered.filter(f => f.category === cat);
	if (q) {
		filtered = filtered.filter(f => {
			const haystack = `${f.title} ${f.category} ${f.url} ${f.expected} ${f.actual}`.toLowerCase();
			return haystack.includes(q);
		});
	}
	return filtered;
}

function renderBugsStats() {
	const filtered = getFilteredBugs();
	const open = filtered.filter(f => f.status === 'open').length;
	const testing = filtered.filter(f => f.status === 'in_testing').length;
	const resolved = filtered.filter(f => f.status === 'resolved').length;
	const closed = filtered.filter(f => f.status === 'closed').length;
	el.bugsStats.innerHTML = '';
	for (const [label, count, cls] of [
		['Open', open, 'bug-status-open'],
		['In Testing', testing, 'bug-status-in_testing'],
		['Resolved', resolved, 'bug-status-resolved'],
		['Closed', closed, 'bug-status-closed']
	]) {
		const stat = document.createElement('div');
		stat.className = 'bug-stat';
		stat.innerHTML = `<div class="stat-val ${cls}">${count}</div><div class="stat-lbl">${label}</div>`;
		el.bugsStats.append(stat);
	}
}

function renderBugsBoard() {
	const bugs = getFilteredBugs();
	el.bugsBoard.innerHTML = '';
	el.bugsBoard.className = `bugs-hub-board bugs-view-${bugState.view}`;

	if (bugs.length === 0) {
		el.bugsBoard.innerHTML = '<div class="bug-empty">No bugs match the current filters.</div>';
		return;
	}

	for (const bug of bugs) {
		const card = document.createElement('div');
		card.className = `bug-card bug-card-${bugState.view}`;
		card.innerHTML = `
			<div class="bug-card-head">
				<div class="bug-card-title">${escapeHtml(bug.title)}</div>
				<div class="bug-badges">
					<span class="bug-sev-badge bug-sev-${bug.severity}">${bug.severity}</span>
					<span class="bug-status-badge bug-status-${bug.status}">${STATUS_LABELS[bug.status] ?? bug.status}</span>
				</div>
			</div>
			<div class="bug-card-meta">
				<span class="cat">📁 ${escapeHtml(bug.category || 'general')}</span>
				${bug.url ? `<span>🔗 ${escapeHtml(truncateUrl(bug.url))}</span>` : ''}
				${bug.assignee ? `<span>👤 ${escapeHtml(bug.assignee)}</span>` : ''}
				<span>⏱ ${timeAgo(bug.ts)}</span>
				${(bug.comments?.length ?? 0) > 0 ? `<span>💬 ${bug.comments.length}</span>` : ''}
				${(bug.testCaseIds?.length ?? 0) > 0 ? `<span>🧪 ${bug.testCaseIds.length} tests</span>` : ''}
			</div>
		`;
		card.addEventListener('click', () => openBugDetail(bug.id));
		el.bugsBoard.append(card);
	}
}

/** Shorten a URL for display in bug cards. */
function truncateUrl(url) {
	try {
		const u = new URL(url);
		return u.host + (u.pathname.length > 1 ? u.pathname.slice(0, 20) : '');
	} catch {
		return (url || '').slice(0, 40);
	}
}

async function openBugDetail(id) {
	bugState.detailId = id;
	try {
		const bug = await api(`/findings/${id}`);
		renderBugDetail(bug);
		el.bugDetail.showModal();
	} catch (error) {
		fail(error);
	}
}

async function loadBugDevIntel(bug, container, force = false) {
	const btn = container.querySelector('button');
	if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
	try {
		if (force) {
			await fetch(`/api/findings/${bug.id}/dev-analysis?force=1`);
		}
		const intel = await api(`/findings/${bug.id}/dev-analysis`);
		if (intel) {
			const updated = await api(`/findings/${bug.id}`);
			renderBugDetail(updated);
		}
	} catch (err) {
		if (btn) { btn.disabled = false; btn.textContent = '🧠 Analyze this finding'; }
		toast('Analysis failed — try again later', 'bad');
	}
}

function renderBugDetail(bug) {
	el.bugDetailTitle.textContent = bug.title;

	const body = el.bugDetailBody;
	body.innerHTML = '';

	// Badges.
	const meta = document.createElement('div');
	meta.className = 'bug-detail-meta';
	meta.innerHTML = `
		<span class="bug-sev-badge bug-sev-${bug.severity}">${SEV_LABELS[bug.severity] ?? bug.severity}</span>
		<span class="bug-status-badge bug-status-${bug.status}">${STATUS_LABELS[bug.status] ?? bug.status}</span>
		${bug.category ? `<span class="bug-status-badge">📁 ${escapeHtml(bug.category)}</span>` : ''}
		${bug.assignee ? `<span class="bug-status-badge">👤 ${escapeHtml(bug.assignee)}</span>` : ''}
	`;
	body.append(meta);

	// URL.
	if (bug.url) {
		const urlDiv = document.createElement('div');
		urlDiv.className = 'bug-detail-section';
		urlDiv.innerHTML = `<h4>URL</h4><div><a href="${escapeHtml(bug.url)}" target="_blank" rel="noopener">${escapeHtml(bug.url)}</a></div>`;
		body.append(urlDiv);
	}

	// Steps.
	if (bug.steps?.length) {
		const steps = document.createElement('div');
		steps.className = 'bug-detail-section';
		steps.innerHTML = '<h4>Steps to Reproduce</h4>';
		const ol = document.createElement('ol');
		ol.className = 'bug-detail-steps';
		ol.innerHTML = bug.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('');
		steps.append(ol);
		body.append(steps);
	}

	// Expected / Actual.
	const ea = document.createElement('div');
	ea.className = 'bug-detail-section';
	ea.innerHTML = `
		<h4>Expected vs Actual</h4>
		<div class="bug-detail-ea"><strong>Expected:</strong> ${escapeHtml(bug.expected || '—')}</div>
		<div class="bug-detail-ea"><strong>Actual:</strong> ${escapeHtml(bug.actual || '—')}</div>
	`;
	body.append(ea);

	// Evidence.
	if (bug.evidence) {
		const ev = document.createElement('div');
		ev.className = 'bug-detail-section';
		ev.innerHTML = `<h4>Evidence</h4><pre style="white-space:pre-wrap;font-size:12px;background:var(--surface);padding:8px;border-radius:6px;border:1px solid var(--border)">${escapeHtml(bug.evidence)}</pre>`;
		body.append(ev);
	}

	// Linked test cases.
	const tcSection = document.createElement('div');
	tcSection.className = 'bug-detail-section';
	tcSection.innerHTML = '<h4>Linked Test Cases</h4>';
	const linked = bug.linkedTests ?? [];
	if (linked.length > 0) {
		for (const tc of linked) {
			const row = document.createElement('div');
			row.className = 'bug-link-row';
			row.innerHTML = `<span>🧪 ${escapeHtml(tc.name)}</span><span class="bug-sev-badge bug-sev-${tc.severity || 'low'}">${tc.severity || 'low'}</span>`;
			const unlinkBtn = document.createElement('button');
			unlinkBtn.className = 'btn btn-ghost btn-sm';
			unlinkBtn.textContent = '✕ Unlink';
			unlinkBtn.addEventListener('click', async () => {
				await api(`/findings/${bug.id}/link/${tc.id}`, { method: 'DELETE' });
				const updated = await api(`/findings/${bug.id}`);
				renderBugDetail(updated);
			});
			row.append(unlinkBtn);
			tcSection.append(row);
		}
	} else {
		tcSection.innerHTML += '<div class="bug-empty" style="padding:8px">No test cases linked.</div>';
	}
	body.append(tcSection);

	// Comments.
	const commentsSection = document.createElement('div');
	commentsSection.className = 'bug-detail-section';
	commentsSection.innerHTML = '<h4>Comments</h4>';
	const commentsDiv = document.createElement('div');
	commentsDiv.className = 'bug-detail-comments';
	if (bug.comments?.length) {
		for (const c of bug.comments) {
			const cdiv = document.createElement('div');
			cdiv.className = 'bug-comment';
			cdiv.innerHTML = `<div class="bug-comment-head">${escapeHtml(c.author)} · ${timeAgo(c.ts)}</div><div>${escapeHtml(c.text)}</div>`;
			commentsDiv.append(cdiv);
		}
	} else {
		commentsDiv.innerHTML = '<div class="bug-empty" style="padding:8px">No comments yet.</div>';
	}
	commentsSection.append(commentsDiv);

	// Comment input.
	const commentRow = document.createElement('div');
	commentRow.className = 'bug-comment-input-row';
	const commentInput = document.createElement('input');
	commentInput.type = 'text';
	commentInput.placeholder = 'Add a comment…';
	const commentBtn = document.createElement('button');
	commentBtn.className = 'btn btn-primary btn-sm';
	commentBtn.textContent = 'Post';
	commentBtn.addEventListener('click', async () => {
		if (!commentInput.value.trim()) return;
		await api(`/findings/${bug.id}/comments`, {
			method: 'POST',
			body: JSON.stringify({ author: 'user', text: commentInput.value.trim() })
		});
		commentInput.value = '';
		const updated = await api(`/findings/${bug.id}`);
		renderBugDetail(updated);
	});
	commentRow.append(commentInput, commentBtn);
	commentsSection.append(commentRow);
	body.append(commentsSection);

	// Dev Intelligence section (Phase 13) — lazy, user-initiated.
	const devSection = document.createElement('div');
	devSection.className = 'bug-detail-section';
	devSection.innerHTML = '<h4>🧠 Dev Intelligence</h4>';

	if (bug.devIntelligence) {
		// Already analyzed — show cached results.
		const intel = bug.devIntelligence;
		const devContent = document.createElement('div');
		devContent.className = 'bug-dev-intel-content';
		devContent.innerHTML = `
			<div class="bug-dev-intel-cause"><strong>Root cause:</strong> ${escapeHtml(intel.rootCause || '—')}</div>
			<div class="bug-dev-intel-fix"><strong>Fix:</strong> ${escapeHtml(intel.fixApproach || '—')}</div>
			<div class="bug-dev-intel-meta">${escapeHtml(intel.affectedArea || '—')} · ${escapeHtml(intel.estimatedComplexity || '—')} · ${Math.round((intel.confidence || 0) * 100)}% confidence</div>
		`;
		const copyBtn = document.createElement('button');
		copyBtn.className = 'btn btn-ghost btn-sm';
		copyBtn.textContent = '📋 Copy fix prompt';
		copyBtn.addEventListener('click', async () => {
			try {
				const res = await fetch(`/api/findings/${bug.id}/fix-prompt`);
				const text = await res.text();
				await navigator.clipboard.writeText(text);
				toast('Fix prompt copied');
			} catch {
				toast('Failed to copy', 'bad');
			}
		});
		const reBtn = document.createElement('button');
		reBtn.className = 'btn btn-ghost btn-sm';
		reBtn.textContent = '↻ Re-analyze';
		reBtn.addEventListener('click', () => loadBugDevIntel(bug, devSection, true));
		devContent.append(copyBtn, reBtn);
		devSection.append(devContent);
	} else {
		// No intelligence yet — show a "Analyze" button.
		const analyzeBtn = document.createElement('button');
		analyzeBtn.className = 'btn btn-ghost btn-sm';
		analyzeBtn.textContent = '🧠 Analyze this finding';
		analyzeBtn.addEventListener('click', () => loadBugDevIntel(bug, devSection));
		devSection.append(analyzeBtn);
	}
	body.append(devSection);

	// History.
	if (bug.history?.length) {
		const histSection = document.createElement('div');
		histSection.className = 'bug-detail-section';
		histSection.innerHTML = '<h4>History</h4>';
		const timeline = document.createElement('ul');
		timeline.className = 'bug-history-timeline';
		for (const h of bug.history) {
			const li = document.createElement('li');
			li.className = 'bug-history-entry';
			let action;
			if (h.to === 'linked_test') {
				action = `linked test case ${h.detail?.slice(0, 8) ?? ''}`;
			} else if (h.to === 'unlinked_test') {
				action = `unlinked test case ${h.detail?.slice(0, 8) ?? ''}`;
			} else {
				action = `${h.from ?? 'created'} → ${h.to}`;
			}
			li.textContent = `${new Date(h.ts).toLocaleString()} — ${escapeHtml(h.by)}: ${action}`;
			timeline.append(li);
		}
		histSection.append(timeline);
		body.append(histSection);
	}

	// Footer: status control, assignee, edit, delete.
	const foot = el.bugDetailFoot;
	foot.innerHTML = '';

	// Status dropdown.
	const statusDiv = document.createElement('div');
	statusDiv.className = 'bug-status-control';
	statusDiv.innerHTML = '<span style="font-size:12px;opacity:0.6">Status:</span>';
	const statusSelect = document.createElement('select');
	for (const s of ['open', 'in_testing', 'resolved', 'closed']) {
		const opt = document.createElement('option');
		opt.value = s;
		opt.textContent = STATUS_LABELS[s];
		if (bug.status === s) opt.selected = true;
		statusSelect.append(opt);
	}
	statusSelect.addEventListener('change', async () => {
		await api(`/findings/${bug.id}/status`, {
			method: 'PATCH',
			body: JSON.stringify({ status: statusSelect.value, by: 'user' })
		});
		const updated = await api(`/findings/${bug.id}`);
		renderBugDetail(updated);
		await loadBugs();
	});
	statusDiv.append(statusSelect);

	// Assignee input.
	const assigneeDiv = document.createElement('div');
	assigneeDiv.className = 'bug-status-control';
	assigneeDiv.innerHTML = '<span style="font-size:12px;opacity:0.6">Assignee:</span>';
	const assigneeInput = document.createElement('input');
	assigneeInput.type = 'text';
	assigneeInput.className = 'bug-assignee-input';
	assigneeInput.value = bug.assignee ?? '';
	assigneeInput.placeholder = 'Unassigned';
	const saveAssignee = async () => {
		await api(`/findings/${bug.id}`, {
			method: 'PUT',
			body: JSON.stringify({ assignee: assigneeInput.value.trim() })
		});
		const updated = await api(`/findings/${bug.id}`);
		renderBugDetail(updated);
		await loadBugs();
	};
	assigneeInput.addEventListener('change', saveAssignee);
	assigneeDiv.append(assigneeInput);

	const spacer = document.createElement('div');
	spacer.style.flex = '1';

	// Delete button.
	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'btn btn-ghost btn-sm';
	deleteBtn.style.color = 'var(--danger, #ff453a)';
	deleteBtn.textContent = '🗑 Delete';
	deleteBtn.addEventListener('click', async () => {
		if (!confirm('Delete this bug? This cannot be undone.')) return;
		await api(`/findings/${bug.id}`, { method: 'DELETE' });
		el.bugDetail.close();
		await loadBugs();
		toast('Bug deleted');
	});

	foot.style.display = 'flex';
	foot.style.gap = '8px';
	foot.style.alignItems = 'center';
	foot.style.flexWrap = 'wrap';
	foot.append(statusDiv, assigneeDiv, spacer, deleteBtn);}

/* ── Bug editor (new bug) ─────────────────────────────────────────── */

function openBugEditor() {
	el.bugEditTitle.value = '';
	el.bugEditSeverity.value = 'medium';
	el.bugEditCategory.value = '';
	el.bugEditUrl.value = '';
	el.bugEditSteps.value = '';
	el.bugEditExpected.value = '';
	el.bugEditActual.value = '';
	el.bugEditEvidence.value = '';
	el.bugEditor.showModal();
}

async function saveNewBug() {
	const data = {
		title: el.bugEditTitle.value.trim(),
		severity: el.bugEditSeverity.value,
		category: el.bugEditCategory.value.trim() || 'general',
		url: el.bugEditUrl.value.trim(),
		steps: el.bugEditSteps.value.split('\n').map(s => s.trim()).filter(Boolean),
		expected: el.bugEditExpected.value.trim(),
		actual: el.bugEditActual.value.trim(),
		evidence: el.bugEditEvidence.value.trim() || undefined,
		projectId: state.projectId
	};
	if (!data.title) {
		toast('Title is required', 'bad');
		return;
	}
	try {
		await api('/findings', { method: 'POST', body: JSON.stringify(data) });
		el.bugEditor.close();
		await loadBugs();
		toast('Bug created');
	} catch (error) {
		fail(error);
	}
}


/* ── Bugs Hub event wiring ────────────────────────────────────────── */

function initBugsWiring() {
	if (el.btnNewBug) el.btnNewBug.addEventListener('click', openBugEditor);
	if (el.bugEditorClose) el.bugEditorClose.addEventListener('click', () => el.bugEditor.close());
	if (el.bugEditorSave) el.bugEditorSave.addEventListener('click', saveNewBug);
	if (el.bugDetailClose) el.bugDetailClose.addEventListener('click', () => el.bugDetail.close());

	if (el.bugSearch) el.bugSearch.addEventListener('input', () => { renderBugsBoard(); renderBugsStats(); });
	if (el.bugFilterSeverity) el.bugFilterSeverity.addEventListener('change', () => { renderBugsBoard(); renderBugsStats(); });
	if (el.bugFilterStatus) el.bugFilterStatus.addEventListener('change', () => { renderBugsBoard(); renderBugsStats(); });
	if (el.bugFilterCategory) el.bugFilterCategory.addEventListener('change', () => { renderBugsBoard(); renderBugsStats(); });

	// View toggle (grid / list).
	if (el.bugViewGrid) {
		el.bugViewGrid.addEventListener('click', () => {
			bugState.view = 'grid';
			el.bugViewGrid.classList.add('is-active');
			if (el.bugViewList) el.bugViewList.classList.remove('is-active');
			renderBugsBoard();
		});
	}
	if (el.bugViewList) {
		el.bugViewList.addEventListener('click', () => {
			bugState.view = 'list';
			el.bugViewList.classList.add('is-active');
			if (el.bugViewGrid) el.bugViewGrid.classList.remove('is-active');
			renderBugsBoard();
		});
	}

	// Cross-session export buttons.
	document.querySelectorAll('[data-bug-export]').forEach(btn => {
		btn.addEventListener('click', async () => {
			const format = btn.dataset.bugExport;
			const params = new URLSearchParams();
			const projectId = state.projectId;
			if (projectId) params.set('projectId', projectId);
			try {
				const res = await fetch(`/api/findings/export?format=${format}&${params}`);
				if (!res.ok) throw new Error('Export failed');
				const blob = await res.blob();
				const disposition = res.headers.get('Content-Disposition') || '';
				const match = disposition.match(/filename="?([^"]+)"?/);
				const filename = match?.[1] || `bugs-${format}.${format === 'markdown' ? 'md' : 'json'}`;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = filename;
				a.click();
				URL.revokeObjectURL(url);
				toast(`Bugs exported as ${format}`);
			} catch (error) {
				fail(error);
			}
		});
	});
}

export { loadBugs, openBugDetail, initBugsWiring };
