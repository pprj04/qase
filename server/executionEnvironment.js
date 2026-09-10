/**
 * BUILD B0.2 — Execution provenance.
 *
 * One shape, used everywhere a result/test/finding/evidence needs to say
 * WHERE it actually executed. Unknown values are null — never invented.
 */

const VALID_PROVIDERS = new Set(['browserstack', 'local']);

/**
 * Build the canonical execution-environment object.
 * All fields optional; unknown → null. provider must be valid.
 */
export function buildExecutionEnvironment(input = {}) {
	const provider = input.provider === 'browserstack' || input.provider === 'local'
		? input.provider
		: null;
	if (!provider) {
		throw new Error(`executionEnvironment.provider must be 'browserstack' or 'local' (got ${JSON.stringify(input.provider)})`);
	}
	const executedOn = Number.isFinite(input.executedOn) ? input.executedOn : Date.now();
	const viewport = input.viewport && Number.isFinite(input.viewport.width) && Number.isFinite(input.viewport.height)
		? { width: input.viewport.width, height: input.viewport.height }
		: null;
	// HOTFIX C — explicit execution-type provenance, derived ONLY from what
	// actually ran. LOCAL_EMULATION = local provider + named device context.
	let executionType;
	if (provider === 'local') executionType = input.device != null ? 'LOCAL_EMULATION' : 'LOCAL_DESKTOP';
	else executionType = input.device != null ? (input.engineEmulated === true ? 'LOCAL_EMULATION' : 'REAL_DEVICE') : 'CLOUD_DESKTOP';
	return {
		provider,
		executionType,
		device: input.device != null ? String(input.device) : null,
		browser: input.browser != null ? String(input.browser) : null,
		browserVersion: input.browserVersion != null ? String(input.browserVersion) : null,
		os: input.os != null ? String(input.os) : null,
		osVersion: input.osVersion != null ? String(input.osVersion) : null,
		viewport,
		engineEmulated: input.engineEmulated === true,
		executedOn,
		...(input.failed === true ? { failed: true } : {}),
	};
}

/**
 * Truthful "real device" test: only a BrowserStack (remote real-device/cloud)
 * execution with a named device may be called a real device execution.
 * A local context emulating a phone is engine emulation — never a device claim.
 * B0.3: engineEmulated=true means the device is NOT real hardware — even on
 * BrowserStack, an emulated device is an emulated device.
 */
export function isRealDevice(environment) {
	if (!environment || typeof environment !== 'object') return false;
	return environment.provider === 'browserstack'
		&& environment.device != null
		&& environment.engineEmulated !== true;
}

/**
 * BUILD B0.3 — the truthful execution MODE, computed ONLY from what the
 * environment object says actually happened — never from a mobile-sized
 * viewport. A 375×667 local run is VIEWPORT, not a device claim.
 *   VIEWPORT          local   · device null · !engineEmulated
 *   EMULATED_DEVICE   local   · device set · engineEmulated
 *   REAL_DEVICE       browserstack · device set · !engineEmulated
 *   CLOUD_DESKTOP     browserstack · device null
 */
export function executionModeFor(environment) {
	if (!environment || typeof environment !== 'object') return null;
	const isBs = environment.provider === 'browserstack';
	// A device on BrowserStack with engineEmulated explicitly true would be a
	// misconfiguration — treat it as emulation (truthful, never a device claim).
	if (environment.device != null && environment.engineEmulated && !isBs) return 'EMULATED_DEVICE';
	if (environment.device != null && !environment.engineEmulated) return isBs ? 'REAL_DEVICE' : 'VIEWPORT';
	if (environment.device != null && environment.engineEmulated) return 'EMULATED_DEVICE';
	return isBs ? 'CLOUD_DESKTOP' : 'VIEWPORT';
}

/** Human one-liner for logs/UI badges. */
export function describeExecutionEnvironment(environment) {
	if (!environment || typeof environment !== 'object') return 'unknown environment';
	const parts = [];
	parts.push(environment.provider === 'browserstack' ? 'BrowserStack' : 'Local');
	if (environment.device) parts.push(environment.device);
	if (environment.browser) parts.push(environment.browser);
	if (environment.os) parts.push(environment.os);
	if (environment.viewport) parts.push(`${environment.viewport.width}×${environment.viewport.height}`);
	if (environment.engineEmulated) parts.push('emulated engine');
	if (environment.failed) parts.push('failed to start');
	return parts.join(' · ');
}

/** Redact any accidental key/credential-looking token from an error message. */
function redactInternal(text) {
	let out = String(text ?? '');
	out = out.replace(/(?:key|token|password|authorization)\s*[:=]\s*\S{8,}/gi, '$1: ••••••');
	// Never echo a ?caps= payload (it embeds the BrowserStack access key).
	out = out.replace(/([?&]caps=)[^"'&\s]+/gi, '$1••••••');
	return out.slice(0, 400);
}
/** Public alias used by replay.js logging. */
export function redactSecrets(text) { return redactInternal(text); }

/** The strict-mode error thrown when BrowserStack execution fails. */
export class BrowserStackStrictError extends Error {
	constructor(cause) {
		const reason = redactInternal(cause instanceof Error ? cause.message : String(cause ?? 'unknown error'));
		super(`BrowserStack execution failed — local fallback was disabled. Fix the BrowserStack configuration or disable BrowserStack. (${reason})`);
		this.name = 'BrowserStackStrictError';
		this.cause = cause;
	}
}
