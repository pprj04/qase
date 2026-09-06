import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWrite } from './atomicWrite.js';
import { restorePendingTestMarkers } from './testRestore.js';
import { hasMasterKey, encryptSecret, decryptSecret } from './secretStore.js';

/**
 * Model settings, resolved from the settings file first and the environment
 * second, so the dashboard can point Qase at a custom endpoint without anyone
 * editing .env and restarting.
 *
 * The `custom` provider is an OpenAI-compatible endpoint: the three things it
 * needs are a key, a base URL and a model name.
 */

// QASE_DATA_DIR lets tests redirect the whole .qase tree to a temp dir;
// unset in production → identical behavior (cwd/.qase).
const CONFIG_DIR = path.join(process.env.QASE_DATA_DIR ?? path.join(process.cwd(), '.qase'));
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
	// B1 W8: crash-recovery for test config mutations (BrowserStack snapshot→mutate→restore).
	// A test SIGKILLed mid-mutation leaves the mutation live; the marker restores it at boot.
	restorePendingTestMarkers({ saveConfig: (c) => { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); stored = c; } });
	// C4 — decrypt the stored BrowserStack key envelope in memory only. The
	// envelope stays on disk; getConfig()/saveConfig() see the plaintext key
	// and behave exactly as before. An envelope we cannot decrypt (orphan from
	// the lost build, wrong master key) leaves browserstackKey unset and flags
	// needsReentry so the operator is asked to re-enter the key.
	if (typeof stored.browserstackKeyEnc === 'string' && !stored.browserstackKey) {
		if (hasMasterKey()) {
			const decrypted = decryptSecret(stored.browserstackKeyEnc);
			if (decrypted.ok) {
				stored.browserstackKey = decrypted.value;
			} else {
				stored.__bsKeyNeedsReentry = true;
			}
		} else {
			stored.__bsKeyNeedsReentry = true;
		}
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
		maxConcurrentMissions: process.env.QASE_MAX_MISSIONS ? Number(process.env.QASE_MAX_MISSIONS) : undefined,
		missionTimeoutMinutes: process.env.QASE_MISSION_TIMEOUT_MIN ? Number(process.env.QASE_MISSION_TIMEOUT_MIN) : undefined,
		// R2-A/G3 — awaiting_input session timeout. A mission that pauses for
		// user input must not hold its browser + session record forever when
		// nobody answers. Default 60 minutes; clamped to [5, 1440].
		awaitingInputTimeoutMinutes: process.env.QASE_AWAITING_INPUT_TIMEOUT_MINUTES
			? Number(process.env.QASE_AWAITING_INPUT_TIMEOUT_MINUTES) : undefined,
		autoSaveWorkflow: process.env.QASE_AUTO_SAVE_WORKFLOW === undefined ? undefined : process.env.QASE_AUTO_SAVE_WORKFLOW !== 'false',
		autoGenerateTests: process.env.QASE_AUTO_GEN_TESTS === undefined ? undefined : process.env.QASE_AUTO_GEN_TESTS !== 'false',
		autoSmokeRun: process.env.QASE_AUTO_SMOKE_RUN === undefined ? undefined : process.env.QASE_AUTO_SMOKE_RUN === 'true',
		autoCreateSchedule: process.env.QASE_AUTO_CREATE_SCHEDULE === undefined ? undefined : process.env.QASE_AUTO_CREATE_SCHEDULE !== 'false',
		autoDevReport: process.env.QASE_AUTO_DEV_REPORT === undefined ? undefined : process.env.QASE_AUTO_DEV_REPORT !== 'false',
		exploreViewports: process.env.QASE_EXPLORE_VIEWPORTS === undefined ? undefined : process.env.QASE_EXPLORE_VIEWPORTS !== 'false',
		defaultScheduleCron: process.env.QASE_DEFAULT_CRON,
		browserstackEnabled: process.env.QASE_BROWSERSTACK_ENABLED === undefined ? undefined : process.env.QASE_BROWSERSTACK_ENABLED === 'true',
		// C4.1-FIX2 — standard BrowserStack Playwright credential env vars as
		// a FALLBACK source only. Precedence is unchanged (B0.1): Settings-stored
		// (encrypted) credentials always win; these seed env-only boots. Values
		// are never logged, echoed, or returned by getPublicConfig beyond the
		// existing redacted booleans/lengths.
		browserstackUser: process.env.QASE_BROWSERSTACK_USER ?? process.env.BROWSERSTACK_USERNAME,
		browserstackKey: process.env.QASE_BROWSERSTACK_KEY ?? process.env.BROWSERSTACK_ACCESS_KEY,
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
	// M1-P4.2 — execution governor bounds for AGENT missions (a slot = one
	// session + Chromium + LLM conversation). Replay suites keep their own
	// concurrentRuns pool; these bound the mission layer only.
	maxConcurrentMissions: 3,
	missionTimeoutMinutes: 60,
	// R2-A/G3 — default awaiting-input timeout (minutes). See env mapping above.
	awaitingInputTimeoutMinutes: 60,
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
	selfHealThreshold: 0.8,
	// R6-T3 — evidence/artifact retention (link-aware; see
	// server/artifactRetention.js + the R6 spec). Conservative local defaults.
	retentionArtifactMaxCount: 20_000,
	retentionArtifactMaxAgeDays: 180,
	// R6-T4 — never-started mission shells (`created`, no execution markers)
	// older than this TTL are transitioned created→cancelled with
	// cancellationReason 'never_started_ttl_expired' (record preserved).
	missionShellTtlHours: 24
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
	// BUILD B0.1 — BrowserStack credential authority: Settings-saved values
	// must WIN over .env. The generic merge above lets env override stored for
	// every field (the bootstrap-friendly order for LLM settings), which caused
	// the restart flip-flop: stale/garbage env BrowserStack creds silently
	// re-became effective on every boot while the stored key was empty.
	// Invert the order for these two fields only: stored beats env when the
	// stored value exists; env still seeds the very first boot.
	const storedBs = readStored();
	if (storedBs.browserstackUser) {
		merged.browserstackUser = storedBs.browserstackUser;
	}
	if (storedBs.browserstackKey) {
		merged.browserstackKey = storedBs.browserstackKey;
	}
	// ...and the enable flag must not resurrect itself from a malformed env
	// value (e.g. doubly-quoted "\"false\"") when Settings has an explicit one.
	if (storedBs.browserstackEnabled !== undefined) {
		merged.browserstackEnabled = storedBs.browserstackEnabled === true;
	}
	// BUILD B0.2 — strict mode: default TRUE (never silently fall back to
	// local Chromium when BrowserStack was explicitly selected). Only an
	// explicit stored/browserstackStrict=false turns the loud-but-permissive
	// legacy behavior on; env can only make it strict.
	if (storedBs.browserstackStrict !== undefined) {
		merged.browserstackStrict = storedBs.browserstackStrict === true;
	} else if (process.env.QASE_BROWSERSTACK_STRICT === 'false') {
		merged.browserstackStrict = false;
	} else {
		merged.browserstackStrict = true;
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

/** C4.1 — masked diagnostic: length of the effective BrowserStack key.
 *  Never returns key material itself. */
function effectiveKeyLength() {
	const key = getConfig().browserstackKey;
	return key ? String(key).trim().length : 0;
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
		maxConcurrentMissions: config.maxConcurrentMissions,
		missionTimeoutMinutes: config.missionTimeoutMinutes,
		// R6-T3 — retention policy echo (public because it decides deletion
		// behavior; numbers only, never a secret).
	retentionArtifactMaxCount: config.retentionArtifactMaxCount,
	retentionArtifactMaxAgeDays: config.retentionArtifactMaxAgeDays,
	// R6-T4 — shell-TTL echo (numeric policy, not a secret).
	missionShellTtlHours: config.missionShellTtlHours,
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
		browserstackUser: config.browserstackUser || '',
		browserstackKeyFromEnv: Boolean(fromEnv().browserstackKey) && !readStored().browserstackKey,
		browserstackLastVerified: readStored().browserstackLastVerified ?? null,
		// C4 — truthful credential state. hasBrowserstackKey means "a usable
		// key is effective" (envelope decrypted or plaintext/env). An
		// undecryptable envelope (orphan from the lost build / wrong master
		// key) reports needsReentry; the env fallback stays eligible ONLY
		// while no unusable stored envelope sits on disk, so the
		// hasKey/source pair can never contradict itself.
		browserstackCredentialSource: readStored().browserstackKey
			? 'settings'
			: (fromEnv().browserstackKey && !readStored().__bsKeyNeedsReentry ? 'env' : 'none'),
		browserstackKeyEncrypted: Boolean(readStored().browserstackKeyEnc),
		browserstackNeedsReentry: Boolean(readStored().__bsKeyNeedsReentry),
		// C4.1 — diagnostic hint ONLY: length of the effective (decrypted or
		// env) key, so an obviously-wrong paste (e.g. 11 chars) is visible in
		// Settings without ever exposing key material. Never the key itself.
		browserstackKeyLength: effectiveKeyLength(),
		hasBrowserstackKey: Boolean(config.browserstackKey),
		browserstackStrict: config.browserstackStrict !== false,
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
			} else if (key === 'browserstackUser' || key === 'browserstackKey') {
				// BUILD B0.1 — explicit clear (Settings "Clear" button sends '').
				// Without this, a stored credential could never be removed and
				// env garbage would reapply on every restart.
				delete next[key];
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
	if (patch.maxConcurrentMissions !== undefined) {
		next.maxConcurrentMissions = Math.max(1, Math.min(10, Number(patch.maxConcurrentMissions) || DEFAULTS.maxConcurrentMissions));
	}
	if (patch.awaitingInputTimeoutMinutes !== undefined) {
		// R2-A/G3 — clamp 5..1440 minutes (same validation pattern as
		// missionTimeoutMinutes below).
		next.awaitingInputTimeoutMinutes = Math.max(5, Math.min(1440, Number(patch.awaitingInputTimeoutMinutes) || DEFAULTS.awaitingInputTimeoutMinutes));
	}
	if (patch.missionTimeoutMinutes !== undefined) {
		next.missionTimeoutMinutes = Math.max(5, Math.min(720, Number(patch.missionTimeoutMinutes) || DEFAULTS.missionTimeoutMinutes));
	}
	// R6-T3 — retention clamps (same validation pattern as above). Invalid
	// values fall back to documented defaults — NEVER to 0/delete-everything.
	if (patch.retentionArtifactMaxCount !== undefined) {
		next.retentionArtifactMaxCount = Math.max(100, Math.min(500_000, Math.floor(Number(patch.retentionArtifactMaxCount) || DEFAULTS.retentionArtifactMaxCount)));
	}
	if (patch.retentionArtifactMaxAgeDays !== undefined) {
		next.retentionArtifactMaxAgeDays = Math.max(1, Math.min(3650, Math.floor(Number(patch.retentionArtifactMaxAgeDays) || DEFAULTS.retentionArtifactMaxAgeDays)));
	}
	// R6-T4 — shell TTL clamp. Invalid input falls back to the 24h default,
	// never to 0 (cancel-everything) or an accidental infinite TTL.
	if (patch.missionShellTtlHours !== undefined) {
		next.missionShellTtlHours = Math.max(1, Math.min(8760, Math.floor(Number(patch.missionShellTtlHours) || DEFAULTS.missionShellTtlHours)));
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
	for (const boolKey of ['autoSaveWorkflow', 'autoGenerateTests', 'autoSmokeRun', 'autoCreateSchedule', 'autoDevReport', 'exploreViewports', 'browserstackEnabled', 'selfHealEnabled', 'browserstackStrict']) {
		if (patch[boolKey] !== undefined) {
			next[boolKey] = Boolean(patch[boolKey]);
		}
	}
	if (typeof patch.defaultScheduleCron === 'string' && patch.defaultScheduleCron.trim()) {
		next.defaultScheduleCron = patch.defaultScheduleCron.trim();
	}
	// BUILD B0.1 — persist the last BrowserStack connection-test outcome.
	// Only the redacted summary is stored; never any credential material.
	if (patch.browserstackLastVerified && typeof patch.browserstackLastVerified === 'object') {
		const lv = patch.browserstackLastVerified;
		next.browserstackLastVerified = {
			ts: Number(lv.ts) || Date.now(),
			ok: lv.ok === true,
			code: String(lv.code ?? '').slice(0, 64),
			message: String(lv.message ?? '').slice(0, 400),
			maskedUser: String(lv.maskedUser ?? '').slice(0, 64)
		};
	}
	// BUILD B0.1/C4 — explicit key clear (Settings "Clear" button sends '')
	// also removes the encrypted envelope so a cleared credential can never
	// resurrect; a freshly entered key clears the needs-reentry state.
	if (typeof patch.browserstackKey === 'string' && !patch.browserstackKey.trim()) {
		delete next.browserstackKeyEnc;
		delete next.__bsKeyNeedsReentry;
	}
	if (typeof patch.browserstackKey === 'string' && patch.browserstackKey.trim()) {
		delete next.__bsKeyNeedsReentry;
	}
	// C4 — persist the BrowserStack key as an encrypted envelope whenever a
	// master key (QASE_SECRET_KEY) is configured; the plaintext never returns
	// to disk, and legacy plaintext already on disk migrates to an envelope
	// on the next save. Without a master key (fresh clones, offline test
	// subprocesses) the pre-C4 plaintext flow is kept — graceful degradation,
	// with a warning — so existing gate suites stay green in those contexts.
	// This deployment always runs with QASE_SECRET_KEY set.
	let toPersist = { ...next };
	delete toPersist.__bsKeyNeedsReentry;
	if (hasMasterKey()) {
		if (typeof toPersist.browserstackKey === 'string' && toPersist.browserstackKey) {
			toPersist.browserstackKeyEnc = encryptSecret(toPersist.browserstackKey);
		}
		delete toPersist.browserstackKey;
	} else if (typeof toPersist.browserstackKey === 'string' && toPersist.browserstackKey) {
		console.warn('[config] QASE_SECRET_KEY not set — BrowserStack key stored in cleartext (pre-C4 behavior). Set QASE_SECRET_KEY to enable encryption at rest.');
	}
	if (next.provider && !PROVIDERS.includes(next.provider)) {
		throw new Error(`Unknown provider: ${next.provider}`);
	}

	// C4 — keep the in-memory cache consistent with what was persisted: the
	// plaintext key stays memory-only; the envelope mirrors the disk state so
	// getPublicConfig() reports truthful encrypted/needsReentry flags.
	if (toPersist.browserstackKeyEnc !== undefined) {
		next.browserstackKeyEnc = toPersist.browserstackKeyEnc;
	} else {
		delete next.browserstackKeyEnc;
	}
	stored = next;
	atomicWrite(CONFIG_FILE, JSON.stringify(toPersist, undefined, '\t'), { mode: 0o600 });
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
