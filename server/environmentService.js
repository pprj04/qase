import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
	generateEnvironments,
	getDevice,
	isCombinationSupported,
	getPlatform,
	BROWSERS,
	safariVersionFor,
	buildEnvId,
	availabilityReport,
	ENVIRONMENT_CATALOG_VERSION
} from './environmentCatalog.js';

/**
 * Environment application service.
 *
 * Uniform, camelCase service surface over two backends:
 *  - local JSON file (.qase/environments.json), mirroring store.js conventions
 *  - PostgreSQL environments table (server/postgres/environmentRepository.js)
 *
 * Both backends implement: seed(tenant), list(tenant, filters), get(tenant, envId),
 * create(tenant, input), update(tenant, envId, patch). Seed is idempotent and
 * never resets `active` — operator deprecations survive catalog refreshes on
 * both backends.
 */

export class EnvironmentValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'EnvironmentValidationError';
		this.code = 'QASE_ENVIRONMENT_INVALID';
	}
}

export class EnvironmentConflictError extends Error {
	constructor(envId) {
		super(`Environment ${envId} already exists.`);
		this.name = 'EnvironmentConflictError';
		this.code = 'QASE_ENVIRONMENT_CONFLICT';
		this.envId = envId;
	}
}

export async function normalizeEnvironmentInput(input, options = {}) {
	if (!input || typeof input !== 'object') {
		throw new EnvironmentValidationError('An environment payload is required.');
	}

	const platformId = input.platform;
	const osVersion = typeof input.osVersion === 'string' ? input.osVersion.trim() : input.osVersion;
	const browserVersion = input.browserVersion !== undefined && input.browserVersion !== null
		? String(input.browserVersion).trim()
		: undefined;

	// Prefer the DB-backed catalog (migration 016) when attached; the frozen
	// module remains the fallback so standalone/testing usage still validates.
	const device = getDevice(input.device);
	let verdict;
	if (device && options.catalogBackend?.isCombinationSupported) {
		verdict = await options.catalogBackend.isCombinationSupported({
			deviceSlug: device.slug,
			platform: platformId,
			osVersion,
			browserCode: String(input.browserCode ?? input.browser ?? '').toLowerCase(),
			browserVersion
		});
	} else {
		verdict = isCombinationSupported(platformId, input.device, osVersion, input.browserCode ?? input.browser, browserVersion);
	}
	if (!verdict.ok) throw new EnvironmentValidationError(verdict.reason);

	const platform = getPlatform(platformId);
	const browser = BROWSERS.find((candidate) => candidate.code === String(input.browserCode ?? input.browser ?? '').toLowerCase());
	const resolvedVersion = browser.code === 'safari'
		? safariVersionFor(platformId, osVersion)
		: browserVersion;
	const executionProvider = input.executionProvider === 'local' ? 'local' : 'browserstack';

	// Screen resolution + orientation (request section 5): explicit values win;
	// otherwise default from the device model. Desktop devices have no
	// orientation (not applicable), mobile/tablet default to portrait.
	const orientation = device.deviceType === 'desktop'
		? null
		: (input.orientation === 'landscape' ? 'landscape' : 'portrait');
	const screenResolution = typeof input.screenResolution === 'string' && input.screenResolution.trim() !== ''
		? input.screenResolution.trim()
		: (device.emulation?.viewport
			? `${device.emulation.viewport.width}x${device.emulation.viewport.height}`
			: null);

	return {
		envId: options.envId ?? buildEnvId(platformId, device.slug, osVersion, browser.envCode, resolvedVersion),
		platform: platformId,
		platformLabel: platform.label,
		device: device.name,
		os: platform.os,
		osVersion,
		browser: browser.name,
		browserCode: browser.code,
		browserVersion: String(resolvedVersion),
		deviceType: device.deviceType,
		screenSize: device.screenSize,
		screenResolution,
		orientation,
		description: typeof input.description === 'string' ? input.description.trim() : null,
		executionProvider,
		isRealDevice: device.isRealDevice && executionProvider === 'browserstack',
		active: true,
		browserstackCapabilities: capabilitiesFor(device, platformId, osVersion, browser, resolvedVersion)
	};
}

function capabilitiesFor(device, platformId, osVersion, browser, browserVersion) {
	if (platformId === 'macos') {
		return {
			browserName: browser.code,
			browserVersion: String(browserVersion),
			os: 'OS X',
			osVersion
		};
	}
	if (platformId === 'android') {
		return {
			browserName: browser.code,
			browserVersion: String(browserVersion),
			os: 'android',
			osVersion,
			deviceName: device.browserstackDeviceName,
			realMobile: true
		};
	}
	if (platformId === 'windows') {
		// Windows form factors run as desktop browser sessions (no deviceName);
		// the OS version is the major Windows release.
		const windowsMajor = /(\d+(?:\.\d+)*)\s*$/.exec(String(osVersion).trim())?.[1] ?? osVersion;
		return {
			browserName: browser.code,
			browserVersion: String(browserVersion),
			os: 'Windows',
			osVersion: windowsMajor
		};
	}
	return {
		browserName: browser.code,
		...(browser.code === 'safari' ? {} : { browserVersion: String(browserVersion) }),
		os: 'ios',
		osVersion,
		deviceName: device.browserstackDeviceName,
		realMobile: true
	};
}

/** snake_case DB row -> camelCase environment record (idempotent on local records). */
export function rowToEnvironment(row) {
	if (!row || typeof row !== 'object') return row;
	return {
		id: row.id,
		envId: row.env_id ?? row.envId,
		platform: row.platform,
		platformLabel: row.platform_label ?? row.platformLabel,
		device: row.device,
		os: row.os,
		osVersion: row.os_version ?? row.osVersion,
		browser: row.browser,
		browserCode: row.browser_code ?? row.browserCode,
		browserVersion: row.browser_version ?? row.browserVersion,
		deviceType: row.device_type ?? row.deviceType,
		screenSize: row.screen_size ?? row.screenSize,
		screenResolution: row.screen_resolution ?? row.screenResolution,
		orientation: row.orientation,
		deviceModelSlug: row.device_model_slug ?? row.deviceModelSlug,
		description: row.description,
		executionProvider: row.execution_provider ?? row.executionProvider,
		isRealDevice: row.is_real_device ?? row.isRealDevice,
		active: row.active,
		browserstackCapabilities: row.browserstack_capabilities ?? row.browserstackCapabilities,
		createdAt: row.created_at ?? row.createdAt,
		updatedAt: row.updated_at ?? row.updatedAt
	};
}

// ---------------------------------------------------------------------------
// Local file backend
// ---------------------------------------------------------------------------

export function createLocalEnvironmentBackend(options = {}) {
	const stateDir = options.stateDir ?? path.join(process.cwd(), '.qase');
	const stateFile = options.stateFile ?? path.join(stateDir, 'environments.json');
	const catalogBackend = options.catalogBackend ?? null;
	/** @type {Map<string, any>} */
	const byEnvId = new Map();
	let loaded = false;

	function loadFromDisk() {
		if (loaded) return;
		loaded = true;
		try {
			const raw = fs.readFileSync(stateFile, 'utf8');
			const parsed = JSON.parse(raw);
			for (const record of Array.isArray(parsed) ? parsed : []) {
				if (record?.envId) byEnvId.set(record.envId, record);
			}
		} catch {
			/* first boot or unreadable file — the seed below recreates it */
		}
	}

	function persistNow() {
		try {
			fs.mkdirSync(stateDir, { recursive: true });
			const tmp = `${stateFile}.tmp-${process.pid}-${randomUUID()}`;
			fs.writeFileSync(tmp, JSON.stringify([...byEnvId.values()], undefined, '\t'), { mode: 0o600 });
			fs.renameSync(tmp, stateFile);
		} catch {
			/* a dashboard that cannot write its environment file is still usable */
		}
	}

	/** Same filtered-list semantics as the SQL backend, in memory. */
	function filterRecords(filters = {}) {
		const term = filters.search ? String(filters.search).toLowerCase() : '';
		return [...byEnvId.values()].filter((record) => {
			if (filters.platform && record.platform !== filters.platform) return false;
			if (filters.device && record.device !== filters.device) return false;
			if (filters.os && record.os !== filters.os) return false;
			if (filters.osVersion && record.osVersion !== filters.osVersion) return false;
			if (filters.browser && record.browser !== filters.browser) return false;
			if (filters.browserCode && record.browserCode !== filters.browserCode) return false;
			if (filters.browserVersion && record.browserVersion !== String(filters.browserVersion)) return false;
			if (filters.deviceType && record.deviceType !== filters.deviceType) return false;
			if (filters.executionProvider && record.executionProvider !== filters.executionProvider) return false;
			if (filters.isRealDevice !== undefined && filters.isRealDevice !== null && filters.isRealDevice !== '') {
				if (record.isRealDevice !== (filters.isRealDevice === true || filters.isRealDevice === 'true')) return false;
			}
			if (filters.active !== undefined && filters.active !== null && filters.active !== '') {
				if (record.active !== (filters.active === true || filters.active === 'true')) return false;
			}
			if (term) {
				const haystack = `${record.envId} ${record.device} ${record.browser}`.toLowerCase();
				if (!haystack.includes(term)) return false;
			}
			return true;
		}).sort((left, right) => `${left.platform}|${left.device}|${left.osVersion}|${left.browser}|${left.browserVersion}`
			.localeCompare(`${right.platform}|${right.device}|${right.osVersion}|${right.browser}|${right.browserVersion}`));
	}

	return {
		async seed() {
			loadFromDisk();
			for (const env of generateEnvironments()) {
				const existing = byEnvId.get(env.envId);
				byEnvId.set(env.envId, existing ? { ...env, active: existing.active } : { id: randomUUID(), ...env });
			}
			persistNow();
			return { inserted: byEnvId.size, catalogVersion: ENVIRONMENT_CATALOG_VERSION };
		},
		async list(tenant, filters = {}) {
			loadFromDisk();
			const all = filterRecords(filters);
			const offset = Math.max(Number(filters.offset ?? 0), 0);
			const limit = Math.min(Math.max(Number(filters.limit ?? 500), 1), 1000);
			return all.slice(offset, offset + limit);
		},
		async get(tenant, envId) {
			loadFromDisk();
			return byEnvId.get(envId) ?? null;
		},
		async create(tenant, input) {
			loadFromDisk();
			const record = await normalizeEnvironmentInput(input, { catalogBackend });
			if (byEnvId.has(record.envId)) throw new EnvironmentConflictError(record.envId);
			const stored = { id: randomUUID(), ...record };
			byEnvId.set(stored.envId, stored);
			persistNow();
			return stored;
		},
		async update(tenant, envId, patch) {
			loadFromDisk();
			const record = byEnvId.get(envId);
			if (!record) return null;
			if (patch && typeof patch.active === 'boolean') record.active = patch.active;
			if (patch && (patch.executionProvider === 'local' || patch.executionProvider === 'browserstack')) {
				record.executionProvider = patch.executionProvider;
			}
			if (patch && typeof patch.screenResolution === 'string' && patch.screenResolution.trim() !== '') {
				record.screenResolution = patch.screenResolution.trim();
			}
			if (patch && (patch.orientation === 'portrait' || patch.orientation === 'landscape')) {
				record.orientation = patch.orientation;
			}
			if (patch && typeof patch.description === 'string') {
				record.description = patch.description.trim();
			}
			record.updatedAt = new Date().toISOString();
			persistNow();
			return record;
		},
		async remove(tenant, envId) {
			loadFromDisk();
			if (!byEnvId.has(envId)) return false;
			byEnvId.delete(envId);
			persistNow();
			return true;
		}
	};
}

// ---------------------------------------------------------------------------
// Service facade over either backend
// ---------------------------------------------------------------------------

const FILTER_KEYS = [
	'platform', 'device', 'os', 'osVersion', 'browser', 'browserCode', 'browserVersion',
	'deviceType', 'executionProvider', 'isRealDevice', 'active', 'search', 'limit', 'offset'
];

export function sanitizeFilters(query = {}) {
	const filters = {};
	for (const key of FILTER_KEYS) {
		const value = query[key];
		if (value === undefined || value === null || value === '') continue;
		filters[key] = value;
	}
	return filters;
}

export function createEnvironmentService(backend, options = {}) {
	const tenantContext = options.tenantContext;
	const withTenant = (tenant) => tenant ?? tenantContext ?? {};
	/** Catalog backend (device/OS/browser reference data) — attached by the factory. */
	let catalogBackend = null;

	async function list(filters = {}) {
		const rows = await backend.list(withTenant(), sanitizeFilters(filters));
		return rows.map(rowToEnvironment);
	}

	async function get(envId) {
		return rowToEnvironment(await backend.get(withTenant(), envId));
	}

	async function create(input) {
		return rowToEnvironment(await backend.create(withTenant(), input));
	}

	async function update(envId, patch) {
		return rowToEnvironment(await backend.update(withTenant(), envId, patch));
	}

	async function remove(envId) {
		return Boolean(await backend.remove(withTenant(), envId));
	}

	/** Facet values (with counts) over the filtered set, for the admin UI dropdowns. */
	async function facets(filters = {}) {
		const clean = sanitizeFilters(filters);
		const facetQuery = { ...clean, limit: 1000, offset: 0 };
		const rows = (await backend.list(withTenant(), facetQuery)).map(rowToEnvironment);
		const dimension = (key) => {
			const counts = new Map();
			for (const row of rows) {
				const value = row[key];
				counts.set(value, (counts.get(value) ?? 0) + 1);
			}
			return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
		};
		return {
			total: rows.length,
			platform: dimension('platform'),
			device: dimension('device'),
			os: dimension('os'),
			osVersion: dimension('osVersion'),
			browser: dimension('browser'),
			browserVersion: dimension('browserVersion'),
			deviceType: dimension('deviceType'),
			executionProvider: dimension('executionProvider'),
			isRealDevice: dimension('isRealDevice'),
			active: dimension('active')
		};
	}

	return {
		seed: () => backend.seed(withTenant()),
		list,
		get,
		create,
		update,
		remove,
		facets,
		availability: () => availabilityReport(),
		catalogVersion: () => ENVIRONMENT_CATALOG_VERSION,
		/** Optional catalog backend (migration 016) — set by the service factory. */
		attachCatalog: (catalog) => { catalogBackend = catalog; },
		catalog: () => catalogBackend,
		/** Bulk create: validate every combination, create the valid ones, skip the rest. */
		async bulkCreate(inputs = []) {
			if (!Array.isArray(inputs)) throw new EnvironmentValidationError('combinations must be an array.');
			if (inputs.length > 500) throw new EnvironmentValidationError('combinations is limited to 500 entries per request.');
			const created = [];
			const skipped = [];
			for (const input of inputs) {
				try {
					created.push(await backend.create(withTenant(), input));
				} catch (error) {
					if (error?.code === 'QASE_ENVIRONMENT_CONFLICT' || error?.code === 'QASE_ENVIRONMENT_INVALID') {
						skipped.push({ input, reason: error.message, code: error.code });
					} else {
						throw error;
					}
				}
			}
			return { created: created.map(rowToEnvironment), skipped, total: inputs.length };
		},
		/** Bulk enable/disable by envId list. Unknown ids are reported, not fatal. */
		async bulkToggleActive(envIds = [], active = true) {
			const updated = [];
			const missing = [];
			for (const envId of envIds) {
				const row = await backend.update(withTenant(), String(envId), { active: Boolean(active) });
				if (row) updated.push(rowToEnvironment(row));
				else missing.push(envId);
			}
			return { updated, missing, active: Boolean(active) };
		}
	};
}
