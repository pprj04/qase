import { getDevice } from './environmentCatalog.js';

/**
 * Execution provider for Apple compatibility environments.
 *
 * With BrowserStack credentials configured (BROWSERSTACK_USERNAME /
 * BROWSERSTACK_ACCESS_KEY) a run whose environment carries
 * `executionProvider: 'browserstack'` connects to BrowserStack's Playwright/CDP
 * endpoint using the environment's capability map. Without credentials — or for
 * environments whose provider is `local` — the run executes on local Chromium
 * with the environment's emulation hints (viewport, DPR, touch), clearly
 * labeled "emulated" so nobody mistakes it for real Safari/WebKit.
 *
 * Capabilities are taken from the environment's frozen `browserstackCapabilities`
 * object (validated at catalog-generation time) — this module never invents or
 * mutates capability fields.
 */

const BROWSERSTACK_CDP_ENDPOINT = 'https://cdp.browserstack.com/playwright';

/** @typedef {import('playwright').Browser} PlaywrightBrowser */

/**
 * Reads BrowserStack credentials from the given env-like source (defaults to
 * process.env). Returns null unless BOTH values are non-empty strings — a
 * half-configured integration must fall back to local emulation, never fail a
 * run with an opaque 401 from the CDP endpoint.
 */
export function browserstackCredentials(source = process.env) {
	const username = String(source.BROWSERSTACK_USERNAME ?? '').trim();
	const accessKey = String(source.BROWSERSTACK_ACCESS_KEY ?? '').trim();
	if (!username || !accessKey) return null;
	return { username, accessKey };
}

/**
 * Builds the BrowserStack CDP connect options for an environment: the endpoint,
 * basic-auth credentials, and the environment's capability map verbatim.
 * Returns null when the environment cannot execute on BrowserStack (no
 * capabilities — e.g. a hand-made local-only environment) or credentials are
 * missing.
 */
export function browserstackConnectOptions(environment, credentials) {
	if (!environment) return null;
	if (environment.executionProvider !== 'browserstack') return null;
	const capabilities = environment.browserstackCapabilities;
	if (!capabilities || typeof capabilities !== 'object') return null;
	if (!credentials) return null;
	return {
		endpointURL: BROWSERSTACK_CDP_ENDPOINT,
		httpCredentials: { username: credentials.username, password: credentials.accessKey },
		capabilities: capabilities
	};
}

/**
 * Local-emulation context options derived from an environment snapshot.
 * Mobile/tablet environments carry emulation hints in the catalog; macOS
 * environments (and environments without hints) fall back to a desktop
 * viewport, matching the pre-environment default behavior.
 */
export function environmentEmulationOptions(environment) {
	if (!environment) return undefined;
	if (environment.deviceType === 'desktop') {
		return { viewport: { width: 1440, height: 900 }, acceptDownloads: true };
	}
	// Generated environment records do not inline the hints — resolve them from
	// the frozen device catalog by name (macOS devices have no emulation).
	const hints = environment.emulation ?? getDevice(environment.device)?.emulation;
	if (!hints) return { viewport: { width: 1440, height: 900 }, acceptDownloads: true };
	return {
		viewport: { ...hints.viewport },
		deviceScaleFactor: hints.deviceScaleFactor,
		isMobile: hints.isMobile,
		hasTouch: hints.hasTouch,
		acceptDownloads: true
	};
}

/**
 * Resolves how a run should be executed for the given environment snapshot.
 * `mode` is 'browserstack' | 'emulated' | 'default' (no environment selected —
 * legacy behavior). Never throws: execution resolution is a decision, and the
 * only failure mode worth surfacing is "cannot use BrowserStack", which
 * downgrades to emulation with a recorded reason.
 */
export function resolveExecution(environment, credentials = browserstackCredentials()) {
	if (!environment) {
		return { mode: 'default', label: 'local browser (no environment)', capabilities: null, connectOptions: null };
	}
	if (environment.executionProvider === 'browserstack' && credentials) {
		const connectOptions = browserstackConnectOptions(environment, credentials);
		if (connectOptions) {
			return {
				mode: 'browserstack',
				label: `${environment.device} · ${environment.os} ${environment.osVersion} · ${environment.browser} ${environment.browserVersion} — BrowserStack real device`,
				capabilities: environment.browserstackCapabilities,
				connectOptions
			};
		}
	}
	const device = getDevice(environment.device);
	const hints = device?.emulation;
	const label = environment.executionProvider === 'browserstack' && !credentials
		? `${environment.device} · ${environment.browser} ${environment.browserVersion} — local (emulated; BrowserStack credentials not configured)`
		: `${environment.device} · ${environment.browser} ${environment.browserVersion} — local (emulated)`;
	return {
		mode: 'emulated',
		label,
		capabilities: null,
		connectOptions: null,
		emulation: hints ?? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false }
	};
}

/**
 * Connects Playwright Chromium to BrowserStack for the resolved execution plan.
 * Kept separate from resolveExecution so tests can stub the connect step.
 */
export async function connectBrowserstack(chromium, connectOptions) {
	if (typeof chromium.connectOverCDP !== 'function') {
		throw new TypeError('connectBrowserstack requires a Playwright chromium API.');
	}
	return chromium.connectOverCDP(connectOptions.endpointURL, {
		httpCredentials: connectOptions.httpCredentials,
		capabilities: connectOptions.capabilities
	});
}
