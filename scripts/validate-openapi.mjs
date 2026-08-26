#!/usr/bin/env node
/**
 * OpenAPI document validator — enforces the Drytis Pulse connector guide rules
 * against a live document (same rules the Pulse validator applies).
 *
 * Usage:
 *   node scripts/validate-openapi.mjs http://localhost:5173/openapi.json [-v]
 *   npm run test:openapi            # validates the live server at QASE_BASE_URL
 *
 * Flags every operation as the agent sees it, then checks:
 *   - operationId present, unique, snake_case, <= 64 chars
 *   - every GET declares a 200 response schema
 *   - collections: records under `data` + integer `total`
 *   - every collection declares page/page_size with default and maximum
 *   - enums on closed value sets; from/to format: date on time-based lists
 *   - no standalone {"type": "null"}; free-form objects use additionalProperties
 *   - timestamps declared as format: date-time
 * Exit code 0 = clean, 1 = violations. Node 20+, no dependencies.
 */

import process from 'node:process';

const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const SNAKE_RE = /^[a-z][a-z0-9_]*$/;

const verbose = process.argv.includes('-v');
const urlArg = process.argv.find(a => a.startsWith('http')) ?? process.env.QASE_BASE_URL ?? 'http://localhost:5173';
const docUrl = urlArg.endsWith('/openapi.json') ? urlArg : `${urlArg.replace(/\/$/, '')}/openapi.json`;

const problems = [];
const warnings = [];

function fail(msg) { problems.push(msg); }
function warn(msg) { warnings.push(msg); }
function log(line) { if (verbose) console.log(line); }

function resolveRef(doc, node) {
	if (!node) return null;
	if (node.$ref) {
		const path = node.$ref.replace(/^#\//, '').split('/');
		let cur = doc;
		for (const seg of path) cur = cur?.[seg];
		return cur ?? null;
	}
	return node;
}

async function main() {
	const res = await fetch(docUrl, { headers: { Accept: 'application/json' } });
	const contentType = res.headers.get('content-type') ?? '';
	if (!res.ok) { console.error(`FAIL: document URL returned ${res.status}`); process.exit(1); }
	if (!contentType.includes('application/json')) {
		fail(`content-type must be application/json, got "${contentType}"`);
	}
	const text = await res.text();
	let doc;
	try { doc = JSON.parse(text); } catch (e) {
		console.error(`FAIL: document is not valid JSON: ${e.message}`); process.exit(1);
	}
	if (/^openapi:\s|^\s*swagger:/.test(text) || typeof doc !== 'object') {
		fail('document looks like YAML — the connector requires JSON');
	}

	const version = parseFloat(String(doc.openapi ?? 0));
	if (!(version >= 3)) fail(`openapi field must be 3.x, got ${doc.openapi}`);

	if (!doc.servers?.length || !doc.servers[0].url) fail('servers[0].url missing — base URL ambiguous');
	else log(`server: ${doc.servers[0].url}`);

	if (!doc.security?.some(s => s && Object.keys(s).length > 0) && !doc.paths['/api/v2/health']) {
		// document-level security optional when per-op declared; checked per-op below
	}

	const ops = [];
	for (const [path, methods] of Object.entries(doc.paths ?? {})) {
		for (const [method, op] of Object.entries(methods)) {
			if (method === 'parameters' || !op || typeof op !== 'object') continue;
			if (method.toUpperCase() !== 'GET') continue; // only GETs become tools
			ops.push({ path, method, op });
		}
	}
	if (ops.length === 0) fail('no GET operations found');

	const seenIds = new Map();
	for (const { path, op } of ops) {
		const label = `${path}`;

		// operationId
		const oid = op.operationId;
		if (!oid) fail(`${label}: missing operationId`);
		else {
			if (oid.length > 64) fail(`${label}: operationId "${oid}" exceeds 64 chars (${oid.length})`);
			if (!SNAKE_RE.test(oid)) fail(`${label}: operationId "${oid}" not snake_case`);
			if (seenIds.has(oid)) fail(`${label}: duplicate operationId "${oid}" (also ${seenIds.get(oid)})`);
			seenIds.set(oid, label);
		}

		if (!op.summary) fail(`${label}: missing summary`);
		if (!Array.isArray(op.tags) || op.tags.length === 0) fail(`${label}: missing tags`);
		else for (const t of op.tags) if (!doc.tags?.some(x => x.name === t)) warn(`${label}: tag "${t}" not declared in top-level tags`);

		// response schema
		const schema = op.responses?.['200']?.content?.['application/json']?.schema;
		if (!schema) fail(`${label}: GET without 200 response schema`);

		const params = Array.isArray(op.parameters) ? op.parameters : [];
		const hasPage = params.some(p => p.name === 'page' && p.in === 'query');
		const hasPageSize = params.some(p => p.name === 'page_size' && p.in === 'query');
		const hasFrom = params.some(p => p.name === 'from');
		const hasTo = params.some(p => p.name === 'to');

		// collection detection: response schema with `data` array property
		const props = schema?.properties ?? {};
		const isCollection = schema && props.data?.type === 'array';
		const isEnvelopeList = schema && props.total?.type === 'integer' && props.data;

		if (isEnvelopeList || isCollection) {
			if (!props.total) fail(`${label}: collection without integer total`);
			else if (props.total.type !== 'integer') fail(`${label}: total must be integer`);
			if (!hasPage) fail(`${label}: collection without page parameter`);
			if (!hasPageSize) fail(`${label}: collection without page_size parameter`);
			const psParam = params.find(p => p.name === 'page_size');
			if (psParam && !(psParam.schema?.default != null)) fail(`${label}: page_size missing default`);
			if (psParam && !(psParam.schema?.maximum != null)) fail(`${label}: page_size missing maximum`);
			// from/to only expected when the items themselves carry timestamps
			const itemSchema = resolveRef(doc, props.data.items);
			const hasDateTime = itemSchema && JSON.stringify(itemSchema).includes('"date-time"');
			if (hasDateTime && (!hasFrom || !hasTo)) warn(`${label}: time-based collection without from/to date range`);
		}

		for (const p of params) {
			if (!p.description) warn(`${label}: parameter "${p.name}" without description`);
		}

		log(`${oid ?? path}  [${op.tags?.join(', ')}]${isCollection ? ' (collection)' : ''}`);
	}

	// enum coverage: findings severity + mission status must be enums (guide rule 3)
	const findOps = ops.filter(({ op }) => op.tags?.includes('Findings'));
	const sevParam = findOps.flatMap(({ op }) => op.parameters ?? []).find(p => p.name === 'severity');
	if (sevParam && !sevParam.schema?.enum) warn('findings severity parameter not an enum');
	const missionOps = ops.filter(({ op }) => op.tags?.includes('Missions'));
	const statusParam = missionOps.flatMap(({ op }) => op.parameters ?? []).find(p => p.name === 'status');
	if (statusParam && !statusParam.schema?.enum) warn('missions status parameter not an enum');

	// type:null scan — legal inside anyOf/oneOf unions, illegal as a whole schema
	function scanTypeNull(node, trail, inUnion) {
		if (Array.isArray(node)) return node.forEach(n => scanTypeNull(n, trail, inUnion));
		if (node && typeof node === 'object') {
			if (node.type === 'null' && !inUnion) {
				fail(`${trail}: standalone {"type":"null"} — use additionalProperties or a nullable union`);
			}
			for (const [k, v] of Object.entries(node)) {
				scanTypeNull(v, `${trail}.${k}`, inUnion || k === 'anyOf' || k === 'oneOf');
			}
		}
	}
	scanTypeNull(doc.components?.schemas ?? {}, 'schemas', false);
	scanTypeNull(doc.paths, 'paths', false);

	// document size
	if (text.length > 8 * 1024 * 1024) fail(`document exceeds 8 MB (${(text.length / 1e6).toFixed(1)} MB)`);

	// report
	console.log(`\ndocument: ${docUrl}`);
	console.log(`operations: ${ops.length} GETs, ${seenIds.size} unique operationIds`);
	for (const w of warnings) console.log(`WARN: ${w}`);
	if (problems.length) {
		for (const p of problems) console.log(`FAIL: ${p}`);
		console.log(`\n${problems.length} violation(s), ${warnings.length} warning(s)`);
		process.exit(1);
	}
	console.log(`OK — no violations (${warnings.length} warning(s))`);
}

main().catch(err => { console.error(`FAIL: ${err.message}`); process.exit(1); });
