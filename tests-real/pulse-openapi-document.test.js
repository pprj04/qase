'use strict';

/**
 * Unit tests for the Pulse OpenAPI document builder + helpers.
 * Run: node --test tests-real/pulse-openapi-document.test.js
 * No server required — pure document/rule assertions.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiDocument, operations } from '../server/openapiDocument.js';
import {
	deepIsoTimestamps, parsePulsePaging, pulseEnvelope, parseDateRange, applyDateRange,
} from '../server/pulseHelpers.js';

const SNAKE_RE = /^[a-z][a-z0-9_]*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe('document shape', () => {
	const doc = buildOpenApiDocument({ serverUrl: 'https://api.example.com' });

	test('is OpenAPI 3.x JSON with a server', () => {
		assert.ok(parseFloat(doc.openapi) >= 3);
		assert.equal(doc.servers[0].url, 'https://api.example.com');
		assert.ok(doc.info?.title && doc.info?.version);
	});

	test('declares bearer security', () => {
		assert.ok(doc.components.securitySchemes.bearerAuth);
		assert.equal(doc.components.securitySchemes.bearerAuth.type, 'http');
		assert.equal(doc.components.securitySchemes.bearerAuth.scheme, 'bearer');
	});

	test('health is public; everything else requires the token', () => {
		const health = doc.paths['/api/v2/health'].get;
		assert.deepEqual(health.security, []);
		const missions = doc.paths['/api/v2/missions'].get;
		assert.deepEqual(missions.security, [{ bearerAuth: [] }]);
	});

	test('every operationId is unique, snake_case, <= 64 chars', () => {
		const ops = operations();
		assert.ok(ops.length >= 25, `expected >= 25 operations, got ${ops.length}`);
		const ids = ops.map(o => o.operationId);
		assert.equal(new Set(ids).size, ids.length, 'operationIds must be unique');
		for (const oid of ids) {
			assert.match(oid, SNAKE_RE, `operationId ${oid} not snake_case`);
			assert.ok(oid.length <= 64, `operationId ${oid} too long (${oid.length})`);
		}
	});

	test('every operation has summary, tags, and a success response schema (per-method)', () => {
		for (const [path, methods] of Object.entries(doc.paths)) {
			for (const [method, op] of Object.entries(methods)) {
				assert.ok(op.summary, `${method.toUpperCase()} ${path} missing summary`);
				assert.ok(Array.isArray(op.tags) && op.tags.length > 0, `${method.toUpperCase()} ${path} missing tags`);
				const okCodes = Object.keys(op.responses ?? {}).filter((c) => c.startsWith('2'));
				assert.ok(okCodes.length > 0, `${method.toUpperCase()} ${path} missing a 2xx response`);
				for (const code of okCodes) {
					assert.ok(
						op.responses[code]?.content?.['application/json']?.schema,
						`${method.toUpperCase()} ${path} ${code} missing JSON schema`
					);
				}
			}
		}
	});

	test('integration ops exist (15) and all carry hmacAuth security', () => {
		const intPaths = Object.entries(doc.paths).filter(([p]) => p.startsWith('/api/v1/integration/'));
		const opCount = intPaths.reduce((n, [, methods]) => n + Object.keys(methods).length, 0);
		assert.equal(opCount, 15, `expected 15 integration operations, got ${opCount}`);
		for (const [p, methods] of intPaths) {
			for (const [method, op] of Object.entries(methods)) {
				assert.ok(
					JSON.stringify(op.security ?? []).includes('hmacAuth'),
					`${method.toUpperCase()} ${p} missing hmacAuth security`
				);
			}
		}
		assert.ok(doc.components.securitySchemes.hmacAuth, 'hmacAuth scheme missing');
	});

	test('collections declare data + total + page/page_size with default and maximum', () => {
		for (const [path, methods] of Object.entries(doc.paths)) {
			const get = methods.get;
			if (!get) continue; // POST-only paths are legal on the integration surface
			const schema = get.responses['200']?.content?.['application/json']?.schema;
			if (!schema) continue;
			const props = schema.properties ?? {};
			if (!props.data || props.data.type !== 'array') continue;
			const label = `${path} (collection)`;
			assert.equal(props.total?.type, 'integer', `${label} missing integer total`);
			const params = get.parameters;
			const page = params.find(p => p.name === 'page');
			const pageSize = params.find(p => p.name === 'page_size');
			assert.ok(page, `${label} missing page`);
			assert.ok(pageSize, `${label} missing page_size`);
			assert.ok(page.schema.default === 1, `${label} page default`);
			assert.equal(pageSize.schema.default, 100, `${label} page_size default`);
			assert.ok(pageSize.schema.maximum <= 500, `${label} page_size maximum`);
			assert.ok(page.schema.minimum >= 1, `${label} page minimum`);
		}
	});

	test('time-based collections declare from/to as format: date', () => {
		const expected = ['/api/v2/missions', '/api/v2/sessions', '/api/v2/findings',
			'/api/v2/test-cases', '/api/v2/workflows', '/api/v2/regression/runs'];
		for (const path of expected) {
			const params = doc.paths[path].get.parameters;
			const from = params.find(p => p.name === 'from');
			const to = params.find(p => p.name === 'to');
			assert.ok(from, `${path} missing from`);
			assert.ok(to, `${path} missing to`);
			assert.equal(from.schema.format, 'date');
			assert.equal(to.schema.format, 'date');
			assert.ok(from.description, `${path} from without description`);
			assert.ok(to.description, `${path} to without description`);
		}
	});

	test('closed value sets are enums', () => {
		const findingParams = doc.paths['/api/v2/findings'].get.parameters;
		for (const name of ['severity', 'status', 'finding_status', 'review_status', 'priority', 'primary_category', 'reproducibility']) {
			const p = findingParams.find(x => x.name === name);
			assert.ok(p, `findings missing param ${name}`);
			assert.ok(Array.isArray(p.schema.enum) && p.schema.enum.length > 0, `findings.${name} not an enum`);
		}
		const missionParams = doc.paths['/api/v2/missions'].get.parameters;
		for (const name of ['status', 'type', 'source']) {
			const p = missionParams.find(x => x.name === name);
			assert.ok(Array.isArray(p.schema.enum), `missions.${name} not an enum`);
		}
	});

	test('no standalone {"type": "null"} anywhere', () => {
		// Structural walk: type:'null' is legal only inside anyOf/oneOf unions.
		// (A regex strip cannot handle nested arrays — enum: [...] inside a union
		// branch — and would miscount union branches as standalone.)
		let standalone = 0;
		const walk = (node, inUnion) => {
			if (Array.isArray(node)) { node.forEach((n) => walk(n, inUnion)); return; }
			if (node && typeof node === 'object') {
				if (node.type === 'null' && !inUnion) standalone += 1;
				for (const [k, v] of Object.entries(node)) {
					walk(v, inUnion || k === 'anyOf' || k === 'oneOf');
				}
			}
		};
		walk(doc, false);
		assert.equal(standalone, 0, `standalone type:null found: ${standalone}`);
	});

	test('timestamps declared as date-time; ids + names beside foreign ids', () => {
		const S = doc.components.schemas;
		for (const name of ['Mission', 'Session', 'Finding', 'TestCase', 'Workflow', 'Suite', 'Schedule', 'RegressionRun', 'FixValidationRun']) {
			const props = S[name].properties;
			assert.ok(props.id, `${name} missing id`);
			const created = props.created_at ?? props.createdAt;
			if (created) assert.equal(created.format, 'date-time', `${name}.created_at not date-time`);
			if (props.project_id) assert.ok(props.project_name, `${name} has project_id but no project_name`);
		}
		const finding = S.Finding.properties;
		assert.ok(finding.mission_name, 'Finding missing mission_name');
		assert.ok(finding.session_title, 'Finding missing session_title');
	});

	test('enums in the document mirror the live server taxonomy', async () => {
		const { CATEGORIES, SEVERITIES, PRIORITIES, LIFECYCLE, REVIEW_STATUSES, REPRODUCIBILITIES } =
			await import('../server/findingIntelligence.js');
		const params = doc.paths['/api/v2/findings'].get.parameters;
		assert.deepEqual(params.find(p => p.name === 'severity').schema.enum, SEVERITIES);
		assert.deepEqual(params.find(p => p.name === 'primary_category').schema.enum, CATEGORIES);
		assert.deepEqual(params.find(p => p.name === 'finding_status').schema.enum, LIFECYCLE);
		assert.deepEqual(params.find(p => p.name === 'review_status').schema.enum, REVIEW_STATUSES);
		assert.deepEqual(params.find(p => p.name === 'reproducibility').schema.enum, REPRODUCIBILITIES);
		const { MISSION_STATUS, MISSION_TYPES } = await import('../server/missions.js');
		const mparams = doc.paths['/api/v2/missions'].get.parameters;
		assert.deepEqual(mparams.find(p => p.name === 'status').schema.enum, MISSION_STATUS);
		assert.deepEqual(mparams.find(p => p.name === 'type').schema.enum, MISSION_TYPES);
	});
});

describe('pulseHelpers', () => {

	test('deepIsoTimestamps converts epoch-ms, keeps counters numeric', () => {
		const input = {
			createdAt: 1700000000000,
			ts: 1700000001234,
			total: 42,
			turnCount: 7,
			durationMs: 12345,
			nested: { updatedAt: 1700000000000, score: 3 },
			items: [{ ranAt: 1700000000000 }],
		};
		const out = deepIsoTimestamps(input);
		assert.match(out.createdAt, ISO_RE);
		assert.match(out.ts, ISO_RE);
		assert.match(out.nested.updatedAt, ISO_RE);
		assert.match(out.items[0].ranAt, ISO_RE);
		assert.equal(out.total, 42);
		assert.equal(out.turnCount, 7);
		assert.equal(out.durationMs, 12345);
		assert.equal(out.nested.score, 3);
	});

	test('deepIsoTimestamps does not touch strings or small numbers', () => {
		const out = deepIsoTimestamps({ name: 'x', qualityScore: 87, id: 'abc', label: '1700000000000' });
		assert.equal(out.name, 'x');
		assert.equal(out.qualityScore, 87);
		assert.equal(out.id, 'abc');
		assert.equal(out.label, '1700000000000');
	});

	test('parsePulsePaging: null when absent, clamped when absurd', () => {
		assert.equal(parsePulsePaging({}), null);
		assert.equal(parsePulsePaging({ page: '', page_size: '' }), null);
		assert.deepEqual(parsePulsePaging({ page: '2' }), { page: 2, pageSize: 100 });
		assert.deepEqual(parsePulsePaging({ page_size: '9999' }), { page: 1, pageSize: 500 });
		assert.deepEqual(parsePulsePaging({ page: '0', page_size: '0' }), { page: 1, pageSize: 100 });
		assert.deepEqual(parsePulsePaging({ page: 'abc' }), { page: 1, pageSize: 100 });
	});

	test('pulseEnvelope slices and counts correctly', () => {
		const list = Array.from({ length: 250 }, (_, i) => ({ i }));
		const out = pulseEnvelope(list, { page: 3, pageSize: 100 });
		assert.equal(out.total, 250);
		assert.equal(out.data.length, 50);
		assert.equal(out.page, 3);
		assert.equal(out.page_size, 100);
		const extras = pulseEnvelope(list, { page: 1, pageSize: 100 }, { queueDepth: 0 });
		assert.equal(extras.queueDepth, 0);
	});

	test('parseDateRange + applyDateRange: inclusive from, exclusive to, 400 on junk', () => {
		const range = parseDateRange({ from: '2026-01-01', to: '2026-02-01' });
		assert.ok(!range.error);
		const list = [
			{ id: 1, ts: Date.parse('2026-01-01T00:00:00Z') },
			{ id: 2, ts: Date.parse('2026-01-15T12:00:00Z') },
			{ id: 3, ts: Date.parse('2026-02-01T00:00:00Z') },
			{ id: 4, ts: Date.parse('2025-12-31T23:59:59Z') },
		];
		const out = applyDateRange(list, range, 'ts');
		assert.deepEqual(out.map(x => x.id), [1, 2]);
		assert.ok(parseDateRange({ from: 'yesterday' }).error);
		assert.ok(parseDateRange({ to: '2026-13-45' }).error);
		assert.ok(parseDateRange({}).error === undefined || parseDateRange({})?.toMs === undefined);
	});
});
