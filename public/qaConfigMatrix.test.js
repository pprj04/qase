import test from 'node:test';
import assert from 'node:assert/strict';
import {
	FAMILY_ORDER,
	createDeselectionStore,
	computeSelection,
	sanitizeSelection,
	buildSummary,
	filterConfigurations,
	groupDeviceTree,
	facetValues,
	familyRows,
	isSelectable,
	isValidTargetUrl,
	canStartRun,
	fetchQaConfigurations,
	fetchConfigurationIndex,
	fetchConfigurationWindow,
	executionTypeLabel,
	configurationsForDevice,
	compatibleBrowserFamilies,
	defaultSelectionForDevice,
	deviceScopeSelection
} from './qaConfigMatrix.js';

/** Minimal in-memory localStorage. */
function memoryStorage() {
	const map = new Map();
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => map.set(key, String(value)),
		removeItem: (key) => map.delete(key)
	};
}

function configuration(overrides = {}) {
	return {
		envId: 'ENV-IOS-IP15-18.0-CHR-140',
		device: 'iPhone 15',
		manufacturer: 'Apple',
		platform: 'ios',
		os: 'iOS',
		osVersion: '18.0',
		deviceType: 'mobile',
		orientation: 'portrait',
		browser: 'Chrome',
		browserCode: 'chrome',
		browserVersion: '140',
		executionType: 'emulator',
		availability: 'AVAILABLE',
		availabilityReason: null,
		...overrides
	};
}

const CATALOG = [
	configuration(),
	configuration({ envId: 'ENV-IOS-IP15-18.0-CHR-141', browserVersion: '141' }),
	configuration({ envId: 'ENV-AND-SGS24-15-BRV-138', device: 'Galaxy S24', manufacturer: 'Samsung', platform: 'android', os: 'Android', osVersion: '15', browser: 'Brave', browserCode: 'brave', browserVersion: '138', executionType: 'virtual_machine' }),
	configuration({ envId: 'ENV-WIN-SL5-11-EDG-140', device: 'Surface Laptop 5', manufacturer: 'Microsoft', platform: 'windows', os: 'Windows', osVersion: '11', deviceType: 'desktop', orientation: 'landscape', browser: 'Edge', browserCode: 'edge', browserVersion: '140', executionType: 'browser_emulation' }),
	configuration({ envId: 'ENV-AND-PIX9-16-DDG-2', device: 'Pixel 9', manufacturer: 'Google', platform: 'android', browser: 'DuckDuckGo', browserCode: 'duckduckgo', browserVersion: '2', availability: 'NOT_SUPPORTED', availabilityReason: 'DuckDuckGo is mobile-only with no automation channel.' }),
	configuration({ envId: 'PROV-BS-IP15-REAL', device: 'iPhone 15', platform: 'ios', availability: 'NOT_CONFIGURED', availabilityReason: 'Provider "browserstack" not configured.' })
];

test('FAMILY_ORDER matches the seven required families', () => {
	assert.deepEqual(FAMILY_ORDER, ['chrome', 'edge', 'firefox', 'opera', 'brave', 'duckduckgo', 'safari']);
});

test('isSelectable: only AVAILABLE rows selectable', () => {
	assert.equal(isSelectable(configuration()), true);
	assert.equal(isSelectable(configuration({ availability: 'NOT_SUPPORTED' })), false);
	assert.equal(isSelectable(configuration({ availability: 'NOT_CONFIGURED' })), false);
	assert.equal(isSelectable(configuration({ availability: 'UNAVAILABLE' })), false);
});

test('default selection = all available configurations; unavailable never selected', () => {
	const store = createDeselectionStore(memoryStorage());
	const selected = computeSelection(CATALOG, store);
	assert.deepEqual(selected, ['ENV-IOS-IP15-18.0-CHR-140', 'ENV-IOS-IP15-18.0-CHR-141', 'ENV-AND-SGS24-15-BRV-138', 'ENV-WIN-SL5-11-EDG-140']);
	assert.ok(!selected.includes('ENV-AND-PIX9-16-DDG-2'));
	assert.ok(!selected.includes('PROV-BS-IP15-REAL'));
});

test('explicit deselections persist and survive store recreation', () => {
	const storage = memoryStorage();
	const store = createDeselectionStore(storage);
	store.deselect('ENV-AND-SGS24-15-BRV-138');
	store.deselect('ENV-WIN-SL5-11-EDG-140');
	let selected = computeSelection(CATALOG, store);
	assert.deepEqual(selected, ['ENV-IOS-IP15-18.0-CHR-140', 'ENV-IOS-IP15-18.0-CHR-141']);
	// Simulate dialog reopen: fresh store over the same storage.
	const reopened = createDeselectionStore(storage);
	selected = computeSelection(CATALOG, reopened);
	assert.deepEqual(selected, ['ENV-IOS-IP15-18.0-CHR-140', 'ENV-IOS-IP15-18.0-CHR-141']);
	// Reselect one back.
	reopened.reselect('ENV-AND-SGS24-15-BRV-138');
	assert.equal(computeSelection(CATALOG, reopened).length, 3);
	// Select-all clears memory.
	reopened.clear();
	assert.equal(computeSelection(CATALOG, reopened).length, 4);
});

test('deselection of an unavailable envId is inert (no fabricated availability)', () => {
	const store = createDeselectionStore(memoryStorage());
	store.deselect('ENV-AND-PIX9-16-DDG-2');
	assert.ok(!computeSelection(CATALOG, store).includes('ENV-AND-PIX9-16-DDG-2'));
	store.reselect('ENV-AND-PIX9-16-DDG-2');
	assert.ok(!computeSelection(CATALOG, store).includes('ENV-AND-PIX9-16-DDG-2'), 'resurrecting a deselected NOT_SUPPORTED row must not select it');
});

test('sanitizeSelection drops envIds that became unselectable', () => {
	const clean = sanitizeSelection(CATALOG, ['ENV-IOS-IP15-18.0-CHR-140', 'ENV-AND-PIX9-16-DDG-2', 'GONE-ID', 'PROV-BS-IP15-REAL']);
	assert.deepEqual(clean, ['ENV-IOS-IP15-18.0-CHR-140']);
});

test('buildSummary: planned total, per-family, per-platform, deselected and unavailable counts', () => {
	const store = createDeselectionStore(memoryStorage());
	store.deselect('ENV-WIN-SL5-11-EDG-140');
	const selected = computeSelection(CATALOG, store);
	const summary = buildSummary(CATALOG, selected);
	assert.equal(summary.total, 3);
	assert.equal(summary.availableTotal, 4);
	assert.equal(summary.unavailable, 2);
	assert.equal(summary.deselected, 1);
	assert.equal(summary.byFamily.chrome, 2);
	assert.equal(summary.byFamily.brave, 1);
	assert.equal(summary.byFamily.edge, 0);
	assert.equal(summary.byFamily.duckduckgo, 0);
	assert.deepEqual(summary.byPlatform, { ios: 2, android: 1 });
});

test('filterConfigurations: all five facets + search', () => {
	assert.equal(filterConfigurations(CATALOG, { platform: 'android' }).length, 2);
	assert.equal(filterConfigurations(CATALOG, { manufacturer: 'Samsung' }).length, 1);
	assert.equal(filterConfigurations(CATALOG, { device: 'Pixel 9' }).length, 1);
	assert.equal(filterConfigurations(CATALOG, { osVersion: '18.0' }).length, 4);
	assert.equal(filterConfigurations(CATALOG, { orientation: 'landscape' }).length, 1);
	assert.equal(filterConfigurations(CATALOG, { browserCode: 'brave' }).length, 1);
	assert.equal(filterConfigurations(CATALOG, { search: 'galaxy' }).length, 1);
	assert.equal(filterConfigurations(CATALOG, { search: 'IPHONE' }).length, 3);
	assert.equal(filterConfigurations(CATALOG, { executionType: 'virtual_machine' }).length, 1);
});

test('groupDeviceTree: platform → device → OS → family versions newest first', () => {
	const tree = groupDeviceTree(CATALOG);
	const ios = tree.find((group) => group.platform === 'ios');
	assert.ok(ios);
	const iphone = ios.devices.find((device) => device.device === 'iPhone 15');
	assert.ok(iphone);
	assert.equal(iphone.manufacturer, 'Apple');
	assert.ok(iphone.executionTypes.includes('emulator'));
	const os = iphone.osVersions[0];
	assert.equal(os.osVersion, '18.0');
	const chrome = os.browsers.find((browser) => browser.browserCode === 'chrome');
	// iPhone 15 iOS 18.0: two chrome versions + the provider-overlay iPhone 15 row
	// shares the device tree node only when its osVersion matches; the fixture
	// provider row carries osVersion 18.0 too, so three chrome rows exist.
	assert.deepEqual(chrome.versions.map((version) => version.browserVersion), ['141', '140', '140']);
});

test('facetValues returns facet lists with counts', () => {
	const facets = facetValues(CATALOG);
	assert.deepEqual(facets.platform.map((entry) => entry.value), ['ios', 'android', 'windows']);
	assert.ok(facets.manufacturer.some((entry) => entry.value === 'Apple' && entry.count === 3));
	assert.ok(facets.orientation.some((entry) => entry.value === 'landscape'));
});

test('familyRows: all seven always present; DDG unavailable with reason; versions newest first', () => {
	const rows = familyRows(CATALOG, [
		{ code: 'chrome', label: 'Chrome' },
		{ code: 'edge', label: 'Edge' },
		{ code: 'firefox', label: 'Firefox' },
		{ code: 'opera', label: 'Opera' },
		{ code: 'brave', label: 'Brave' },
		{ code: 'duckduckgo', label: 'DuckDuckGo', reasonWhenUnavailable: 'No automation channel.' },
		{ code: 'safari', label: 'Safari' }
	]);
	assert.equal(rows.length, 7);
	assert.deepEqual(rows.map((row) => row.code), FAMILY_ORDER);
	const chrome = rows.find((row) => row.code === 'chrome');
	assert.equal(chrome.available, true);
	assert.deepEqual(chrome.versions, ['141', '140']);
	const ddg = rows.find((row) => row.code === 'duckduckgo');
	assert.equal(ddg.available, false);
	assert.match(ddg.reason, /automation channel|mobile-only/);
	// Families with no rows at all (firefox/opera/safari in this fixture) stay visible + reason.
	for (const code of ['firefox', 'opera', 'safari']) {
		const row = rows.find((candidate) => candidate.code === code);
		assert.equal(row.available, false);
		assert.ok(row.reason, `${code} needs a reason`);
	}
});

test('safari absent from Android/Windows rows but present in family list', () => {
	const androidOnly = filterConfigurations(CATALOG, { platform: 'android' });
	assert.ok(androidOnly.every((row) => row.browserCode !== 'safari'));
	const rows = familyRows(androidOnly, []);
	const safari = rows.find((row) => row.code === 'safari');
	assert.equal(safari.available, false);
	assert.ok(safari.reason);
});

test('canStartRun gating: URL validity + at least one configuration', () => {
	assert.equal(isValidTargetUrl('https://example.com'), true);
	assert.equal(isValidTargetUrl('http://localhost:3000'), true);
	assert.equal(isValidTargetUrl('example.com'), false);
	assert.equal(isValidTargetUrl('ftp://example.com'), false);
	assert.equal(isValidTargetUrl(''), false);
	assert.equal(canStartRun({ targetUrl: 'https://example.com', selectedEnvIds: ['A'] }), true);
	assert.equal(canStartRun({ targetUrl: 'https://example.com', selectedEnvIds: [] }), false);
	assert.equal(canStartRun({ targetUrl: 'not-a-url', selectedEnvIds: ['A'] }), false);
});

test('fetchQaConfigurations: ok → payload; error status → thrown with message; malformed → thrown', async () => {
	const ok = await fetchQaConfigurations({ fetcher: async () => ({ ok: true, status: 200, json: async () => ({ configurations: [], browserFamilies: [], totals: { configurations: 0 } }) }) });
	assert.deepEqual(ok.configurations, []);
	await assert.rejects(
		fetchQaConfigurations({ fetcher: async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) }),
		/boom/
	);
	await assert.rejects(
		fetchQaConfigurations({ fetcher: async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }) }),
		/malformed/
	);
});

test('executionTypeLabel maps all five execution types', () => {
	assert.equal(executionTypeLabel('physical_device'), 'Physical device');
	assert.equal(executionTypeLabel('virtual_machine'), 'Virtual machine');
	assert.equal(executionTypeLabel('emulator'), 'Emulator');
	assert.equal(executionTypeLabel('simulator'), 'Simulator');
	assert.equal(executionTypeLabel('browser_emulation'), 'Browser emulation');
});

/* ── Windowed catalog model (30MB-payload fix, #15013) ─────────────── */

test('fetchConfigurationIndex requests the compact index and returns it', async () => {
	const calls = [];
	const fetcher = async (url) => {
		calls.push(url);
		assert.match(url, /\/api\/qa-configurations\?index=1&limit=1/);
		return { ok: true, json: async () => ({ index: [configuration()], configurations: [], totals: {} }) };
	};
	const index = await fetchConfigurationIndex({ fetcher });
	assert.equal(index.length, 1);
	assert.equal(index[0].envId, 'ENV-IOS-IP15-18.0-CHR-140');
});

test('fetchConfigurationIndex surfaces server errors with status', async () => {
	const fetcher = async () => ({ ok: false, status: 500, json: async () => ({ error: 'catalog exploded' }) });
	await assert.rejects(
		() => fetchConfigurationIndex({ fetcher }),
		(error) => error.status === 500 && /catalog exploded/.test(error.message)
	);
});

test('fetchConfigurationWindow passes filters + pagination and reports hasMore', async () => {
	const seen = [];
	const fetcher = async (url) => {
		seen.push(url);
		return { ok: true, json: async () => ({ configurations: [configuration()], totals: { configurations: 12 } }) };
	};
	const result = await fetchConfigurationWindow({ platform: 'ios', search: 'iphone 15' }, { fetcher, limit: 50, offset: 100 });
	assert.match(seen[0], /platform=ios/);
	assert.match(seen[0], /search=iphone(%2015|\+15)/);
	assert.match(seen[0], /limit=50/);
	assert.match(seen[0], /offset=100/);
	assert.equal(result.configurations.length, 1);
	assert.equal(result.total, 12);
	assert.equal(result.hasMore, false); // 100 + 1 < 12 is false
});

test('fetchConfigurationWindow hasMore is true when window is partial', async () => {
	const fetcher = async () => ({ ok: true, json: async () => ({ configurations: Array.from({ length: 50 }, (_, i) => configuration({ envId: `E${i}` })), totals: { configurations: 500 } }) });
	const result = await fetchConfigurationWindow({}, { fetcher, limit: 50, offset: 0 });
	assert.equal(result.hasMore, true);
});

test('fetchConfigurationWindow rejects malformed payloads', async () => {
	const fetcher = async () => ({ ok: true, json: async () => ({ nonsense: true }) });
	await assert.rejects(() => fetchConfigurationWindow({}, { fetcher }), /malformed/);
});

test('default selection over an index honors deselections across the full catalog', () => {
	const storage = memoryStorage();
	const store = createDeselectionStore(storage);
	store.deselect('ENV-AND-SGS24-15-BRV-138');
	const selected = computeSelection(CATALOG, store);
	assert.ok(!selected.includes('ENV-AND-SGS24-15-BRV-138'));
	assert.ok(!selected.includes('PROV-BS-IP15-REAL')); // NOT_CONFIGURED never selected
	assert.equal(selected.length, 3);
});

test('buildSummary over the index reports full-catalog totals', () => {
	const selected = computeSelection(CATALOG, createDeselectionStore(memoryStorage()));
	const summary = buildSummary(CATALOG, selected);
	assert.equal(summary.total, 4); // 6 rows − 1 NOT_SUPPORTED − 1 NOT_CONFIGURED
	assert.equal(summary.availableTotal, 4);
	assert.equal(summary.unavailable, 2);
	assert.equal(summary.byFamily.chrome, 2);
	assert.equal(summary.byFamily.edge, 1);
	assert.equal(summary.byFamily.brave, 1);
});

test('#15092 family-toggle bulk store writes persist once and survive reopen', () => {
	const storage = memoryStorage();
	let writes = 0;
	const counting = {
		getItem: storage.getItem,
		setItem: (key, value) => { writes += 1; storage.setItem(key, value); },
		removeItem: storage.removeItem
	};
	const store = createDeselectionStore(counting);
	// Family toggle deselecting ~8k rows must be ONE store write, not one
	// per envId (the per-row persist crashed the renderer tab).
	const ids = Array.from({ length: 8000 }, (_, index) => `ENV-BULK-${index}`);
	store.deselectMany(ids);
	assert.equal(writes, 1);
	assert.equal(store.get().size, 8000);
	// Persistence survives a "reopen" (new store over the same storage).
	const reopened = createDeselectionStore(storage);
	assert.equal(reopened.get().size, 8000);
	reopened.reselectMany(ids.slice(0, 4000));
	assert.equal(reopened.get().size, 4000);
	const reopened2 = createDeselectionStore(storage);
	assert.equal(reopened2.get().size, 4000);
});

// ---------------------------------------------------------------------------
// #15163 device scope: picking a device auto-selects ALL its compatible
// browsers; switching devices never leaks the previous scope.
// ---------------------------------------------------------------------------
test('#15163 configurationsForDevice scopes by platform+device+manufacturer', () => {
	const galaxy = configurationsForDevice(CATALOG, { platform: 'android', device: 'Galaxy S24', manufacturer: 'Samsung' });
	assert.equal(galaxy.length, 1);
	assert.ok(galaxy.every((row) => row.device === 'Galaxy S24' && row.platform === 'android'));
	const other = configurationsForDevice(CATALOG, { platform: 'android', device: 'Galaxy S24', manufacturer: 'Other' });
	assert.equal(other.length, 0);
});

test('#15163 compatibleBrowserFamilies lists only families with an available row', () => {
	const galaxy = configurationsForDevice(CATALOG, { platform: 'android', device: 'Galaxy S24', manufacturer: 'Samsung' });
	const families = compatibleBrowserFamilies(galaxy);
	assert.ok(families.includes('brave'));
	assert.ok(!families.includes('duckduckgo'), 'statically unsupported family must never appear');
	const pixel = configurationsForDevice(CATALOG, { platform: 'android', device: 'Pixel 9', manufacturer: 'Google' });
	assert.deepEqual(compatibleBrowserFamilies(pixel), []);
});

test('#15163 defaultSelectionForDevice returns exactly the available envIds', () => {
	const galaxy = configurationsForDevice(CATALOG, { platform: 'android', device: 'Galaxy S24', manufacturer: 'Samsung' });
	assert.deepEqual([...defaultSelectionForDevice(galaxy)], ['ENV-AND-SGS24-15-BRV-138']);
	const pixel = configurationsForDevice(CATALOG, { platform: 'android', device: 'Pixel 9', manufacturer: 'Google' });
	assert.deepEqual([...defaultSelectionForDevice(pixel)], []);
});

test('#15163 deviceScopeSelection derives scope + selection + families in one call', () => {
	const result = deviceScopeSelection(CATALOG, { platform: 'android', device: 'Galaxy S24', manufacturer: 'Samsung' });
	assert.equal(result.scope.platform, 'android');
	assert.deepEqual(result.selectedEnvIds, ['ENV-AND-SGS24-15-BRV-138']);
	assert.ok(result.browserFamilies.includes('brave'));
	assert.equal(result.configurationCount, 1);
	assert.equal(deviceScopeSelection(CATALOG, null), null);
});
