/** Focused contract tests for Settings → Test connection. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'qase-provider-test-'));
process.env.QASE_DATA_DIR = dataDir;
process.env.QASE_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
const { buildModelsUrl, saveConfig, testConnection } = await import('../server/config.js');

test.after(() => rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));

const dummyKey = 'provider-test-key-1234';
const candidate = (overrides = {}) => ({
	provider: 'custom',
	baseUrl: 'https://llm.example.test/v1',
	model: 'example-model',
	apiKey: dummyKey,
	...overrides
});

async function withFetch(mock, callback) {
	const original = globalThis.fetch;
	globalThis.fetch = mock;
	try {
		return await callback();
	} finally {
		globalThis.fetch = original;
	}
}

test('provider test uses the canonical GET /v1/models request and Bearer key', async () => {
	let request;
	const result = await withFetch(async (url, options) => {
		request = { url: String(url), method: options.method ?? 'GET', authorization: options.headers.Authorization };
		return new Response(JSON.stringify({ data: [{ id: 'example-model' }] }), { status: 200 });
	}, () => testConnection(candidate()));
	assert.equal(result.ok, true);
	assert.deepEqual(request, {
		url: 'https://llm.example.test/v1/models',
		method: 'GET',
		authorization: `Bearer ${dummyKey}`
	});
	assert.ok(!JSON.stringify(result).includes(dummyKey), 'response must not expose the API key');
});

test('base URL normalization always builds exactly one /v1/models path', () => {
	for (const base of [
		'https://llm.example.test',
		'https://llm.example.test/',
		'https://llm.example.test/v1',
		'https://llm.example.test/v1/',
		'https://llm.example.test/v1/models'
	]) {
		assert.equal(buildModelsUrl(base), 'https://llm.example.test/v1/models');
	}
});

for (const [status, category, phrase] of [
	[401, 'AUTH_FAILED', 'Authentication failed'],
	[403, 'AUTHORIZATION_FAILED', 'Authorization failed'],
	[404, 'BAD_ENDPOINT', 'endpoint not found'],
	[429, 'RATE_LIMITED', 'rate limit'],
	[500, 'PROVIDER_ERROR', 'Provider service failed']
]) {
	test(`provider HTTP ${status} maps to ${category} without secret echo`, async () => {
		const result = await withFetch(async () => new Response('', { status }), () => testConnection(candidate()));
		assert.equal(result.ok, false);
		assert.equal(result.diagnostic.category, category);
		assert.match(result.error, new RegExp(phrase, 'i'));
		assert.ok(!JSON.stringify(result).includes(dummyKey));
	});
}

test('timeout and nested socket causes are classified safely', async () => {
	const timeout = new Error('timed out');
	timeout.name = 'TimeoutError';
	const timedOut = await withFetch(async () => { throw timeout; }, () => testConnection(candidate()));
	assert.equal(timedOut.diagnostic.category, 'TIMEOUT');

	const blocked = new TypeError('fetch failed');
	blocked.cause = { code: 'EACCES', errno: -4092, message: 'connect EACCES 203.0.113.9:443' };
	const blockedResult = await withFetch(async () => { throw blocked; }, () => testConnection(candidate()));
	assert.equal(blockedResult.diagnostic.category, 'CONNECTION_BLOCKED');
	assert.equal(blockedResult.diagnostic.causeCode, 'EACCES');
	assert.match(blockedResult.error, /not permitted/i);
	assert.ok(!JSON.stringify(blockedResult).includes(dummyKey));
});

test('a blank candidate uses the current saved credential and a masked value is never sent', async () => {
	const savedKey = 'saved-provider-key-5678';
	saveConfig({ apiKey: savedKey });
	let authorization = null;
	const savedResult = await withFetch(async (_url, options) => {
		authorization = options.headers.Authorization;
		return new Response(JSON.stringify({ data: [] }), { status: 200 });
	}, () => testConnection(candidate({ apiKey: '' })));
	assert.equal(savedResult.ok, true);
	assert.equal(authorization, `Bearer ${savedKey}`);
	assert.ok(!JSON.stringify(savedResult).includes(savedKey));

	let called = false;
	const maskedResult = await withFetch(async () => {
		called = true;
		return new Response('{}', { status: 200 });
	}, () => testConnection(candidate({ apiKey: '••••5678' })));
	assert.equal(called, false);
	assert.equal(maskedResult.diagnostic.category, 'INVALID_CREDENTIAL_INPUT');
	assert.ok(!JSON.stringify(maskedResult).includes(savedKey));
});
