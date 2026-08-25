import { el, state, api, apiRaw, toast, fail, escapeHtml, markdown, relativeTime, showPageLoading, showPageError, clearPageState } from './shared.js';

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
	const container = el.bugsBoard;
	const firstLoad = !bugState.loaded;
	if (firstLoad) showPageLoading(container);
	const projectId = state.projectId ?? '';
	const params = new URLSearchParams();
	if (projectId) params.set('projectId', projectId);
	const query = params.toString() ? `?${params.toString()}` : '';
	try {
		bugState.findings = await api(`/findings${query}`);
	} catch (error) {
		bugState.findings = [];
		bugState.loaded = true;
		// BUILD 1: server failure ≠ "No bugs". Show the error with Retry.
		if (firstLoad) {
			el.navCountBugs.textContent = '';
			showPageError(container, loadBugs, `Could not load findings — ${error?.message ?? 'server unreachable'}.`);
			return;
		}
		throw error;
	}
	bugState.loaded = true;
	clearPageState(container);

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
	const fix = document.getElementById('bug-filter-fix-status')?.value || '';
	const q = el.bugSearch.value.trim().toLowerCase();
	if (sev) filtered = filtered.filter(f => f.severity === sev);
	if (status) filtered = filtered.filter(f => f.status === status);
	if (cat) filtered = filtered.filter(f => f.category === cat);
	if (fix) filtered = filtered.filter(f => f.fixStatus === fix);
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
			// B1 W3 — authed force-refresh (GET ?force=1) via the shared helper.
			await api(`/findings/${bug.id}/dev-analysis?force=1`).catch(() => null);
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
		// Workflow-generated findings carry evidence as an ARRAY of
		// evidence-node refs — normalize so escapeHtml never receives a
		// non-string (this threw and killed the whole detail render).
		const evidenceText = Array.isArray(bug.evidence)
			? bug.evidence.map(String).join('\n')
			: String(bug.evidence);
		const ev = document.createElement('div');
		ev.className = 'bug-detail-section';
		ev.innerHTML = `<h4>Evidence</h4><pre style="white-space:pre-wrap;font-size:12px;background:var(--surface);padding:8px;border-radius:6px;border:1px solid var(--border)">${escapeHtml(evidenceText)}</pre>`;
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

	// Fix Validation section (Phase 18) — lifecycle, confidence, attempts,
	// before/after comparison, history, approve/reopen.
	renderFixValidationSection(body, bug);

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
				// B1 W3 — authed read via the raw helper (text body).
				const text = await apiRaw(`/findings/${bug.id}/fix-prompt`).then(r => r.text());
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
	const fixFilter = document.getElementById('bug-filter-fix-status');
	if (fixFilter) fixFilter.addEventListener('change', () => { renderBugsBoard(); renderBugsStats(); });
	initFixValidationWiring();

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
				// B1 W3 — authed export via the raw helper (blob body).
				const res = await apiRaw(`/findings/export?format=${format}&${params}`);
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

/* ── Phase 18: Fix Validation UI ─────────────────────────────────── */

const FIX_STATUS_LABELS = {
	VERIFIED_FIXED: { cls: 'fx-ok', text: '✅ Verified Fixed' },
	STILL_BROKEN: { cls: 'fx-bad', text: '❌ Still Broken' },
	PARTIALLY_FIXED: { cls: 'fx-warn', text: '◐ Partially Fixed' },
	REGRESSED: { cls: 'fx-bad', text: '⚠ Regressed' },
	UNABLE_TO_VERIFY: { cls: 'fx-neutral', text: '? Unable to Verify' },
	READY_FOR_VALIDATION: { cls: 'fx-neutral', text: '◆ Ready for Validation' },
	VALIDATING: { cls: 'fx-warn', text: '⏳ Validating…' },
};

function fxBadge(status) {
	const def = FIX_STATUS_LABELS[status] ?? { cls: 'fx-neutral', text: status || 'Not validated' };
	const span = document.createElement('span');
	span.className = `fx-badge ${def.cls}`;
	span.textContent = def.text;
	return span;
}

async function renderFixValidationSection(body, bug) {
	const section = document.createElement('div');
	section.className = 'bug-detail-section fx-section';
	section.innerHTML = '<h4>🔬 Fix Validation</h4>';
	const holder = document.createElement('div');
	holder.innerHTML = '<div class="fx-loading">Loading validation state…</div>';
	section.append(holder);
	body.append(section);

	let data = null;
	let run = null;
	let loadError = null;
	try {
		data = await api(`/v1/findings/${bug.id}/validation`);
		run = data?.latest ?? null;
	} catch (error) {
		loadError = error; // distinguish API failure from "never validated"
	}

	holder.replaceChildren();
	if (loadError) {
		holder.innerHTML = `<div class="fx-hint fx-err">⚠ Could not load validation state: ${escapeHtml(loadError.message || 'API error')}</div>`;
	} else if (!data?.latest && !bug.fixStatus) {
		holder.innerHTML = '<div class="fx-hint">Not validated yet. Run a validation to verify whether a fix landed.</div>';
	} else {
		const card = document.createElement('div');
		card.className = 'fx-head';
		card.append(fxBadge(bug.fixStatus || run?.fixStatus));
		if (run) {
			if (run.validationConfidence != null) {
				const conf = document.createElement('span');
				conf.className = 'fx-confidence';
				conf.textContent = `confidence ${(run.validationConfidence * 100).toFixed(0)}%`;
				card.append(conf);
			}
			const attempts = run.attempts?.length ?? run.attemptCount ?? 0;
			const att = document.createElement('span');
			att.className = 'fx-attempts';
			att.textContent = `attempts ${attempts}`;
			card.append(att);
		}
		holder.append(card);

		if (run?.comparison?.verdicts) {
			const cmp = document.createElement('div');
			cmp.className = 'fx-comparison';
			cmp.innerHTML = '<h5>Before / After</h5>';
			const grid = document.createElement('div');
			grid.className = 'fx-cmp-grid';
			for (const [k, v] of Object.entries(run.comparison.verdicts)) {
				const row = document.createElement('div');
				row.className = 'fx-cmp-row';
				row.innerHTML = `<span>${escapeHtml(k)}</span><span class="${v ? 'fx-ok' : 'fx-bad'}">${v ? 'yes' : 'no'}</span>`;
				grid.append(row);
			}
			cmp.append(grid);
			holder.append(cmp);
		}
		// BUILD 18.4 — structured BEFORE/AFTER evidence blocks + screenshots.
		renderFxShotStrip(holder, run, { allRuns: data.history });
		renderFxOriginalBlock(holder, run, { collapsed: true });
		renderFxAfterBlock(holder, run, { collapsed: true });
		if (run?.regressions?.length) {
			const reg = document.createElement('div');
			reg.className = 'fx-regressions';
			reg.innerHTML = `<h5>Regressions detected (${run.regressions.length})</h5>`;
			for (const r of run.regressions) {
				const row = document.createElement('div');
				row.className = 'fx-reg-row';
				row.textContent = `${r.testName || r.test || r.name || 'test'} — ${r.status || ''}`;
				reg.append(row);
			}
			holder.append(reg);
		}
	}

	const actions = document.createElement('div');
	actions.className = 'fx-actions';
	const mk = (label, cls, fn) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = `btn btn-ghost btn-sm ${cls}`;
		b.textContent = label;
		b.addEventListener('click', fn);
		return b;
	};
	actions.append(
		mk('▶ Revalidate', '', () => triggerRevalidate(bug.id, `${bug.id.slice(0, 8)}-ui-${Date.now()}`)),
		mk('History', '', () => openFixValidationHistory(bug.id)),
		mk('View Original', '', () => openFixValidationHistory(bug.id, 'original')),
		mk('View Validation', '', () => openFixValidationHistory(bug.id, 'validation')),
		mk('Compare', '', () => openFixValidationHistory(bug.id, 'compare')),
		mk('✓ Approve Closure', 'fx-ok', () => submitReview(bug.id, 'APPROVED', 'Approved from UI')),
		mk('↺ Reopen', 'fx-warn', () => submitReview(bug.id, 'REOPENED', 'Reopened from UI')),
	);
	holder.append(actions);
	if (run) {
		holder.dataset.runId = run.id;
		renderFixValidationSection.lastRun = run;
	}
}

async function triggerRevalidate(findingId, key) {
	try {
		const res = await api(`/v1/findings/${findingId}/revalidate`, {
			method: 'POST',
			headers: { 'Idempotency-Key': `fxui-${key}` },
		});
		toast(`Validation ${res.validationId} started`, 'ok');
		pollFixValidation(findingId, res.validationId);
	} catch (error) {
		fail(error);
	}
}

/**
 * Phase 18 UI (BUILD 18.2): after starting a validation, show a live
 * VALIDATING indicator in the Fix Validation section and refresh it when the
 * run completes. Bounded polling (10s interval, 15 min cap) — no infinite
 * spinners; on timeout the section keeps its last known state and the user
 * can reopen the finding manually.
 */
let fxPollTimers = new Map();
function pollFixValidation(findingId, validationId) {
	// Only poll while the finding's detail drawer is showing this section.
	const section = document.querySelector('#bug-detail-body .fx-section');
	if (!section || bugState.detailId !== findingId) return;
	const badge = document.createElement('div');
	badge.className = 'fx-run-state fx-loading';
	badge.id = `fx-polling-${validationId}`;
	badge.textContent = `⏳ VALIDATING — run ${validationId} in progress…`;
	section.prepend(badge);
	if (fxPollTimers.has(findingId)) clearInterval(fxPollTimers.get(findingId));
	let elapsed = 0;
	const timer = setInterval(async () => {
		elapsed += 10;
		const stillOpen = document.getElementById(`fx-polling-${validationId}`);
		if (!stillOpen || bugState.detailId !== findingId) {
			clearInterval(timer);
			fxPollTimers.delete(findingId);
			return;
		}
		try {
			const data = await api(`/v1/findings/${findingId}/validation`);
			const run = data?.latest;
			if (!run || ['REQUESTED', 'QUEUED', 'RUNNING'].includes(run?.status)) {
				if (elapsed >= 900) { // 15 min cap
					stillOpen.textContent = `⏳ Still validating after 15 min — check History for run ${validationId}.`;
					clearInterval(timer);
					fxPollTimers.delete(findingId);
				}
				return;
			}
			clearInterval(timer);
			fxPollTimers.delete(findingId);
			// Run finished: re-render the finding detail (fetches fresh state).
			try {
				const fresh = await api(`/findings/${findingId}`);
				renderBugDetail(fresh);
				toast(`Validation finished: ${run.fixStatus ?? run.status}`, 'ok');
			} catch { /* leave indicator in place */ }
		} catch { /* transient fetch error — keep polling until cap */ }
	}, 10000);
	fxPollTimers.set(findingId, timer);
}

/* ── BUILD 18.4 — structured evidence rendering helpers ────────────
 * All renderers are defensive: any malformed/partial run data must
 * render "Not captured" rows, never crash the drawer or modal. */

function fxNewEl(tag, cls, text) {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (text != null) el.textContent = text;
	return el;
}

function fmtTs(ts) {
	if (!ts) return '—';
	try {
		return new Date(typeof ts === 'number' ? ts : Number(ts)).toLocaleString();
	} catch {
		return '—';
	}
}

function fmtDur(ms) {
	if (ms == null || Number.isNaN(Number(ms))) return '—';
	const s = Number(ms) / 1000;
	return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`;
}

/** Rows of evidence with persisted screenshot artifacts, from ALL runs of a
 * finding (latest first). The drawer strip shows the LATEST run only; if the
 * latest is a pass with no failure screenshots, older runs' BEFORE/AFTER
 * artifacts are still relevant and must stay reachable. */
function fxShotRows(run, { allRuns = null } = {}) {
	const rows = [];
	for (const phase of ['before', 'after']) {
		for (const ev of run?.evidence?.[phase] ?? []) {
			if (ev?.artifactPath) rows.push({ ...ev, phase, runId: run?.id });
		}
	}
	for (const r of allRuns ?? []) {
		if (!r || r.id === run?.id) continue;
		for (const phase of ['after', 'before']) {
			for (const ev of r.evidence?.[phase] ?? []) {
				if (ev?.artifactPath) rows.push({ ...ev, phase, runId: r.id, fromOlderRun: true });
			}
		}
	}
	return rows;
}

function fxArtifactUrl(artifactPath) {
	// artifactPath shape: "<dir>/<file>" → /api/artifacts/<dir>/<file> (per-segment encoded)
	const segs = String(artifactPath).split('/').filter(Boolean).map(encodeURIComponent);
	return segs.length ? `/api/artifacts/${segs.join('/')}` : null;
}

/** Small overlay to enlarge a screenshot (click a thumbnail). */
function ensureFxImageModal() {
	let modal = document.getElementById('fx-image-modal');
	if (modal) return modal;
	modal = document.createElement('dialog');
	modal.className = 'modal fx-image-modal';
	modal.id = 'fx-image-modal';
	modal.innerHTML = `
		<form method="dialog" class="modal-inner">
			<header class="modal-head">
				<h2 id="fx-image-title">Screenshot</h2>
				<button class="btn btn-ghost btn-sm" type="button" id="fx-image-close">✕</button>
			</header>
			<div class="modal-body fx-image-body">
				<img id="fx-image-el" alt="evidence screenshot" />
				<p class="fx-image-meta" id="fx-image-meta"></p>
			</div>
		</form>`;
	document.body.append(modal);
	modal.querySelector('#fx-image-close').addEventListener('click', () => modal.close());
	return modal;
}

function openFxImage(src, title, meta) {
	const modal = ensureFxImageModal();
	modal.querySelector('#fx-image-title').textContent = title || 'Screenshot';
	modal.querySelector('#fx-image-el').src = src;
	modal.querySelector('#fx-image-meta').textContent = meta || '';
	if (!modal.open) modal.showModal();
}

/**
 * BEFORE / AFTER screenshot strip. Each thumbnail shows which phase it
 * belongs to, which attempt produced it, and enlarges on click.
 */
function renderFxShotStrip(container, run, { limit = 6, allRuns = null, heading = null } = {}) {
	const all = fxShotRows(run, { allRuns });
	const rows = all.slice(0, limit);
	const wrap = fxNewEl('div', 'fx-shot-strip');
	const head = fxNewEl('div', 'fx-shot-head');
	head.append(fxNewEl('h5', null, heading ?? `📸 Screenshots (${all.length})`));
	if (all.length > rows.length) head.append(fxNewEl('span', 'fx-shot-more', `+${all.length - rows.length} more in History`));
	wrap.append(head);
	if (!rows.length) {
		wrap.append(fxNewEl('p', 'fx-notcaptured', 'Not captured for this run.'));
		container.append(wrap);
		return;
	}
	const strip = fxNewEl('div', 'fx-shot-row');
	for (const ev of rows) {
		const url = fxArtifactUrl(ev.artifactPath);
		if (!url) continue;
		const card = fxNewEl('button', 'fx-shot');
		card.type = 'button';
		const img = document.createElement('img');
		img.src = url;
		img.alt = ev.title || 'evidence screenshot';
		img.loading = 'lazy';
		img.addEventListener('error', () => { card.classList.add('fx-shot-missing'); img.alt = 'screenshot unavailable'; }, { once: true });
		card.append(img);
		const tag = fxNewEl('span', `fx-shot-tag fx-${ev.phase === 'before' ? 'before' : 'after'}`, ev.phase === 'before' ? 'BEFORE' : 'AFTER');
		card.append(tag);
		if (ev.fromOlderRun) card.append(fxNewEl('span', 'fx-shot-tag fx-shot-older', 'older run'));
		card.title = `${ev.phase.toUpperCase()} · ${ev.title || ''}${ev.runId ? ` · ${ev.runId}` : ''}`;
		card.addEventListener('click', () => openFxImage(url, ev.title || 'Screenshot', `${ev.phase.toUpperCase()} · ${fmtTs(ev.ts)}${ev.fromOlderRun ? ' · from earlier run' : ''} · ${ev.runId ?? run?.id ?? ''}`));
		strip.append(card);
	}
	wrap.append(strip);
	container.append(wrap);
}

/** Structured key/value panel (no raw JSON). */
function renderFxKv(container, pairs, { title, cls = '' } = {}) {
	const panel = fxNewEl('div', `fx-kv-panel ${cls}`);
	if (title) panel.append(fxNewEl('h5', null, title));
	for (const [label, value, valueCls = ''] of pairs) {
		const row = fxNewEl('div', 'fx-kv-row');
		row.append(fxNewEl('span', 'fx-kv-label', label));
		const v = fxNewEl('span', `fx-kv-value ${valueCls}`);
		v.textContent = value;
		row.append(v);
		panel.append(row);
	}
	container.append(panel);
	return panel;
}

/** Original finding (immutable snapshot) rendered as structured panels. */
function renderFxOriginalBlock(container, run, { collapsed = true } = {}) {
	const of = run?.originalFinding;
	const det = document.createElement('details');
	det.className = 'fx-block fx-block-original';
	det.open = !collapsed;
	const sum = document.createElement('summary');
	sum.textContent = '📋 ORIGINAL — finding as first reported (immutable)';
	det.append(sum);
	if (!of) {
		det.append(fxNewEl('p', 'fx-notcaptured', 'Original finding snapshot not retained for this run.'));
		container.append(det);
		return;
	}
	renderFxKv(det, [
		['Title', of.title ?? '—'],
		['Expected', of.expected ?? '—'],
		['Actual (observed failure)', of.actual ?? '—'],
		['Severity / priority', `${of.severity ?? '—'} · ${of.priority ?? '—'}`],
		['URL', of.url ?? '—'],
		['Environment', [of.browser, of.device, of.viewport ? `${of.viewport.width}×${of.viewport.height}` : null].filter(Boolean).join(' · ') || 'Not captured'],
		['Mission / workflow', [of.missionId, of.workflowId].filter(Boolean).join(' · ') || '—'],
		['Reproduced', of.reproductionAttempts ? `${of.reproductionSuccesses ?? 0}/${of.reproductionAttempts} attempts` : 'Not captured'],
	], { cls: 'fx-before' });
	const steps = of.steps?.length ? of.steps : (of.reproductionSteps ?? []);
	if (steps.length) {
		const ol = document.createElement('ol');
		ol.className = 'fx-steps';
		for (const s of steps) {
			const li = document.createElement('li');
			li.textContent = typeof s === 'string' ? s : (s?.action ? `${s.action}${s.target ? ` ${s.target}` : ''}` : JSON.stringify(s));
			ol.append(li);
		}
		const stepsWrap = fxNewEl('div', 'fx-kv-panel');
		stepsWrap.append(fxNewEl('h5', null, 'Reproduction steps'));
		stepsWrap.append(ol);
		det.append(stepsWrap);
	}
	const evCount = Array.isArray(of.evidence) ? of.evidence.length : (of.evidence ? 1 : 0);
	det.append(fxNewEl('p', 'fx-evidence-count', `🔗 ${evCount} original evidence node${evCount === 1 ? '' : 's'} linked (see evidence graph)`));
	container.append(det);
}

/** Per-attempt execution cards: assertions, steps, duration, errors. */
function renderFxAttempts(container, run, { collapsed = true, max = null } = {}) {
	const attempts = run?.attempts ?? [];
	const det = document.createElement('details');
	det.className = 'fx-block fx-block-attempts';
	det.open = !collapsed;
	const passes = attempts.filter(a => a?.succeeded).length;
	det.append(fxNewEl('summary', null, `🧪 VALIDATION ATTEMPTS — ${passes}/${attempts.length} reproduced expected behavior`));
	if (!attempts.length) {
		det.append(fxNewEl('p', 'fx-notcaptured', 'Not captured — run has no attempts.'));
		container.append(det);
		return;
	}
	const list = max ? attempts.slice(-max) : attempts;
	for (const a of list) {
		const card = fxNewEl('div', `fx-attempt ${a?.succeeded ? 'fx-attempt-ok' : 'fx-attempt-bad'}`);
		const head = fxNewEl('div', 'fx-attempt-head');
		head.append(fxNewEl('span', 'fx-attempt-num', `Attempt ${a?.attempt ?? '?'}`));
		const res = fxNewEl('span', `fx-attempt-res ${a?.succeeded ? 'fx-ok' : 'fx-bad'}`);
		res.textContent = !a?.executed ? '⚠ not executed' : a?.succeeded ? '✓ pass' : a?.originalFailureReproduced ? '✕ original failure reproduced' : '✕ failed';
		head.append(res);
		head.append(fxNewEl('span', 'fx-attempt-dur', fmtDur(a?.durationMs)));
		head.append(fxNewEl('span', 'fx-attempt-ts', fmtTs(a?.ts)));
		card.append(head);

		if (a?.assertions?.length) {
			const table = document.createElement('table');
			table.className = 'fx-assert-table';
			table.innerHTML = '<thead><tr><th>Assertion</th><th>Result</th><th>Expected</th><th>Observed</th></tr></thead>';
			const tbody = document.createElement('tbody');
			for (const asrt of a.assertions) {
				const tr = document.createElement('tr');
				tr.className = asrt?.passed ? '' : 'fx-assert-fail';
				const t = fxNewEl('td', null, asrt?.type ?? 'unknown');
				const r = fxNewEl('td', asrt?.passed ? 'fx-ok' : 'fx-bad', asrt?.passed ? '✓ pass' : '✕ fail');
				const e = fxNewEl('td', null, asrt?.expected ?? '—');
				const o = fxNewEl('td', null, asrt?.actual ?? '—');
				tr.append(t, r, e, o);
				tbody.append(tr);
			}
			table.append(tbody);
			const wrap = fxNewEl('div', 'fx-attempt-asserts');
			wrap.append(table);
			card.append(wrap);
		} else {
			card.append(fxNewEl('p', 'fx-notcaptured', 'Assertions: not captured'));
		}

		if (a?.steps?.length) {
			const line = a.steps.map(s => `${s?.status === 'pass' ? '✓' : s?.status === 'fail' ? '✕' : '•'} ${s?.action ?? 'step'}`).join(' → ');
			card.append(fxNewEl('p', 'fx-attempt-steps', line));
		}
		if (a?.error) card.append(fxNewEl('p', 'fx-err', `⚠ ${a.error}`));
		if (a?.missingEvidence?.length) card.append(fxNewEl('p', 'fx-warn', `Missing evidence: ${a.missingEvidence.join(', ')}`));
		det.append(card);
	}
	container.append(det);
}

/** AFTER-side evidence: what the validation observed + environment + timings. */
function renderFxAfterBlock(container, run, { collapsed = true } = {}) {
	const det = document.createElement('details');
	det.className = 'fx-block fx-block-after';
	det.open = !collapsed;
	det.append(fxNewEl('summary', null, '🧾 AFTER — validation execution evidence'));
	const of = run?.originalFinding ?? {};
	const t = run?.timings ?? {};
	renderFxKv(det, [
		['Run', run?.id ?? '—'],
		['Executed', fmtTs(run?.completedAt ?? run?.updatedAt)],
		['Result', run?.fixStatus ?? '—', run?.fixStatus === 'VERIFIED_FIXED' ? 'fx-ok' : 'fx-bad'],
		['Why', run?.fixStatusReason ?? '—'],
		['Validation confidence', run?.validationConfidence != null ? `${(run.validationConfidence * 100).toFixed(0)}% (new measurement)` : 'Not captured'],
		['Observed', run?.comparison?.after?.[0]?.actual ?? (run?.attempts?.length ? (run.attempts.every(a => a.succeeded) ? 'expected behavior observed' : 'original behavior persisted') : '—')],
		['Expected (from original)', of.expected ?? '—'],
		['URL validated', run?.plan?.url ?? of.url ?? '—'],
		['Environment', [run?.plan?.browser, run?.plan?.device, run?.plan?.viewport ? `${run.plan.viewport.width}×${run.plan.viewport.height}` : null].filter(Boolean).join(' · ') || 'local Chromium'],
		['Console / network', run?.comparison?.after?.[0] ? `${run.comparison.after[0].console ?? '—'} / ${run.comparison.after[0].network ?? '—'}` : 'Not captured'],
		['Duration (total / attempts)', `${fmtDur(t.totalMs)} / ${fmtDur(t.attemptsMs)}`],
	], { cls: 'fx-after' });
	if (Array.isArray(run?.environmentDeltas) && run.environmentDeltas.length) {
		const deltas = fxNewEl('p', 'fx-warn', `⚠ Environment differences vs original: ${run.environmentDeltas.map(d => `${d?.field ?? '?'}: ${d?.from ?? '?'} → ${d?.to ?? '?'}`).join(', ')}`);
		det.append(deltas);
	}
	if (run?.regressions && (run.regressions.verifiedRegressions?.length || run.regressions.suspectedRegressions?.length)) {
		const reg = fxNewEl('div', 'fx-regressions');
		reg.append(fxNewEl('h5', null, `⚠ Regressions (${run.regressions.verifiedRegressions?.length ?? 0} verified / ${run.regressions.suspectedRegressions?.length ?? 0} suspected)`));
		for (const r of [...(run.regressions.verifiedRegressions ?? []), ...(run.regressions.suspectedRegressions ?? [])]) {
			reg.append(fxNewEl('div', 'fx-reg-row', `${r?.testName ?? r?.test ?? r?.name ?? 'test'} — ${r?.status ?? ''}`));
		}
		det.append(reg);
	}
	if (run?.reviewTrail?.length) {
		const trail = fxNewEl('div', 'fx-kv-panel');
		trail.append(fxNewEl('h5', null, 'Review trail'));
		for (const rv of run.reviewTrail) {
			trail.append(fxNewEl('div', 'fx-kv-row', `${fmtTs(rv?.ts)} · ${rv?.from ?? '∅'} → ${rv?.to ?? '?'} · ${rv?.by ?? 'system'}${rv?.comment ? ` — “${rv.comment}”` : ''}`));
		}
		det.append(trail);
	}
	container.append(det);
}

function ensureFxHistoryModal() {
	let modal = document.getElementById('fx-history-modal');
	if (modal) return modal;
	modal = document.createElement('dialog');
	modal.className = 'modal modal-wide fx-history-modal';
	modal.id = 'fx-history-modal';
	modal.innerHTML = `
		<form method="dialog" class="modal-inner">
			<header class="modal-head">
				<h2>Fix Validation History</h2>
				<button class="btn btn-ghost btn-sm" type="button" id="fx-history-close">✕</button>
			</header>
			<div class="modal-body" id="fx-history-body"></div>
		</form>`;
	document.body.append(modal);
	modal.querySelector('#fx-history-close').addEventListener('click', () => modal.close());
	return modal;
}

async function openFixValidationHistory(findingId, view = 'runs') {
	const modal = ensureFxHistoryModal();
	const body = modal.querySelector('#fx-history-body');
	body.innerHTML = '<div class="fx-loading">Loading…</div>';
	modal.showModal();
	let data = null;
	try {
		data = await api(`/v1/findings/${findingId}/validation`);
	} catch (error) {
		body.innerHTML = `<div class="fx-hint fx-err">⚠ Could not load validation history: ${escapeHtml(error.message || 'API error')}</div>`;
		return;
	}
	body.replaceChildren();
	const runs = [data.latest, ...(data.history ?? [])].filter(Boolean);
	if (!runs.length) {
		body.innerHTML = '<div class="fx-hint">No validation runs yet.</div>';
		return;
	}
	// ── BUILD 18.4: structured views — no raw JSON as primary experience ──
	if (view === 'compare' && runs.length) {
		const run = data.latest ?? runs[0];
		body.append(fxNewEl('h5', 'fx-cmp-title', `${run.id} — deterministic comparison flags`));
		if (run.comparison?.verdicts) {
			const grid = document.createElement('div');
			grid.className = 'fx-cmp-grid';
			const LABELS = {
				behaviorChanged: 'Behavior changed?',
				expectedAchieved: 'Expected behavior achieved?',
				originalFailureReproduced: 'Original failure reproduced?',
				relatedFailuresIntroduced: 'Related failures introduced?',
			};
			const INVERT = { originalFailureReproduced: true, relatedFailuresIntroduced: true };
			for (const [k, v] of Object.entries(run.comparison.verdicts)) {
				// Glyph/word show the LITERAL flag value; color shows whether
				// that value is good news (inverted for the two failure flags).
				const good = INVERT[k] ? !v : !!v;
				const row = document.createElement('div');
				row.className = 'fx-cmp-row';
				row.innerHTML = `<span>${escapeHtml(LABELS[k] ?? k)}</span><span class="${good ? 'fx-ok' : 'fx-bad'}">${v ? '✓ yes' : '✕ no'}</span>`;
				grid.append(row);
			}
			body.append(grid);
		} else {
			body.append(fxNewEl('p', 'fx-notcaptured', 'Comparison not captured for this run.'));
		}
		renderFxOriginalBlock(body, run, { collapsed: false });
		renderFxAfterBlock(body, run, { collapsed: false });
		renderFxShotStrip(body, run, { allRuns: data.history });
		return;
	}
	if (view === 'original' || view === 'validation') {
		const run = data.latest;
		if (!run) {
			body.append(fxNewEl('p', 'fx-notcaptured', 'No validation run recorded for this finding.'));
			return;
		}
		if (view === 'original') {
			renderFxOriginalBlock(body, run, { collapsed: false });
		} else {
			renderFxAfterBlock(body, run, { collapsed: false });
			renderFxAttempts(body, run, { collapsed: false });
			renderFxShotStrip(body, run, { allRuns: data.history });
		}
		return;
	}
	for (const run of runs) {
		const row = document.createElement('div');
		row.className = 'fx-run-state fx-run-clickable';
		const head = document.createElement('div');
		head.className = 'fx-head';
		head.append(fxBadge(run.fixStatus));
		const meta = document.createElement('span');
		meta.className = 'fx-trail';
		meta.textContent = [
			run.id,
			fmtTs(run.createdAt ?? run.completedAt ?? run.updatedAt),
			run.status,
		].filter(Boolean).join(' · ');
		head.append(meta);
		row.append(head);
		const sub = document.createElement('div');
		sub.className = 'fx-run-sub';
		const evTotal = (run.evidence?.after?.length ?? 0) + (run.evidence?.before?.length ?? 0);
		sub.textContent = [
			run.validationConfidence != null ? `conf ${(run.validationConfidence * 100).toFixed(0)}%` : null,
			`attempts ${run.attempts?.length ?? 0}`,
			fmtDur(run.timings?.totalMs) !== '—' ? fmtDur(run.timings?.totalMs) : null,
			`evidence ✓${evTotal}`,
			run.fixStatusReason ?? '',
		].filter(Boolean).join(' · ');
		row.append(sub);
		row.addEventListener('click', () => {
			if (row.querySelector('.fx-block')) return; // already expanded
			renderFxOriginalBlock(row, run, { collapsed: false });
			renderFxAttempts(row, run, { collapsed: true });
			renderFxShotStrip(row, run);
			row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
		body.append(row);
	}
	if (!runs.length) {
		body.append(fxNewEl('p', 'fx-notcaptured', 'No validation runs recorded for this finding.'));
	}
}

async function submitReview(findingId, decision, comment) {
	try {
		const endpoint = decision === 'APPROVED' ? 'approve' : 'reopen';
		const res = await api(`/v1/findings/${findingId}/${endpoint}`, {
			method: 'POST',
			body: JSON.stringify({ decision, comment }),
		});
		toast(`Review: ${res.reviewState ?? decision}`, 'ok');
		const updated = await api(`/findings/${findingId}`);
		renderBugDetail(updated);
	} catch (error) {
		fail(error);
	}
}

function initFixValidationWiring() {
	// Filters + buttons are wired inline at render time; nothing to do here
	// beyond ensuring the modal exists lazily on first open.
}

export { loadBugs, openBugDetail, initBugsWiring };
