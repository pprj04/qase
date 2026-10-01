import { randomUUID } from 'node:crypto';
import {
	generateEnvironments,
	ENVIRONMENT_CATALOG_VERSION
} from '../environmentCatalog.js';
import {
	normalizeEnvironmentInput,
	EnvironmentValidationError,
	EnvironmentConflictError
} from '../environmentService.js';

// The normalizer is shared with the local store backend — a single validation
// path (frozen catalog fallback, DB-backed catalog when attached) for both stores.
export { normalizeEnvironmentInput, EnvironmentValidationError };
void EnvironmentConflictError;

/**
 * PostgreSQL persistence for Apple compatibility environments.
 *
 * The matrix is generated deterministically from the frozen catalog
 * (server/environmentCatalog.js) and upserted by env_id — re-seeding is
 * idempotent, never deletes rows, and never flips `active` back to true on its
 * own, so operator deprecations survive catalog refreshes.
 */

const ENV_COLUMNS = [
	'platform', 'platform_label', 'device', 'os', 'os_version', 'browser',
	'browser_code', 'browser_version', 'device_type', 'screen_size',
	'screen_resolution', 'orientation', 'description',
	'execution_provider', 'is_real_device', 'active', 'browserstack_capabilities',
	'permission_scenario', 'orientation_scenario', 'execution_level_requested'
];

export { EnvironmentConflictError };

function requireTenant(tenant) {
	if (!tenant || typeof tenant !== 'object') {
		throw new TypeError('Environment storage requires a tenant context.');
	}
	if (!tenant.organizationId || !tenant.projectId) {
		throw new TypeError('Environment tenant context is missing organizationId/projectId.');
	}
	return tenant;
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
	return {
		browserName: browser.code,
		...(browser.code === 'safari' ? {} : { browserVersion: String(browserVersion) }),
		os: 'ios',
		osVersion,
		deviceName: device.browserstackDeviceName,
		realMobile: true
	};
}

export function createPostgresEnvironmentRepository(pool, options = {}) {
	const tenantContext = options.tenantContext;
	const catalogValidator = options.catalogBackend ?? null;
	const effectiveTenant = () => requireTenant(tenantContext);

	async function withTenant(client, tenant) {
		const resolved = requireTenant(tenant);
		await client.query("SELECT set_config('qase.organization_id', $1, true)", [resolved.organizationId]);
		await client.query("SELECT set_config('qase.project_id', $1, true)", [resolved.projectId]);
	}

	/**
	 * Idempotently seed the deterministic matrix. Upsert by env_id; descriptive
	 * fields are refreshed, but `active` is intentionally NOT overwritten — an
	 * environment an operator deactivated stays deactivated. Rows no longer in
	 * the catalog are never deleted (history references them).
	 */
	async function seed(tenant) {
		const resolved = requireTenant(tenant ?? tenantContext);
		const environments = generateEnvironments();
		const refreshed = ENV_COLUMNS.filter((column) => column !== 'active');
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await withTenant(client, resolved);
			for (const env of environments) {
				const params = [randomUUID(), resolved.organizationId, resolved.projectId, env.envId];
				// Deterministic seed rows predate the resolution/orientation columns —
				// default them from the device so seeded rows carry the new fields too.
				const seeded = {
					screenResolution: null,
					orientation: null,
					description: null,
					...env,
					screenResolution: env.screenResolution ?? null,
					orientation: env.orientation ?? null,
					description: env.description ?? null
				};
				for (const column of ENV_COLUMNS) {
				const value = seeded[column];
				params.push(column === 'browserstack_capabilities' || column === 'permission_scenario'
					? (value === undefined || value === null ? null : JSON.stringify(value))
					: (value === undefined ? null : value));
			}
				const placeholders = params.map((_, index) => `$${index + 1}`).join(', ');
				const updates = refreshed.map((column) => `${column} = EXCLUDED.${column}`).join(', ');
				await client.query(
					`INSERT INTO environments (id, organization_id, project_id, env_id, ${ENV_COLUMNS.join(', ')})
					 VALUES (${placeholders})
					 ON CONFLICT (organization_id, project_id, env_id) DO UPDATE SET
						${updates}, updated_at = CURRENT_TIMESTAMP`,
					params
				);
			}
			await client.query('COMMIT');
			return { inserted: environments.length, catalogVersion: ENVIRONMENT_CATALOG_VERSION };
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	}

	async function list(tenant, filters = {}) {
		const resolved = requireTenant(tenant ?? tenantContext);
		const client = await pool.connect();
		try {
			await withTenant(client, resolved);
			return await queryFiltered(client, filters, false);
		} finally {
			client.release();
		}
	}

	async function count(tenant, filters = {}) {
		const resolved = requireTenant(tenant ?? tenantContext);
		const client = await pool.connect();
		try {
			await withTenant(client, resolved);
			return await queryFiltered(client, filters, true);
		} finally {
			client.release();
		}
	}

	async function get(tenant, envId) {
		const resolved = requireTenant(tenant ?? tenantContext);
		const client = await pool.connect();
		try {
			await withTenant(client, resolved);
			const result = await client.query(
				'SELECT * FROM environments WHERE env_id = $1 LIMIT 1',
				[envId]
			);
			return result.rows[0] ?? null;
		} finally {
			client.release();
		}
	}

	async function create(tenant, input) {
		const resolved = requireTenant(tenant ?? tenantContext);
		const record = await normalizeEnvironmentInput(input, { catalogBackend: catalogValidator });
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await withTenant(client, resolved);
			const existing = await client.query(
				'SELECT env_id FROM environments WHERE env_id = $1 LIMIT 1',
				[record.envId]
			);
			if (existing.rows.length > 0) {
				await client.query('ROLLBACK');
				throw new EnvironmentConflictError(record.envId);
			}
			const params = [randomUUID(), resolved.organizationId, resolved.projectId, record.envId];
			for (const column of ENV_COLUMNS) {
				const value = record[column];
				params.push(column === 'browserstack_capabilities' || column === 'permission_scenario'
					? (value === undefined || value === null ? null : JSON.stringify(value))
					: (value === undefined ? null : value));
			}
			const placeholders = params.map((_, index) => `$${index + 1}`).join(', ');
			const result = await client.query(
				`INSERT INTO environments (id, organization_id, project_id, env_id, ${ENV_COLUMNS.join(', ')})
				 VALUES (${placeholders}) RETURNING *`,
				params
			);
			await client.query('COMMIT');
			return result.rows[0];
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	}

		/** Patchable fields only: active, execution_provider, scenarios. env_id is immutable. */
		async function update(tenant, envId, patch) {
			const resolved = requireTenant(tenant ?? tenantContext);
			const columnMap = {
				active: 'active',
				executionProvider: 'execution_provider',
				screenResolution: 'screen_resolution',
				orientation: 'orientation',
				description: 'description',
				permissionScenario: 'permission_scenario',
				orientationScenario: 'orientation_scenario',
				executionLevelRequested: 'execution_level_requested'
			};
		const columns = [];
		const params = [];
			for (const [key, value] of Object.entries(patch ?? {})) {
				const column = columnMap[key];
				if (!column) continue;
				columns.push(`${column} = $${params.length + 1}`);
				params.push(column === 'permission_scenario' && value !== null && value !== undefined
					? JSON.stringify(value)
					: (value === undefined ? null : value));
			}
		if (columns.length === 0) return get(tenant, envId);
		params.push(envId);
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await withTenant(client, resolved);
			const result = await client.query(
				`UPDATE environments SET ${columns.join(', ')}, updated_at = CURRENT_TIMESTAMP
				 WHERE env_id = $${params.length} RETURNING *`,
				params
			);
			await client.query('COMMIT');
			return result.rows[0] ?? null;
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	}

	async function remove(tenant, envId) {
		const resolved = requireTenant(tenant ?? tenantContext);
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await withTenant(client, resolved);
			const result = await client.query('DELETE FROM environments WHERE env_id = $1', [envId]);
			await client.query('COMMIT');
			return (result.rowCount ?? 0) > 0;
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	}

	async function queryFiltered(client, filters, countOnly) {
		const conditions = [];
		const params = [];
		const add = (column, value) => {
			params.push(value);
			conditions.push(`${column} = $${params.length}`);
		};
		if (filters.platform) add('platform', filters.platform);
		if (filters.platformGroup?.length) {
			params.push(filters.platformGroup);
			conditions.push(`platform = ANY($${params.length})`);
		}
		if (filters.device) add('device', filters.device);
		if (filters.os) add('os', filters.os);
		if (filters.osVersion) add('os_version', filters.osVersion);
		if (filters.browser) add('browser', filters.browser);
		if (filters.browserCode) add('browser_code', filters.browserCode);
		if (filters.browserVersion) add('browser_version', filters.browserVersion);
		if (filters.deviceType) add('device_type', filters.deviceType);
		if (filters.executionProvider) add('execution_provider', filters.executionProvider);
		if (filters.orientationScenario) add('orientation_scenario', filters.orientationScenario);
		if (filters.executionLevelRequested) add('execution_level_requested', filters.executionLevelRequested);
		if (filters.isRealDevice !== undefined && filters.isRealDevice !== null && filters.isRealDevice !== '') {
			add('is_real_device', filters.isRealDevice === true || filters.isRealDevice === 'true');
		}
		if (filters.active !== undefined && filters.active !== null && filters.active !== '') {
			add('active', filters.active === true || filters.active === 'true');
		}
		if (filters.search) {
			params.push(`%${filters.search}%`);
			conditions.push(`(env_id ILIKE $${params.length} OR device ILIKE $${params.length} OR browser ILIKE $${params.length})`);
		}
		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
		if (countOnly) {
			const result = await client.query(`SELECT COUNT(*)::int AS count FROM environments ${where}`, params);
			return result.rows[0].count;
		}
		const limit = Number(filters.limit ?? 500);
		const offset = Number(filters.offset ?? 0);
		const result = await client.query(
			`SELECT * FROM environments ${where}
			 ORDER BY platform, device, os_version, browser, browser_version
			 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
			[...params, Math.min(Math.max(limit, 1), 20000), Math.max(offset, 0)]
		);
		return result.rows;
	}

	return { seed, list, count, get, create, update, remove };
}
