/**
 * Device context (Phase: Mobile Live View)
 *
 * Maps an incoming mission's device preference to a REAL Playwright device
 * descriptor (UA / viewport / DPR / touch). The descriptor is applied to the
 * agent's browser CONTEXT at runtime construction — same seam as the existing
 * browser bridge — so mobile executions genuinely run as the chosen device,
 * not a CSS resize.
 *
 * Design constraints honored:
 *   - No changes to the @cleanslate/sdk package.
 *   - Desktop behavior unchanged (no device === today's 1440×900 context).
 *   - No duplicate execution engine: this is a thin, passive configuration
 *     layer feeding the ONE existing agent runtime.
 *   - Nothing is faked: the UI renders whatever the real Playwright context
 *     reports via the existing frame.viewport payload.
 */

import { devices as playwrightDevices } from 'playwright-core';

/** Named device aliases accepted from missions / API callers. */
export const DEVICE_ALIASES = {
	// Apple phones
	'iphone 15 pro': 'iPhone 15 Pro',
	'iphone 15': 'iPhone 15',
	'iphone 14 pro max': 'iPhone 14 Pro Max',
	'iphone 14 pro': 'iPhone 14 Pro',
	'iphone 14': 'iPhone 14',
	'iphone 13': 'iPhone 13',
	'iphone se': 'iPhone SE',
	// Android phones
	'pixel 8': 'Pixel 8',
	'pixel 7': 'Pixel 7',
	'pixel 5': 'Pixel 5',
	'galaxy s9+': 'Galaxy S9+',
	// Tablets
	'ipad pro 11': 'iPad Pro 11',
	'ipad mini': 'iPad Mini',
	'ipad (gen 7)': 'iPad (gen 7)',
	'kindle fire hdx': 'Kindle Fire HDX',
	'nexus 7': 'Nexus 7'
};

/** Playwright browser engine per platform (informational — local runs use Chromium). */
const ENGINE_BY_PLATFORM = {
	ios: 'webkit',
	android: 'chromium'
};

/**
 * BUILD B0.3 — deterministic class defaults.
 * 'mobile' / 'tablet' class strings (mission constraints, legacy callers)
 * resolve to one canonical device each — never a silent desktop downgrade.
 */
export const DEFAULT_DEVICE_BY_CLASS = {
	mobile: 'iPhone 15',
	tablet: 'iPad Pro 11'
};

/**
 * BUILD B0.3 — devices BrowserStack's Playwright CDP endpoint can run on
 * REAL hardware (Android + Chrome only: the CDP path cannot drive iOS).
 * Maps our resolved device name → BrowserStack's canonical caps.
 */
export const BROWSERSTACK_REAL_DEVICES = {
	'Pixel 8': 'Google Pixel 8',
	'Pixel 7': 'Google Pixel 7',
	'Pixel 5': 'Google Pixel 5',
	'Galaxy S9+': 'Samsung Galaxy S9 Plus'
};

/** True when the device name has a BrowserStack REAL_DEVICE execution path. */
export function isBrowserstackRealDevice(name) {
	return Object.prototype.hasOwnProperty.call(BROWSERSTACK_REAL_DEVICES, String(name ?? ''));
}

/**
 * BUILD B0.3 — validate a normalized device request WITHOUT silently
 * downgrading. Returns { ok, deviceName, error }:
 *   ok:true  + deviceName   → supported named device
 *   ok:true  + deviceName:null → desktop (no device / 'desktop' / 'none' / '')
 *   ok:false + error        → unsupported request — caller MUST fail
 */
export function validateDeviceRequest(input) {
	const request = normalizeDeviceRequest(input);
	if (request == null) return { ok: true, deviceName: null };
	if (/^(mobile|tablet|phone)$/i.test(request)) {
		return { ok: true, deviceName: DEFAULT_DEVICE_BY_CLASS[/^tablet$/i.test(request) ? 'tablet' : 'mobile'] };
	}
	const name = DEVICE_ALIASES[request]
		|| DEVICE_ALIASES[String(request).toLowerCase()]
		|| (playwrightDevices[request] ? request : null);
	if (!name || !playwrightDevices[name]) {
		return {
			ok: false,
			deviceName: null,
			error: `Unsupported device configuration: ${String(input?.device ?? input?.deviceName ?? input).slice(0, 60)}. Supported devices: ${Object.keys(DEVICE_ALIASES).join(', ')}.`
		};
	}
	return { ok: true, deviceName: name };
}

/**
 * Resolves a device request into a full device context, or null for desktop.
 *
 * Accepts either a device name string ("iPhone 15 Pro", "Pixel 8") or a
 * structured object { device: 'Pixel 8' } / { device: 'mobile' } /
 * { deviceType: 'phone' } / { mode: 'mobile' } — callers vary.
 *
 * BUILD B0.3: class strings ('mobile'/'tablet') resolve to the canonical
 * class device so they no longer silently downgrade to desktop. Unknown
 * names still return null HERE (legacy behavior for the agent runtime
 * fallback) — API boundaries use validateDeviceRequest() to fail loudly.
 *
 * Returns null when nothing mobile/tablet-like is requested (desktop default).
 */
export function resolveDeviceContext(input) {
	const request = normalizeDeviceRequest(input);
	if (!request) return null;
	let name = null;
	if (/^(mobile|tablet|phone)$/i.test(request)) {
		name = DEFAULT_DEVICE_BY_CLASS[/^tablet$/i.test(request) ? 'tablet' : 'mobile'];
	} else {
		name = DEVICE_ALIASES[request] || DEVICE_ALIASES[String(request).toLowerCase()]
			|| (playwrightDevices[request] ? request : null);
	}
	if (!name) return null;
	const descriptor = playwrightDevices[name];
	if (!descriptor) return null;
	return buildDeviceContext(name, descriptor);
}

function normalizeDeviceRequest(input) {
	if (input == null) return null;
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (!trimmed || /^(none|desktop|default)$/i.test(trimmed)) return null;
		return trimmed;
	}
	if (typeof input === 'object') {
		// Accept { device: ... } / { deviceName: ... } / { mode: ... } /
		// { deviceType: ... } shapes
		const raw = input.device ?? input.deviceName ?? input.mode ?? input.deviceType;
		if (raw == null) return null;
		if (typeof raw === 'string') {
			const trimmed = raw.trim();
			if (!trimmed || /^(none|desktop|default)$/i.test(trimmed)) return null;
			return trimmed;
		}
		return null;
	}
	return null;
}

function buildDeviceContext(name, descriptor) {
	const requestedEngine = descriptor.defaultBrowserType === 'webkit' ? 'webkit' : 'chromium';
	// Local execution runs the installed Chromium (no WebKit binaries). iOS
	// devices still get REAL context-level emulation — UA, viewport, DPR,
	// isMobile, hasTouch — only the rendering engine differs from a physical
	// iPhone. Record both so the UI can state it truthfully.
	const engine = 'chromium';
	return {
		/** Resolved Playwright registry name, e.g. "iPhone 15 Pro". */
		deviceName: name,
		/** 'phone' | 'tablet' */
		deviceType: /ipad|tablet|nexus 7|kindle/i.test(name) ? 'tablet' : 'phone',
		/** Human OS label, e.g. "iOS 17" / "Android 14". */
		os: extractOs(name, descriptor.userAgent),
		/** Human browser label from the UA actually applied, e.g. "Safari" / "Chrome". */
		browser: descriptor.defaultBrowserType === 'webkit' ? 'Safari' : 'Chrome',
		/** Raw UA string actually applied to the context. */
		userAgent: descriptor.userAgent,
		/** Actual Playwright viewport for this device. */
		viewport: { width: descriptor.viewport.width, height: descriptor.viewport.height },
		/** deviceScaleFactor actually applied. */
		deviceScaleFactor: descriptor.deviceScaleFactor ?? 1,
		isMobile: descriptor.isMobile ?? true,
		hasTouch: descriptor.hasTouch ?? true,
		/** Engine that actually runs the context (local Chromium). */
		engine,
		/** Engine the device's platform would prefer (webkit for iOS). */
		engineRequested: requestedEngine,
		/** True when the platform engine differs from what actually runs. */
		engineEmulated: requestedEngine !== engine,
		source: 'playwright-registry'
	};
}

function extractOs(name, ua) {
	if (/iphone|ipad/i.test(name)) {
		const m = ua.match(/iPhone OS (\d+)[._](\d+)/i) || ua.match(/CPU OS (\d+)[._](\d+)/i);
		if (m) return `iOS ${m[1]}.${m[2]}`;
	}
	if (/pixel|galaxy|nexus/i.test(name)) {
		const m = ua.match(/Android ([\d.]+)/i);
		if (m) return `Android ${m[1].replace(/\.$/, '')}`;
	}
	return null;
}

/** Context options passed to browser.newContext() for this device. */
export function contextOptionsFor(deviceContext) {
	if (!deviceContext) return null;
	return {
		viewport: { ...deviceContext.deviceName && deviceContext.viewport },
		userAgent: deviceContext.userAgent,
		deviceScaleFactor: deviceContext.deviceScaleFactor,
		isMobile: deviceContext.isMobile,
		hasTouch: deviceContext.hasTouch
	 };
}

/** Human-readable one-liner for logs and the device info strip. */
export function describeDevice(deviceContext) {
	if (!deviceContext) return 'Desktop · 1440×900';
	const bits = [deviceContext.deviceName, deviceContext.os, deviceContext.browser].filter(Boolean);
	return bits.join(' · ');
}
