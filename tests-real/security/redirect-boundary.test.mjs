/**
 * M1-P4.1 Phase 3 — redirect boundary LIVE test.
 *
 * Proves, with a real local HTTP redirector, that:
 *   1. public→public redirects still work (allowed), and
 *   2. a redirect to a loopback/private/link-local destination is BLOCKED at
 *      the browser layer (installRedirectBoundary / installPageBoundary),
 *      regardless of the syntactic form of the destination
 *      (localhost, 127.0.0.1, 0177.0.0.1, decimal 2852039166, [::1]).
 *
 * Uses the practice port range (9901–9907) for the redirector so the FIRST
 * hop is a legitimately-allowed practice target; the REDIRECT DESTINATION is
 * what must be blocked. The blocked destinations are on port 9900 — NOT an
 * allowed practice port — so even a hostname-based check would deny them;
 * we assert the redirect is aborted (net::ERR_BLOCKED_BY_CLIENT).
 *
 * Runs its own HTTP redirect server on 127.0.0.1:9900 and spins a real
 * Chromium context through installRedirectBoundary.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';

// The redirector needs its own ALLOWED local port (9901–9907 are taken by the
// benchmark apps). Register 9899 via the operator extension BEFORE loading
// targetGuard, exactly as an operator would via env — proves that mechanism too.
process.env.QASE_ALLOWED_LOCAL_TARGETS = '9899';
const { installRedirectBoundary } = await import('../../server/targetGuard.js');

const REDIRECTOR_PORT = 9899; // allowed practice port → hop 1 legitimately passes

function startRedirector() {
	return new Promise(resolve => {
		const server = http.createServer((req, res) => {
			const where = req.url.startsWith('/to/') ? decodeURIComponent(req.url.slice(4)) : 'https://example.com/';
			res.writeHead(302, { Location: where });
			res.end();
		});
		server.listen(REDIRECTOR_PORT, '127.0.0.1', () => resolve(server));
	});
}

describe('BOUNDARY-REDIRECT — browser redirect interception (live Chromium)', () => {
	let server;
	let browser;

	before(async () => {
		server = await startRedirector();
		browser = await chromium.launch();
	});
	after(async () => {
		await browser?.close().catch(() => {});
		server?.close();
	});

	// The redirector runs ON an allowed practice port (9907), so hop 1 is a
	// legitimate target and PASSES the boundary; hop 2 (the redirect
	// destination) is what must be blocked. This proves redirect protection
	// proper, not just first-hop blocking.

	// Destinations use NON-practice port 9900 — genuinely blocked targets.
	// (localhost/127.0.0.1 on practice ports 9901–9907 are ALLOWED policy —
	// the product's local testing feature — and covered by the ALLOW cases.)
	for (const [label, dest] of [
		['localhost (non-practice port)', 'http://localhost:9900'],
		['127.0.0.1 (non-practice port)', 'http://127.0.0.1:9900'],
		['octal loopback', 'http://0177.0.0.1:9900'],
		['decimal link-local (169.254.169.254)', 'http://2852039166/'],
		['IPv6 loopback', 'http://[::1]:9900'],
		['private 10.x', 'http://10.0.0.5:9900'],
	]) {
		it(`BLOCK: 302 → ${label} is aborted at the browser layer`, async () => {
			const context = await browser.newContext();
			await installRedirectBoundary(context);
			const page = await context.newPage();
			const firstHop = `http://127.0.0.1:${REDIRECTOR_PORT}/to/${encodeURIComponent(dest)}`;
			try {
				await page.goto(firstHop, { timeout: 8000 });
				// If hop 1 loaded (shouldn't), hop 2 must have been blocked:
				assert.fail(`navigation unexpectedly succeeded to ${page.url()}`);
			} catch (err) {
				const msg = String(err?.message || err);
				// Hop 2 must be blocked BY THE BOUNDARY (not merely refused).
				assert.match(msg, /ERR_BLOCKED_BY_CLIENT/, `redirect destination not blocked by boundary: ${msg.slice(0, 200)}`);
			}
			const finalUrl = page.url();
			assert.notEqual(finalUrl, dest, 'must never land on the blocked destination');
			await context.close();
		});
	}

	it('ALLOW: public→public redirect passes the boundary (mechanism not over-blocking)', async () => {
		const context = await browser.newContext();
		await installRedirectBoundary(context);
		const page = await context.newPage();
		// hop 1: practice redirector on 9907 (allowed). hop 2: https://example.com
		// (public). Both hops must pass; we expect a successful load of
		// example.com (network permitting).
		await page.goto(`http://127.0.0.1:${REDIRECTOR_PORT}/to/${encodeURIComponent('https://example.com/')}`, { timeout: 15000 });
		assert.match(page.url(), /example\.com/, `should land on example.com, got ${page.url()}`);
		await context.close();
	});

	it('ALLOW: allowed practice port navigation passes the boundary', async () => {
		const context = await browser.newContext();
		await installRedirectBoundary(context);
		const page = await context.newPage();
		// 9901 is an allowed practice port — the boundary must let it through.
		try {
			await page.goto('http://127.0.0.1:9901', { timeout: 8000 });
		} catch (err) {
			const msg = String(err?.message || err);
			assert.ok(!/ERR_BLOCKED_BY_CLIENT/.test(msg), `allowed practice port was blocked: ${msg.slice(0, 200)}`);
		}
		await context.close();
	});
});
