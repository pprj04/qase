/**
 * Standalone QASE integration client — HMAC-SHA256 signed requests.
 *
 * Implemented purely from the documented contract (docs/integration-guide.md):
 *   Authorization: QASE-HMAC-SHA256 keyId:timestampMs:nonce:signature
 *   canonical = METHOD \n PATH \n tsMs \n nonce \n hex(HMAC-SHA256(key="", rawBody))
 *   signature = hex(HMAC-SHA256(secret, canonical))
 *
 * ZERO imports from the QASE server. The only inputs are baseUrl, keyId, secret.
 */
import { createHmac, randomBytes } from 'node:crypto';

export function createHmacClient({ baseUrl, keyId, secret }) {
	if (!baseUrl) throw new Error('baseUrl required');
	if (!keyId) throw new Error('keyId required');
	if (!secret) throw new Error('secret required');
	baseUrl = baseUrl.replace(/\/+$/, '');

	function sign(method, path, bodyText, { timestampMs, nonce } = {}) {
		const ts = String(timestampMs ?? Date.now());
		const nc = nonce ?? randomBytes(8).toString('hex');
		const bodyDigest = createHmac('sha256', '').update(bodyText).digest('hex');
		const canonical = [method.toUpperCase(), path, ts, nc, bodyDigest].join('\n');
		const signature = createHmac('sha256', secret).update(canonical).digest('hex');
		return `QASE-HMAC-SHA256 ${keyId}:${ts}:${nc}:${signature}`;
	}

	async function request(method, apiPath, { body, extraHeaders = {}, signOverrides } = {}) {
		const bodyText = body === undefined ? '' : JSON.stringify(body);
		const url = new URL(apiPath, baseUrl);
		const authorization = sign(method, url.pathname, bodyText, signOverrides);
		const res = await fetch(url, {
			method,
			headers: {
				Authorization: authorization,
				...(bodyText ? { 'Content-Type': 'application/json' } : {}),
				...extraHeaders
			},
			body: bodyText || undefined
		});
		let json = null;
		const text = await res.text();
		try { json = JSON.parse(text); } catch { /* non-JSON body */ }
		return { status: res.status, headers: res.headers, json, text };
	}

	return {
		request,
		whoami: () => request('GET', '/api/v1/integration/whoami'),
		createMission: (payload, headers) => request('POST', '/api/v1/integration/missions', { body: payload, extraHeaders: headers }),
		getMission: (id) => request('GET', `/api/v1/integration/missions/${encodeURIComponent(id)}`),
		getMissionFindings: (id) => request('GET', `/api/v1/integration/missions/${encodeURIComponent(id)}/findings`)
	};
}
