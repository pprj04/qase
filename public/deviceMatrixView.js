/**
 * Apple Device Matrix UI (Phase 3).
 *
 * Self-contained module that renders the Device Matrix dialog: a catalog browser
 * (devices × OS versions × browsers with facet counts and search), an environment
 * builder with multi-select bulk creation, environment CRUD + enable/disable, and
 * data-driven catalog forms to add new devices / OS versions / browser versions
 * without code changes.
 *
 * Deliberately DOM-framework-free to match the vanilla-JS dashboard. Pure helper
 * functions are exported separately so they can be unit-tested without a DOM.
 */

/** @typedef {{slug:string, display:string, osVersionId:string}} CompatOs */

/**
 * Expand a multi-selection of devices × OS versions × browser versions into
 * candidate environment combinations. Cross-product — validity is checked
 * server-side via /api/catalog/validate (and per-model compat lookups).
 */
export function expandSelection(selection) {
	const { devices = [], osVersions = [], browsers = [] } = selection ?? {};
	const combos = [];
	for (const device of devices) {
		for (const os of osVersions) {
			for (const browser of browsers) {
				combos.push({ device: device.slug, deviceDisplay: device.display, osVersion: os.id, osDisplay: os.display, browser: browser.code, browserVersion: browser.version, browserDisplay: browser.display });
			}
		}
	}
	return combos;
}

/** Truncate a combination list for display ("3 more…"). */
export function summarizeCombos(combos, limit = 5) {
	if (combos.length <= limit) return combos;
	return [...combos.slice(0, limit), { summaryOnly: true, remaining: combos.length - limit }];
}

/**
 * Group environments for the bulk table by device, keeping insertion order of
 * the input list. Returns [{ device, rows: [env, …] }].
 */
export function groupEnvironmentsByDevice(environments = []) {
	const groups = new Map();
	for (const env of environments) {
		const key = env.device ?? 'Unknown device';
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(env);
	}
	return [...groups.entries()].map(([device, rows]) => ({ device, rows }));
}

/** Debounce helper used for catalog search inputs. */
export function debounce(fn, ms = 250) {
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
}

export function createDeviceMatrixView({ api, toast, fail, elements }) {
	const state = {
		catalog: { deviceCategories: [], deviceModels: [], osVersions: [], browsers: [], browserVersions: {} },
		facets: {},
		selection: { devices: new Set(), osVersions: new Set(), browsers: new Set() },
		environments: [],
		total: 0,
		filters: { platform: '', category: '', browser: '', active: '', search: '' },
		page: 0,
		pageSize: 50
	};
	const { dialog, navButton, tabs } = elements;
	let currentTab = 'browse';
	const fire = debounce(refreshFacets, 200);

	function open() {
		if (!dialog.open) dialog.showModal();
		void loadCatalog().then(() => { refreshAll(); });
	}

	async function loadCatalog() {
		const [categories, models, osVersions, browsers] = await Promise.all([
			api('/catalog/deviceCategories').catch(() => ({ rows: [] })),
			api('/catalog/deviceModels').catch(() => ({ rows: [] })),
			api('/catalog/osVersions').catch(() => ({ rows: [] })),
			api('/catalog/browsers').catch(() => ({ rows: [] }))
		]);
		state.catalog.deviceCategories = categories.rows ?? [];
		state.catalog.deviceModels = models.rows ?? [];
		state.catalog.osVersions = osVersions.rows ?? [];
		state.catalog.browsers = browsers.rows ?? [];
		// Browser versions (dimension in its own right): fetch the version list
		// per browser lazily when a browser is first selected.
	}

	async function loadBrowserVersions(browserId) {
		if (state.catalog.browserVersions[browserId]) return state.catalog.browserVersions[browserId];
		const payload = await api(`/catalog/browsers/${encodeURIComponent(browserId)}/versions`).catch(() => ({ rows: [] }));
		state.catalog.browserVersions[browserId] = payload.rows ?? [];
		return state.catalog.browserVersions[browserId];
	}

	function refreshAll() {
		refreshFacets();
		refreshEnvironments();
		if (currentTab === 'browse') renderBrowse();
		if (currentTab === 'builder') renderBuilder();
		if (currentTab === 'environments') renderEnvironments();
	}

	async function refreshFacets() {
		const payload = await api('/catalog/facets').catch(() => null);
		state.facets = payload ?? {};
		const target = elements.facetSummary;
		if (!target || !payload) return;
		target.textContent = `${payload.totalDeviceModels} device models · ${payload.totalOsVersions} OS versions · ${payload.totalBrowsers} browsers in the catalog.`;
	}

	function categoryOf(model) {
		return state.catalog.deviceCategories.find((c) => c.id === model.category_id) ?? null;
	}

	// ── Browse tab ─────────────────────────────────────────────────────────
	function renderBrowse() {
		const { browseList, browseSearch } = elements;
		browseList.innerHTML = '';
		const term = (browseSearch?.value ?? '').trim().toLowerCase();
		const models = state.catalog.deviceModels
			.filter((m) => !state.filters.category || m.category_id === state.filters.category)
			.filter((m) => !term || `${m.display_name} ${m.id}`.toLowerCase().includes(term));
		for (const model of models) {
			const category = categoryOf(model);
			const card = document.createElement('article');
			card.className = 'dm-card';
			card.dataset.modelId = model.id;
			const head = document.createElement('header');
			const title = document.createElement('strong');
			title.textContent = model.display_name;
			const meta = document.createElement('small');
			meta.textContent = `${category?.display_name ?? model.category_id} · ${model.release_year ?? ''}`;
			head.append(title, meta);
			const actions = document.createElement('div');
			actions.className = 'dm-card-actions';
			const osButton = document.createElement('button');
			osButton.type = 'button';
			osButton.className = 'btn btn-ghost btn-sm';
			osButton.textContent = 'OS versions';
			osButton.onclick = () => loadModelOs(model, card);
			const pick = document.createElement('button');
			pick.type = 'button';
			pick.className = 'btn btn-sm';
			pick.textContent = state.selection.devices.has(model.id) ? '✓ selected' : 'select';
			pick.onclick = () => {
				if (state.selection.devices.has(model.id)) state.selection.devices.delete(model.id);
				else state.selection.devices.add(model.id);
				pick.textContent = state.selection.devices.has(model.id) ? '✓ selected' : 'select';
			};
			actions.append(osButton, pick);
			card.append(head, actions);
			browseList.append(card);
		}
		if (!models.length) {
			const empty = document.createElement('p');
			empty.className = 'dm-empty';
			empty.textContent = 'No device models match. Add one from the Catalog forms tab.';
			browseList.append(empty);
		}
		fillCategoryFilter();
	}

	async function loadModelOs(model, card) {
		const existing = card.querySelector('.dm-os-list');
		if (existing) { existing.remove(); return; }
		const payload = await api(`/catalog/deviceModels/${encodeURIComponent(model.id)}/osVersions`).catch(() => ({ rows: [] }));
		const listEl = document.createElement('ul');
		listEl.className = 'dm-os-list';
		for (const os of payload.rows ?? []) {
			const li = document.createElement('li');
			li.textContent = os.display ?? os.id;
			listEl.append(li);
		}
		if (!listEl.children.length) {
			const li = document.createElement('li');
			li.textContent = 'No compatible OS versions recorded.';
			listEl.append(li);
		}
		card.append(listEl);
	}

	function fillCategoryFilter() {
		const select = elements.browseCategory;
		if (!select) return;
		const current = select.value;
		select.innerHTML = '<option value="">All categories</option>';
		for (const c of state.catalog.deviceCategories) {
			const option = document.createElement('option');
			option.value = c.id;
			option.textContent = c.display_name;
			select.append(option);
		}
		if ([...select.options].some((o) => o.value === current)) select.value = current;
	}

	// ── Builder tab ────────────────────────────────────────────────────────
	function renderBuilder() {
		renderBuilderPickers();
		void renderBuilderPreview();
	}

	function renderBuilderPickers() {
		const deviceBox = elements.builderDevices;
		const osBox = elements.builderOs;
		const browserBox = elements.builderBrowsers;
		if (!deviceBox || !osBox || !browserBox) return;
		deviceBox.innerHTML = '';
		osBox.innerHTML = '';
		browserBox.innerHTML = '';
		for (const model of state.catalog.deviceModels) {
			deviceBox.append(checkboxRow('devices', model.id, model.display_name));
		}
		for (const os of state.catalog.osVersions) {
			osBox.append(checkboxRow('osVersions', os.id, os.display ?? os.id));
		}
		for (const browser of state.catalog.browsers) {
			const row = checkboxRow('browsers', browser.id, browser.display_name);
			const input = row.querySelector('input');
			// Lazy version fetch: browser versions are their own dimension and
			// get resolved per selected browser when the preview is built.
			input.addEventListener?.('change', () => {
				if (input.checked) void loadBrowserVersions(browser.id).then(renderBuilderPreview);
			});
			browserBox.append(row);
		}
	}

	function checkboxRow(group, value, label) {
		const label_ = document.createElement('label');
		label_.className = 'dm-check';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.value = value;
		input.checked = state.selection[group].has(value);
		input.onchange = () => {
			if (input.checked) state.selection[group].add(value);
			else state.selection[group].delete(value);
			void renderBuilderPreview();
		};
		const span = document.createElement('span');
		span.textContent = label;
		label_.append(input, span);
		return label_;
	}

	async function renderBuilderPreview() {
		const preview = elements.builderPreview;
		if (!preview) return;
		const selected = {
			devices: state.catalog.deviceModels.filter((m) => state.selection.devices.has(m.id)),
			osVersions: state.catalog.osVersions.filter((o) => state.selection.osVersions.has(o.id)),
			browsers: state.catalog.browsers.filter((b) => state.selection.browsers.has(b.id))
		};
		// Resolve browser versions (latest version per browser unless more were added).
		const versionedBrowsers = [];
		for (const browser of selected.browsers) {
			const versions = await loadBrowserVersions(browser.id);
			const rows = versions.length ? versions : [{ id: browser.id, version: browser.id }];
			for (const version of rows) {
				versionedBrowsers.push({ code: browser.id, version: String(version.version), display: `${browser.display_name} ${version.version}` });
			}
		}
		const combos = expandSelection({
			devices: selected.devices.map((m) => ({ slug: m.id, display: m.display_name })),
			osVersions: selected.osVersions.map((o) => ({ id: o.id, display: o.display ?? o.id })),
			browsers: versionedBrowsers
		});
		preview.innerHTML = '';
		const summary = document.createElement('p');
		summary.textContent = `${selected.devices.length} device(s) × ${selected.osVersions.length} OS version(s) × ${versionedBrowsers.length} browser+version(s) → ${combos.length} candidate combination(s). Invalid combinations are skipped at creation.`;
		preview.append(summary);
		const listEl = document.createElement('ul');
		for (const item of summarizeCombos(combos)) {
			const li = document.createElement('li');
			li.textContent = item.summaryOnly ? `… ${item.remaining} more` : `${item.deviceDisplay} · ${item.osDisplay} · ${item.browserDisplay}`;
			listEl.append(li);
		}
		preview.append(listEl);
		const createButton = elements.builderCreate;
		if (createButton) {
			createButton.disabled = !combos.length;
			createButton.onclick = async () => {
				createButton.disabled = true;
				try {
					const payload = await api('/environments/bulk', {
						method: 'POST',
						// content-type is set by the shared api() helper; passing it again duplicates it.
						body: JSON.stringify({
							combinations: combos.map((combo) => ({
								device: combo.deviceDisplay,
								platform: combo.osVersion.split(':')[0] === 'macos' ? 'macos' : combo.osVersion.split(':')[0],
								osVersion: combo.osVersion.split(':').slice(1).join(':'),
								browser: combo.browser,
								browserVersion: combo.browserVersion
							}))
						})
					});
					toast(`Created ${payload.created?.length ?? 0} environment(s); skipped ${payload.skipped?.length ?? 0}.`);
					refreshEnvironments();
				} catch (error) {
					fail(error);
				} finally {
					createButton.disabled = !combos.length;
				}
			};
		}
	}

	// ── Environments tab ───────────────────────────────────────────────────
	async function refreshEnvironments() {
		const params = new URLSearchParams();
		if (state.filters.platform) params.set('platform', state.filters.platform);
		if (state.filters.browser) params.set('browser', state.filters.browser);
		if (state.filters.active) params.set('active', state.filters.active);
		if (state.filters.search) params.set('search', state.filters.search);
		params.set('limit', String(state.pageSize));
		params.set('offset', String(state.page * state.pageSize));
		const payload = await api(`/environments?${params.toString()}`).catch(() => ({ total: 0, environments: [] }));
		state.environments = payload.environments ?? [];
		state.total = payload.total ?? 0;
		if (currentTab === 'environments') renderEnvironments();
	}

	function renderEnvironments() {
		const tbody = elements.envTbody;
		if (!tbody) return;
		tbody.innerHTML = '';
		for (const env of state.environments) {
			const tr = document.createElement('tr');
			tr.className = env.active ? '' : 'env-inactive';
			const cells = [
				env.envId, env.device, `${env.os} ${env.osVersion}`, env.browser, env.browserVersion,
				env.screenResolution ?? '—', env.orientation ?? '—',
				env.executionProvider === 'browserstack' ? 'BrowserStack' : env.executionProvider
			];
			for (const text of cells) {
				const td = document.createElement('td');
				td.textContent = String(text);
				tr.append(td);
			}
			const actionsTd = document.createElement('td');
			const toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.className = 'btn btn-ghost btn-sm';
			toggle.textContent = env.active ? 'disable' : 'enable';
			toggle.onclick = async () => {
				try {
					await api(`/environments/${encodeURIComponent(env.envId)}`, {
						method: 'PATCH',
						// content-type is set by the shared api() helper; passing it again duplicates it.
						body: JSON.stringify({ active: !env.active })
					});
					refreshEnvironments();
				} catch (error) { fail(error); }
			};
			const edit = document.createElement('button');
			edit.type = 'button';
			edit.className = 'btn btn-ghost btn-sm';
			edit.textContent = 'edit';
			edit.onclick = () => openEnvEditor(env);
			actionsTd.append(toggle, ' ', edit);
			tr.append(actionsTd);
			tbody.append(tr);
		}
		const summary = elements.envSummary;
		if (summary) {
			const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
			summary.textContent = `${state.total} environment(s) · page ${state.page + 1}/${pages}`;
		}
	}

	function page(delta) {
		const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
		const next = Math.min(pages - 1, Math.max(0, state.page + delta));
		if (next !== state.page) {
			state.page = next;
			refreshEnvironments();
		}
	}

	// ── Environment editor (inline dialog) ─────────────────────────────────
	function openEnvEditor(env) {
		const editor = elements.envEditor;
		if (!editor) return;
		editor.innerHTML = '';
		editor.hidden = false;
		const title = document.createElement('h3');
		title.textContent = `Edit ${env.envId}`;
		editor.append(title);
		const fields = [
			{ key: 'screenResolution', label: 'Screen resolution (e.g. 1179x2556)', value: env.screenResolution ?? '' },
			{ key: 'orientation', label: 'Orientation', value: env.orientation ?? '', select: ['', 'portrait', 'landscape'] },
			{ key: 'description', label: 'Description', value: env.description ?? '' },
			{ key: 'executionProvider', label: 'Execution provider', value: env.executionProvider ?? 'browserstack', select: ['browserstack', 'local'] }
		];
		const inputs = {};
		for (const field of fields) {
			const label_ = document.createElement('label');
			label_.className = 'field';
			const span = document.createElement('span');
			span.textContent = field.label;
			label_.append(span);
			let input;
			if (field.select) {
				input = document.createElement('select');
				for (const value of field.select) {
					const option = document.createElement('option');
					option.value = value;
					option.textContent = value === '' ? '—' : value;
					input.append(option);
				}
				input.value = field.value;
			} else {
				input = document.createElement('input');
				input.value = field.value;
			}
			inputs[field.key] = input;
			label_.append(input);
			editor.append(label_);
		}
		const buttonRow = document.createElement('div');
		buttonRow.className = 'dm-editor-actions';
		const save = document.createElement('button');
		save.type = 'button';
		save.className = 'btn btn-sm';
		save.textContent = 'Save';
		save.onclick = async () => {
			const patch = {};
			if (inputs.screenResolution.value.trim()) patch.screenResolution = inputs.screenResolution.value.trim();
			if (inputs.orientation.value) patch.orientation = inputs.orientation.value;
			if (inputs.description.value.trim()) patch.description = inputs.description.value.trim();
			if (inputs.executionProvider.value) patch.executionProvider = inputs.executionProvider.value;
			try {
				await api(`/environments/${encodeURIComponent(env.envId)}`, {
					method: 'PATCH',
					// content-type is set by the shared api() helper; passing it again duplicates it.
					body: JSON.stringify(patch)
				});
				toast(`${env.envId} updated.`);
				editor.hidden = true;
				editor.innerHTML = '';
				refreshEnvironments();
			} catch (error) { fail(error); }
		};
		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.className = 'btn btn-ghost btn-sm';
		cancel.textContent = 'Cancel';
		cancel.onclick = () => { editor.hidden = true; editor.innerHTML = ''; };
		buttonRow.append(save, cancel);
		editor.append(buttonRow);
	}

	// ── Catalog forms tab ─────────────────────────────────────────────────
	function renderCatalogForms() {
		const forms = elements.catalogForms;
		if (!forms) return;
		forms.innerHTML = '';
		forms.append(
			catalogForm('Device model', [
				{ name: 'display_name', label: 'Display name', required: true, placeholder: 'iPhone 17 Air' },
				{ name: 'category_id', label: 'Category', required: true, select: () => state.catalog.deviceCategories.map((c) => ({ value: c.id, label: c.display_name })) },
				{ name: 'release_year', label: 'Release year', type: 'number' }
			], 'deviceModels'),
			catalogForm('OS version', [
				{ name: 'os_family_id', label: 'OS family', required: true, select: () => [
					{ value: 'ios', label: 'iOS' }, { value: 'ipados', label: 'iPadOS' }, { value: 'macos', label: 'macOS' }
				] },
				{ name: 'version', label: 'Version', required: true, placeholder: '26.2' }
			], 'osVersions'),
			catalogForm('Browser version', [
				{ name: 'browser_id', label: 'Browser', required: true, select: () => state.catalog.browsers.map((b) => ({ value: b.id, label: b.display_name })) },
				{ name: 'version', label: 'Version', required: true, placeholder: '154' }
			], 'browserVersions')
		);
	}

	function catalogForm(title, fields, entity) {
		const card = document.createElement('form');
		card.className = 'dm-form';
		card.onsubmit = async (event) => {
			event.preventDefault();
			const body = {};
			for (const field of fields) {
				const input = card.querySelector(`[name="${field.name}"]`);
				if (input?.value) body[field.name] = input.value;
			}
			try {
				// content-type is set by the shared api() helper.
				await api(`/catalog/${entity}`, { method: 'POST', body: JSON.stringify(body) });
				toast(`${title} added to the catalog.`);
				card.reset();
				await loadCatalog();
				renderCatalogForms();
				refreshAll();
			} catch (error) { fail(error); }
		};
		const heading = document.createElement('h3');
		heading.textContent = `Add ${title.toLowerCase()}`;
		card.append(heading);
		for (const field of fields) {
			const label_ = document.createElement('label');
			label_.className = 'field';
			const span = document.createElement('span');
			span.textContent = field.label + (field.required ? ' *' : '');
			label_.append(span);
			let input;
			if (field.select) {
				input = document.createElement('select');
				for (const { value, label } of field.select()) {
					const option = document.createElement('option');
					option.value = value;
					option.textContent = label;
					input.append(option);
				}
			} else {
				input = document.createElement('input');
				if (field.type) input.type = field.type;
				if (field.placeholder) input.placeholder = field.placeholder;
			}
			input.name = field.name;
			input.required = Boolean(field.required);
			label_.append(input);
			card.append(label_);
		}
		const submit = document.createElement('button');
		submit.type = 'submit';
		submit.className = 'btn btn-sm';
		submit.textContent = `Add ${title.toLowerCase()}`;
		card.append(submit);
		return card;
	}

	// ── Wiring ─────────────────────────────────────────────────────────────
	function wire() {
		navButton?.addEventListener('click', open);
		dialog?.querySelector('.dm-close')?.addEventListener('click', () => dialog.close());
		for (const tab of tabs ?? []) {
			tab.addEventListener('click', () => {
				for (const other of tabs) {
					other.classList.toggle('is-active', other === tab);
					other.setAttribute('aria-selected', other === tab ? 'true' : 'false');
				}
				currentTab = tab.dataset.dmTab;
				const bodies = dialog.querySelectorAll('[data-dm-pane]');
				for (const pane of bodies) {
					pane.hidden = pane.dataset.dmPane !== currentTab;
				}
				if (currentTab === 'browse') renderBrowse();
				if (currentTab === 'builder') renderBuilder();
				if (currentTab === 'environments') renderEnvironments();
				if (currentTab === 'catalogForms') renderCatalogForms();
			});
		}
		elements.browseSearch?.addEventListener('input', debounce(renderBrowse, 200));
		elements.browseCategory?.addEventListener('change', () => { state.filters.category = elements.browseCategory.value; renderBrowse(); });
		elements.envFilterPlatform?.addEventListener('change', () => { state.filters.platform = elements.envFilterPlatform.value; state.page = 0; refreshEnvironments(); });
		elements.envFilterBrowser?.addEventListener('change', () => { state.filters.browser = elements.envFilterBrowser.value; state.page = 0; refreshEnvironments(); });
		elements.envFilterActive?.addEventListener('change', () => { state.filters.active = elements.envFilterActive.value; state.page = 0; refreshEnvironments(); });
		elements.envFilterSearch?.addEventListener('input', debounce(() => { state.filters.search = elements.envFilterSearch.value; state.page = 0; refreshEnvironments(); }, 250));
		elements.envPrev?.addEventListener('click', () => page(-1));
		elements.envNext?.addEventListener('click', () => page(1));
	}
	wire();

	return { open, refreshAll, state };
}
