/**
 * Qase — Schedules module (Phase 16C).
 *
 * Project-scoped regression schedule management page:
 *   - Pass rate trend chart
 *   - Create / edit / delete schedules
 *   - Toggle enable/disable
 *   - Run Now (manual trigger)
 *
 * Replaces the hidden #regression-pane logic from app.js with a
 * dedicated page that works without a session context.
 */

import { el, state, api, toast, fail, CRON_PRESETS, hostOf, relativeTime, showPageLoading, showPageError, clearPageState } from './shared.js';

/* ── State ───────────────────────────────────────────────────────── */

const schedState = {
	schedules: [],
	trend: [],
	showForm: false
};

/* ── Loading ─────────────────────────────────────────────────────── */

async function loadSchedulesPage() {
	const container = el.schedulesList;
	const firstLoad = !schedState.loaded;
	if (firstLoad) showPageLoading(container);
	const projectId = state.projectId;
	const pq = projectId ? `?projectId=${projectId}` : '';
	let failed = null;
	try {
		schedState.schedules = await api(`/schedules${pq}`);
	} catch (error) {
		schedState.schedules = [];
		failed = error;
	}
	try {
		schedState.trend = await api(`/regression/trend?limit=15${projectId ? `&projectId=${projectId}` : ''}`);
	} catch {
		schedState.trend = [];
	}
	schedState.loaded = true;
	if (failed && firstLoad) {
		// BUILD 1: a failed load must not look like "No schedules yet".
		showPageError(container, loadSchedulesPage, `Could not load schedules — ${failed?.message ?? 'server unreachable'}.`);
		return;
	}
	clearPageState(container);
	renderSchedulesPage();
}

/* ── Rendering ───────────────────────────────────────────────────── */

function renderSchedulesPage() {
	renderSchedulesStats();
	renderTrendSection();
	renderSchedulesList();
}

function renderSchedulesStats() {
	const total = schedState.schedules.length;
	const active = schedState.schedules.filter(s => s.enabled).length;
	const totalTests = schedState.schedules.reduce((sum, s) => sum + (s.testCaseIds?.length || 0), 0);
	el.schedulesStats.replaceChildren();
	const chips = [
		{ label: 'Schedules', value: total },
		{ label: 'Active', value: active },
		{ label: 'Test cases', value: totalTests }
	];
	for (const chip of chips) {
		const span = document.createElement('span');
		span.className = 'stat-chip';
		span.innerHTML = `<strong>${chip.value}</strong> ${chip.label}`;
		el.schedulesStats.append(span);
	}
}

function renderTrendSection() {
	el.schedulesTrend.replaceChildren();

	if (schedState.trend.length === 0) {
		return;
	}

	const heading = document.createElement('div');
	heading.className = 'schedules-section-title';
	heading.textContent = 'Pass Rate Trend';
	el.schedulesTrend.append(heading);

	const chart = document.createElement('div');
	chart.className = 'sched-chart';

	for (const point of schedState.trend) {
		const bar = document.createElement('div');
		bar.className = 'sched-chart-bar';

		const noTests = !point.total;
		const pct = point.passRate;
		const color = noTests ? '#5e5e6a' /* stale / no tests recorded */
			: pct >= 80 ? '#30d158'
			: pct >= 50 ? '#ff9f0a'
			: '#ff453a';

		const fill = document.createElement('div');
		fill.className = 'sched-chart-fill';
		fill.style.height = noTests ? '100%' : `${Math.max(pct, 3)}%`;
		fill.style.background = color;
		if (noTests) fill.style.opacity = '0.25';

		const label = document.createElement('div');
		label.className = 'sched-chart-label';
		label.textContent = noTests ? '—' : pct + '%';

		bar.append(fill, label);
		bar.title = noTests
			? `${new Date(point.ts).toLocaleString()}\nno tests recorded (stale run against an unreachable target — excluded from pass rate)`
			: `${new Date(point.ts).toLocaleString()}\n${point.passed}/${point.total} passed (${pct}%)${point.flaky ? `\n${point.flaky} flaky` : ''}`;
		chart.append(bar);
	}

	const legend = document.createElement('div');
	legend.className = 'sched-chart-legend';
	legend.innerHTML = '<span style="color:#30d158">■ ≥80%</span> <span style="color:#ff9f0a">■ ≥50%</span> <span style="color:#ff453a">■ <50%</span> <span style="color:#8e8e99">■ no tests recorded (stale)</span>';

	el.schedulesTrend.append(chart, legend);
}

function renderSchedulesList() {
	const container = el.schedulesList;
	container.replaceChildren();

	if (schedState.showForm) {
		container.append(buildScheduleForm());
	}

	if (schedState.schedules.length === 0 && !schedState.showForm) {
		const empty = document.createElement('div');
		empty.className = 'sched-empty';
		empty.innerHTML = '<p>No schedules yet.</p><small>Create a schedule to auto-run test suites on a recurring basis.</small>';
		container.append(empty);
		return;
	}

	const heading = document.createElement('div');
	heading.className = 'schedules-section-title';
	heading.textContent = `Schedules (${schedState.schedules.length})`;
	container.append(heading);

	for (const sched of schedState.schedules) {
		container.append(renderScheduleCard(sched));
	}
}

function renderScheduleCard(sched) {
	const card = document.createElement('div');
	card.className = `sched-card ${sched.enabled ? '' : 'is-disabled'}`;

	// Header row
	const header = document.createElement('div');
	header.className = 'sched-card-header';

	const left = document.createElement('div');
	left.className = 'sched-card-left';

	const name = document.createElement('span');
	name.className = 'sched-card-name';
	name.textContent = sched.name;

	// Enable/disable toggle
	const toggleLabel = document.createElement('label');
	toggleLabel.className = 'reg-toggle';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.checked = sched.enabled;
	checkbox.onchange = async () => {
		try {
			await api(`/schedules/${sched.id}`, {
				method: 'PUT',
				body: JSON.stringify({ enabled: checkbox.checked })
			});
			card.classList.toggle('is-disabled', !checkbox.checked);
			renderSchedulesStats();
			toast(`Schedule ${checkbox.checked ? 'enabled' : 'disabled'}.`, 'good');
		} catch (error) {
			fail(error);
			checkbox.checked = !checkbox.checked;
		}
	};
	const slider = document.createElement('span');
	slider.className = 'reg-toggle-slider';
	toggleLabel.append(checkbox, slider);

	left.append(name, toggleLabel);
	header.append(left);
	card.append(header);

	// Meta line
	const meta = document.createElement('div');
	meta.className = 'sched-card-meta';
	const parts = [];
	parts.push(`⏰ ${sched.cronExpr}`);
	if (sched.testCaseIds?.length) {
		parts.push(`${sched.testCaseIds.length} test${sched.testCaseIds.length === 1 ? '' : 's'}`);
	}
	if (sched.targetUrl) {
		parts.push(hostOf(sched.targetUrl));
	}
	if (sched.lastRun && sched.lastRun.ts) {
		const r = sched.lastRun;
		const icon = r.result === 'pass' ? '✅' : r.result === 'fail' ? '❌' : '⚠️';
		parts.push(`last: ${icon} ${relativeTime(r.ts)}`);
	}
	if (sched.nextRun && sched.enabled) {
		parts.push(`next: ${relativeTime(sched.nextRun)}`);
	}
	meta.textContent = parts.join(' · ');
	card.append(meta);

	// Actions
	const actions = document.createElement('div');
	actions.className = 'sched-card-actions';

	const runBtn = document.createElement('button');
	runBtn.className = 'btn btn-ghost btn-sm';
	runBtn.textContent = '▶ Run Now';
	runBtn.onclick = async () => {
		try {
			runBtn.disabled = true;
			runBtn.textContent = 'Running…';
			const summary = await api(`/schedules/${sched.id}/run`, { method: 'POST' });
			let msg = `${sched.name}: ${summary.passed}/${summary.total} passed`;
			if (summary.flaky) msg += `, ${summary.flaky} flaky`;
			toast(msg, summary.failed + summary.errored === 0 ? 'good' : 'bad');
			// Reload everything
			await loadSchedulesPage();
		} catch (error) {
			fail(error);
		} finally {
			runBtn.disabled = false;
			runBtn.textContent = '▶ Run Now';
		}
	};

	const delBtn = document.createElement('button');
	delBtn.className = 'btn btn-ghost btn-sm sched-card-del';
	delBtn.textContent = '🗑';
	delBtn.title = 'Delete schedule';
	delBtn.onclick = async () => {
		try {
			await api(`/schedules/${sched.id}`, { method: 'DELETE' });
			schedState.schedules = schedState.schedules.filter(s => s.id !== sched.id);
			renderSchedulesPage();
			toast(`Deleted "${sched.name}".`, 'good');
		} catch (error) {
			fail(error);
		}
	};

	actions.append(runBtn, delBtn);
	card.append(actions);

	return card;
}

/* ── Create Schedule Form ────────────────────────────────────────── */

function buildScheduleForm() {
	const wrap = document.createElement('div');
	wrap.className = 'sched-form-card';

	const heading = document.createElement('div');
	heading.className = 'schedules-section-title';
	heading.textContent = 'New Schedule';
	wrap.append(heading);

	// Name
	const nameLabel = document.createElement('label');
	nameLabel.className = 'sched-field';
	nameLabel.innerHTML = '<span>Name</span>';
	const nameInput = document.createElement('input');
	nameInput.type = 'text';
	nameInput.placeholder = 'e.g. Daily Smoke Test';
	nameInput.className = 'sched-input';
	nameLabel.append(nameInput);

	// Cron presets
	const cronRow = document.createElement('div');
	cronRow.className = 'sched-field-row';

	const cronLabel = document.createElement('label');
	cronLabel.className = 'sched-field';
	cronLabel.innerHTML = '<span>Cron expression</span>';
	const cronSelect = document.createElement('select');
	cronSelect.className = 'sched-input';
	for (const preset of CRON_PRESETS) {
		const opt = document.createElement('option');
		opt.value = preset.value;
		opt.textContent = preset.label;
		cronSelect.append(opt);
	}
	cronLabel.append(cronSelect);

	// Custom cron
	const customLabel = document.createElement('label');
	customLabel.className = 'sched-field';
	customLabel.innerHTML = '<span>Custom cron</span>';
	const customCron = document.createElement('input');
	customCron.type = 'text';
	customCron.placeholder = '0 9 * * 1,4';
	customCron.className = 'sched-input';
	customCron.style.display = 'none';
	customLabel.append(customCron);

	const customToggle = document.createElement('label');
	customToggle.className = 'sched-custom-toggle';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	const toggleText = document.createElement('span');
	toggleText.textContent = ' Custom';
	customToggle.append(checkbox, toggleText);
	checkbox.onchange = () => {
		customCron.style.display = checkbox.checked ? 'block' : 'none';
		cronSelect.style.display = checkbox.checked ? 'none' : 'block';
	};

	cronRow.append(cronLabel, customToggle, customLabel);

	// Suite selector
	const suiteLabel = document.createElement('label');
	suiteLabel.className = 'sched-field';
	suiteLabel.innerHTML = '<span>Test cases</span>';
	const suiteSelect = document.createElement('select');
	suiteSelect.className = 'sched-input';
	const allOpt = document.createElement('option');
	allOpt.value = '';
	allOpt.textContent = 'All test cases';
	suiteSelect.append(allOpt);
	for (const suite of state.suites) {
		const opt = document.createElement('option');
		opt.value = suite.id;
		opt.textContent = suite.name;
		suiteSelect.append(opt);
	}
	suiteLabel.append(suiteSelect);

	// Target URL
	const urlLabel = document.createElement('label');
	urlLabel.className = 'sched-field';
	urlLabel.innerHTML = '<span>Target URL (optional)</span>';
	const urlInput = document.createElement('input');
	urlInput.type = 'text';
	urlInput.placeholder = 'https://example.com';
	urlInput.className = 'sched-input';
	urlInput.value = state.session?.targetUrl ?? '';
	urlLabel.append(urlInput);

	// Buttons
	const btnRow = document.createElement('div');
	btnRow.className = 'sched-form-actions';

	const createBtn = document.createElement('button');
	createBtn.className = 'btn btn-primary btn-sm';
	createBtn.textContent = 'Create Schedule';

	const cancelBtn = document.createElement('button');
	cancelBtn.className = 'btn btn-ghost btn-sm';
	cancelBtn.textContent = 'Cancel';
	cancelBtn.onclick = () => {
		schedState.showForm = false;
		renderSchedulesList();
	};

	createBtn.onclick = async () => {
		const cron = checkbox.checked ? customCron.value.trim() : cronSelect.value;
		if (!nameInput.value.trim()) {
			toast('Enter a schedule name.', 'bad');
			return;
		}
		try {
			createBtn.disabled = true;
			createBtn.textContent = 'Creating…';

			// Determine test case IDs
			let testCaseIds = state.testCases.map(tc => tc.id);
			if (suiteSelect.value) {
				testCaseIds = state.testCases.filter(tc => tc.suiteId === suiteSelect.value).map(tc => tc.id);
			}

			await api('/schedules', {
				method: 'POST',
				body: JSON.stringify({
					name: nameInput.value.trim(),
					cronExpr: cron,
					targetUrl: urlInput.value.trim(),
					projectId: state.projectId,
					testCaseIds
				})
			});

			schedState.showForm = false;
			toast('Schedule created.', 'good');
			await loadSchedulesPage();
		} catch (error) {
			fail(error);
		} finally {
			createBtn.disabled = false;
			createBtn.textContent = 'Create Schedule';
		}
	};

	btnRow.append(createBtn, cancelBtn);

	wrap.append(nameLabel, cronRow, suiteLabel, urlLabel, btnRow);
	return wrap;
}

/* ── Wiring ──────────────────────────────────────────────────────── */

function initSchedulesWiring() {
	if (el.btnNewSchedule) {
		el.btnNewSchedule.onclick = () => {
			schedState.showForm = true;
			renderSchedulesList();
		};
	}
}

export { loadSchedulesPage, renderSchedulesPage, initSchedulesWiring };
