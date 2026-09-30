/**
 * devicePicker — pure helpers for the ONE device picker.
 *
 * Device CARDS are derived from existing environment records: group active
 * environments by device, rank each device's environments, and expose the
 * best one plus the OS/browser alternatives that ACTUALLY exist for it.
 */

const PLATFORM_GROUPS = Object.freeze({
	apple: ['ios', 'ipados', 'macos'],
	android: ['android'],
	windows: ['windows']
});

const GROUP_ORDER = Object.freeze(['apple', 'android', 'windows']);

export function platformGroupFor(env) {
	const platform = String(env?.platform ?? '').toLowerCase();
	for (const [group, platforms] of Object.entries(PLATFORM_GROUPS)) {
		if (platforms.includes(platform)) return group;
	}
	return 'other';
}

export function groupLabelFor(group) {
	return { apple: 'APPLE', android: 'ANDROID', windows: 'WINDOWS', other: 'OTHER' }[group] ?? 'OTHER';
}

/**
 * Rank a device's environments: attested execution level first, then
 * real-device flag, then newest osVersion, then browser version.
 */
export function rankEnvironments(envs) {
	const levelScore = (env) => {
		if (env?.runtimeAttestedLevel === 'REAL_DEVICE') return 3;
		if (env?.executionLevelRequested === 'REAL_DEVICE') return 2;
		if (env?.isRealDevice) return 1;
		return 0;
	};
	const versionNumber = (value) => {
		const match = /(\d+(?:\.\d+)*)/.exec(String(value ?? ''));
		return match ? match[1].split('.').map(Number) : [0];
	};
	const compareVersions = (a, b) => {
		for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
			const d = (a[i] ?? 0) - (b[i] ?? 0);
			if (d !== 0) return d;
		}
		return 0;
	};
	return [...envs].sort((a, b) => {
		const level = levelScore(b) - levelScore(a);
		if (level !== 0) return level;
		const os = compareVersions(versionNumber(b.osVersion), versionNumber(a.osVersion));
		if (os !== 0) return os;
		return 0; // stable sort keeps catalog order — the catalog's default browser wins ties
	});
}

/**
 * Build the card model from active environments (+ optional runtime board map
 * envId → { status, maximumLevel } for honest availability badges).
 * Returns [{ group, groupLabel, device, deviceType, platform, best, osVersions, browsers, envCount }].
 */
export function buildDeviceCards(environments, boardByEnvId = null) {
	const byDevice = new Map();
	for (const env of environments ?? []) {
		if (env?.active === false) continue;
		const key = String(env.device ?? '').trim();
		if (!key) continue;
		if (!byDevice.has(key)) byDevice.set(key, []);
		byDevice.get(key).push(env);
	}
	const cards = [];
	for (const [device, envs] of byDevice) {
		const ranked = rankEnvironments(envs);
		const best = ranked[0];
		const boardEntry = boardByEnvId?.get?.(best.envId ?? best.id) ?? null;
		const osVersions = [...new Set(envs.map((e) => e.osVersion).filter(Boolean))];
		const browsers = [...new Set(envs.map((e) => `${e.browser}|${e.browserVersion ?? ''}`).filter((b) => b !== '|'))]
			.map((b) => {
				const [name, version] = b.split('|');
				return { browser: name, browserVersion: version || null };
			});
		cards.push({
			group: platformGroupFor(best),
			groupLabel: groupLabelFor(platformGroupFor(best)),
			device,
			deviceType: best.deviceType ?? 'phone',
			platform: best.platform ?? null,
			best,
			envs,
			availability: boardEntry?.status ?? null,
			maximumLevel: boardEntry?.maximumLevel ?? null,
			osVersions,
			browsers,
			envCount: envs.length
		});
	}
	return cards.sort((a, b) => {
		const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
		if (g !== 0) return g;
		return a.device.localeCompare(b.device);
	});
}

/**
 * Auto-resolve THE environment for a device selection with optional browser /
 * osVersion overrides. Only combinations that exist as active environments
 * are resolvable — never an invented one.
 */
export function resolveDeviceEnvironment(environments, { device, browser, osVersion } = {}) {
	const candidates = (environments ?? []).filter((e) => e?.active !== false && String(e.device ?? '').trim() === String(device ?? '').trim());
	if (!candidates.length) return null;
	let filtered = candidates;
	if (osVersion) filtered = filtered.filter((e) => String(e.osVersion ?? '') === String(osVersion));
	if (browser) filtered = filtered.filter((e) => String(e.browser ?? '').toLowerCase() === String(browser).toLowerCase());
	if (!filtered.length && browser) {
		// Browser/os combination doesn't exist for this device — fall back to
		// the device's best environment rather than inventing one.
		filtered = candidates;
	}
	return rankEnvironments(filtered)[0] ?? null;
}

/** Filter cards by search text, platform group and device type. */
export function filterDeviceCards(cards, { search = '', platform = 'all', deviceType = 'all' } = {}) {
	const q = String(search ?? '').trim().toLowerCase();
	return (cards ?? []).filter((card) => {
		if (platform !== 'all' && card.group !== platform) return false;
		if (deviceType !== 'all' && card.deviceType !== deviceType) return false;
		if (!q) return true;
		const haystack = [card.device, card.best?.os, card.best?.osVersion, card.best?.browser, card.best?.browserVersion]
			.filter(Boolean).join(' ').toLowerCase();
		return haystack.includes(q);
	});
}

/** Honest card badge: execution level text + availability, never name-inferred. */
export function cardBadge(card) {
	const level = card?.maximumLevel === 'REAL_DEVICE'
		? 'REAL DEVICE'
		: card?.maximumLevel === 'VIRTUAL_DEVICE'
			? 'VIRTUAL DEVICE'
			: card?.maximumLevel === 'SIMULATED' ? 'SIMULATED' : 'SIMULATED';
	const availability = card?.availability === 'AVAILABLE' ? 'AVAILABLE'
		: card?.availability === 'BUSY' ? 'BUSY'
			: card?.availability === 'OFFLINE' ? 'OFFLINE'
				: card?.availability === 'NOT_EXECUTABLE' ? 'NOT EXECUTABLE' : 'AVAILABLE';
	return { level, availability };
}

/**
 * Browsers that ACTUALLY exist as active environments for device + OS.
 * Never offers a combination that can't execute.
 */
export function browsersForOS(card, osVersion) {
	if (!card?.envs) return card?.browsers ?? [];
	const forOS = osVersion ? card.envs.filter((e) => String(e.osVersion ?? '') === String(osVersion)) : card.envs;
	const browsers = [...new Set(forOS.map((e) => `${e.browser}|${e.browserVersion ?? ''}`).filter((b) => b !== '|'))]
		.map((b) => {
			const [name, version] = b.split('|');
			return { browser: name, browserVersion: version || null };
		});
	return browsers.length ? browsers : card.browsers;
}

/** Execution level display text, honest (from selection data only). */
export function executionTypeText(selection) {
	const level = selection?.executionType;
	if (level === 'REAL_DEVICE') return 'REAL DEVICE';
	if (level === 'VIRTUAL_DEVICE') return 'VIRTUAL DEVICE';
	if (level === 'SIMULATED') return 'SIMULATED';
	return 'VIRTUAL DEVICE';
}

/** Type chips map deviceType (phone/mobile) → chip value. */
const TYPE_BY_CHIP = { phone: 'mobile', tablet: 'tablet', desktop: 'desktop' };

export function chipForDeviceType(deviceType) {
	if (deviceType === 'mobile' || deviceType === 'phone') return 'phone';
	return deviceType ?? 'phone';
}

/** Chip label for an environment: "Device — OS ver — Browser ver". */
export function envChipLabel(env) {
	if (!env) return '';
	return [env.device, [env.os, env.osVersion].filter(Boolean).join(' '), [env.browser, env.browserVersion].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
}

/**
 * TEST ON DEVICES chip list (DX Phase 4): renders selected envIds as chips
 * with remove buttons plus a [+ Add device] button that opens THE picker in
 * add-mode. Replaces every Ctrl/Cmd multi-select.
 */
export function createDeviceChipList({ container, addBtn, environmentsById, onChange }) {
	const selected = new Set();

	function lookup(envId) {
		if (typeof environmentsById === 'function') return environmentsById(envId);
		return environmentsById?.get?.(envId);
	}

	function render() {
		if (!container) return;
		container.textContent = '';
		if (!selected.size) {
			const empty = document.createElement('span');
			empty.className = 'dcl-empty';
			empty.textContent = 'No devices yet — add one.';
			container.append(empty);
			return;
		}
		for (const envId of selected) {
			const env = lookup(envId);
			const chip = document.createElement('span');
			chip.className = 'dcl-chip';
			const label = document.createElement('span');
			label.textContent = envChipLabel(env) || envId;
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'dcl-remove';
			remove.textContent = '×';
			remove.setAttribute('aria-label', `Remove ${label.textContent}`);
			remove.onclick = () => { selected.delete(envId); render(); onChange?.([...selected]); };
			chip.append(label, remove);
			container.append(chip);
		}
	}

	if (addBtn) addBtn.onclick = () => {
		devicePickerHost?.beginAddMode?.((env) => {
			if (!env?.envId || selected.has(env.envId)) return;
			selected.add(env.envId);
			render();
			onChange?.([...selected]);
		});
		devicePickerHost?.open?.();
	};

	// The picker instance is wired by app.js after both exist.
	let devicePickerHost = null;
	function setPickerHost(picker) { devicePickerHost = picker; render(); }

	render();
	return {
		setPickerHost,
		set(ids) { selected.clear(); for (const id of ids ?? []) selected.add(id); render(); },
		get ids() { return [...selected]; },
		clear() { selected.clear(); render(); onChange?.([]); }
	};
}
/**
 * SELECTED TEST ENVIRONMENT summary line for the picker footer.
 * Capabilities are derived from the platform runtime profiles — display only.
 */
export function selectionSummary(selection, runtimeProfiles) {
	if (!selection) return null;
	const profile = runtimeProfiles?.[selection.platform];
	const media = profile?.media ?? {};
	const caps = [];
	if (profile?.input?.includes('touch')) caps.push('Touch');
	if (media.camera?.supported) caps.push('Camera');
	if (media.microphone?.supported) caps.push('Microphone');
	if (media.screenShare?.supported) caps.push('Screen');
	caps.push('Orientation');
	return {
		device: selection.device,
		line: [selection.os, selection.osVersion, '·', selection.browser, selection.browserVersion].filter(Boolean).join(' '),
		resolution: selection.resolution,
		orientation: selection.orientation,
		executionType: executionTypeText(selection),
		capabilities: caps
	};
}

/**
 * The ONE Device Picker dialog. Cards are derived from active environments;
 * selecting a device auto-resolves its environment (browser/OS overrides
 * re-resolve it). Selection is written through the caller's store.
 */
export function createDevicePicker({ elements, store, runtimeProfiles = {}, onSelect, onClose }) {
	const { dialog, search, tabs, types, cards, summary, closeBtn } = elements;
	const state = { environments: [], boardByEnvId: new Map(), filters: { search: '', platform: 'all', deviceType: 'all' }, selectedDevice: null };

	function boardFor(envs) {
		const map = new Map();
		for (const env of envs) {
			const entry = state.boardByEnvId.get(env.envId ?? env.id);
			if (entry) map.set(env.envId ?? env.id, entry);
		}
		return map;
	}

	function cardsModel() {
		return buildDeviceCards(state.environments, boardFor(state.environments));
	}

	function renderSummary() {
		if (!summary) return;
		if (state.addPick) {
			summary.textContent = 'ADD MODE — click a device to add it to the list. Close when done.';
			delete summary.dataset.empty;
			return;
		}
		const selection = store?.get?.();
		if (!selection) {
			summary.textContent = 'SELECT A DEVICE';
			summary.dataset.empty = 'true';
			return;
		}
		delete summary.dataset.empty;
		const s = selectionSummary(selection, runtimeProfiles);
		summary.textContent = `SELECTED: ${s.device} · ${s.line} · ${s.executionType} · ${s.resolution ?? ''} ${s.orientation ?? ''} · ${s.capabilities.join(' / ')}`.replace(/\s+/g, ' ').trim();
	}

	function renderCardOptions(card, el) {
		// Secondary options only for the selected device: OS (if >1 actually
		// available) + executable browsers for the selected OS only.
		const opts = document.createElement('div');
		opts.className = 'dp-card-options';
		const currentOS = store.get()?.osVersion ?? null;
		if (card.osVersions.length > 1) {
			const sel = document.createElement('select');
			sel.className = 'dp-select';
			sel.setAttribute('aria-label', `OS version for ${card.device}`);
			for (const v of [...card.osVersions].reverse()) {
				const opt = document.createElement('option');
				opt.value = v;
				opt.textContent = `${card.best.os ?? 'OS'} ${v}`;
				sel.appendChild(opt);
			}
			if (currentOS && card.osVersions.includes(currentOS)) sel.value = currentOS;
			sel.onchange = () => { reselect({ osVersion: sel.value }); renderCardOptionsSync(); };
			opts.appendChild(sel);
			opts.dataset.osSelect = '';
		}
		const bsel = document.createElement('select');
		bsel.className = 'dp-select';
		bsel.setAttribute('aria-label', `Browser for ${card.device}`);
		const fillBrowsers = (osVersion) => {
			bsel.textContent = '';
			for (const b of browsersForOS(card, osVersion)) {
				const opt = document.createElement('option');
				opt.value = b.browser;
				opt.textContent = [b.browser, b.browserVersion].filter(Boolean).join(' ');
				bsel.appendChild(opt);
			}
			const current = store.get()?.browser ?? card.best.browser;
			bsel.value = current;
		};
		fillBrowsers(currentOS);
		bsel.onchange = () => reselect({ browser: bsel.value });
		opts.appendChild(bsel);
		el.appendChild(opts);
		// OS change re-fills the browser list for the new OS (in place, no full
		// re-render needed for the dropdown itself — reselect handles the rest).
		const osSelect = opts.querySelector('.dp-select[aria-label^="OS version"]');
		if (osSelect) {
			const original = osSelect.onchange;
			osSelect.onchange = () => {
				fillBrowsers(osSelect.value);
				original?.();
			};
		}
		function renderCardOptionsSync() { fillBrowsers(store.get()?.osVersion ?? null); }
	}

	function reselect(overrides = {}) {
		const env = resolveDeviceEnvironment(state.environments, { device: state.selectedDevice, ...overrides });
		if (!env) return;
		if (state.addPick) {
			// Add-mode: append to the caller's chip list, don't touch the
			// active selection. Dialog stays open for multiple adds.
			state.addPick(env);
			renderCards();
			return;
		}
		store.setSelection(env);
		onSelect?.(store.get(), env);
		renderSummary();
		renderCards();
	}

	function renderCards() {
		if (!cards) return;
		cards.textContent = '';
		const visible = filterDeviceCards(cardsModel(), state.filters);
		if (!visible.length) {
			const empty = document.createElement('p');
			empty.className = 'dp-empty';
			empty.textContent = 'No devices match — clear the search or filters.';
			cards.appendChild(empty);
			return;
		}
		let currentGroup = null;
		for (const card of visible) {
			if (card.groupLabel !== currentGroup) {
				currentGroup = card.groupLabel;
				const head = document.createElement('div');
				head.className = 'dp-group';
				head.textContent = currentGroup;
				cards.appendChild(head);
			}
			const el = document.createElement('div');
			const selected = state.selectedDevice === card.device;
			el.className = `dp-card${selected ? ' is-selected' : ''}`;
			const badge = cardBadge(card);
			const info = document.createElement('div');
			info.className = 'dp-card-info';
			const name = document.createElement('span');
			name.className = 'dp-card-name';
			name.textContent = card.device;
			const sub = document.createElement('span');
			sub.className = 'dp-card-sub';
			sub.textContent = `${card.best.os ?? ''} ${card.best.osVersion ?? ''} · ${card.best.browser ?? ''} ${card.best.browserVersion ?? ''}`.trim();
			const badgeEl = document.createElement('span');
			badgeEl.className = 'dp-card-badge';
			badgeEl.textContent = `● ${badge.level} · ${badge.availability}`;
			info.append(name, sub, badgeEl);
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'btn btn-primary btn-sm dp-select-btn';
			btn.textContent = state.addPick ? 'Add' : (selected ? 'Selected ✓' : 'Select');
			btn.onclick = () => { state.selectedDevice = card.device; reselect(); };
			el.append(info, btn);
			if (selected) renderCardOptions(card, el);
			cards.appendChild(el);
		}
	}

	function setFilter(patch) {
		Object.assign(state.filters, patch);
		for (const t of tabs ?? []) t.classList.toggle('is-active', t.dataset.dpTab === state.filters.platform);
		for (const t of types ?? []) t.classList.toggle('is-active', t.dataset.dpType === state.filters.deviceType);
		renderCards();
	}

	for (const t of tabs ?? []) {
		t.onclick = () => setFilter({ platform: t.dataset.dpTab });
	}
	for (const t of types ?? []) {
		t.onclick = () => setFilter({ deviceType: TYPE_BY_CHIP[t.dataset.dpType] ?? t.dataset.dpType });
	}
	if (search) search.oninput = () => setFilter({ search: search.value });
	if (closeBtn) closeBtn.onclick = () => { state.addPick = null; dialog?.close?.(); onClose?.(store?.get?.()); };
	dialog?.addEventListener?.('close', () => { state.addPick = null; onClose?.(store?.get?.()); });

	return {
		state,
		open() {
			if (!state.addPick && !state.selectedDevice && store?.get?.()) state.selectedDevice = store.get().device;
			setFilter({});
			dialog?.showModal?.();
			renderSummary();
		},
		close() { dialog?.close?.(); },
		/**
		 * Add-mode (multi-select): each Select click calls onPick(env) instead
		 * of replacing the active selection; the dialog stays open. Pass null
		 * to return to select-mode. The close button ends add-mode.
		 */
		beginAddMode(onPick) {
			state.addPick = onPick ?? null;
			if (onPick) renderSummary();
		},
		endAddMode() { state.addPick = null; },
		setData({ environments, boardByEnvId }) {
			state.environments = environments ?? [];
			state.boardByEnvId = boardByEnvId ?? new Map();
			renderCards();
		},
		hydrate(env) {
			// Restore the persisted selection once environments are known.
			if (!env || !state.environments.length) return;
			const resolved = resolveDeviceEnvironment(state.environments, { device: env.device, browser: env.browser, osVersion: env.osVersion })
				?? resolveDeviceEnvironment(state.environments, { device: env.device });
			if (!resolved) { store.clear(); state.selectedDevice = null; }
			else { store.setSelection(resolved); state.selectedDevice = resolved.device; }
			renderSummary();
			renderCards();
		},
		renderSummary
	};
}
