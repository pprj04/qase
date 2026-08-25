/**
 * Tests module — test case management, suites, test editor, and test execution.
 */
import { el, state, api, toast, fail, escapeHtml, hostOf, relativeTime, truncate, STEP_ICONS, showPageLoading, showPageError, clearPageState } from './shared.js';

/* ── Tests page search/filter wiring ──────────────────────────────── */
function initTestsWiring() {
	if (el.testsSearch) {
		el.testsSearch.addEventListener('input', () => {
			state.testsSearch = el.testsSearch.value.toLowerCase().trim();
			renderTestCases();
		});
	}
	if (el.testsFilterSeverity) {
		el.testsFilterSeverity.addEventListener('change', () => {
			state.testsSeverityFilter = el.testsFilterSeverity.value;
			renderTestCases();
		});
	}
	if (el.testsFilterViewport) {
		el.testsFilterViewport.addEventListener('change', () => {
			state.testsViewportFilter = el.testsFilterViewport.value;
			renderTestCases();
		});
	}
	if (el.btnRunAllTests) {
		el.btnRunAllTests.addEventListener('click', () => runAllTests());
	}
}

/* ── Stats bar ────────────────────────────────────────────────────── */
function renderTestsStats() {
	if (!el.testsStats) return;
	const total = state.testCases.length;
	const bySev = {};
	for (const tc of state.testCases) bySev[tc.severity] = (bySev[tc.severity] || 0) + 1;
	const suites = state.suites.length;
	const chips = [
		`<span class="ts-chip"><strong>${total}</strong> tests</span>`,
		`<span class="ts-chip"><strong>${suites}</strong> suites</span>`,
	];
	if (bySev.critical) chips.push(`<span class="ts-chip ts-crit"><strong>${bySev.critical}</strong> critical</span>`);
	if (bySev.high) chips.push(`<span class="ts-chip ts-high"><strong>${bySev.high}</strong> high</span>`);
	el.testsStats.innerHTML = chips.join('');
}
import { navigate } from './router.js';
import { openBugDetail } from './bugs.js';

/* ── Test Cases ─────────────────────────────────────────────────── */

const SEVERITY_COLORS = {
	critical: '#ff4444', high: '#ff8c00', medium: '#0a84ff', low: '#8e8e93'
};

const VP_PRESETS = {
	desktop:      { width: 1440, height: 900,  label: 'Desktop',  icon: '🖥️' },
	tablet:       { width: 768,  height: 1024, label: 'Tablet',   icon: '📋' },
	mobile:       { width: 375,  height: 812,  label: 'Mobile',   icon: '📱' },
	mobile_small: { width: 320,  height: 568,  label: 'Mobile S', icon: '📱' }
};

const ASSERTION_ICONS = {
	url_is: '🔗', url_contains: '🔗', element_visible: '👁️', element_hidden: '🚫',
	element_text: '📝', element_enabled: '⚡', no_console_errors: '🖥️',
	no_failed_requests: '🌐', status_code: '📊', custom: '❓'
};

async function loadTestCases() {
	const firstLoad = !state.testCasesLoaded;
	if (firstLoad) showPageLoading(el.testcasePane);
	const projectId = state.session?.projectId ?? state.projectId;
	const params = new URLSearchParams();
	if (projectId) params.set('projectId', projectId);
	const query = params.toString() ? `?${params.toString()}` : '';
	try {
		state.testCases = await api(`/test-cases${query}`);
	} catch (error) {
		state.testCases = [];
		state.testCasesLoaded = true;
		// BUILD 1: a load failure must not masquerade as an empty project.
		if (firstLoad || !state.suites?.length) {
			showPageError(el.testcasePane, loadTestCases, `Could not load test cases — ${error?.message ?? 'server unreachable'}.`);
			return;
		}
	}

	// Load suites for the project.
	try {
		state.suites = await api(`/suites${query}`);
	} catch {
		state.suites = [];
	}
	state.testCasesLoaded = true;
	clearPageState(el.testcasePane);

	renderSuiteTree();
	renderTestsStats();
	renderTestCases();
}

function renderTestCases() {
	el.testcasePane.replaceChildren();

	// Apply filters: tag, suite, search, severity, viewport.
	let visible = state.testCases;
	if (state.tagFilter) {
		visible = visible.filter(tc => (tc.tags ?? []).includes(state.tagFilter));
	}
	if (state.suiteFilter) {
		visible = visible.filter(tc => tc.suiteId === state.suiteFilter);
		const suite = state.suites.find(s => s.id === state.suiteFilter);
		if (suite) {
			const filterBar = document.createElement('div');
			filterBar.className = 'tc-suite-filter-bar';
			filterBar.innerHTML = `<span>Filtered by suite: <strong>${escapeHtml(suite.name)}</strong></span>`;
			const clearBtn = document.createElement('button');
			clearBtn.className = 'tc-tag-chip';
			clearBtn.textContent = '✕ Clear filter';
			clearBtn.onclick = () => { state.suiteFilter = null; renderTestCases(); renderSuiteTree(); };
			filterBar.append(clearBtn);
			el.testcasePane.append(filterBar);
		}
	}
	if (state.testsSearch) {
		const q = state.testsSearch;
		visible = visible.filter(tc =>
			tc.name?.toLowerCase().includes(q) ||
			tc.url?.toLowerCase().includes(q) ||
			(tc.tags ?? []).some(t => t.toLowerCase().includes(q))
		);
	}
	if (state.testsSeverityFilter) {
		visible = visible.filter(tc => tc.severity === state.testsSeverityFilter);
	}
	if (state.testsViewportFilter) {
		visible = visible.filter(tc => {
			if (tc.viewport && tc.viewport === state.testsViewportFilter) return true;
			if (tc.viewports && tc.viewports.includes(state.testsViewportFilter)) return true;
			return false;
		});
	}


	// Tag filter chips — render into tag bar wrap area (above the grid).
	if (el.testsTagBarWrap) {
		el.testsTagBarWrap.replaceChildren();
		const allTags = [...new Set(state.testCases.flatMap(tc => tc.tags ?? []))].sort();
		if (allTags.length > 0) {
			const tagBar = document.createElement('div');
			tagBar.className = 'tc-tag-bar';
			if (state.tagFilter) {
				const clearChip = document.createElement('button');
				clearChip.className = 'tc-tag-chip tc-tag-active';
				clearChip.textContent = `✕ ${state.tagFilter}`;
				clearChip.onclick = () => { state.tagFilter = null; renderTestCases(); };
				tagBar.append(clearChip);
			} else {
				for (const tag of allTags) {
					const chip = document.createElement('button');
					chip.className = 'tc-tag-chip';
					chip.textContent = tag;
					chip.onclick = () => { state.tagFilter = tag; renderTestCases(); };
					tagBar.append(chip);
				}
			}
			el.testsTagBarWrap.append(tagBar);
		}
	}

	if (visible.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'tc-empty';
		if (state.tagFilter) {
			empty.innerHTML = `<p>No test cases with tag "${escapeHtml(state.tagFilter)}".</p>`;
		} else if (state.suiteFilter) {
			empty.innerHTML = '<p>No test cases in this suite.</p>';
		} else {
			empty.innerHTML = '<p>No test cases yet.</p><small>Save a workflow → Gen Tests, or click "New Test Case" to create one manually.</small>';
		}
		el.testcasePane.append(empty);
		return;
	}

	// Render test case cards in batches for performance.
	const RENDER_BATCH = 25;
	let shown = 0;

	function renderBatch() {
		const fragment = document.createDocumentFragment();
		const end = Math.min(shown + RENDER_BATCH, visible.length);
		for (let i = shown; i < end; i++) {
			fragment.append(renderTestCaseCard(visible[i]));
		}
		shown = end;
		el.testcasePane.append(fragment);

		// Add "Load more" if there are remaining cards.
		if (shown < visible.length) {
			const loadMore = document.createElement('div');
			loadMore.className = 'tc-load-more';
			const btn = document.createElement('button');
			btn.className = 'btn btn-ghost btn-sm';
			btn.textContent = `Load more (${visible.length - shown} remaining)`;
			btn.onclick = () => { loadMore.remove(); renderBatch(); };
			loadMore.append(btn);
			el.testcasePane.append(loadMore);
		}
	}
	renderBatch();
}

function renderTestCaseCard(tc) {
	const card = document.createElement('div');
	card.className = 'tc-card';
	card.dataset.id = tc.id;

	// Header
	const header = document.createElement('div');
	header.className = 'tc-header';

	const sevDot = document.createElement('span');
	sevDot.className = 'tc-sev-dot';
	sevDot.style.background = SEVERITY_COLORS[tc.severity] ?? SEVERITY_COLORS.medium;

	const name = document.createElement('span');
	name.className = 'tc-name';
	name.textContent = tc.name;

	const stepCount = document.createElement('span');
	stepCount.className = 'tc-step-count';
	stepCount.textContent = `${tc.steps?.length ?? 0} steps · ${tc.assertions?.length ?? 0} assertions`;

	const delBtn = document.createElement('button');
	delBtn.className = 'tc-delete';
	delBtn.textContent = '✕';
	delBtn.title = 'Delete test case';
	delBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			await api(`/test-cases/${tc.id}`, { method: 'DELETE' });
			state.testCases = state.testCases.filter(t => t.id !== tc.id);
			card.remove();
					toast(`Deleted "${tc.name}".`, 'good');
		} catch (error) {
			fail(error);
		}
	};

	const cloneBtn = document.createElement('button');
	cloneBtn.className = 'tc-clone';
	cloneBtn.textContent = '⧉';
	cloneBtn.title = 'Clone test case';
	cloneBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			const clone = await api(`/test-cases/${tc.id}/clone`, { method: 'POST' });
			state.testCases.unshift(clone);
			el.testcasePane.insertBefore(renderTestCaseCard(clone), card.nextSibling);
					toast(`Cloned "${tc.name}".`, 'good');
		} catch (error) {
			fail(error);
		}
	};

	const editBtn = document.createElement('button');
	editBtn.className = 'tc-edit';
	editBtn.textContent = '✎';
	editBtn.title = 'Edit test case';
	editBtn.onclick = (e) => {
		e.stopPropagation();
		openTcEditor(tc);
	};

	const runBtn = document.createElement('button');
	runBtn.className = 'tc-run';
	runBtn.textContent = 'Run';
	runBtn.title = 'Run this test case';
	runBtn.onclick = async (e) => {
		e.stopPropagation();
		await runSingleTest(tc, card, runBtn);
	};

	const approveBtn = document.createElement('button');
	approveBtn.className = 'tc-approve-baseline';
	approveBtn.textContent = '✓ Baseline';
	approveBtn.title = 'Approve visual baseline from latest run';
	approveBtn.style.display = 'none';
	approveBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			approveBtn.disabled = true;
			approveBtn.textContent = 'Approving…';
			const data = await api(`/test-cases/${tc.id}/approve-baseline`, { method: 'POST' });
			toast(`Baseline updated (${data.approved} screenshot${data.approved === 1 ? '' : 's'}).`, 'good');
			approveBtn.style.display = 'none';
		} catch (error) {
			fail(error);
		} finally {
			approveBtn.disabled = false;
			approveBtn.textContent = '✓ Baseline';
		}
	};

	header.append(sevDot, name, stepCount, runBtn, approveBtn, editBtn, cloneBtn, delBtn);

	// Use server-provided hasBaselines flag instead of N+1 API calls.
	approveBtn.style.display = tc.hasBaselines ? '' : 'none';

	// Tags + viewport + move-to-suite
	const metaRow = document.createElement('div');
	metaRow.className = 'tc-meta-row';

	// Viewport badge
	const vpKey = tc.viewport;
	const multiVps = tc.viewports ?? [];
	if (vpKey || multiVps.length > 0) {
		const vpBadges = document.createElement('span');
		vpBadges.className = 'tc-viewport-badges';
		const vps = multiVps.length > 0 ? multiVps : (vpKey ? [vpKey] : []);
		for (const v of vps) {
			const vpBadge = document.createElement('span');
			vpBadge.className = 'tc-vp-badge';
			const vpMeta = VP_PRESETS[v] || VP_PRESETS.desktop;
			vpBadge.textContent = vpMeta.icon;
			vpBadge.title = `${vpMeta.label} (${vpMeta.width}×${vpMeta.height})`;
			vpBadges.append(vpBadge);
		}
		metaRow.append(vpBadges);
	}

	if (tc.tags?.length > 0) {
		for (const tag of tc.tags) {
			const chip = document.createElement('span');
			chip.className = 'tc-tag-chip';
			chip.textContent = tag;
			chip.onclick = (e) => {
				e.stopPropagation();
				state.tagFilter = tag;
				renderTestCases();
			};
			metaRow.append(chip);
		}
	}

	// Move to suite dropdown
	if (state.suites.length > 0) {
		const moveSelect = document.createElement('select');
		moveSelect.className = 'tc-move-suite';
		moveSelect.title = 'Move to suite';
		const noneOpt = document.createElement('option');
		noneOpt.value = '';
		noneOpt.textContent = '— No suite —';
		moveSelect.append(noneOpt);
		for (const suite of state.suites) {
			const opt = document.createElement('option');
			opt.value = suite.id;
			const prefix = suite.parentId ? '↳ ' : '';
			opt.textContent = prefix + suite.name;
			if (tc.suiteId === suite.id) opt.selected = true;
			moveSelect.append(opt);
		}
		moveSelect.onchange = async (e) => {
			e.stopPropagation();
			try {
				const newSuiteId = moveSelect.value || null;
				await api(`/test-cases/${tc.id}`, {
					method: 'PUT',
					body: JSON.stringify({ ...tc, suiteId: newSuiteId })
				});
				tc.suiteId = newSuiteId;
				state.testCases = state.testCases.map(t =>
					t.id === tc.id ? { ...t, suiteId: newSuiteId } : t
				);
				renderSuiteTree();
				toast(`Moved to ${newSuiteId ? state.suites.find(s => s.id === newSuiteId)?.name : 'no suite'}.`, 'good');
			} catch (error) {
				fail(error);
			}
		};
		metaRow.append(moveSelect);
	}

	if (metaRow.children.length > 0) {
		header.append(metaRow);
	}

	// Bug badges (Phase 11: bi-directional linking)
	if (tc.findingIds?.length > 0) {
		const bugBadges = document.createElement('div');
		bugBadges.className = 'tc-bug-badges';
		for (const fid of tc.findingIds) {
			const badge = document.createElement('span');
			badge.className = 'tc-bug-badge';
			badge.textContent = '🐛';
			badge.title = `Linked bug: ${fid.slice(0, 8)}…`;
			badge.onclick = (e) => {
				e.stopPropagation();
				navigate('bugs');
				openBugDetail(fid);
			};
			bugBadges.append(badge);
		}
		header.append(bugBadges);
	}

	// Body (collapsible)
	const body = document.createElement('div');
	body.className = 'tc-body';

	// Preconditions
	if (tc.preconditions?.length > 0) {
		const precond = document.createElement('div');
		precond.className = 'tc-section-label';
		precond.textContent = 'Preconditions';
		const ul = document.createElement('ul');
		ul.className = 'tc-precond';
		for (const p of tc.preconditions) {
			const li = document.createElement('li');
			li.textContent = p;
			ul.append(li);
		}
		body.append(precond, ul);
	}

	// Steps
	if (tc.steps?.length > 0) {
		const stepsLabel = document.createElement('div');
		stepsLabel.className = 'tc-section-label';
		stepsLabel.textContent = 'Steps';
		body.append(stepsLabel);

		for (const [i, step] of tc.steps.entries()) {
			const row = document.createElement('div');
			row.className = 'tc-step';

			const num = document.createElement('span');
			num.className = 'tc-step-num';
			num.textContent = String(i + 1);

			const icon = document.createElement('span');
			icon.className = 'tc-step-icon';
			icon.textContent = STEP_ICONS[step.action] ?? '•';

			const text = document.createElement('span');
			text.className = 'tc-step-text';
			const parts = [step.description || step.action];
			if (step.target) parts.push(step.target);
			if (step.value) parts.push(`= ${step.value}`);
			text.textContent = parts.join(' · ');

			row.append(num, icon, text);
			body.append(row);
		}
	}

	// Assertions
	if (tc.assertions?.length > 0) {
		const assertLabel = document.createElement('div');
		assertLabel.className = 'tc-section-label';
		assertLabel.textContent = 'Assertions';
		body.append(assertLabel);

		for (const assertion of tc.assertions) {
			const row = document.createElement('div');
			row.className = 'tc-assertion';

			const icon = document.createElement('span');
			icon.className = 'tc-assertion-icon';
			icon.textContent = ASSERTION_ICONS[assertion.type] ?? '❓';

			const text = document.createElement('span');
			text.className = 'tc-assertion-text';
			text.textContent = assertion.description || `${assertion.type}: ${assertion.expected}`;

			row.append(icon, text);
			body.append(row);
		}
	}

	card.append(header, body);

	// Run result container (populated after a run)
	const resultContainer = document.createElement('div');
	resultContainer.className = 'tc-result';
	card.append(resultContainer);

	// History section (lazy-loaded on first expand)
	const historySection = document.createElement('div');
	historySection.className = 'tc-history-section';
	const historyToggle = document.createElement('button');
	historyToggle.className = 'tc-history-toggle';
	historyToggle.textContent = '▸ History';
	let historyLoaded = false;
	historyToggle.onclick = async (e) => {
		e.stopPropagation();
		const isOpen = historySection.classList.toggle('is-open');
		historyToggle.textContent = isOpen ? '▾ History' : '▸ History';
		if (isOpen && !historyLoaded) {
			historyLoaded = true;
			historyToggle.textContent = '▾ Loading…';
			try {
				const runs = await api(`/test-cases/${tc.id}/runs`);
				renderHistoryList(historySection, runs, tc.id);
				historyToggle.textContent = `▾ History (${runs.length})`;
			} catch {
				historyToggle.textContent = '▾ History (error)';
			}
		}
	};
	card.append(historyToggle, historySection);

	// Toggle expand/collapse
	let expanded = false;
	header.onclick = () => {
		expanded = !expanded;
		body.classList.toggle('is-expanded', expanded);
		header.classList.toggle('is-expanded', expanded);
	};

	card._runResult = resultContainer;
	return card;
}

/* ── Run history rendering ──────────────────────────────────────── */

function renderHistoryList(container, runs, testCaseId) {
	container.replaceChildren();

	if (!runs || runs.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'tc-history-empty';
		empty.textContent = 'No previous runs.';
		container.append(empty);
		return;
	}

	for (const run of runs) {
		const entry = document.createElement('div');
		entry.className = 'tc-history-entry';

		// Header row: timestamp, result badge, duration, flaky
		const header = document.createElement('div');
		header.className = 'tc-history-header';

		const icon = run.result === 'pass' ? '✓' : run.result === 'fail' ? '✗' : '⚠';
		header.innerHTML = `<span class="tc-history-icon tc-result-${run.result}">${icon}</span>`;
		const info = document.createElement('span');
		info.className = 'tc-history-info';
		const time = new Date(run.ts).toLocaleString();
		let infoText = `${time} · ${Math.round(run.durationMs / 1000)}s`;
		if (run.flaky) {
			infoText += ' · <span class="tc-history-flaky">⚡ flaky</span>';
		}
		if (run.attempt && run.attempt > 1) {
			infoText += ` · attempt ${run.attempt}`;
		}
		info.innerHTML = infoText;
		header.append(info);

		// Screenshot thumbnails (from artifact paths)
		if (run.screenshotPaths?.length > 0) {
			const thumbs = document.createElement('div');
			thumbs.className = 'tc-history-thumbs';
			for (const sp of run.screenshotPaths) {
				const img = document.createElement('img');
				img.className = 'tc-history-thumb';
				img.src = `/api/artifacts/${sp}`;
				img.alt = 'Screenshot evidence';
				img.loading = 'lazy';
				img.onclick = () => window.open(img.src, '_blank');
				thumbs.append(img);
			}
			entry.append(header, thumbs);
		} else {
			entry.append(header);
		}

		// Expandable details: step + assertion results
		let detailsOpen = false;
		const details = document.createElement('div');
		details.className = 'tc-history-details';

		entry.onclick = () => {
			detailsOpen = !detailsOpen;
			details.classList.toggle('is-open', detailsOpen);
			if (detailsOpen && !details.children.length) {
				renderHistoryDetails(details, run);
			}
		};
		entry.style.cursor = 'pointer';
		entry.append(details);

		container.append(entry);
	}
}

function renderHistoryDetails(container, run) {
	// Step results
	if (run.stepResults?.length > 0) {
		const label = document.createElement('div');
		label.className = 'tc-section-label';
		label.textContent = `Steps (${run.stepResults.length})`;
		container.append(label);

		for (const sr of run.stepResults) {
			const row = document.createElement('div');
			row.className = `tc-result-step ${sr.status}`;
			const sIcon = sr.status === 'pass' ? '✓' : '✗';
			let html = `<span class="tc-result-step-icon">${sIcon}</span>`;
			if (sr.stepIndex !== undefined) html += ` ${sr.stepIndex + 1}.`;
			html += ` ${escapeHtml(sr.action || '')}`;
			if (sr.error) {
				html += ` <span class="tc-result-step-error">${escapeHtml(sr.error)}</span>`;
			}
			row.innerHTML = html;
			container.append(row);
		}
	}

	// Assertion results
	if (run.assertionResults?.length > 0) {
		const label = document.createElement('div');
		label.className = 'tc-section-label';
		label.textContent = `Assertions (${run.assertionResults.length})`;
		container.append(label);

		for (const ar of run.assertionResults) {
			const row = document.createElement('div');
			row.className = `tc-result-assertion ${ar.passed ? 'pass' : 'fail'}`;
			const aIcon = ar.passed ? '✓' : '✗';
			row.innerHTML = `<span class="tc-result-step-icon">${aIcon}</span> ${escapeHtml(ar.type || '')}: ${escapeHtml(ar.description || '')}`;
			if (!ar.passed) {
				const detail = document.createElement('div');
				detail.className = 'tc-result-assertion-detail';
				detail.textContent = `expected: ${ar.expected} · got: ${ar.actual}`;
				row.append(detail);
			}
			container.append(row);
		}
	}

	// Trace download
	if (run.tracePath) {
		const trace = document.createElement('a');
		trace.className = 'tc-trace-download';
		trace.href = `/api/artifacts/${run.tracePath}`;
		trace.download = 'trace.zip';
		trace.textContent = '⬇ Download Playwright trace';
		trace.onclick = (e) => e.stopPropagation();
		container.append(trace);
	}

	if (!run.stepResults?.length && !run.assertionResults?.length && !run.tracePath) {
		const none = document.createElement('div');
		none.className = 'tc-history-empty';
		none.textContent = 'No detailed results for this run.';
		container.append(none);
	}
}

/* ── Test case execution ────────────────────────────────────────── */

async function runSingleTest(tc, card, runBtn) {
	const resultContainer = card._runResult;
	try {
		runBtn.disabled = true;
		runBtn.textContent = 'Running…';
		resultContainer.replaceChildren();
		const spinner = document.createElement('div');
		spinner.className = 'tc-running';
		spinner.textContent = 'Running test…';
		resultContainer.append(spinner);

		// B0: credentials intentionally omitted for single-run — the vault
		// scope is per-session and there is no UI to select stored secret
		// names yet. (Documented as a B1 finding: single-test authenticated
		// replay needs a secret picker.)
		const data = await api(`/test-cases/${tc.id}/run`, {
			method: 'POST',
			body: JSON.stringify({})
		});

		renderRunResult(resultContainer, data.result);
		// Show the approve-baseline button if the run produced screenshots.
		if (data.result.screenshots?.length > 0) {
			const approveBtn = card.querySelector('.tc-approve-baseline');
			if (approveBtn) approveBtn.style.display = '';
		}
		toast(
			data.result.result === 'pass' ? `✓ ${tc.name} passed` : `✗ ${tc.name} ${data.result.result}`,
			data.result.result === 'pass' ? 'good' : 'bad'
		);
	} catch (error) {
		fail(error);
		resultContainer.replaceChildren();
		const errEl = document.createElement('div');
		errEl.className = 'tc-result-error';
		errEl.textContent = `Error: ${fail(error)}`;
		resultContainer.append(errEl);
	} finally {
		runBtn.disabled = false;
		runBtn.textContent = 'Run';
	}
}

async function runAllTests() {
	if (state.testCases.length === 0) {
		toast('No test cases to run.', 'bad');
		return;
	}

	const pane = el.testcasePane;
	const runAllBtn = el.btnRunAllTests;
	if (runAllBtn) {
		runAllBtn.disabled = true;
		runAllBtn.textContent = 'Running…';
	}

	// Show running indicator
	const indicator = document.createElement('div');
	indicator.className = 'tc-running-all';
	indicator.textContent = `Running ${state.testCases.length} test cases…`;
	pane.prepend(indicator);

	try {
		const ids = state.testCases.map(tc => tc.id);
		// B0 fix: stop bypassing server configuration with hardcoded
		// concurrency/retries. Omit both fields — the server applies
		// the operator's Settings (concurrentRuns / retriesCount) server-side.
		const summary = await api('/test-cases/run', {
			method: 'POST',
			body: JSON.stringify({
				testCaseIds: ids
			})
		});

		// Render results on each card
		for (const result of summary.results) {
			const card = pane.querySelector(`.tc-card[data-id="${result.testCaseId}"]`);
			if (card && card._runResult) {
				renderRunResult(card._runResult, result);
			}
		}

		let msg = `Suite: ${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored`;
		if (summary.flaky) {
			msg += `, ${summary.flaky} flaky`;
		}
		toast(msg, summary.failed + summary.errored === 0 ? 'good' : 'bad');
	} catch (error) {
		fail(error);
	} finally {
		indicator.remove();
		if (runAllBtn) {
			runAllBtn.disabled = false;
			runAllBtn.textContent = 'Run All';
		}
	}
}

function renderRunResult(container, result) {
	container.replaceChildren();

	const banner = document.createElement('div');
	banner.className = `tc-result-banner ${result.result}`;
	const icon = result.result === 'pass' ? '✓' : result.result === 'fail' ? '✗' : '⚠';
	const label = result.result === 'pass' ? 'PASSED' : result.result === 'fail' ? 'FAILED' : 'ERROR';
	let bannerHtml = `<span class="tc-result-icon">${icon}</span> ${label} · ${Math.round(result.durationMs / 1000)}s`;
	// B0.2 — truthful execution provenance badge. The environment says where
	// the test ACTUALLY ran; the legacy result.browser field only says what
	// was REQUESTED. Never render a provider from the request alone.
	if (result.executionEnvironment?.provider === 'browserstack') {
		const bsEnv = result.executionEnvironment;
		const failed = bsEnv.failed === true;
		// B0.3 — a BrowserStack run with a device is a REAL-DEVICE run;
		// without one it's a cloud desktop browser. The badge says which.
		const isDevice = Boolean(bsEnv.device);
		const badgeText = isDevice
			? `☁️ ${bsEnv.device} · BrowserStack · real device`
			: '☁️ BrowserStack';
		const badgeTitle = isDevice
			? `${bsEnv.device} · real device · ${bsEnv.browser ?? 'chrome'} · ${bsEnv.os ?? ''}${bsEnv.osVersion ? ` ${bsEnv.osVersion}` : ''}`
			: `${bsEnv.browser ?? ''} ${bsEnv.os ?? ''} ${bsEnv.osVersion ?? ''}`.trim() || 'BrowserStack';
		bannerHtml += ` <span class="tc-browser-badge tc-bs-badge${failed ? ' tc-bs-failed' : ''}" title="${escapeHtml(badgeTitle)}">${escapeHtml(badgeText)}${failed ? ' (failed — local fallback disabled)' : ''}</span>`;
	} else if (result.executionEnvironment?.provider === 'local') {
		// Local runs stay quiet unless something notable: emulated device or
		// a non-chromium request label.
		if (result.executionEnvironment.engineEmulated && result.executionEnvironment.device) {
			bannerHtml += ` <span class="tc-browser-badge" title="${escapeHtml(result.executionEnvironment.device)} (local Chromium — emulated)">📱 ${escapeHtml(result.executionEnvironment.device)} · emulated</span>`;
		}
	}
	if (result.browser && result.browser !== 'chromium') {
		const browserIcons = { chrome: '🌐', firefox: '🦊', safari: '🧭', edge: '🔵' };
		const safeBrowser = escapeHtml(result.browser);
		bannerHtml += ` <span class="tc-browser-badge" title="Browser: ${safeBrowser}">${browserIcons[result.browser] || '🌐'} ${safeBrowser}</span>`;
	}
	if (result.flaky) {
		bannerHtml += ` <span class="tc-flaky-badge" title="Passed on attempt ${result.attempt || 2} of ${result.attempt || 2}">⚡ FLAKY</span>`;
	}
	if (result.healed) {
		bannerHtml += ` <span class="tc-healed-badge" title="Selector was auto-healed and persisted">💚 HEALED</span>`;
	}
	if (result.attempt && result.attempt > 1) {
		bannerHtml += ` <span class="tc-attempt-badge">attempt ${result.attempt}</span>`;
	}
	banner.innerHTML = bannerHtml;
	container.append(banner);

	// Multi-viewport results
	if (result.viewportResults?.length > 0) {
		const vpRow = document.createElement('div');
		vpRow.className = 'tc-viewport-results';
		for (const vpr of result.viewportResults) {
			const vp = vpr.viewport;
			const vpMeta = VP_PRESETS[vp?.label?.toLowerCase?.()] || VP_PRESETS[Object.keys(VP_PRESETS).find(k => VP_PRESETS[k].label === vp?.label)] || {};
			const chip = document.createElement('span');
			chip.className = `tc-vp-result vpr-${vpr.result}`;
			chip.textContent = `${vpMeta.icon || '📐'} ${vp?.label || ''}: ${vpr.result === 'pass' ? '✓' : '✗'} ${Math.round(vpr.durationMs / 1000)}s`;
			vpRow.append(chip);
		}
		container.append(vpRow);
	} else if (result.viewport?.label) {
		// Single viewport — show a badge
		const vpBadge = document.createElement('div');
		vpBadge.className = 'tc-viewport-single';
		vpBadge.textContent = `${result.viewport.icon || '📐'} ${result.viewport.label} (${result.viewport.width}×${result.viewport.height})`;
		container.append(vpBadge);
	}

	// Error message
	if (result.error) {
		const errEl = document.createElement('div');
		errEl.className = 'tc-result-error';
		errEl.textContent = result.error;
		container.append(errEl);
	}

	// Healing details
	if (result.healRecords?.length > 0) {
		const healLabel = document.createElement('div');
		healLabel.className = 'tc-section-label';
		healLabel.textContent = 'Self-Healing';
		container.append(healLabel);

		for (const rec of result.healRecords) {
			const row = document.createElement('div');
			row.className = 'tc-heal-record';
			const pct = Math.round(rec.confidence * 100);
			row.innerHTML = `<span class="tc-heal-action">${escapeHtml(rec.action)}</span>`
				+ `<span class="tc-heal-old">${escapeHtml(rec.oldSelector)}</span>`
				+ `<span class="tc-heal-arrow">→</span>`
				+ `<span class="tc-heal-new">${escapeHtml(rec.newSelector)}</span>`
				+ `<span class="tc-heal-conf" title="${escapeHtml(rec.reason || '')}">${pct}% confidence</span>`;
			container.append(row);
		}
	}

	// Step results
	if (result.stepResults?.length > 0) {
		const stepsLabel = document.createElement('div');
		stepsLabel.className = 'tc-section-label';
		stepsLabel.textContent = 'Steps';
		container.append(stepsLabel);

		for (const sr of result.stepResults) {
			const row = document.createElement('div');
			row.className = `tc-result-step ${sr.status}`;
			const sIcon = sr.status === 'pass' ? '✓' : '✗';
			const labelSpan = document.createElement('span');
			labelSpan.textContent = `${sr.stepIndex + 1}. ${sr.action || ''}`;
			row.innerHTML = `<span class="tc-result-step-icon">${sIcon}</span> `;
			row.append(labelSpan);
			if (sr.error) {
				const err = document.createElement('span');
				err.className = 'tc-result-step-error';
				err.textContent = sr.error;
				row.append(err);
			}
			container.append(row);
		}
	}

	// Assertion results
	if (result.assertionResults?.length > 0) {
		const assertLabel = document.createElement('div');
		assertLabel.className = 'tc-section-label';
		assertLabel.textContent = 'Assertions';
		container.append(assertLabel);

		for (const ar of result.assertionResults) {
			const row = document.createElement('div');
			row.className = `tc-result-assertion ${ar.passed ? 'pass' : 'fail'}`;
			const aIcon = ar.passed ? '✓' : '✗';
			let typeLabel = escapeHtml(ar.type || '');
			if (ar.type === 'visual_match') {
				typeLabel = '🎨 visual_match';
			}
			row.innerHTML = `<span class="tc-result-step-icon">${aIcon}</span> ${typeLabel}: ${escapeHtml(ar.description || '')}`;
			if (!ar.passed) {
				const detail = document.createElement('div');
				detail.className = 'tc-result-assertion-detail';
				detail.textContent = `expected: ${ar.expected} · got: ${ar.actual}`;
				row.append(detail);
			}
			// Visual diff viewer
			if (ar.type === 'visual_match' && ar.visual) {
				const v = ar.visual;
				if (v.isNew) {
					const badge = document.createElement('div');
					badge.className = 'tc-visual-badge new';
					badge.textContent = '✓ Baseline auto-captured';
					row.append(badge);
				} else if (v.diffPath) {
					const viewer = renderVisualDiffViewer(v);
					row.append(viewer);
				}
			}
			container.append(row);
		}
	}

	// Screenshots
	if (result.screenshots?.length > 0) {
		const ssLabel = document.createElement('div');
		ssLabel.className = 'tc-section-label';
		ssLabel.textContent = 'Evidence';
		container.append(ssLabel);

		for (const ss of result.screenshots) {
			const wrap = document.createElement('div');
			wrap.className = 'tc-screenshot';
			const cap = document.createElement('div');
			cap.className = 'tc-screenshot-label';
			cap.textContent = ss.label;
			const img = document.createElement('img');
			img.src = ss.dataUrl;
			img.alt = ss.label;
			wrap.append(cap, img);
			container.append(wrap);
		}
	}
}

/* ── Visual diff viewer ────────────────────────────────────────── */

function renderVisualDiffViewer(visual) {
	const wrap = document.createElement('div');
	wrap.className = 'tc-visual-diff';

	// Stats bar
	const stats = document.createElement('div');
	stats.className = 'tc-visual-stats';
	const pct = (visual.pctChanged * 100).toFixed(2);
	const status = visual.pctChanged <= (visual.threshold ?? 0.001) ? 'match' : 'diff';
	stats.innerHTML = `
		<span class="tc-visual-stat ${status}">
			${status === 'match' ? '✓' : '⚠'} ${pct}% changed
		</span>
		<span class="tc-visual-stat-detail">${visual.pixelDiff.toLocaleString()} / ${visual.totalPixels.toLocaleString()} pixels</span>
	`;
	wrap.append(stats);

	// Side-by-side images
	const grid = document.createElement('div');
	grid.className = 'tc-visual-grid';

	// Baseline
	const baselineBox = document.createElement('div');
	baselineBox.className = 'tc-visual-img-box';
	baselineBox.innerHTML = '<div class="tc-visual-img-label">Baseline</div>';
	const baselineImg = document.createElement('img');
	baselineImg.src = `/api/artifacts/${visual.baselinePath}`;
	baselineImg.alt = 'Baseline screenshot';
	baselineImg.loading = 'lazy';
	baselineBox.append(baselineImg);

	// Current
	const currentBox = document.createElement('div');
	currentBox.className = 'tc-visual-img-box';
	currentBox.innerHTML = '<div class="tc-visual-img-label">Actual</div>';
	const currentImg = document.createElement('img');
	currentImg.src = `/api/artifacts/${visual.currentPath}`;
	currentImg.alt = 'Current screenshot';
	currentImg.loading = 'lazy';
	currentBox.append(currentImg);

	// Diff
	const diffBox = document.createElement('div');
	diffBox.className = 'tc-visual-img-box';
	diffBox.innerHTML = '<div class="tc-visual-img-label">Diff</div>';
	const diffImg = document.createElement('img');
	diffImg.src = `/api/artifacts/${visual.diffPath}`;
	diffImg.alt = 'Visual diff';
	diffImg.loading = 'lazy';
	diffBox.append(diffImg);

	grid.append(baselineBox, currentBox, diffBox);
	wrap.append(grid);

	return wrap;
}

/* ── Test Case Editor (Phase 8) ─────────────────────────────────── */

const STEP_ACTIONS = [
	'navigate', 'click', 'fill', 'type', 'select', 'check', 'key',
	'scroll', 'hover', 'wait', 'screenshot', 'diagnostics'
];

const ASSERTION_TYPES = [
	'url_is', 'url_contains', 'element_visible', 'element_hidden',
	'element_text', 'element_enabled', 'no_console_errors',
	'no_failed_requests', 'status_code', 'visual_match', 'custom'
];

/** Populates the suite <select> inside the editor. */
function populateSuiteSelect() {
	el.tcEditSuite.replaceChildren();
	const none = document.createElement('option');
	none.value = '';
	none.textContent = '— No suite —';
	el.tcEditSuite.append(none);
	for (const suite of state.suites) {
		const opt = document.createElement('option');
		opt.value = suite.id;
		const prefix = suite.parentId ? '↳ ' : '';
		opt.textContent = prefix + suite.name;
		el.tcEditSuite.append(opt);
	}
}

/** Renders the suite tree sidebar. */
function renderSuiteTree() {
	el.suiteTree.replaceChildren();
	if (state.suites.length === 0) return;

	const rootSuites = state.suites.filter(s => !s.parentId);
	for (const suite of rootSuites) {
		el.suiteTree.append(renderSuiteNode(suite, 0));
	}
}

function renderSuiteNode(suite, depth) {
	const node = document.createElement('div');
	node.className = 'suite-node';
	node.style.marginLeft = `${depth * 16}px`;

	const row = document.createElement('div');
	row.className = 'suite-row';

	const folder = document.createElement('span');
	folder.className = 'suite-folder';
	const hasChildren = state.suites.some(s => s.parentId === suite.id);
	folder.textContent = hasChildren ? '📂' : '📁';

	const name = document.createElement('span');
	name.className = 'suite-name';
	name.textContent = suite.name;
	name.title = 'Click to filter test cases by this suite';
	name.style.cursor = 'pointer';
	name.onclick = (e) => {
		e.stopPropagation();
		// Toggle: if already filtering by this suite, clear it.
		if (state.suiteFilter === suite.id) {
			state.suiteFilter = null;
		} else {
			state.suiteFilter = suite.id;
		}
		renderTestCases();
		renderSuiteTree();
	};

	// Test case count in suite.
	const count = state.testCases.filter(tc => tc.suiteId === suite.id).length;
	const countSpan = document.createElement('span');
	countSpan.className = 'suite-count';
	countSpan.textContent = `${count}`;

	const delBtn = document.createElement('button');
	delBtn.className = 'suite-del';
	delBtn.textContent = '✕';
	delBtn.title = 'Delete suite';
	delBtn.onclick = async (e) => {
		e.stopPropagation();
		try {
			await api(`/suites/${suite.id}`, { method: 'DELETE' });
			state.suites = state.suites.filter(s => s.id !== suite.id);
			renderSuiteTree();
			toast(`Deleted suite "${suite.name}".`, 'good');
		} catch (error) {
			fail(error);
		}
	};

	row.append(folder, name, countSpan, delBtn);
	node.append(row);

	// Children (collapsible).
	const childWrap = document.createElement('div');
	childWrap.className = 'suite-children';

	// Collapsible: clicking the row toggles children.
	if (hasChildren) {
		row.classList.add('suite-collapsible');
		row.onclick = (e) => {
			// Don't toggle when clicking delete button.
			if (e.target === delBtn) return;
			const collapsed = row.classList.toggle('suite-collapsed');
			childWrap.hidden = collapsed;
			folder.textContent = collapsed ? '📁' : '📂';
		};
	}

	const children = state.suites.filter(s => s.parentId === suite.id);
	for (const child of children) {
		childWrap.append(renderSuiteNode(child, depth + 1));
	}
	node.append(childWrap);

	return node;
}

/** Opens the test case editor — `existingTc` null = new, object = edit. */
function openTcEditor(existingTc) {
	state.editingTc = existingTc ?? null;

	populateSuiteSelect();

	if (existingTc) {
		el.tcEditorTitle.textContent = 'Edit Test Case';
		el.tcEditName.value = existingTc.name ?? '';
		el.tcEditSeverity.value = existingTc.severity ?? 'medium';
		el.tcEditUrl.value = existingTc.targetUrl ?? '';
		el.tcEditSuite.value = existingTc.suiteId ?? '';
		el.tcEditTags.value = (existingTc.tags ?? []).join(', ');
		el.tcEditViewport.value = existingTc.viewport ?? '';
		// Multi-select viewports
		if (el.tcEditViewports) {
			const vps = existingTc.viewports ?? [];
			for (const opt of el.tcEditViewports.options) {
				opt.selected = vps.includes(opt.value);
			}
		}
		el.tcEditPrecond.value = (existingTc.preconditions ?? []).join('\n');
		state.editorSteps = (existingTc.steps ?? []).map(s => ({ ...s }));
		state.editorAssertions = (existingTc.assertions ?? []).map(a => ({ ...a }));
	} else {
		el.tcEditorTitle.textContent = 'New Test Case';
		el.tcEditName.value = '';
		el.tcEditSeverity.value = 'medium';
		el.tcEditUrl.value = state.session?.targetUrl ?? '';
		el.tcEditSuite.value = '';
		el.tcEditTags.value = '';
		el.tcEditViewport.value = '';
		if (el.tcEditViewports) {
			for (const opt of el.tcEditViewports.options) opt.selected = false;
		}
		el.tcEditPrecond.value = '';
		state.editorSteps = [];
		state.editorAssertions = [];
	}

	renderEditorSteps();
	renderEditorAssertions();
	el.tcEditor.showModal();
}

/** Renders the step editor rows. */
function renderEditorSteps() {
	el.tcStepsList.replaceChildren();
	for (const [i, step] of state.editorSteps.entries()) {
		const row = document.createElement('div');
		row.className = 'tc-edit-step';

		const num = document.createElement('span');
		num.className = 'tc-edit-step-num';
		num.textContent = String(i + 1);

		const actionSel = document.createElement('select');
		actionSel.className = 'tc-edit-field';
		for (const a of STEP_ACTIONS) {
			const opt = document.createElement('option');
			opt.value = a;
			opt.textContent = a;
			if (step.action === a) opt.selected = true;
			actionSel.append(opt);
		}
		actionSel.onchange = () => { step.action = actionSel.value; };

		const targetInput = document.createElement('input');
		targetInput.type = 'text';
		targetInput.className = 'tc-edit-field';
		targetInput.placeholder = 'CSS selector / URL';
		targetInput.value = step.target ?? '';
		targetInput.oninput = () => { step.target = targetInput.value; };

		const valueInput = document.createElement('input');
		valueInput.type = 'text';
		valueInput.className = 'tc-edit-field';
		valueInput.placeholder = 'Value';
		valueInput.value = step.value ?? '';
		valueInput.oninput = () => { step.value = valueInput.value; };

		const descInput = document.createElement('input');
		descInput.type = 'text';
		descInput.className = 'tc-edit-field tc-edit-desc';
		descInput.placeholder = 'Description';
		descInput.value = step.description ?? '';
		descInput.oninput = () => { step.description = descInput.value; };

		// Move up / down / delete
		const upBtn = document.createElement('button');
		upBtn.type = 'button';
		upBtn.className = 'btn btn-ghost btn-sm tc-step-move';
		upBtn.textContent = '↑';
		upBtn.title = 'Move up';
		upBtn.disabled = i === 0;
		upBtn.onclick = () => {
			if (i > 0) {
				[state.editorSteps[i - 1], state.editorSteps[i]] = [state.editorSteps[i], state.editorSteps[i - 1]];
				renderEditorSteps();
			}
		};

		const downBtn = document.createElement('button');
		downBtn.type = 'button';
		downBtn.className = 'btn btn-ghost btn-sm tc-step-move';
		downBtn.textContent = '↓';
		downBtn.title = 'Move down';
		downBtn.disabled = i === state.editorSteps.length - 1;
		downBtn.onclick = () => {
			if (i < state.editorSteps.length - 1) {
				[state.editorSteps[i + 1], state.editorSteps[i]] = [state.editorSteps[i], state.editorSteps[i + 1]];
				renderEditorSteps();
			}
		};

		const delBtn = document.createElement('button');
		delBtn.type = 'button';
		delBtn.className = 'btn btn-ghost btn-sm tc-step-del';
		delBtn.textContent = '✕';
		delBtn.title = 'Remove step';
		delBtn.onclick = () => {
			state.editorSteps.splice(i, 1);
			renderEditorSteps();
		};

		row.append(num, actionSel, targetInput, valueInput, descInput, upBtn, downBtn, delBtn);
		el.tcStepsList.append(row);
	}
}

/** Renders the assertion editor rows. */
function renderEditorAssertions() {
	el.tcAssertionsList.replaceChildren();
	for (const [i, assertion] of state.editorAssertions.entries()) {
		const row = document.createElement('div');
		row.className = 'tc-edit-assertion';

		const num = document.createElement('span');
		num.className = 'tc-edit-step-num';
		num.textContent = String(i + 1);

		const typeSel = document.createElement('select');
		typeSel.className = 'tc-edit-field';
		for (const t of ASSERTION_TYPES) {
			const opt = document.createElement('option');
			opt.value = t;
			opt.textContent = t;
			if (assertion.type === t) opt.selected = true;
			typeSel.append(opt);
		}
		typeSel.onchange = () => { assertion.type = typeSel.value; };

		const targetInput = document.createElement('input');
		targetInput.type = 'text';
		targetInput.className = 'tc-edit-field';
		targetInput.placeholder = 'Selector / URL';
		targetInput.value = assertion.target ?? '';
		targetInput.oninput = () => { assertion.target = targetInput.value; };

		const expectedInput = document.createElement('input');
		expectedInput.type = 'text';
		expectedInput.className = 'tc-edit-field';
		expectedInput.placeholder = 'Expected value';
		expectedInput.value = assertion.expected ?? '';
		expectedInput.oninput = () => { assertion.expected = expectedInput.value; };

		const descInput = document.createElement('input');
		descInput.type = 'text';
		descInput.className = 'tc-edit-field tc-edit-desc';
		descInput.placeholder = 'Description';
		descInput.value = assertion.description ?? '';
		descInput.oninput = () => { assertion.description = descInput.value; };

		const delBtn = document.createElement('button');
		delBtn.type = 'button';
		delBtn.className = 'btn btn-ghost btn-sm tc-step-del';
		delBtn.textContent = '✕';
		delBtn.title = 'Remove assertion';
		delBtn.onclick = () => {
			state.editorAssertions.splice(i, 1);
			renderEditorAssertions();
		};

		row.append(num, typeSel, targetInput, expectedInput, descInput, delBtn);
		el.tcAssertionsList.append(row);
	}
}

// Editor event wiring.
el.btnNewTestcase.onclick = () => openTcEditor(null);

el.btnNewSuite.onclick = async () => {
	const name = prompt('Suite name:', '');
	if (!name?.trim()) return;
	try {
		const projectId = state.session?.projectId ?? state.projectId;
		await api('/suites', {
			method: 'POST',
			body: JSON.stringify({ name: name.trim(), projectId })
		});
		const params = new URLSearchParams();
		if (projectId) params.set('projectId', projectId);
		state.suites = await api(`/suites${params.toString() ? `?${params}` : ''}`);
		renderSuiteTree();
		toast(`Suite "${name.trim()}" created.`, 'good');
	} catch (error) {
		fail(error);
	}
};

el.tcAddStep.onclick = () => {
	state.editorSteps.push({ action: 'click', target: '', value: '', description: '' });
	renderEditorSteps();
};

el.tcAddAssertion.onclick = () => {
	state.editorAssertions.push({ type: 'element_visible', target: '', expected: '', description: '' });
	renderEditorAssertions();
};

el.tcEditorClose.onclick = () => el.tcEditor.close();

el.tcEditorSave.onclick = async () => {
	const name = el.tcEditName.value.trim();
	if (!name) {
		toast('Test case name is required.', 'bad');
		return;
	}

	const data = {
		name,
		severity: el.tcEditSeverity.value,
		targetUrl: el.tcEditUrl.value.trim(),
		suiteId: el.tcEditSuite.value || null,
		tags: el.tcEditTags.value.split(',').map(t => t.trim()).filter(Boolean),
		viewport: el.tcEditViewport.value || null,
		viewports: el.tcEditViewports ? Array.from(el.tcEditViewports.selectedOptions).map(o => o.value) : [],
		preconditions: el.tcEditPrecond.value.split('\n').map(p => p.trim()).filter(Boolean),
		steps: state.editorSteps,
		assertions: state.editorAssertions
	};

	try {
		el.tcEditorSave.disabled = true;
		el.tcEditorSave.textContent = 'Saving…';

		if (state.editingTc) {
			// Update existing.
			const updated = await api(`/test-cases/${state.editingTc.id}`, {
				method: 'PUT',
				body: JSON.stringify(data)
			});
			const idx = state.testCases.findIndex(tc => tc.id === state.editingTc.id);
			if (idx !== -1) state.testCases[idx] = updated;
			toast(`Updated "${updated.name}".`, 'good');
		} else {
			// Create new.
			const tc = await api('/test-cases', {
				method: 'POST',
				body: JSON.stringify({
					...data,
					projectId: state.session?.projectId ?? state.projectId
				})
			});
			state.testCases.unshift(tc);
			toast(`Created "${tc.name}".`, 'good');
		}

		el.tcEditor.close();
		renderTestCases();
		} catch (error) {
		fail(error);
	} finally {
		el.tcEditorSave.disabled = false;
		el.tcEditorSave.textContent = 'Save';
	}
};

/* ── Regression Schedules ───────────────────────────────────────── */

export { loadTestCases, renderTestCases, initTestsWiring };
