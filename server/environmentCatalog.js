/**
 * Apple device & browser compatibility catalog for QASE environments.
 *
 * This module is the single source of truth for the Apple environment matrix:
 * which devices exist (iPhone / iPad / macOS), which OS versions each supports,
 * which browsers are actually executable per platform (validated against
 * published vendor availability), and how Safari versions derive from
 * OS versions (Safari is never an independently installed browser).
 *
 * Everything here is frozen, deterministic data + pure functions — same pattern
 * as deviceProfiles.js. Browser/OS version lists are curated from vendors'
 * published platform lists and refreshed manually (see scripts/generate-environments.mjs
 * usage). Nothing in this module talks to the network or the database.
 *
 * Hard availability rules (expanded 2026-10, catalog 2026.10.1):
 *   - iOS / iPadOS: all seven App Store browsers generate environments —
 *     Safari + Chrome + Firefox + Edge + Opera + Brave + DuckDuckGo. Every
 *     iOS browser is required to use WebKit under the hood, so they are
 *     executable as distinct browser targets on real devices.
 *   - macOS: all seven browsers (Safari, Chrome, Firefox, Edge, Opera,
 *     Brave, DuckDuckGo).
 *   - Android: Chrome, Firefox, Edge, Opera, Brave, DuckDuckGo. Safari is
 *     NEVER generated — Apple does not ship Safari for Android.
 *   - Windows: Chrome, Firefox, Edge, Opera, Brave, DuckDuckGo. Safari is
 *     NEVER generated — Apple does not ship Safari for Windows.
 */

export const ENVIRONMENT_CATALOG_VERSION = '2026.10.2';

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

export const PLATFORMS = [
	{ id: 'ios', label: 'iPhone', os: 'iOS', envCode: 'IOS', deviceType: 'mobile', isRealDevice: true },
	{ id: 'ipados', label: 'iPad', os: 'iPadOS', envCode: 'IPADOS', deviceType: 'tablet', isRealDevice: true },
	{ id: 'macos', label: 'macOS', os: 'macOS', envCode: 'MAC', deviceType: 'desktop', isRealDevice: false },
	{ id: 'android', label: 'Android', os: 'Android', envCode: 'AND', deviceType: 'mobile', isRealDevice: true },
	{ id: 'windows', label: 'Windows', os: 'Windows', envCode: 'WIN', deviceType: 'desktop', isRealDevice: false }
];

// ---------------------------------------------------------------------------
// Browsers and per-platform availability
// ---------------------------------------------------------------------------

/**
 * @typedef {{ code: string, name: string, envCode: string, independentlyVersioned: boolean,
 *             platforms: string[], note?: string }} BrowserDef
 * `platforms` lists the platforms where the browser is executable in QASE.
 * Browsers absent from a platform's list are kept here for UI explanation only.
 */
export const BROWSERS = [
	{
		code: 'safari', name: 'Safari', envCode: 'SAF', independentlyVersioned: false,
		platforms: ['ios', 'ipados', 'macos'],
		note: 'Safari version is derived from the OS version (it ships with the OS), never chosen independently.'
	},
	{
		code: 'chrome', name: 'Chrome', envCode: 'CHR', independentlyVersioned: true,
		platforms: ['ios', 'ipados', 'macos', 'android', 'windows']
	},
	{
		code: 'firefox', name: 'Firefox', envCode: 'FF', independentlyVersioned: true,
		platforms: ['ios', 'ipados', 'macos', 'android', 'windows'],
		note: 'On iOS/iPadOS Firefox runs on the required WebKit engine; Android Firefox is scriptable via Gecko remote debugging.'
	},
	{
		code: 'edge', name: 'Edge', envCode: 'EDG', independentlyVersioned: true,
		platforms: ['ios', 'ipados', 'macos', 'android', 'windows'],
		note: 'On iOS/iPadOS Edge runs on the required WebKit engine.'
	},
	{
		code: 'opera', name: 'Opera', envCode: 'OPR', independentlyVersioned: true,
		platforms: ['ios', 'ipados', 'macos', 'android', 'windows'],
		note: 'On iOS/iPadOS Opera runs on the required WebKit engine.'
	},
	{
		code: 'brave', name: 'Brave', envCode: 'BRV', independentlyVersioned: true,
		platforms: ['ios', 'ipados', 'macos', 'android', 'windows'],
		note: 'Chromium-based; on iOS/iPadOS it runs on the required WebKit engine.'
	},
	{
		code: 'duckduckgo', name: 'DuckDuckGo', envCode: 'DDG', independentlyVersioned: true,
		platforms: ['ios', 'ipados', 'macos', 'android', 'windows'],
		note: 'Privacy browser on all five platforms; on iOS/iPadOS it runs on the required WebKit engine.'
	}
];

/**
 * Curated major browser versions available per browser family.
 * 2026.10.2 (#14166): deepened to match the reference catalog UI — each family
 * carries the latest majors plus a back-catalog (roughly the visible ~15 rows
 * of the reference; the 'N more' links in that UI count sub-minors and betas
 * which the environment model does not enumerate — majors only).
 */
export const BROWSER_VERSIONS = {
	chrome: ['140', '141', '142', '143', '144', '145', '146', '147', '148', '149', '150', '151', '152', '153', '154', '155', '156'],
	firefox: ['141', '142', '143', '144', '145', '146', '147', '148', '149', '150', '151', '152', '153', '154', '155', '156', '157', '158'],
	edge: ['140', '141', '142', '143', '144', '145', '146', '147', '148', '149', '150', '151', '152', '153', '154', '155', '156'],
	opera: ['122', '123', '124', '125', '126', '127', '128', '129', '130', '131', '132', '133', '134', '135', '136', '137'],
	brave: ['136', '137', '138', '139', '140'],
	duckduckgo: ['1', '2', '3']
};

/**
 * Safari versions shipped per macOS release (major.minor of the newest Safari
 * available on that macOS). Curated — Safari on macOS is OS-bound.
 */
export const MACOS_SAFARI_VERSIONS = {
	'High Sierra': '11.1.2',
	Mojave: '12.1.2',
	Catalina: '13.1.3',
	'Big Sur': '14.1.2',
	Monterey: '16.6',
	Ventura: '17.6',
	Sonoma: '18.6',
	Sequoia: '26.2',
	Tahoe: '26.4'
};

/**
 * Safari version for a platform/OS-version pair.
 * - iOS/iPadOS: Safari tracks the OS minor (iOS 18.3 -> Safari 18.3; iOS 26.0 -> Safari 26).
 * - macOS: curated map in MACOS_SAFARI_VERSIONS.
 * Returns null when the OS version is unknown.
 */
export function safariVersionFor(platformId, osVersion) {
	if (platformId === 'ios' || platformId === 'ipados') {
		if (typeof osVersion !== 'string') return null;
		const match = /^(\d+(?:\.\d+)?)/.exec(osVersion.trim());
		if (!match) return null;
		return match[1];
	}
	if (platformId === 'macos') {
		const key = typeof osVersion === 'string' ? osVersion.trim() : '';
		if (MACOS_SAFARI_VERSIONS[key]) return MACOS_SAFARI_VERSIONS[key];
		// Case-insensitive fallback (legacy single-word keys) — multi-word
		// macOS names like 'Big Sur' match exactly above.
		const lower = key.toLowerCase();
		for (const [name, version] of Object.entries(MACOS_SAFARI_VERSIONS)) {
			if (name.toLowerCase() === lower) return version;
		}
		return null;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AppleDevice
 * @property {string} slug          Fixed ENV-ID slug (IP16PRO, IPADMINI, …). For
 *                                  macOS the "device" is the OS itself; slugs are
 *                                  MONTEREY/VENTURA/… and there is one device
 *                                  record per macOS version.
 * @property {string} name          Display name ("iPhone 16 Pro").
 * @property {string} runtimeDeviceName  Remote runtime device identifier.
 * @property {string} platformId    ios | ipados | macos
 * @property {string} deviceType    mobile | tablet | desktop
 * @property {string} screenSize    Human screen size, e.g. "6.3 inch".
 * @property {string[]} osVersions  Curated supported OS versions.
 * @property {boolean} isRealDevice Real hardware (true for iOS/iPadOS; false for macOS VMs).
 * @property {Object} [emulation]   Optional local-emulation hints (viewport etc.) for
 *                                  non-remote execution (Phase 5/6).
 */

/** iPhone catalog — every requested model with curated supported OS versions. */
const IPHONE_SCREEN = (inches) => `${inches} inch`;

/** @type {AppleDevice[]} */
export const APPLE_DEVICES = [
	// --- iPhone 11 family (A13; supports up to iOS 26) ---
	iphone('IP11', 'iPhone 11', '414×896', 2, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP11PRO', 'iPhone 11 Pro', '375×812', 3, IPHONE_SCREEN('5.8'), ['17.0', '18.3', '26.0']),
	iphone('IP11PROMAX', 'iPhone 11 Pro Max', '414×896', 2, IPHONE_SCREEN('6.5'), ['17.0', '18.3', '26.0']),

	// --- iPhone 12 family (A14; supports up to iOS 26) ---
	iphone('IP12', 'iPhone 12', '390×844', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP12MINI', 'iPhone 12 mini', '375×812', 3, IPHONE_SCREEN('5.4'), ['17.0', '18.3', '26.0']),
	iphone('IP12PRO', 'iPhone 12 Pro', '390×844', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP12PROMAX', 'iPhone 12 Pro Max', '428×926', 3, IPHONE_SCREEN('6.7'), ['17.0', '18.3', '26.0']),

	// --- iPhone 13 family (A15; supports up to iOS 26) ---
	iphone('IP13', 'iPhone 13', '390×844', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP13MINI', 'iPhone 13 mini', '375×812', 3, IPHONE_SCREEN('5.4'), ['17.0', '18.3', '26.0']),
	iphone('IP13PRO', 'iPhone 13 Pro', '390×844', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP13PROMAX', 'iPhone 13 Pro Max', '428×926', 3, IPHONE_SCREEN('6.7'), ['17.0', '18.3', '26.0']),

	// --- iPhone 14 family (A15/A16; supports up to iOS 26) ---
	iphone('IP14', 'iPhone 14', '390×844', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP14PLUS', 'iPhone 14 Plus', '428×926', 3, IPHONE_SCREEN('6.7'), ['17.0', '18.3', '26.0']),
	iphone('IP14PRO', 'iPhone 14 Pro', '393×852', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP14PROMAX', 'iPhone 14 Pro Max', '430×932', 3, IPHONE_SCREEN('6.7'), ['17.0', '18.3', '26.0']),

	// --- iPhone 15 family (A16/A17 Pro; shipped with iOS 17, supports iOS 26) ---
	iphone('IP15', 'iPhone 15', '393×852', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP15PLUS', 'iPhone 15 Plus', '430×932', 3, IPHONE_SCREEN('6.7'), ['17.0', '18.3', '26.0']),
	iphone('IP15PRO', 'iPhone 15 Pro', '393×852', 3, IPHONE_SCREEN('6.1'), ['17.0', '18.3', '26.0']),
	iphone('IP15PROMAX', 'iPhone 15 Pro Max', '430×932', 3, IPHONE_SCREEN('6.7'), ['17.0', '18.3', '26.0']),

	// --- iPhone 16 family (A18/A18 Pro; shipped with iOS 18, no iOS 17) ---
	iphone('IP16', 'iPhone 16', '393×852', 3, IPHONE_SCREEN('6.1'), ['18.0', '18.3', '26.0']),
	iphone('IP16PLUS', 'iPhone 16 Plus', '430×932', 3, IPHONE_SCREEN('6.7'), ['18.0', '18.3', '26.0']),
	iphone('IP16PRO', 'iPhone 16 Pro', '402×874', 3, IPHONE_SCREEN('6.3'), ['18.0', '18.3', '26.0']),
	iphone('IP16PROMAX', 'iPhone 16 Pro Max', '440×956', 3, IPHONE_SCREEN('6.9'), ['18.0', '18.3', '26.0']),
	iphone('IP16E', 'iPhone 16e', '390×844', 3, IPHONE_SCREEN('6.1'), ['18.0', '18.3', '26.0']),

	// --- iPhone 17 family (ships with iOS 26 only) ---
	iphone('IP17', 'iPhone 17', '402×874', 3, IPHONE_SCREEN('6.3'), ['26.0']),
	iphone('IP17AIR', 'iPhone 17 Air', '420×912', 3, IPHONE_SCREEN('6.5'), ['26.0']),
	iphone('IP17PRO', 'iPhone 17 Pro', '402×874', 3, IPHONE_SCREEN('6.3'), ['26.0']),
	iphone('IP17PROMAX', 'iPhone 17 Pro Max', '440×956', 3, IPHONE_SCREEN('6.9'), ['26.0']),

	// --- iPad (representative current generation per line) ---
	ipad('IPAD', 'iPad', 'iPad 10th Gen', '820×1180', 2, '10.9 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADMINI', 'iPad mini', 'iPad mini (7th Gen)', '744×1133', 2, '8.3 inch', ['18.3', '26.0']),
	ipad('IPADAIR', 'iPad Air', 'iPad Air (5th Gen)', '820×1180', 2, '10.9 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADPRO11', 'iPad Pro 11-inch', 'iPad Pro 11 (4th Gen)', '834×1194', 2, '11.0 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADPRO129', 'iPad Pro 12.9-inch', 'iPad Pro 12.9 (6th Gen)', '1024×1366', 2, '12.9 inch', ['17.0', '18.3', '26.0']),
	ipad('IPADPRO13', 'iPad Pro 13-inch', 'iPad Pro 13 (M4)', '1032×1376', 2, '13.0 inch', ['18.3', '26.0']),

	// --- macOS (one "device" per OS version; BrowserStack desktop has no deviceName) ---
	mac('HIGH-SIERRA', 'macOS High Sierra', '10.13'),
	mac('MOJAVE', 'macOS Mojave', '10.14'),
	mac('CATALINA', 'macOS Catalina', '10.15'),
	mac('BIG-SUR', 'macOS Big Sur', '11'),
	mac('MONTEREY', 'macOS Monterey', '12'),
	mac('VENTURA', 'macOS Ventura', '13'),
	mac('SONOMA', 'macOS Sonoma', '14'),
	mac('SEQUOIA', 'macOS Sequoia', '15'),
	mac('TAHOE', 'macOS Tahoe', '26')
];

// ---------------------------------------------------------------------------
// Android + Windows devices (Phase 9 cross-platform catalog)
// ---------------------------------------------------------------------------

/** @typedef {Object} GenericDevice — same shape as AppleDevice, plus manufacturer. */

function androidDevice(slug, name, manufacturer, runtimeDeviceName, osVersions, viewport = '390×844') {
	const [width, height] = viewport.split('×').map(Number);
	return {
		slug, name, manufacturer,
		runtimeDeviceName,
		platformId: 'android',
		deviceType: 'mobile',
		screenSize: '—',
		osVersions,
		isRealDevice: true,
		emulation: { viewport: { width, height }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }
	};
}

function windowsDevice(slug, name, deviceType) {
	return {
		slug, name, manufacturer: 'Microsoft',
		runtimeDeviceName: null,
		platformId: 'windows',
		deviceType,
		screenSize: '—',
		osVersions: ['10', '11'],
		isRealDevice: false,
		emulation: { viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25, isMobile: false, hasTouch: deviceType === 'tablet' }
	};
}

export const ANDROID_DEVICES = [
	// Samsung — Galaxy S21–S26, Note/A/Z series
	androidDevice('GALS21', 'Galaxy S21', 'Samsung', 'Samsung Galaxy S21', ['12', '13']),
	androidDevice('GALS22', 'Galaxy S22', 'Samsung', 'Samsung Galaxy S22', ['13', '14']),
	androidDevice('GALS23', 'Galaxy S23', 'Samsung', 'Samsung Galaxy S23', ['13', '14', '15']),
	androidDevice('GALS24', 'Galaxy S24', 'Samsung', 'Samsung Galaxy S24', ['14', '15']),
	androidDevice('GALS25', 'Galaxy S25', 'Samsung', 'Samsung Galaxy S25', ['15']),
	androidDevice('GALS26', 'Galaxy S26', 'Samsung', 'Samsung Galaxy S26', ['15', '16']),
	androidDevice('GALNOTE', 'Galaxy Note 20', 'Samsung', 'Samsung Galaxy Note 20', ['12', '13']),
	androidDevice('GALA54', 'Galaxy A54', 'Samsung', 'Samsung Galaxy A54', ['13', '14']),
	androidDevice('GALZFOLD', 'Galaxy Z Fold', 'Samsung', 'Samsung Galaxy Z Fold 5', ['13', '14', '15']),
	androidDevice('GALZFLIP', 'Galaxy Z Flip', 'Samsung', 'Samsung Galaxy Z Flip 5', ['13', '14', '15']),
	// Google Pixel 6–10, Pro variants, Fold
	androidDevice('PIXEL6', 'Pixel 6', 'Google', 'Google Pixel 6', ['12', '13', '14']),
	androidDevice('PIXEL7', 'Pixel 7', 'Google', 'Google Pixel 7', ['13', '14', '15']),
	androidDevice('PIXEL7PRO', 'Pixel 7 Pro', 'Google', 'Google Pixel 7 Pro', ['13', '14', '15']),
	androidDevice('PIXEL8', 'Pixel 8', 'Google', 'Google Pixel 8', ['14', '15']),
	androidDevice('PIXEL8PRO', 'Pixel 8 Pro', 'Google', 'Google Pixel 8 Pro', ['14', '15']),
	androidDevice('PIXEL9', 'Pixel 9', 'Google', 'Google Pixel 9', ['14', '15', '16']),
	androidDevice('PIXEL9PRO', 'Pixel 9 Pro', 'Google', 'Google Pixel 9 Pro', ['14', '15', '16']),
	androidDevice('PIXEL10', 'Pixel 10', 'Google', 'Google Pixel 10', ['15', '16']),
	androidDevice('PIXELFOLD', 'Pixel Fold', 'Google', 'Google Pixel Fold', ['14', '15']),
	// OnePlus 9–13, 13R
	androidDevice('OP9', 'OnePlus 9', 'OnePlus', 'OnePlus 9', ['12', '13']),
	androidDevice('OP10', 'OnePlus 10 Pro', 'OnePlus', 'OnePlus 10 Pro', ['12', '13', '14']),
	androidDevice('OP11', 'OnePlus 11', 'OnePlus', 'OnePlus 11', ['13', '14']),
	androidDevice('OP12', 'OnePlus 12', 'OnePlus', 'OnePlus 12', ['14', '15']),
	androidDevice('OP13', 'OnePlus 13', 'OnePlus', 'OnePlus 13', ['15']),
	androidDevice('OP13R', 'OnePlus 13R', 'OnePlus', 'OnePlus 13R', ['15']),
	// Motorola — Edge, Moto G, Razr
	androidDevice('MOTOEDGE', 'Motorola Edge 50', 'Motorola', 'Motorola Edge 50', ['13', '14', '15']),
	androidDevice('MOTOG', 'Moto G Power', 'Motorola', 'Moto G Power', ['12', '13', '14']),
	androidDevice('MOTORAZR', 'Motorola Razr', 'Motorola', 'Motorola Razr 40', ['13', '14', '15']),
	// Xiaomi / Redmi
	androidDevice('XIAOMI14', 'Xiaomi 14', 'Xiaomi', 'Xiaomi 14', ['13', '14', '15']),
	androidDevice('REDMINOTE', 'Redmi Note 13', 'Xiaomi', 'Redmi Note 13', ['13', '14']),
	// Oppo — Reno, Find, A
	androidDevice('OPPORENO', 'Oppo Reno 11', 'Oppo', 'Oppo Reno 11', ['13', '14']),
	androidDevice('OPPOFIND', 'Oppo Find X7', 'Oppo', 'Oppo Find X7', ['14', '15']),
	// Vivo — V, X, Y
	androidDevice('VIVOV', 'Vivo V30', 'Vivo', 'Vivo V30', ['14', '15']),
	androidDevice('VIVOX', 'Vivo X100', 'Vivo', 'Vivo X100', ['14', '15']),
	// Realme — GT, Number, C
	androidDevice('REALMEGT', 'Realme GT 6', 'Realme', 'Realme GT 6', ['14', '15']),
	androidDevice('REALMEC', 'Realme C67', 'Realme', 'Realme C67', ['13', '14']),
	// Nothing
	androidDevice('NOTHPHONE', 'Nothing Phone (2a)', 'Nothing', 'Nothing Phone (2a)', ['14', '15'])
];

export const WINDOWS_DEVICES = [
	windowsDevice('WINLAPTOP', 'Windows Laptop', 'desktop'),
	windowsDevice('WINDESKTOP', 'Windows Desktop', 'desktop'),
	windowsDevice('WINTABLET', 'Windows Tablet', 'tablet')
];

/** All catalog devices across platforms (Apple unchanged, then Android, then Windows). */
export const ALL_DEVICES = [...APPLE_DEVICES, ...ANDROID_DEVICES, ...WINDOWS_DEVICES];

/** Manufacturer for a device slug — Apple devices are their own manufacturer. */
export function manufacturerFor(deviceOrSlug) {
	const device = typeof deviceOrSlug === 'string'
		? ALL_DEVICES.find((candidate) => candidate.slug === deviceOrSlug)
		: deviceOrSlug;
	if (!device) return null;
	return device.manufacturer ?? (device.platformId === 'ios' || device.platformId === 'ipados' ? 'Apple' : 'Apple');
}

function iphone(slug, name, viewport, dpr, screenSize, osVersions) {
	const [width, height] = viewport.split('×').map(Number);
	return {
		slug,
		name,
		runtimeDeviceName: name,
		platformId: 'ios',
		deviceType: 'mobile',
		screenSize,
		osVersions,
		isRealDevice: true,
		emulation: { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true }
	};
}

function ipad(slug, name, runtimeDeviceName, viewport, dpr, screenSize, osVersions) {
	const [width, height] = viewport.split('×').map(Number);
	return {
		slug,
		name,
		runtimeDeviceName,
		platformId: 'ipados',
		deviceType: 'tablet',
		screenSize,
		osVersions,
		isRealDevice: true,
		emulation: { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true }
	};
}

function mac(slug, name, version) {
	return {
		slug,
		name,
		runtimeDeviceName: null,
		platformId: 'macos',
		deviceType: 'desktop',
		screenSize: '—',
		osVersions: [name.replace('macOS ', '')],
		isRealDevice: false,
		emulation: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
		macOsVersion: version
	};
}

const DEVICE_BY_NAME = new Map(ALL_DEVICES.map((device) => [device.name, device]));
const DEVICE_BY_SLUG = new Map(ALL_DEVICES.map((device) => [device.slug, device]));
const PLATFORM_BY_ID = new Map(PLATFORMS.map((platform) => [platform.id, platform]));
const BROWSER_BY_CODE = new Map(BROWSERS.map((browser) => [browser.code, browser]));

export function getPlatform(id) {
	return PLATFORM_BY_ID.get(id) ?? null;
}

export function getBrowser(code) {
	return BROWSER_BY_CODE.get(String(code ?? '').toLowerCase()) ?? null;
}

export function getDevice(nameOrSlug) {
	return DEVICE_BY_NAME.get(nameOrSlug) ?? DEVICE_BY_SLUG.get(nameOrSlug) ?? null;
}

// ---------------------------------------------------------------------------
// Combination validation
// ---------------------------------------------------------------------------

/**
 * Whether a (platform, device, osVersion, browser[, browserVersion]) combination
 * is executable in QASE. Returns { ok, reason } so callers can surface
 * a human-readable reason on rejection.
 */
export function isCombinationSupported(platformId, device, osVersion, browser, browserVersion) {
	const platform = PLATFORM_BY_ID.get(platformId);
	if (!platform) return { ok: false, reason: `Unknown platform "${platformId}"` };

	const deviceRecord = typeof device === 'string' ? getDevice(device) : device;
	if (!deviceRecord || deviceRecord.platformId !== platformId) {
		return { ok: false, reason: `Unknown or mismatched device "${device?.name ?? device}" for platform ${platform.label}` };
	}
	if (!deviceRecord.osVersions.includes(osVersion)) {
		// Windows accepts 'Windows 11' / 'Win 11' spellings — normalize then recheck.
		const windowsNormalized = platformId === 'windows'
			? String(osVersion).replace(/^.*?(\d+(?:\.\d+)*)\s*$/,'$1')
			: null;
		if (!(platformId === 'windows' && deviceRecord.osVersions.includes(windowsNormalized))) {
			return { ok: false, reason: `${deviceRecord.name} does not support OS version ${osVersion} (supported: ${deviceRecord.osVersions.join(', ')})` };
		}
	}

	const browserRecord = typeof browser === 'string' ? getBrowser(browser) : browser;
	if (!browserRecord) {
		return { ok: false, reason: `Unknown browser "${browser}"` };
	}
	if (!browserRecord.platforms.includes(platformId)) {
		return { ok: false, reason: `${browserRecord.name} is not supported on ${platform.label}${browserRecord.note ? ` — ${browserRecord.note}` : ''}` };
	}

	if (browserRecord.code === 'safari') {
		if (browserVersion !== undefined && browserVersion !== null) {
			const derived = safariVersionFor(platformId, osVersion);
			if (String(browserVersion) !== derived) {
				return { ok: false, reason: `Safari version is derived from the OS: ${platform.os} ${osVersion} ships Safari ${derived}, not ${browserVersion}` };
			}
		}
		return { ok: true };
	}

	if (!browserRecord.independentlyVersioned) {
		return { ok: false, reason: `${browserRecord.name} has no independently selectable version on this platform` };
	}
	const allowed = BROWSER_VERSIONS[browserRecord.code] ?? [];
	if (browserVersion !== undefined && browserVersion !== null && !allowed.includes(String(browserVersion))) {
		return { ok: false, reason: `${browserRecord.name} version ${browserVersion} is not available (available: ${allowed.join(', ')})` };
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// ENV ID + environment generation
// ---------------------------------------------------------------------------

/** Normalize an OS version for use in an ENV ID (keeps dots, strips spaces): "18.3", "Sonoma". */
function osVersionToken(platformId, osVersion) {
	if (platformId === 'macos') {
		return osVersion.replace(/\s+/g, '').toUpperCase();
	}
	if (platformId === 'windows') {
		// 'Windows 11' -> WIN-11; '11' -> 11
		const match = /(\d+(?:\.\d+)*)\s*$/.exec(String(osVersion).trim());
		return match ? match[1] : String(osVersion).replace(/\s+/g, '');
	}
	return osVersion;
}

/**
 * Deterministic ENV ID: ENV-{PLAT}-{DEVICE_SLUG}-{OSVER}-{BROWSER3}-{BROWSER_MAJOR}.
 * On macOS the device IS the OS version, so the OS token is omitted to avoid
 * duplicating it: ENV-MAC-SONOMA-CHR-140 (not ENV-MAC-SONOMA-SONOMA-CHR-140).
 */
export function buildEnvId(platformId, deviceSlug, osVersion, browserEnvCode, browserVersion) {
	const plat = PLATFORM_BY_ID.get(platformId)?.envCode ?? '??';
	if (platformId === 'macos' || platformId === 'windows') {
		// Windows devices are generic form factors (Laptop/Desktop/Tablet) and the
		// OS version carries the distinguishing information: ENV-WIN-11-CHR-141.
		if (platformId === 'windows') {
			return `ENV-${plat}-${osVersionToken(platformId, osVersion)}-${browserEnvCode}-${browserVersion}-${deviceSlug}`;
		}
		return `ENV-${plat}-${deviceSlug}-${browserEnvCode}-${browserVersion}`;
	}
	return `ENV-${plat}-${deviceSlug}-${osVersionToken(platformId, osVersion)}-${browserEnvCode}-${browserVersion}`;
}

/**
 * The full deterministic environment matrix. Pure — callers persist the result.
 * Only executable combinations are emitted.
 */
export function generateEnvironments() {
	const environments = [];
	for (const device of ALL_DEVICES) {
		const platform = PLATFORM_BY_ID.get(device.platformId);
		for (const osVersion of device.osVersions) {
			for (const browser of BROWSERS) {
				if (!browser.platforms.includes(device.platformId)) continue;
				if (browser.code === 'safari') {
					const safariVersion = safariVersionFor(device.platformId, osVersion);
					if (!safariVersion) continue;
					environments.push(buildEnvironment(device, platform, osVersion, browser, safariVersion, safariVersion));
				} else {
					for (const version of BROWSER_VERSIONS[browser.code] ?? []) {
						environments.push(buildEnvironment(device, platform, osVersion, browser, version, version));
					}
				}
			}
		}
	}
	return environments;
}

function buildEnvironment(device, platform, osVersion, browser, browserVersion, capabilityBrowserVersion) {
	const envId = buildEnvId(device.platformId, device.slug, osVersion, browser.envCode, browserVersion);
	const capabilities = device.platformId === 'macos'
		? {
			browserName: browser.code,
			browserVersion: capabilityBrowserVersion,
			os: 'OS X',
			osVersion
		}
		: device.platformId === 'android'
			? {
				browserName: browser.code,
				browserVersion: capabilityBrowserVersion,
				os: 'android',
				osVersion,
				deviceName: device.runtimeDeviceName,
				realMobile: true
			}
			: device.platformId === 'windows'
				? {
					browserName: browser.code,
					browserVersion: capabilityBrowserVersion,
					os: 'Windows',
					osVersion
				}
				: device.platformId === 'ipados'
					? {
						browserName: browser.code,
						...(browser.code === 'safari' ? {} : { browserVersion: capabilityBrowserVersion }),
						os: 'ios',
						osVersion,
						deviceName: device.runtimeDeviceName,
						realMobile: true
					}
					: {
						browserName: browser.code,
						...(browser.code === 'safari' ? {} : { browserVersion: capabilityBrowserVersion }),
						os: 'ios',
						osVersion,
						deviceName: device.runtimeDeviceName,
						realMobile: true
					};
	return {
		envId,
		platform: device.platformId,
		platformLabel: platform.label,
		device: device.name,
		...(device.manufacturer ? { manufacturer: device.manufacturer } : {}),
		os: platform.os,
		osVersion,
		browser: browser.name,
		browserCode: browser.code,
		browserVersion: String(browserVersion),
		deviceType: device.deviceType,
		screenSize: device.screenSize,
		screenResolution: device.emulation?.viewport
			? `${device.emulation.viewport.width}x${device.emulation.viewport.height}`
			: null,
		orientation: device.deviceType === 'desktop' ? null : 'portrait',
		executionProvider: 'environment',
		isRealDevice: device.isRealDevice,
		active: true,
		runtimeCapabilities: capabilities
	};
}

/**
 * Documentation surface for the UI: why browsers are (un)available per platform.
 */
export function availabilityReport() {
	return PLATFORMS.map((platform) => ({
		platform: platform.id,
		platformLabel: platform.label,
		available: BROWSERS.filter((browser) => browser.platforms.includes(platform.id)).map((browser) => browser.name),
		unavailable: BROWSERS
			.filter((browser) => !browser.platforms.includes(platform.id))
			.map((browser) => ({ browser: browser.name, reason: browser.note ?? 'Not supported on this platform.' }))
	}));
}
