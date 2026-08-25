/**
 * QASE Reference Client — B1 integration surface.
 *
 * A single-file, zero-dependency Node >= 18 client for QASE's external
 * integration API (/api/v1/integration/*). It authenticates every request
 * with an HMAC-SHA256 signature over method + path + timestamp + nonce +
 * body digest, using the shared secret QASE_INTEGRATION_SECRET.
 *
 * It deliberately uses NOTHING else: no UI, no browser, no admin shortcuts,
 * no direct file access. If something cannot be done through this client,
 * it is not part of the integration contract.
 *
 * Usage:
 *   const client = createClient({ baseUrl, keyId, secret });
 *   const { missionId } = await client.createMission({ ... });
 */

import { createHmac, randomBytes } from 'node:crypto';

const CLOCK_SKEW_MS = 5 * 60 * 1000; // server rejects signatures older than 5 min

export function createClient({ baseUrl, keyId, secret, fetchImpl = globalThis.fetch }) {
	if (!baseUrl) throw new Error('baseUrl is required');
	if (!keyId) throw new Error('keyId is required');
	if (!secret) throw new Error('secret (QASE_INTEGRATION_SECRET) is required');
	baseUrl = baseUrl.replace(/\/+$/, '');

	function sign(method, path, bodyText) {
		const ts = String(Date.now());
		const nonce = randomBytes(8).toString('hex');
		const bodyDigest = createHmac('sha256', '').update(bodyText).digest('hex');
		const canonical = [method.toUpperCase(), path, ts, nonce, bodyDigest].join('\n');
		const signature = createHmac('sha256', secret).update(canonical).digest('hex');
		return `QASE-HMAC-SHA256 ${keyId}:${ts}:${nonce}:${signature}`;
	}

	async function request(method, apiPath, { body, headers = {}, correlationId } = {}) {
		const bodyText = body === undefined ? '' : JSON.stringify(body);
		const url = new URL(apiPath, baseUrl);
		// The server verifies the signature against req.path (pathname WITHOUT
		// query). Keep the canonical string identical on both sides.
		const auth = sign(method, url.pathname, bodyText);
		const res = await fetchImpl(url, {
			method,
			headers: {
				...(bodyText ? { 'Content-Type': 'application/json' } : {}),
				Authorization: auth,
				...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
				...headers
			},
			body: bodyText || undefined
		});
		const text = await res.text();
		let json = null;
		try { json = text ? JSON.parse(text) : null; } catch { /* markdown / raw */ }
		return { status: res.status, json, text, headers: Object.fromEntries(res.headers) };
	}

	/* ── identity ─────────────────────────────────────────────── */

	const whoami = () => request('GET', '/api/v1/integration/whoami');

	/* ── missions ─────────────────────────────────────────────── */

	function createMission(input, { idempotencyKey, correlationId } = {}) {
		return request('POST', '/api/v1/integration/missions', {
			body: input,
			correlationId,
			headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
		});
	}

	const startMission = (id, correlationId) =>
		request('POST', `/api/v1/integration/missions/${id}/start`, { correlationId });

	const getMission = (id, correlationId) =>
		request('GET', `/api/v1/integration/missions/${id}`, { correlationId });

	const stopMission = (id, correlationId) =>
		request('POST', `/api/v1/integration/missions/${id}/stop`, { correlationId });

	const getReport = (id, { format = 'json', correlationId } = {}) =>
		request('GET', `/api/v1/integration/missions/${id}/report${format === 'md' || format === 'markdown' ? '?format=md' : ''}`, { correlationId });

	const getFindings = (id, { limit = 100, offset = 0, correlationId } = {}) =>
		request('GET', `/api/v1/integration/missions/${id}/findings?limit=${limit}&offset=${offset}`, { correlationId });

	const getEvidence = (id, { limit = 100, offset = 0, correlationId } = {}) =>
		request('GET', `/api/v1/integration/missions/${id}/evidence?limit=${limit}&offset=${offset}`, { correlationId });

	const revalidateMission = (id, correlationId) =>
		request('POST', `/api/v1/integration/missions/${id}/revalidate`, { correlationId });

	/* ── findings (Phase 18 fix-validation) ───────────────────── */

	const revalidateFinding = (id, { idempotencyKey, correlationId } = {}) =>
		request('POST', `/api/v1/integration/findings/${id}/revalidate`, {
			correlationId,
			headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}
		});

	const getFindingValidation = (id, correlationId) =>
		request('GET', `/api/v1/integration/findings/${id}/validation`, { correlationId });

	/* ── webhooks ─────────────────────────────────────────────── */

	const registerWebhook = (input, correlationId) =>
		request('POST', '/api/v1/integration/webhooks', { body: input, correlationId });

	/* ── helpers ──────────────────────────────────────────────── */

	/** Poll until terminal status. Returns the final mission status object. */
	async function waitForCompletion(id, { timeoutMs = 20 * 60 * 1000, intervalMs = 5_000, onProgress, correlationId } = {}) {
		const started = Date.now();
		for (;;) {
			const { status, json } = await getMission(id, correlationId);
			if (onProgress) onProgress(json);
			if (['completed', 'failed', 'aborted', 'cancelled'].includes(json?.status)) return json;
			if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for mission ${id} (status ${json?.status})`);
			await new Promise(r => setTimeout(r, intervalMs));
		}
	}

	/** Verify a webhook delivery's X-Qase-Signature header (v1=hex hmac). */
	function verifyWebhookSignature(bodyText, timestamp, signatureHeader) {
		const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${bodyText}`).digest('hex')}`;
		return expected === signatureHeader;
	}

	return {
		request, sign, whoami, createMission, startMission, getMission, stopMission,
		getReport, getFindings, getEvidence, revalidateMission,
		revalidateFinding, getFindingValidation, registerWebhook,
		waitForCompletion, verifyWebhookSignature, CLOCK_SKEW_MS
	};
}
