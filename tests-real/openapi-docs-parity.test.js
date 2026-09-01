/**
 * Parity test — docs/openapi.yaml ↔ live OpenAPI document (integration surface).
 *
 * The YAML is the human-readable mirror of the live /openapi.json for
 * /api/v1/integration/*. This suite locks them together: every path:method
 * in the YAML must exist in the live document and vice versa (integration
 * scope only), success status codes must match per op, and every integration
 * op must carry hmacAuth security in BOTH documents.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as yamlLoad } from 'js-yaml';
import { buildOpenApiDocument } from '../server/openapiDocument.js';

const yamlDoc = yamlLoad(readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'));
const liveDoc = buildOpenApiDocument({ serverUrl: 'http://localhost:5173' });

const INT_PREFIX = '/api/v1/integration/';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function flatten(doc) {
	const ops = new Map(); // key: "METHOD path" -> { responses: Set(2xx+409), security }
	const docLevel = (doc.security ?? []).flatMap((s) => Object.keys(s));
	for (const [path, methods] of Object.entries(doc.paths ?? {})) {
		if (!path.startsWith(INT_PREFIX)) continue;
		for (const method of METHODS) {
			const op = methods[method];
			if (!op) continue;
			const codes = new Set(
				Object.keys(op.responses ?? {}).filter((c) => c.startsWith('2') || c === '409')
			);
			// per-op security overrides; absent → inherits document-level security
			const security = op.security !== undefined
				? (op.security).flatMap((s) => Object.keys(s))
				: docLevel;
			ops.set(`${method.toUpperCase()} ${path}`, { codes, security });
		}
	}
	return ops;
}

test('integration parity: docs/openapi.yaml ↔ live /openapi.json', () => {
	const yamlOps = flatten(yamlDoc);
	const liveOps = flatten(liveDoc);

	assert.ok(yamlOps.size >= 15, `YAML should declare the full integration surface, found ${yamlOps.size}`);
	assert.ok(liveOps.size >= 15, `live doc should declare the full integration surface, found ${liveOps.size}`);

	const onlyYaml = [...yamlOps.keys()].filter((k) => !liveOps.has(k));
	const onlyLive = [...liveOps.keys()].filter((k) => !yamlOps.has(k));
	assert.deepEqual(onlyYaml, [], `ops in YAML but missing from live doc: ${onlyYaml.join(', ')}`);
	assert.deepEqual(onlyLive, [], `ops in live doc but missing from YAML: ${onlyLive.join(', ')}`);

	for (const [key, y] of yamlOps) {
		const l = liveOps.get(key);
		// success code agreement: every 2xx/409 the YAML documents must exist live
		for (const code of y.codes) {
			assert.ok(l.codes.has(code), `${key}: YAML declares ${code} but live doc does not (${[...l.codes].join(',')})`);
		}
		// at least one shared success code
		const shared = [...y.codes].filter((c) => l.codes.has(c));
		assert.ok(shared.length > 0, `${key}: no shared success code (yaml ${[...y.codes]}, live ${[...l.codes]})`);
		// security
		assert.ok(
			y.security.includes('hmacAuth') || y.security.includes('hmacSignature'),
			`${key}: YAML op missing hmac security (${y.security.join(',')})`
		);
		assert.ok(l.security.includes('hmacAuth'), `${key}: live op missing hmacAuth (${l.security.join(',')})`);
	}
});

test('hmac security scheme exists in both documents', () => {
	assert.ok(yamlDoc.components?.securitySchemes?.hmacAuth, 'YAML missing components.securitySchemes.hmacAuth');
	assert.ok(liveDoc.components?.securitySchemes?.hmacAuth, 'live doc missing components.securitySchemes.hmacAuth');
});

test('docs/openapi.yaml corrections stay corrected', () => {
	// Regression guards for the four corrections made in Phase 4:
	// 1. decision-trace documented
	assert.ok(
		yamlDoc.paths['/api/v1/integration/missions/{id}/decision-trace']?.get,
		'decision-trace missing from YAML'
	);
	// 2. GET /keys returns {integrations: [...]}
	const keysGet = yamlDoc.paths['/api/v1/integration/keys']?.get;
	const props = keysGet?.responses?.['200']?.content?.['application/json']?.schema?.properties ?? {};
	assert.ok(props.integrations, 'GET /keys response must declare {integrations: [...]}');
	assert.equal(props.keys, undefined, 'GET /keys response must NOT use the old keys:[] shape');
	// 3. missions-create documents 409
	const createCodes = Object.keys(yamlDoc.paths['/api/v1/integration/missions']?.post?.responses ?? {});
	assert.ok(createCodes.includes('409'), 'POST /missions must document 409 idempotency_key_reused');
	// 4. findings default limit is 50
	const limitParam = (yamlDoc.paths['/api/v1/integration/missions/{id}/findings']?.get?.parameters ?? [])
		.find((p) => p.name === 'limit');
	assert.equal(limitParam?.schema?.default, 50, 'findings limit default must be 50 (not 100)');
});
