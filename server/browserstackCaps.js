/**
 * C4 — shared BrowserStack caps builder.
 *
 * Extracted VERBATIM from replay.js (BUILD B0.2/B0.3 logic unchanged) so the
 * agent path (browserstackAgentRuntime.js) consumes the SAME caps builder as
 * the replay/test-case path. replay.js imports and re-exports
 * `resolveLaunchPlan` from here — there is exactly one caps builder in the
 * codebase. Do not duplicate this logic anywhere else.
 *
 * Adds `buildBrowserstackCdpUrl(caps)` (extracted from replay's launch path)
 * and `resolveAgentExecutionPlan` for the agent/mission path:
 *   - Explicit provider='browserstack' selects BrowserStack regardless of the
 *     global browserstackEnabled flag (an explicit mission request wins), but
 *     requires usable credentials — missing/needs-re-entry credentials are a
 *     deterministic error, NEVER a silent local run (approved C4 decisions
 *     3+4).
 *   - Device semantics mirror the replay B0.3 rules: only
 *     BROWSERSTACK_REAL_DEVICES are supported; anything else is a
 *     deterministic unsupported error.
 */

import {
	isBrowserstackRealDevice,
	BROWSERSTACK_REAL_DEVICES
} from './deviceContext.js';

const BROWSERSTACK_OS_MAP = {
	chrome: { browser: 'chrome', os: 'OS X', os_version: 'Sonoma' },
	firefox: { browser: 'firefox', os: 'OS X', os_version: 'Sonoma' },
	safari: { browser: 'Safari', os: 'OS X', os_version: 'Sonoma' }
};

export { BROWSERSTACK_OS_MAP };

/**
 * Pure launch-plan resolver (BUILD B0.2 — unit-testable without a browser).
 * Returns { mode: 'browserstack' | 'local', strict, caps?, osInfo?, device? }.
 *
 * BUILD B0.3: opts.device (a RESOLVED Playwright device name) adds
 * real-device / emulated-device semantics:
 *   - BrowserStack selected + device in BROWSERSTACK_REAL_DEVICES
 *     → caps carry { device, os:'android', real_mobile:true } (REAL_DEVICE)
 *   - BrowserStack selected + device NOT real-device capable (e.g. iOS)
 *     → { unsupported: 'Unsupported device configuration: <name> …' }
 *     deterministic — the caller must fail; NEVER substitutes or downgrades.
 *   - BrowserStack NOT selected → local emulated context (device descriptor
 *     applied to browser.newContext — see launchLocal/launchBrowser).
 */
/**
 * P0-F1 — BrowserStack configuration validation, BEFORE any execution attempt.
 *
 * browserstackEnabled with only one of user/key present is an INCOMPLETE
 * configuration, not a "silent local" one: previously resolveLaunchPlan treated
 * user-set+key-missing as a selected BrowserStack run, built caps carrying an
 * EMPTY access key, and the CDP endpoint then failed with an auth error — while
 * the run's provenance claimed provider 'browserstack' even though no
 * BrowserStack session was ever possible. That phantom provider claim is an
 * execution-truth defect (observed live: execution-provenance suite [5]/[8]
 * recorded browserstack on runs whose credentials could never connect).
 *
 * Returns { ok:true } only when BOTH credentials are present and non-empty.
 * The message never contains the credential values themselves.
 */
export function validateBrowserstackConfig(config = {}) {
	const user = typeof config.browserstackUser === 'string' ? config.browserstackUser.trim() : '';
	const key = typeof config.browserstackKey === 'string' ? config.browserstackKey.trim() : '';
	if (!user || !key) {
		const missing = !user && !key
			? 'username and access key'
			: (!user ? 'username' : 'access key');
		return {
			ok: false,
			code: 'invalid_credentials',
			error: `BrowserStack is enabled but its credentials are incomplete (missing ${missing}). Execution was not attempted: add the BrowserStack username and access key in Settings (or disable BrowserStack), verify the connection, then retry.`
		};
	}
	return { ok: true };
}

export function resolveLaunchPlan(config = {}, opts = {}) {
	const browserstackSelected = config.browserstackEnabled === true
		&& Boolean(config.browserstackUser) && Boolean(config.browserstackKey);
	const deviceName = opts.device != null ? String(opts.device) : null;
	if (!browserstackSelected) {
		// P0-F1 — enabled with INCOMPLETE credentials is a deterministic
		// configuration error, never a silent local run. Enabled with neither
		// credential stored also lands here (an operator turned the provider on
		// without ever saving credentials): the run must fail truthfully as a
		// provider configuration failure.
		if (config.browserstackEnabled === true) {
			const check = validateBrowserstackConfig(config);
			return {
				mode: 'error',
				code: check.code,
				error: check.error,
				strict: true
			};
		}
		return { mode: 'local', strict: false, device: deviceName };
	}
	// ── BrowserStack real-device path (B0.3) ──
	if (deviceName) {
		if (!isBrowserstackRealDevice(deviceName)) {
			return {
				mode: 'browserstack',
				strict: true,
				device: deviceName,
				unsupported: `Unsupported device configuration: ${deviceName} cannot run on BrowserStack real devices. Real devices available via the Playwright CDP path: ${Object.keys(BROWSERSTACK_REAL_DEVICES).join(', ')}.`
			};
		}
		if ((opts.browser || 'chrome') !== 'chrome') {
			return {
				mode: 'browserstack',
				strict: true,
				device: deviceName,
				unsupported: `Unsupported device configuration: BrowserStack real-device execution requires Chrome (requested ${(opts.browser || 'chrome')}).`
			};
		}
		const caps = {
			browser: 'chrome',
			os: 'android',
			os_version: null,
			device: BROWSERSTACK_REAL_DEVICES[deviceName],
			real_mobile: 'true',
			// C4.1-FIX — BrowserStack's Playwright CDP contract reads
			// 'browserstack.username' / 'browserstack.accessKey' (documented
			// capability names). The previous 'browserstack.user'/'browserstack.key'
			// names were ignored by the CDP endpoint, which then closed with
			// 1001 "Invalid username or password" — while REST Basic-auth
			// succeeded with the same credentials.
			'browserstack.username': config.browserstackUser,
			'browserstack.accessKey': config.browserstackKey,
			'name': opts.testName || `Qase test run`,
			'browserstack.local': 'false'
		};
		return { mode: 'browserstack', strict: true, caps, osInfo: { browser: 'chrome', os: 'android', os_version: null }, browserType: 'chrome', device: deviceName };
	}
	const browserType = opts.browser || 'chrome';
	const osInfo = BROWSERSTACK_OS_MAP[browserType] || BROWSERSTACK_OS_MAP.chrome;
	const caps = {
		browser: osInfo.browser,
		os: osInfo.os,
		os_version: osInfo.os_version,
		// C4.1-FIX — documented BrowserStack Playwright CDP capability names
		// (was browserstack.user/browserstack.key — ignored by the endpoint).
		'browserstack.username': config.browserstackUser,
		'browserstack.accessKey': config.browserstackKey,
		'name': opts.testName || `Qase test run`,
		'browserstack.local': 'false'
	};
	// B0.2: STRICT by default — silent local fallback is forbidden when the
	// user explicitly selected BrowserStack. browserstackStrict=false (set
	// deliberately) is the only escape hatch, and even then the fallback is
	// LOUDLY logged and the result still records the failed BS attempt.
	const strict = config.browserstackStrict !== false;
	return { mode: 'browserstack', strict, caps, osInfo, browserType, device: null };
}

/** The one canonical BrowserStack CDP endpoint builder (extracted from replay.js). */
export function buildBrowserstackCdpUrl(caps) {
	return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
}

/**
 * C4 — execution plan for the AUTONOMOUS AGENT path.
 *
 * Selection rules (approved decisions 3+4):
 *   - Only an EXPLICIT provider request selects BrowserStack. The global
 *     browserstackEnabled flag does NOT reroute agent missions (it continues
 *     to govern the replay/test-case path only). The LLM has no tool that
 *     reaches this — provider comes from mission configuration at session
 *     creation, never from model output.
 *   - An explicit BrowserStack request with missing / needs-re-entry
 *     credentials is a deterministic error. The mission fails truthfully;
 *     local Chromium is never launched as a substitute.
 *   - Device rules mirror replay B0.3 exactly (same builder, same errors).
 *
 * Returns:
 *   { mode: 'local', device }
 *   { mode: 'browserstack', strict: true, caps, osInfo, browserType, device }
 *   { mode: 'error', code: 'missing_credentials'|'unsupported_device'|'invalid_provider', error }
 */
export function resolveAgentExecutionPlan({ device = null, explicitProvider = null, config = {} } = {}) {
	const requested = typeof explicitProvider === 'string' ? explicitProvider.trim().toLowerCase() : '';
	if (!requested || requested === 'local') {
		return { mode: 'local', device: device != null ? String(device) : null };
	}
	if (requested !== 'browserstack') {
		return {
			mode: 'error',
			code: 'invalid_provider',
			error: `Unsupported execution provider: ${requested.slice(0, 40)}. Supported providers: browserstack, local.`
		};
	}
	// Explicit BrowserStack request — credentials must be usable. A stored
	// envelope that cannot be decrypted (needsReentry) surfaces here as
	// missing_credentials: the operator must re-enter the key.
	if (!config.browserstackUser || !config.browserstackKey) {
		return {
			mode: 'error',
			code: 'missing_credentials',
			error: 'BrowserStack execution was requested for this mission, but BrowserStack credentials are missing or need to be re-entered. Add the BrowserStack username and access key in Settings, verify the connection, then retry the mission.'
		};
	}
	// Reuse the ONE caps builder with a forced-selected view of the config.
	// Strict is forced true: an explicit agent request never falls back.
	const plan = resolveLaunchPlan(
		{ ...config, browserstackEnabled: true, browserstackStrict: true },
		{ device: device != null ? String(device) : null, testName: 'Qase agent mission' }
	);
	if (plan.unsupported) {
		return { mode: 'error', code: 'unsupported_device', error: plan.unsupported };
	}
	return plan;
}
