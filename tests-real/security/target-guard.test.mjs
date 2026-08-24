/**
 * M1-P4.1 — SSRF / target-URL boundary regression matrix.
 *
 * Covers the deterministic verdicts of server/targetGuard.js as ENFORCED at
 * the live API boundary (POST /api/v1/missions) and as exposed for direct
 * unit verification via `node --test tests-real/security/target-guard.test.mjs`.
 *
 * Requires the live server on BASE (default http://localhost:5173) with
 * QASE_API_TOKEN exported — the runner injects it via process.env.
 *
 * VALID cases must keep working (public testing is the product).
 * BLOCK cases must be rejected with deterministic codes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTargetUrl, classifyUrlFast } from '../../server/targetGuard.js';

const BASE = process.env.QASE_URL || 'http://localhost:5173';
const TOKEN = process.env.QASE_API_TOKEN || '';
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const hasServer = Boolean(TOKEN);

/* ------------------------------------------------------------------ */
/* UNIT — deterministic classifier verdicts (no server needed)         */
/* ------------------------------------------------------------------ */
describe('BOUNDARY-UNIT — classifyUrlFast deterministic matrix', () => {
	it('public https → ALLOW', () => {
		assert.equal(classifyUrlFast('https://example.com/app').code, 'VALID_PUBLIC_TARGET');
	});
	it('public http → ALLOW (existing intentional support)', () => {
		assert.equal(classifyUrlFast('http://example.com/').code, 'VALID_PUBLIC_TARGET');
	});
	it('public domain with private-looking label → ALLOW (no blind string matching)', () => {
		assert.equal(classifyUrlFast('http://10.example.com/').code, 'VALID_PUBLIC_TARGET');
		assert.equal(classifyUrlFast('http://192.168.example.com/').code, 'VALID_PUBLIC_TARGET');
	});
	it('localhost on practice port 5173 → ALLOW', () => {
		assert.equal(classifyUrlFast('http://localhost:5173/').code, 'VALID_PUBLIC_TARGET');
	});
	it('localhost on benchmark port 9901 → ALLOW', () => {
		assert.equal(classifyUrlFast('http://localhost:9901').code, 'VALID_PUBLIC_TARGET');
	});
	it('127.0.0.1 on practice port → ALLOW; on other port → PORT_NOT_ALLOWED', () => {
		assert.equal(classifyUrlFast('http://127.0.0.1:5173').code, 'VALID_PUBLIC_TARGET');
		assert.equal(classifyUrlFast('http://127.0.0.1:8080').code, 'PORT_NOT_ALLOWED');
	});
	it('localhost on non-practice port → PORT_NOT_ALLOWED', () => {
		assert.equal(classifyUrlFast('http://localhost:8080/').code, 'PORT_NOT_ALLOWED');
	});
	it('IPv6 loopback is ALWAYS LOOPBACK_TARGET (even on allowed port)', () => {
		assert.equal(classifyUrlFast('http://[::1]:5173/').code, 'LOOPBACK_TARGET');
		assert.equal(classifyUrlFast('http://[::1]/').code, 'LOOPBACK_TARGET');
	});
	it('IPv4-mapped IPv6 loopback → LOOPBACK_TARGET', () => {
		assert.equal(classifyUrlFast('http://[::ffff:127.0.0.1]/').code, 'LOOPBACK_TARGET');
	});
	it('RFC1918 private ranges → PRIVATE_NETWORK_TARGET', () => {
		for (const u of ['http://10.0.0.5/', 'http://10.255.255.255/', 'http://172.16.1.1/', 'http://172.31.255.254/', 'http://192.168.1.10/', 'http://192.168.0.1/']) {
			assert.equal(classifyUrlFast(u).code, 'PRIVATE_NETWORK_TARGET', u);
		}
	});
	it('CGNAT 100.64/10 → PRIVATE_NETWORK_TARGET', () => {
		assert.equal(classifyUrlFast('http://100.64.0.1/').code, 'PRIVATE_NETWORK_TARGET');
	});
	it('link-local → LINK_LOCAL_TARGET (v4 + v6)', () => {
		assert.equal(classifyUrlFast('http://169.254.169.254/latest/meta-data/').code, 'LINK_LOCAL_TARGET');
		assert.equal(classifyUrlFast('http://[fe80::1]/').code, 'LINK_LOCAL_TARGET');
	});
	it('0.0.0.0 and reserved/special-use → RESERVED_TARGET; ULA → PRIVATE', () => {
		assert.equal(classifyUrlFast('http://0.0.0.0/').code, 'RESERVED_TARGET');
		assert.equal(classifyUrlFast('http://192.0.2.1/').code, 'RESERVED_TARGET');
		assert.equal(classifyUrlFast('http://198.51.100.1/').code, 'RESERVED_TARGET');
		assert.equal(classifyUrlFast('http://203.0.113.1/').code, 'RESERVED_TARGET');
		// IPv6 ULA (fc00::/7) is a PRIVATE network target, not merely reserved.
		assert.equal(classifyUrlFast('http://[fc00::1]/').code, 'PRIVATE_NETWORK_TARGET');
		assert.equal(classifyUrlFast('http://[fd12::1]/').code, 'PRIVATE_NETWORK_TARGET');
	});
	it('unsupported schemes → UNSUPPORTED_SCHEME', () => {
		for (const u of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://example.com/']) {
			assert.equal(classifyUrlFast(u).code, 'UNSUPPORTED_SCHEME', u);
		}
	});
	it('malformed → INVALID_URL', () => {
		for (const u of ['not a url at all %%', 'http://', '://missing-scheme', '']) {
			assert.equal(classifyUrlFast(u).code, 'INVALID_URL', JSON.stringify(u));
		}
	});
	it('WHATWG normalization defeats encoded-IP forms (decimal/octal/hex IPv4)', () => {
		// WHATWG URL parser normalizes these to dotted-quad before we classify.
		assert.equal(classifyUrlFast('http://2852039166/').code, 'LINK_LOCAL_TARGET');        // 169.254.169.254
		assert.equal(classifyUrlFast('http://0177.0.0.1/').code, 'PORT_NOT_ALLOWED');          // 127.0.0.1 (port 80)
		assert.equal(classifyUrlFast('http://0x7f.0.0.1/').code, 'PORT_NOT_ALLOWED');          // 127.0.0.1 (port 80)
		assert.equal(classifyUrlFast('http://127.1/').code, 'PORT_NOT_ALLOWED');               // 127.0.0.1 (port 80)
	});
});

/* ------------------------------------------------------------------ */
/* UNIT — DNS-aware validation                                          */
/* ------------------------------------------------------------------ */
describe('BOUNDARY-UNIT — validateTargetUrl DNS behavior', () => {
	it('public domain that RESOLVES → ALLOW (one.one.one.one)', async () => {
		const v = await validateTargetUrl('https://one.one.one.one/');
		assert.equal(v.ok, true, v.code);
	});
	it('non-resolvable domain → DNS_RESOLUTION_FAILED, ok:false', async () => {
		const v = await validateTargetUrl('https://this-domain-must-not-exist-qase.invalid/');
		assert.equal(v.ok, false);
		assert.equal(v.code, 'DNS_RESOLUTION_FAILED');
	});
	it('deterministic human message, no raw DNS error leaked', async () => {
		const v = await validateTargetUrl('https://this-domain-must-not-exist-qase.invalid/');
		assert.ok(v.message && v.message.length > 0 && !/getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(v.message), JSON.stringify(v.message));
	});
});

/* ------------------------------------------------------------------ */
/* API — enforced at POST /api/v1/missions (live server)                */
/* ------------------------------------------------------------------ */
describe('BOUNDARY-API — POST /api/v1/missions enforcement', () => {
	async function post(targetUrl) {
		return fetch(`${BASE}/api/v1/missions`, {
			method: 'POST', headers: AUTH,
			body: JSON.stringify({ targetUrl, type: 'qa_review' })
		});
	}
	it('BLOCK: metadata link-local URL → 400 structured error', { skip: !hasServer }, async () => {
		const r = await post('http://169.254.169.254/latest/meta-data/');
		assert.equal(r.status, 400);
		const b = await r.json().catch(() => ({}));
		assert.ok(b.error || b.message, 'structured human message present');
		assert.equal(b.code, 'LINK_LOCAL_TARGET');
	});
	it('BLOCK: localhost non-practice port → 400', { skip: !hasServer }, async () => {
		const r = await post('http://localhost:8080/');
		assert.equal(r.status, 400);
	});
	it('BLOCK: RFC1918 private IP → 400', { skip: !hasServer }, async () => {
		const r = await post('http://10.0.0.5/');
		assert.equal(r.status, 400);
	});
	it('BLOCK: IPv6 loopback → 400', { skip: !hasServer }, async () => {
		const r = await post('http://[::1]/');
		assert.equal(r.status, 400);
	});
	it('BLOCK: unsupported scheme → 400', { skip: !hasServer }, async () => {
		const r = await post('file:///etc/passwd');
		assert.equal(r.status, 400);
	});
	it('BLOCK: malformed URL → 400 (contract change G3 flip)', { skip: !hasServer }, async () => {
		const r = await post('not a url at all %%');
		assert.equal(r.status, 400);
	});
	it('BLOCK: non-resolving public-looking domain → 400 DNS_RESOLUTION_FAILED', { skip: !hasServer }, async () => {
		const r = await post('https://this-domain-must-not-exist-qase.invalid/');
		assert.equal(r.status, 400);
	});
	it('ALLOW: public https domain accepted → then stopped (valid behavior preserved)', { skip: !hasServer }, async () => {
		const r = await post('https://example.com/');
		assert.ok([201, 202].includes(r.status), `status ${r.status}`);
		const m = await r.json().catch(() => null);
		if (m?.missionId || m?.id) {
			await fetch(`${BASE}/api/v1/missions/${m.missionId ?? m.id}/stop`, { method: 'POST', headers: AUTH }).catch(() => {});
		}
	});
	it('ALLOW: localhost practice port accepted → then stopped (first-class local testing)', { skip: !hasServer }, async () => {
		const r = await post('http://localhost:9901');
		assert.ok([201, 202].includes(r.status), `status ${r.status}`);
		const m = await r.json().catch(() => null);
		if (m?.missionId || m?.id) {
			await fetch(`${BASE}/api/v1/missions/${m.missionId ?? m.id}/stop`, { method: 'POST', headers: AUTH }).catch(() => {});
		}
	});
});
