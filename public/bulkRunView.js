/**
 * Bulk Runs wizard (Phase 11): 3 steps — what to run, where, auto-calculated
 * summary with a single [Run N Tests] button. Runs are created sequentially
 * through POST /api/sessions; failures are reported per pair, not fatal.
 */

import { wizardSummary } from './qaWorkflows.js';

export function pairsToRun(cases, environmentSelection) {
	/** environmentSelection: 'all' (each case uses all assigned envs) or a single envId. */
	const pairs = [];
	for (const testCase of cases) {
		const envs = testCase.environmentIds ?? [];
		if (environmentSelection === 'all') {
			for (const envId of envs) pairs.push({ testCase, envId });
		} else if (envs.includes(environmentSelection)) {
			pairs.push({ testCase, envId: environmentSelection });
		}
	}
	return pairs;
}

import { createDeviceChipList } from './devicePicker.js';

export function createBulkRunView({ api, toast, fail, elements, presets, onLaunch }) {
	const {
		dialog, navButton, close,
		what, casesField, casesSelect, where, envsField, deviceChips, addDeviceBtn,
		preview, launchBtn, result,
		steps
	} = elements;
	if (!dialog) return { open() {}, refresh() {} };

	/** TEST ON DEVICES chip list (DX Phase 4) — replaces the Ctrl/Cmd multi-select. */
	const state = { cases: [], environments: [], environmentsById: new Map(), lastRuns: new Map(), step: 1 };
	const deviceList = createDeviceChipList({
		container: deviceChips,
		addBtn: addDeviceBtn,
		environmentsById: (id) => state.environmentsById.get(id),
		onChange: () => renderPreview()
	});

	function showStep(n) {
		state.step = n;
		for (const step of steps ?? []) {
			const num = Number(step.dataset.bulkStep);
			step.hidden = num !== n;
			step.classList.toggle('is-active', num === n);
		}
	}

	function open() {
		dialog.showModal();
		showStep(1);
		void refresh();
	}
	if (navButton) navButton.addEventListener('click', open);
	if (close) close.addEventListener('click', () => dialog.close());

	async function refresh() {
		try {
			const [casePayload, envPayload, sessionPayload] = await Promise.all([
				api('/test-cases'),
				api('/environments?active=true&limit=1000'),
				api('/sessions?limit=100').catch(() => [])
			]);
			state.cases = Array.isArray(casePayload?.testCases) ? casePayload.testCases : [];
			state.environments = Array.isArray(envPayload?.environments) ? envPayload.environments : [];
			state.environmentsById = new Map(state.environments.map((e) => [e.envId, e]));
			const sessions = Array.isArray(sessionPayload) ? sessionPayload : [];
			// Rebuild the case → last-run map from qaWorkflows (imported lazily
			// through the module-level binding set by app.js wiring).
			state.lastRuns = lastRunIndex(sessions);
			renderCases();
			deviceList.set(deviceList.ids); // re-resolve chip labels against fresh envs
			renderPreview();
		} catch (error) {
			fail(error);
		}
	}

	/** Injected by app.js: reuses the qaWorkflows.lastRunByCase helper. */
	let lastRunIndex = (sessions) => new Map();
	function setLastRunIndex(fn) { lastRunIndex = fn; }

	function casesForWhat() {
		const mode = what?.value ?? 'all';
		if (mode === 'selected') {
			const chosen = [...(casesSelect?.selectedOptions ?? [])].map((o) => state.cases.find((c) => c.caseNumber === o.value)).filter(Boolean);
			return chosen;
		}
		return wizardFilter(mode);
	}

	/** Injected: qaWorkflows.filterCasesForWizard with the current last-run map. */
	let wizardFilter = () => state.cases;
	function setWizardFilter(fn) { wizardFilter = fn; }

	function resolvedPairs() {
		const cases = casesForWhat();
		const mode = where?.value ?? 'assigned';
		if (mode === 'assigned') return pairsToRun(cases, 'all');
		if (mode === 'default') {
			const envId = state.defaultEnvId ?? '';
			return envId ? cases.flatMap((testCase) => (testCase.environmentIds ?? []).includes(envId) ? [{ testCase, envId }] : []) : [];
		}
		const chosen = deviceList.ids;
		return cases.flatMap((testCase) => chosen.filter((id) => (testCase.environmentIds ?? []).includes(id)).map((envId) => ({ testCase, envId })));
	}

	function renderCases() {
		if (!casesSelect) return;
		const selected = new Set([...casesSelect.selectedOptions].map((o) => o.value));
		casesSelect.innerHTML = '';
		for (const testCase of state.cases) {
			const option = document.createElement('option');
			option.value = testCase.caseNumber;
			option.textContent = `${testCase.caseNumber} — ${testCase.title} (${(testCase.environmentIds ?? []).length} envs)`;
			option.selected = selected.has(testCase.caseNumber);
			casesSelect.append(option);
		}
	}

	// DX Phase 4: renderEnvs() replaced by the TEST ON DEVICES chip list.
	function renderPreview() {
		if (!preview) return;
		const pairs = resolvedPairs();
		const tests = new Set(pairs.map((p) => p.testCase.caseNumber)).size;
		const devices = new Set(pairs.map((p) => p.envId)).size;
		preview.innerHTML = '';
		if (!pairs.length) {
			preview.textContent = what?.value === 'failed'
				? 'No failed runs — nothing to re-run.'
				: 'Nothing to run yet — choose tests and devices.';
			launchBtn.disabled = true;
			launchBtn.textContent = 'Run tests';
			return;
		}
		const summary = wizardSummary(tests, devices);
		const line = document.createElement('div');
		line.textContent = `Tests: ${summary.tests} · Devices: ${summary.devices} · Total executions: ${summary.total}`;
		preview.append(line);
		if (summary.warn) {
			const warn = document.createElement('div');
			warn.className = 'bulk-warn';
			warn.textContent = summary.warnText;
			preview.append(warn);
		}
		launchBtn.disabled = false;
		launchBtn.textContent = `Run ${summary.total} test${summary.total === 1 ? '' : 's'}`;
	}

	// Wiring
	if (what) {
		what.addEventListener('change', () => {
			if (casesField) casesField.hidden = what.value !== 'selected';
			renderPreview();
		});
	}
	if (where) {
		where.addEventListener('change', () => {
			if (envsField) envsField.hidden = where.value !== 'pick';
			renderPreview();
		});
	}
	if (casesSelect) casesSelect.addEventListener('change', renderPreview);
	for (const next of dialog.querySelectorAll('[data-bulk-next]')) {
		next.addEventListener('click', () => showStep(Number(next.dataset.bulkNext)));
	}
	for (const back of dialog.querySelectorAll('[data-bulk-back]')) {
		back.addEventListener('click', () => showStep(Number(back.dataset.bulkBack)));
	}

	if (launchBtn) launchBtn.addEventListener('click', async () => {
		const pairs = resolvedPairs();
		if (!pairs.length) {
			toast('Nothing selected — pick at least one test case and device.', 'bad');
			return;
		}
		// Delegate to the shared launcher when available: it records the batch
		// for per-environment progress (executions list with honest levels).
		if (typeof onLaunch === 'function') {
			launchBtn.disabled = true;
			launchBtn.textContent = `Launching ${pairs.length} runs…`;
			try {
				const { created, failures } = await onLaunch(pairs, 'Bulk run: ');
				if (result) {
					result.hidden = false;
					result.textContent = failures.length
						? `${created} created, ${failures.length} failed:\n${failures.join('\n')}`
						: `${created} run${created === 1 ? '' : 's'} created.`;
				}
			} finally {
				launchBtn.disabled = false;
				renderPreview();
			}
			return;
		}
		launchBtn.disabled = true;
		launchBtn.textContent = `Launching ${pairs.length} runs…`;
		const failures = [];
		let created = 0;
		for (const { testCase, envId } of pairs) {
			try {
				await api('/sessions', { method: 'POST', body: JSON.stringify({ testCaseId: testCase.caseNumber, environmentId: envId }) });
				created += 1;
			} catch (error) {
				failures.push(`${testCase.caseNumber} @ ${envId}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		launchBtn.disabled = false;
		renderPreview();
		if (result) {
			result.hidden = false;
			result.textContent = failures.length
				? `${created} created, ${failures.length} failed:\n${failures.join('\n')}`
				: `${created} run${created === 1 ? '' : 's'} created.`;
		}
		toast(failures.length ? `${created} launched, ${failures.length} failed.` : `${created} run${created === 1 ? '' : 's'} launched.`);
	});

	/** Presets hand-off: preset → environments → jump to step 3 pre-resolved. */
	function applyPreset(presetId) {
		const envs = presets?.environmentsFor?.(presetId) ?? [];
		if (!envs.length) {
			toast('No environments match this preset yet — create some in Choose devices.', 'bad');
			return false;
		}
		if (where) {
			where.value = 'pick';
			if (envsField) envsField.hidden = false;
		}
		deviceList.set(envs.map((e) => e.envId));
		if (what) what.value = 'all';
		if (casesField) casesField.hidden = true;
		renderPreview();
		showStep(3);
		return true;
	}

	// Public surface used by app.js quick actions.
	return {
		open, refresh,
		runPreset: applyPreset,
		setWizardFilter, setLastRunIndex,
		setDefaultEnvId(envId) { state.defaultEnvId = envId; },
		get state() { return state; },
		get deviceList() { return deviceList; }
	};
}

