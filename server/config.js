import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from './atomicWrite.js';

/**
 * Model settings, resolved from the settings file first and the environment
 * second, so the dashboard can point Qase at a custom endpoint without anyone
 * editing .env and restarting.
 *
 * The `custom` provider is an OpenAI-compatible endpoint: the three things it
 * needs are a key, a base URL and a model name.
 */

const CONFIG_DIR = path.join(process.cwd(), '.qase');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const PROVIDERS = [
	'custom', 'anthropic', 'openai', 'azureOpenAI', 'gemini',
	'grok', 'nvidia', 'openrouter', 'bedrock'
];

/** Providers that will not start without a base URL of their own. */
const NEEDS_BASE_URL = new Set(['custom', 'azureOpenAI']);

export const VIEWPORT_PRESETS = {
	desktop:      { width: 1440, height: 900,  label: 'Desktop',  icon: '🖥️' },
	tablet:       { width: 768,  height: 1024, label: 'Tablet',   icon: '📋' },
	mobile:       { width: 375,  height: 812,  label: 'Mobile',   icon: '📱' },
	mobile_small: { width: 320,  height: 568,  label: 'Mobile S', icon: '📱' }
};

/** Resolve a viewport string ('desktop') or object ({width,height}) to a concrete {width,height,label}. */
export function resolveViewport(vp) {
	if (!vp) return { ...VIEWPORT_PRESETS.desktop };
	if (typeof vp === 'string') {
		return VIEWPORT_PRESETS[vp] ? { ...VIEWPORT_PRESETS[vp] } : { ...VIEWPORT_PRESETS.desktop };
	}
	if (vp.width && vp.height) {
		const match = Object.values(VIEWPORT_PRESETS).find(p => p.width === vp.width && p.height === vp.height);
		return { ...vp, label: match?.label ?? `${vp.width}×${vp.height}`, icon: match?.icon ?? '📐' };
	}
	return { ...VIEWPORT_PRESETS.desktop };
}

/** Return all viewport presets as an array (for UI dropdowns). */
export function listViewportPresets() {
	return Object.entries(VIEWPORT_PRESETS).map(([key, vp]) => ({ key, ...vp }));
}

let stored;

function readStored() {
	if (stored) {
		return stored;
	}
	try {
		stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
	} catch {
		stored = {};
	}
	return stored;
}

function fromEnv() {
	return {
		provider: process.env.QASE_PROVIDER,
		apiKey: process.env.QASE_API_KEY ?? process.env.ANTHROPIC_API_KEY,
		baseUrl: process.env.QASE_BASE_URL,
		model: process.env.QASE_MODEL,
		discoveryModel: process.env.QASE_DISCOVERY_MODEL,
		executionModel: process.env.QASE_EXECUTION_MODEL,
		reasoning: process.env.QASE_REASONING,
		maxTurns: process.env.QASE_MAX_TURNS ? Number(process.env.QASE_MAX_TURNS) : undefined,
		headless: process.env.QASE_HEADLESS === undefined ? undefined : process.env.QASE_HEADLESS !== 'false',
		apiToken: process.env.QASE_API_TOKEN,
		concurrentRuns: process.env.QASE_PARALLEL ? Number(process.env.QASE_PARALLEL) : undefined,
		retriesCount: process.env.QASE_RETRIES ? Number(process.env.QASE_RETRIES) : undefined,
		autoSaveWorkflow: process.env.QASE_AUTO_SAVE_WORKFLOW === undefined ? undefined : process.env.QASE_AUTO_SAVE_WORKFLOW !== 'false',
		autoGenerateTests: process.env.QASE_AUTO_GEN_TESTS === undefined ? undefined : process.env.QASE_AUTO_GEN_TESTS !== 'false',
		autoSmokeRun: process.env.QASE_AUTO_SMOKE_RUN === undefined ? undefined : process.env.QASE_AUTO_SMOKE_RUN === 'true',
		autoCreateSchedule: process.env.QASE_AUTO_CREATE_SCHEDULE === undefined ? undefined : process.env.QASE_AUTO_CREATE_SCHEDULE !== 'false',
		autoDevReport: process.env.QASE_AUTO_DEV_REPORT === undefined ? undefined : process.env.QASE_AUTO_DEV_REPORT !== 'false',
		exploreViewports: process.env.QASE_EXPLORE_VIEWPORTS === undefined ? undefined : process.env.QASE_EXPLORE_VIEWPORTS !== 'false',
		defaultScheduleCron: process.env.QASE_DEFAULT_CRON,
		browserstackEnabled: process.env.QASE_BROWSERSTACK_ENABLED === undefined ? undefined : process.env.QASE_BROWSERSTACK_ENABLED === 'true',
		browserstackUser: process.env.QASE_BROWSERSTACK_USER,
		browserstackKey: process.env.QASE_BROWSERSTACK_KEY,
		browserstackBrowsers: process.env.QASE_BROWSERSTACK_BROWSERS,
		selfHealEnabled: process.env.QASE_SELF_HEAL === undefined ? undefined : process.env.QASE_SELF_HEAL !== 'false',
		selfHealThreshold: process.env.QASE_SELF_HEAL_THRESHOLD ? Number(process.env.QASE_SELF_HEAL_THRESHOLD) : undefined
	};
}

const DEFAULTS = {
	provider: 'anthropic',
	apiKey: '',
	baseUrl: '',
	model: 'claude-opus-5',
	reasoning: 'medium',
	maxTurns: 120,
	headless: true,
	concurrentRuns: 3,
	retriesCount: 1,
	autoSaveWorkflow: true,
	autoGenerateTests: true,
	autoSmokeRun: false,
	autoCreateSchedule: true,
	autoDevReport: true,
	exploreViewports: true,
	defaultScheduleCron: '0 9 * * *',
	browserstackEnabled: false,
	browserstackUser: '',
	browserstackKey: '',
	browserstackBrowsers: 'chrome',
	selfHealEnabled: true,
	selfHealThreshold: 0.8
};

/** The effective settings the agent runs with. Includes the key — server only. */
export function getConfig() {
	const merged = { ...DEFAULTS };
	for (const source of [fromEnv(), readStored()]) {
		for (const [key, value] of Object.entries(source)) {
			if (value !== undefined && value !== null && value !== '') {
				merged[key] = value;
			}
		}
	}
	return merged;
}

/**
 * Returns the effective config for a given model tier.
 *
 * Both tiers share the same provider, API key, and base URL — only the model
 * name differs:
 *   - 'discovery'  → autonomous agent exploration (agent.js)
 *   - 'execution'  → test case generation (testGen.js)
 *
 * If the tier-specific model is not set, falls back to the default `model`.
 */
export function getModelTier(tier) {
	const config = getConfig();
	if (tier === 'discovery' && config.discoveryModel) {
		return { ...config, model: config.discoveryModel };
	}
	if (tier === 'execution' && config.executionModel) {
		return { ...config, model: config.executionModel };
	}
	return config;
}

/** The same settings with the key reduced to a hint. Safe to send to a browser. */
export function getPublicConfig() {
	const config = getConfig();
	return {
		provider: config.provider,
		baseUrl: config.baseUrl,
		model: config.model,
		discoveryModel: config.discoveryModel || '',
		executionModel: config.executionModel || '',
		reasoning: config.reasoning,
		maxTurns: config.maxTurns,
		headless: config.headless,
		concurrentRuns: config.concurrentRuns,
		retriesCount: config.retriesCount,
		autoSaveWorkflow: config.autoSaveWorkflow,
		autoGenerateTests: config.autoGenerateTests,
		autoSmokeRun: config.autoSmokeRun,
		autoCreateSchedule: config.autoCreateSchedule,
		autoDevReport: config.autoDevReport,
		exploreViewports: config.exploreViewports,
		viewportPresets: listViewportPresets(),
		defaultScheduleCron: config.defaultScheduleCron,
		hasApiKey: Boolean(config.apiKey),
		apiKeyHint: config.apiKey ? `••••${config.apiKey.slice(-4)}` : '',
		apiKeyFromEnv: Boolean(fromEnv().apiKey) && !readStored().apiKey,
		selfHealEnabled: config.selfHealEnabled !== false,
		selfHealThreshold: config.selfHealThreshold ?? 0.8,
		providers: PROVIDERS,
		hasApiToken: Boolean(config.apiToken),
		apiTokenHint: config.apiToken ? `••••${config.apiToken.slice(-4)}` : '',
		apiTokenFromEnv: Boolean(fromEnv().apiToken) && !readStored().apiToken,
		browserstackEnabled: config.browserstackEnabled === true,
		browserstackBrowsers: config.browserstackBrowsers || 'chrome',
		hasBrowserstackKey: Boolean(config.browserstackKey),
		browserstackUser: config.browserstackUser || '',
		browserstackKeyFromEnv: Boolean(fromEnv().browserstackKey) && !readStored().browserstackKey,
		ready: isReady(config),
		problem: describeProblem(config)
	};
}

function isReady(config = getConfig()) {
	return !describeProblem(config);
}

function describeProblem(config) {
	if (config.provider !== 'bedrock' && !config.apiKey) {
		return 'No API key set.';
	}
	if (NEEDS_BASE_URL.has(config.provider) && !config.baseUrl) {
		return 'This provider needs a base URL.';
	}
	if (!config.model) {
		return 'No model name set.';
	}
	return undefined;
}

export function saveConfig(patch) {
	const next = { ...readStored() };
	for (const key of ['provider', 'apiKey', 'baseUrl', 'model', 'reasoning', 'discoveryModel', 'executionModel', 'apiToken', 'browserstackUser', 'browserstackKey']) {
		if (typeof patch[key] === 'string') {
			const trimmed = patch[key].trim();
			if (trimmed) {
				next[key] = trimmed;
			} else if (key === 'apiToken') {
				// Explicitly clear the token when an empty string is sent.
				delete next.apiToken;
			}
		}
	}
	if (patch.maxTurns !== undefined) {
		next.maxTurns = Math.max(10, Math.min(500, Number(patch.maxTurns) || DEFAULTS.maxTurns));
	}
	if (patch.headless !== undefined) {
		next.headless = Boolean(patch.headless);
	}
	if (patch.concurrentRuns !== undefined) {
		next.concurrentRuns = Math.max(1, Math.min(20, Number(patch.concurrentRuns) || DEFAULTS.concurrentRuns));
	}
	if (patch.retriesCount !== undefined) {
		next.retriesCount = Math.max(0, Math.min(5, Number(patch.retriesCount) || 0));
	}
	if (patch.browserstackBrowsers !== undefined) {
		next.browserstackBrowsers = String(patch.browserstackBrowsers).trim();
	}
	if (patch.selfHealThreshold !== undefined) {
		const t = Number(patch.selfHealThreshold);
		if (Number.isFinite(t) && t >= 0 && t <= 1) {
			next.selfHealThreshold = t;
		}
	}
	for (const boolKey of ['autoSaveWorkflow', 'autoGenerateTests', 'autoSmokeRun', 'autoCreateSchedule', 'autoDevReport', 'exploreViewports', 'browserstackEnabled', 'selfHealEnabled']) {
		if (patch[boolKey] !== undefined) {
			next[boolKey] = Boolean(patch[boolKey]);
		}
	}
	if (typeof patch.defaultScheduleCron === 'string' && patch.defaultScheduleCron.trim()) {
		next.defaultScheduleCron = patch.defaultScheduleCron.trim();
	}
	if (next.provider && !PROVIDERS.includes(next.provider)) {
		throw new Error(`Unknown provider: ${next.provider}`);
	}

	stored = next;
	atomicWrite(CONFIG_FILE, JSON.stringify(next, undefined, '\t'), { mode: 0o600 });
	return getPublicConfig();
}

/** Trims a base URL to its origin+path root, so `/models` can be appended. */
function normaliseBase(baseUrl) {
	return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * Probes an OpenAI-compatible endpoint's model list. It is a reachability and
 * credential check, not a guarantee — some gateways do not implement /models,
 * so a failure here is reported as a warning rather than a hard error.
 */
export async function testConnection(candidate) {
	const config = { ...getConfig(), ...candidate };
	const problem = describeProblem(config);
	if (problem) {
		return { ok: false, error: problem };
	}
	if (!config.baseUrl) {
		return { ok: true, skipped: true, message: `${config.provider} uses its own endpoint; nothing to probe.` };
	}

	const url = `${normaliseBase(config.baseUrl)}/models`;
	try {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
			signal: AbortSignal.timeout(12_000)
		});
		if (!response.ok) {
			return {
				ok: false,
				error: `${url} returned ${response.status}. ${response.status === 401 ? 'The key was rejected.' : 'Check the base URL.'}`
			};
		}
		const body = await response.json().catch(() => ({}));
		const models = (body.data ?? body.models ?? [])
			.map(entry => entry?.id ?? entry?.name)
			.filter(Boolean);
		return {
			ok: true,
			models: models.slice(0, 200),
			matched: models.length === 0 ? undefined : models.includes(config.model),
			message: models.length > 0
				? `Reachable — ${models.length} model(s) listed.`
				: 'Reachable, but the endpoint listed no models.'
		};
	} catch (error) {
		return { ok: false, error: `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}` };
	}
}
