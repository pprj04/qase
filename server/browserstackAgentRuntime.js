/**
 * C4 — BrowserStack attachment for the autonomous agent runtime.
 *
 * The CleanSlate SDK launches its own local Chromium lazily inside
 * CleanSlateNodeBrowserAutomation.ensureContext(). The SDK has NO CDP attach
 * option (verified against @cleanslate/sdk dist: no connectOverCDP anywhere).
 * The attachment below therefore works at the exact seam the device-context
 * code already uses (agent.js applyDeviceContext swaps service.context):
 *
 *   BEFORE the SDK's first ensurePage(), pre-populate
 *   service.browser / service.context with a chromium.connectOverCDP(...)
 *   BrowserStack browser + context. ensureContext() then finds a context and
 *   never launches local Chromium.
 *
 * Hard guarantees (approved C4 decisions 4+7):
 *   - The existing targetGuard registerPage funnel is untouched and wraps
 *     every page the SDK registers — including BrowserStack pages.
 *   - On ANY attach failure the error is thrown (BrowserStackMissionError)
 *     — the session/mission fails truthfully. Local Chromium is NEVER
 *     launched as a substitute. attach() returns without touching the
 *     service when the plan is local.
 *   - The device-context swap (local emulation) is skipped for BrowserStack
 *     sessions: device semantics are carried by the caps; a BrowserStack
 *     real-device page IS the device.
 */

import { chromium } from 'playwright';
import { buildExecutionEnvironment, BrowserStackStrictError, redactSecrets } from './executionEnvironment.js';
import { resolveDeviceContext, contextOptionsFor } from './deviceContext.js';
import { resolveAgentExecutionPlan, buildBrowserstackCdpUrl } from './browserstackCaps.js';

/** Deterministic mission-level failure for an explicitly requested BrowserStack execution. */
export class BrowserStackMissionError extends Error {
	constructor(message, { code, cause } = {}) {
		super(message);
		this.name = 'BrowserStackMissionError';
		this.code = code;
		if (cause) this.cause = cause;
	}
}

/**
 * Compute the session's execution plan from configuration ONLY. Never reads
 * model output — the LLM has no tool or capability that reaches this.
 * Returns the plan (local/browserstack/error) — see resolveAgentExecutionPlan.
 */
export function planSessionExecution(session, { config } = {}) {
	// `config` is the live effective config (agent.js passes getConfig()).
	// It may be omitted only in tests — then resolveAgentExecutionPlan's own
	// {} default applies (a browserstack request plans as missing_credentials,
	// never as a crash). A session NEVER carries its own config override in
	// production; provider selection comes from configuration only.
	return resolveAgentExecutionPlan({
		device: session?.deviceRequest ?? null,
		explicitProvider: session?.executionProvider ?? null,
		config
	});
}

/**
 * Attach the session's browser automation service to BrowserStack per plan.
 *
 * Call BEFORE the SDK performs its first ensurePage() (ensureRuntime wiring
 * order: targetGuard wrap → this attach → local device wrap). For a local
 * plan this is a no-op that leaves the service exactly as the SDK built it.
 *
 * On success sets session.execution (truthful provenance) and returns
 * { provider: 'browserstack', device }.
 * On a browserstack plan failure throws BrowserStackMissionError — callers
 * must fail the session; there is no fallback path.
 */
export async function attachBrowserstackRuntime(service, session, { config } = {}) {
	const plan = resolveAgentExecutionPlan({
		device: session?.deviceRequest ?? null,
		explicitProvider: session?.executionProvider ?? null,
		config
	});

	if (plan.mode === 'error') {
		throw new BrowserStackMissionError(plan.error, { code: plan.code });
	}
	if (plan.mode !== 'browserstack') {
		return { provider: 'local', device: plan.device ?? null };
	}

	// Explicit BrowserStack session. Attach BEFORE the SDK can lazily launch
	// local Chromium; if the service already has a context (should not happen
	// in the ensureRuntime ordering), that is a wiring bug — fail loudly.
	if (service.context || service.browser) {
		throw new BrowserStackMissionError(
			'BrowserStack attach ordering violation: the runtime already holds a browser/context. Attach must happen before the first page is created.',
			{ code: 'attach_ordering' }
		);
	}

	const cdpUrl = buildBrowserstackCdpUrl(plan.caps);
	let browser;
	try {
		browser = await chromium.connectOverCDP(cdpUrl);
	} catch (error) {
		// STRICT ALWAYS (decision 4): no local fallback, ever, for an explicit
		// BrowserStack request. Redact — the CDP URL embeds the credentials.
		console.error(`[BrowserStack:agent] CDP attach failed — mission fails, NO local fallback: ${redactSecrets(error.message)}`);
		throw new BrowserStackMissionError(
			`BrowserStack execution failed — the mission requested BrowserStack and could not connect. Fix the BrowserStack configuration in Settings and retry. (${redactSecrets(error.message)})`,
			{ code: 'cdp_attach_failed', cause: error }
		);
	}

	let browserVersion = null;
	try { browserVersion = await browser.version(); } catch { /* CDP may not expose it */ }

	// Real-device context options come from the device descriptor (viewport
	// for the recorded device); desktop sessions get the standard viewport.
	const deviceContext = plan.device ? resolveDeviceContext(plan.device) : null;
	const contextOptions = deviceContext ? contextOptionsFor(deviceContext) : { viewport: { width: 1440, height: 900 } };
	if (deviceContext) {
		contextOptions.acceptDownloads = true;
	}

	let context;
	try {
		context = await browser.newContext(contextOptions);
	} catch (error) {
		try { await browser.close(); } catch { /* already gone */ }
		console.error(`[BrowserStack:agent] context creation failed: ${redactSecrets(error.message)}`);
		throw new BrowserStackMissionError(
			`BrowserStack execution failed — could not create a session context. (${redactSecrets(error.message)})`,
			{ code: 'context_failed', cause: error }
		);
	}

	// Pre-populate the SDK service. ensureContext() now finds a context and
	// never launches local Chromium; dispose() closes this browser and
	// releases the BrowserStack session.
	service.browser = browser;
	service.context = context;
	service.activePage = undefined;

	// Truthful provenance — same builder/shape the replay path produces.
	session.execution = buildExecutionEnvironment({
		provider: 'browserstack',
		browser: plan.device ? 'chrome' : plan.osInfo.browser,
		browserVersion,
		os: plan.device ? 'Android' : plan.osInfo.os,
		// Real-device OS build is NOT observable via CDP — null, never invented.
		osVersion: plan.device ? null : plan.osInfo.os_version,
		device: plan.device,
		engineEmulated: false,
		executedOn: Date.now()
	});
	return { provider: 'browserstack', device: plan.device };
}

// NOTE: no registerPage wrapper is needed for BrowserStack sessions. The SDK
// calls registerPage(page) with the page it created from ITS context — and we
// pre-populated service.context with the CDP context, so that page already
// lives on BrowserStack. agent.js's targetGuard wrap therefore covers BS
// pages with zero additional wiring.
