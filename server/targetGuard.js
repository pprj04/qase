/**
 * M1-P4.1 — Target URL security boundary (single reusable validator).
 *
 * Enforced at BOTH ingest (mission create/start/iterate/revalidate, chat
 * extractUrl, test-case create) AND the execution sinks (replay runTestCase,
 * navigate steps, uxSweep, agent page registration, webhook delivery) so
 * stored URLs can never be executed later without passing the same check.
 *
 * Policy (allowlist, not blocklist):
 *   ALLOW  public HTTP/HTTPS targets (any public IP / resolvable public host)
 *   ALLOW  loopback (localhost/127.0.0.1/::1) ONLY on configured local ports
 *          (the product's own practice target + benchmark apps) — see
 *          LOCAL_ALLOWED_PORTS below.
 *   DENY   everything else: private IPv4 ranges, IPv6 ULA/link-local,
 *          IPv4-mapped IPv6, link-local 169.254.0.0/16 (metadata), reserved,
 *          unspecified, unsupported schemes, malformed URLs, hostnames whose
 *          DNS resolves (fully or partially) to private addresses, and
 *          redirects whose navigation destination is private (handled at the
 *          browser-layer route interceptor, which calls classifyUrl).
 *
 * Parsing uses WHATWG new URL() — normalization defeats decimal/octal/hex
 * IPv4 encodings for free (http://2852039166/ → 169.254.169.254,
 * 0177.0.0.1 → 127.0.0.1, [::ffff:127.0.0.1] → ::ffff:7f00:1 — verified).
 *
 * Honest limitations (documented, not hidden):
 *   - DNS rebinding TOCTOU: hostname resolves public at validate time but
 *     private at navigation time is narrowed by re-validating at navigation
 *     (browser-layer hook), not eliminated — a determined attacker with
 *     control of a domain's TTL could still race the two resolutions. Full
 *     mitigation requires egress IP pinning at the network layer.
 *   - Subresource requests (fetch/XHR from the page itself) are not
 *     intercepted — only navigations. A public page that <script src>s a
 *     private resource is the browser's own request; the agent never reads
 *     that response body. Documented as accepted risk.
 */

import { lookup } from 'node:dns/promises';

/* ── Policy configuration ────────────────────────────────────────── */

/** Loopback ports QASE is ALLOWED to target (product features): */
export const LOCAL_ALLOWED_PORTS = (() => {
	const ports = new Set();
	// The server's own origin (demo practice target at /demo).
	const ownPort = Number.parseInt(process.env.PORT ?? '5173', 10);
	if (Number.isInteger(ownPort)) ports.add(ownPort);
	// Benchmark practice apps (scripts/serve-benchmarks.py).
	for (let p = 9901; p <= 9907; p += 1) ports.add(p);
	// Operator extension, e.g. "8080,3000".
	for (const part of (process.env.QASE_ALLOWED_LOCAL_TARGETS ?? '').split(',')) {
		const p = Number.parseInt(part.trim(), 10);
		if (Number.isInteger(p) && p > 0 && p < 65536) ports.add(p);
	}
	return ports;
})();

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/* ── IP classification ───────────────────────────────────────────── */

const ipv4ToInt = (a, b, c, d) => ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
const inRange = (ip, base, bits) => (ip >>> (32 - bits)) === (base >>> (32 - bits));

function classifyIPv4(a, b, c, d) {
	const ip = ipv4ToInt(a, b, c, d);
	if (inRange(ip, ipv4ToInt(10, 0, 0, 0), 8)) return 'PRIVATE_NETWORK_TARGET';
	if (inRange(ip, ipv4ToInt(172, 16, 0, 0), 12)) return 'PRIVATE_NETWORK_TARGET';
	if (inRange(ip, ipv4ToInt(192, 168, 0, 0), 16)) return 'PRIVATE_NETWORK_TARGET';
	if (inRange(ip, ipv4ToInt(127, 0, 0, 0), 8)) return 'LOOPBACK_TARGET';
	if (inRange(ip, ipv4ToInt(169, 254, 0, 0), 16)) return 'LINK_LOCAL_TARGET';
	if (inRange(ip, ipv4ToInt(0, 0, 0, 0), 8)) return 'RESERVED_TARGET';
	if (inRange(ip, ipv4ToInt(100, 64, 0, 0), 10)) return 'PRIVATE_NETWORK_TARGET'; // CGNAT
	if (inRange(ip, ipv4ToInt(192, 0, 0, 0), 24)) return 'RESERVED_TARGET';
	if (inRange(ip, ipv4ToInt(192, 0, 2, 0), 24)) return 'RESERVED_TARGET';   // TEST-NET-1
	if (inRange(ip, ipv4ToInt(198, 51, 100, 0), 24)) return 'RESERVED_TARGET'; // TEST-NET-2
	if (inRange(ip, ipv4ToInt(203, 0, 113, 0), 24)) return 'RESERVED_TARGET'; // TEST-NET-3
	if (inRange(ip, ipv4ToInt(224, 0, 0, 0), 4)) return 'RESERVED_TARGET';    // multicast
	if (inRange(ip, ipv4ToInt(240, 0, 0, 0), 4)) return 'RESERVED_TARGET';    // reserved
	if (ip === ipv4ToInt(255, 255, 255, 255)) return 'RESERVED_TARGET';
	return null; // public
}

/**
 * Classify an IPv6 address (expanded hex form, no brackets).
 * Handles ::1, ULA fc00::/7, link-local fe80::/10, IPv4-mapped, multicast,
 * unspecified, and documentation ranges.
 */
function classifyIPv6(host) {
	const groups = expandIPv6(host);
	if (!groups) return 'INVALID_URL';
	const first = groups[0];
	const isAllZero = groups.slice(0, 6).every(g => g === 0);
	const ter = (groups[6] << 16) | groups[7];
	if (groups.every(g => g === 0)) return 'RESERVED_TARGET';                    // ::
	if (isAllZero && ter === 1) return 'LOOPBACK_TARGET';                        // ::1
	if ((first & 0xfe00) === 0xfc00) return 'PRIVATE_NETWORK_TARGET';            // fc00::/7 ULA
	if ((first & 0xffc0) === 0xfe80) return 'LINK_LOCAL_TARGET';                 // fe80::/10
	if ((first & 0xff00) === 0xff00) return 'RESERVED_TARGET';                   // ff00::/8 multicast
	// IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
	if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
		return classifyIPv4((ter >> 24) & 255, (ter >> 16) & 255, (ter >> 8) & 255, ter & 255)
			?? classifyIPv4(0, 0, 0, 0) /* mapped → never plain public by v6 rules */;
	}
	if (isAllZero && ter !== 0) {
		// ::a.b.c.d (deprecated IPv4-compatible) — treat as its IPv4 class.
		return classifyIPv4((ter >> 24) & 255, (ter >> 16) & 255, (ter >> 8) & 255, ter & 255);
	}
	if (first === 0x2001 && (groups[1] & 0xff00) === 0xdb80) return 'RESERVED_TARGET'; // 2001:db8::/32 docs
	if (first === 0x64 && groups[1] === 0xff9b) return 'PRIVATE_NETWORK_TARGET';       // 64:ff9b::
	return null; // public
}

function expandIPv6(host) {
	const clean = host.replace(/^\[|\]$/g, '');
	if (clean.includes('%')) return null; // zone ids unsupported
	const halves = clean.split('::');
	if (halves.length > 2) return null;
	const parse = part => part === '' ? [] : part.split(':').map(h => Number.parseInt(h, 16));
	const head = parse(halves[0] ?? '');
	const tail = halves.length === 2 ? parse(halves[1]) : [];
	if (head.some(n => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
	if (tail.some(n => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 && head.length !== 8) return null;
	if (halves.length === 2 && missing < 0) return null;
	return [...head, ...Array(Math.max(missing, 0)).fill(0), ...tail];
}

const IPv4_HOST = /^\[?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\]?$/;

/** Classify the HOST of a parsed URL. Returns a denial code or null=public. */
function classifyHost(hostname) {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost')) return 'LOOPBACK_TARGET';
	const v4 = host.match(IPv4_HOST);
	if (v4) {
		const octets = v4.slice(1).map(Number);
		if (octets.some(o => o > 255)) return 'INVALID_URL';
		return classifyIPv4(...octets);
	}
	if (host.includes(':')) return classifyIPv6(host);
	return null; // a name — needs DNS
}

/* ── DNS resolution (bounded, no raw error leakage) ──────────────── */

const DNS_TIMEOUT_MS = 4000;

function resolveWithTimeout(hostname) {
	return Promise.race([
		lookup(hostname, { all: true, verbatim: true }),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error('DNS_TIMEOUT')), DNS_TIMEOUT_MS).unref?.())
	]).catch(() => null);
}

/** Test env: skip DNS for arbitrary names (deterministic offline tests). */
const SKIP_DNS = process.env.QASE_TARGET_GUARD_SKIP_DNS === '1';

/* ── Public API ──────────────────────────────────────────────────── */

const HUMAN_MESSAGES = {
	INVALID_URL: 'The target URL could not be parsed.',
	UNSUPPORTED_SCHEME: 'Only http:// and https:// targets are supported.',
	PRIVATE_NETWORK_TARGET: 'Private-network targets are not allowed.',
	LOOPBACK_TARGET: 'Loopback targets are only allowed on QASE\u2019s own practice ports.',
	LINK_LOCAL_TARGET: 'Link-local targets are not allowed.',
	RESERVED_TARGET: 'Reserved/special-use addresses are not allowed.',
	DNS_RESOLUTION_FAILED: 'The target host could not be resolved.',
	REDIRECT_TO_BLOCKED_TARGET: 'A redirect tried to leave the allowed target boundary.',
	PORT_NOT_ALLOWED: 'This local port is not an allowed practice target.'
};

/**
 * Validate a URL string.
 * @returns {ok:true, url:URL} | {ok:false, code, message}
 */
export async function validateTargetUrl(raw, { skipDns = SKIP_DNS } = {}) {
	if (typeof raw !== 'string' || raw.trim() === '') {
		return { ok: false, code: 'INVALID_URL', message: HUMAN_MESSAGES.INVALID_URL };
	}
	let url;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, code: 'INVALID_URL', message: HUMAN_MESSAGES.INVALID_URL };
	}
	// Browser-internal about: pages (about:blank, about:error) carry no host,
	// make no network request, and are legitimate navigation targets inside
	// replay/test-case steps — they are not an SSRF surface and are exempt.
	if (url.protocol === 'about:') {
		return { ok: true, code: 'VALID_PUBLIC_TARGET', url };
	}
	if (!ALLOWED_SCHEMES.has(url.protocol)) {
		return { ok: false, code: 'UNSUPPORTED_SCHEME', message: HUMAN_MESSAGES.UNSUPPORTED_SCHEME };
	}
	const hostCode = classifyHost(url.hostname);
	if (hostCode === 'INVALID_URL') {
		return { ok: false, code: 'INVALID_URL', message: HUMAN_MESSAGES.INVALID_URL };
	}
	// IPv6 loopback is NEVER a practice target — deny regardless of port
	// (the demo/benchmark apps bind IPv4 loopback only).
	if (hostCode === 'LOOPBACK_TARGET' && url.hostname.includes(':')) {
		return { ok: false, code: 'LOOPBACK_TARGET', message: HUMAN_MESSAGES.LOOPBACK_TARGET };
	}
	if (hostCode === 'LOOPBACK_TARGET') {
		// Loopback allowed only on the configured local practice ports.
		if (!LOCAL_ALLOWED_PORTS.has(url.port === '' ? 80 : Number.parseInt(url.port, 10))) {
			return { ok: false, code: 'PORT_NOT_ALLOWED', message: HUMAN_MESSAGES.PORT_NOT_ALLOWED };
		}
		return { ok: true, code: 'VALID_PUBLIC_TARGET', url };
	}
	if (hostCode) {
		return { ok: false, code: hostCode, message: HUMAN_MESSAGES[hostCode] ?? hostCode };
	}
	if (skipDns) {
		return { ok: true, code: 'VALID_PUBLIC_TARGET', url };
	}
	const addresses = await resolveWithTimeout(url.hostname);
	if (!addresses || addresses.length === 0) {
		return { ok: false, code: 'DNS_RESOLUTION_FAILED', message: HUMAN_MESSAGES.DNS_RESOLUTION_FAILED };
	}
	for (const { address } of addresses) {
		const code = address.includes(':') ? classifyIPv6(address) : classifyIPv4(...address.split('.').map(Number));
		if (code) {
			return { ok: false, code, message: HUMAN_MESSAGES[code] ?? code };
		}
	}
	return { ok: true, code: 'VALID_PUBLIC_TARGET', url };
}

/**
 * Synchronous fast-path check for hot paths (per-navigation redirect checks).
 * Same classification as validateTargetUrl minus DNS: hostnames WITHOUT a
 * DNS-resolvable private address are allowed optimistically here — the
 * redirect interceptor's job is catching IP-literal escapes, which are the
 * concrete redirect-to-internal pattern. DNS-level redirect protection is
 * enforced for the initial target via validateTargetUrl and re-checked via
 * validateTargetUrl on each navigation for hostname destinations (async).
 */
export function classifyUrlFast(raw) {
	if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, code: 'INVALID_URL' };
	let url;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, code: 'INVALID_URL' };
	}
	if (!ALLOWED_SCHEMES.has(url.protocol) && url.protocol !== 'about:') {
		return { ok: false, code: 'UNSUPPORTED_SCHEME' };
	}
	if (url.protocol === 'about:') return { ok: true, code: 'VALID_PUBLIC_TARGET', url };
	const code = classifyHost(url.hostname);
	// IPv6 loopback never allowed regardless of port.
	if (code === 'LOOPBACK_TARGET' && url.hostname.includes(':')) return { ok: false, code: 'LOOPBACK_TARGET' };
	if (code === 'LOOPBACK_TARGET') {
		const port = url.port === '' ? 80 : Number.parseInt(url.port, 10);
		if (!LOCAL_ALLOWED_PORTS.has(port)) return { ok: false, code: 'PORT_NOT_ALLOWED' };
		return { ok: true, code: 'VALID_PUBLIC_TARGET', url };
	}
	if (code) return { ok: false, code };
	return { ok: true, code: 'VALID_PUBLIC_TARGET', url };
}

/**
 * Shared navigation verdict: 'allow' | 'block'.
 * IP-literal destinations use the fast classifier; hostname destinations are
 * DNS-validated once per host (per context/page Set).
 */
const IP_LIKE = /^\[?[0-9a-f.:]+\]?$/i;

async function decideNavigation(url, checked) {
	const fast = classifyUrlFast(url);
	if (!fast.ok) return 'block';
	const host = fast.url.hostname;
	if (!IP_LIKE.test(host) && !checked.has(host)) {
		checked.add(host);
		const v = await validateTargetUrl(url);
		if (!v.ok) return 'block';
	}
	return 'allow';
}

/**
 * CDP-layer interception. CRITICAL: Playwright's context.route/page.route do
 * NOT fire for redirect-chain navigations (Chromium follows a 302 inside the
 * network stack without re-invoking Playwright routing — verified live: a 302
 * to http://2852039166/ landed on 169.254.169.254 with the route handler never
 * seeing the second request). CDP Fetch.requestPaused DOES pause every request
 * in the chain, so it is the actual redirect enforcement layer. The route
 * handler remains installed as a base layer (first navigations + non-chromium
 * fallback); both layers classify identically, so double interception is
 * harmless.
 */
async function attachCdpBoundary(page, checked) {
	let cdp;
	try {
		const ctx = page.context();
		const browser = ctx.browser?.();
		// CDP sessions only exist on Chromium; on other engines the caller's
		// route fallback remains the (documented, first-hop-only) protection.
		if (browser && browser.browserType?.().name && browser.browserType().name() !== 'chromium') return false;
		cdp = await ctx.newCDPSession(page);
		await cdp.send('Fetch.enable', {
			patterns: [{ urlPattern: '*', requestStage: 'Request' }],
		});
	} catch {
		try { await cdp?.detach?.(); } catch { /* already gone */ }
		return false;
	}
	let closed = false;
	const finish = () => {
		if (closed) return;
		closed = true;
		try { Promise.resolve(cdp.detach()).catch(() => { /* already gone */ }); } catch { /* already gone */ }
	};
	page.once('close', finish);
	page.context().once('close', finish);
	cdp.on('Fetch.requestPaused', event => {
		const { requestId, request, resourceType } = event;
		void (async () => {
			try {
				if (resourceType !== 'Document') {
					await cdp.send('Fetch.continueRequest', { requestId });
					return;
				}
				const verdict = await decideNavigation(request.url, checked);
				if (verdict === 'block') {
					await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
				} else {
					await cdp.send('Fetch.continueRequest', { requestId });
				}
			} catch {
				// Never strand a paused request: always release on internal error.
				try { await cdp.send('Fetch.continueRequest', { requestId }); } catch { /* session closed */ }
			}
		})();
	});
	return true;
}

/**
 * Install redirect-boundary enforcement on a browser CONTEXT (replay,
 * uxSweep). Base layer: Playwright route interception (first navigations).
 * Enforcement layer: per-page CDP Fetch interception, which is what actually
 * catches redirect chains on Chromium. Blocked navigations abort with
 * net::ERR_BLOCKED_BY_CLIENT so page.goto rejects — the caller records an
 * honest failure.
 */
export function installRedirectBoundary(context) {
	const checked = new Set();

	// Enforcement layer first: per-page CDP Fetch interception catches
	// redirect-chain navigations (context.route provably does NOT). The async
	// attach must complete BEFORE the caller starts navigating, so we patch
	// newPage to attach-and-await before resolving — this closes the race
	// where goto() outruns Fetch.enable.
	const wirePage = async page => {
		await attachCdpBoundary(page, checked);
		return page;
	};
	const originalNewPage = context.newPage.bind(context);
	context.newPage = async function patchedNewPage(...args) {
		const page = await originalNewPage(...args);
		return wirePage(page);
	};
	// Pages created before installation (rare) get best-effort attach too.
	for (const page of context.pages()) void wirePage(page).catch(() => { /* best-effort */ });

	// Base layer: Playwright route interception for FIRST navigations (works
	// on all engines, incl. non-Chromium where CDP is unavailable).
	const routeHandler = route => {
		const request = route.request();
		if (!request.isNavigationRequest()) return route.continue();
		const fast = classifyUrlFast(request.url());
		if (!fast.ok) return route.abort('blockedbyclient');
		return route.continue();
	};
	context.route('**/*', routeHandler).catch(() => { /* context may close early */ });
}

/**
 * Same boundary for agent-run pages (SDK-created contexts). Installed per
 * page at registration — the SDK owns context creation, so the hook lives on
 * the page. The installer is async: callers MUST await it before navigating.
 */
export async function installPageBoundary(page) {
	const checked = new Set();
	// Enforcement layer: CDP Fetch (catches redirect chains, Chromium).
	const attached = await attachCdpBoundary(page, checked).catch(() => false);
	// Base layer: Playwright route (first navigations; engine-portable).
	const routeHandler = route => {
		const request = route.request();
		if (!request.isNavigationRequest()) return route.continue();
		const fast = classifyUrlFast(request.url());
		if (!fast.ok) return route.abort('blockedbyclient');
		const host = fast.url.hostname;
		if (!IP_LIKE.test(host) && !checked.has(host)) {
			checked.add(host);
			validateTargetUrl(request.url())
				.then(v => (v.ok ? route.continue() : route.abort('blockedbyclient')))
				.catch(() => route.abort('blockedbyclient'));
			return;
		}
		return route.continue();
	};
	await page.route('**/*', routeHandler).catch(() => { /* page may close early */ });
	return attached;
}

/** Webhook URL check (replaces the broken substring blocklist). */
export async function validateWebhookUrl(raw) {
	const v = await validateTargetUrl(raw, { skipDns: SKIP_DNS });
	if (!v.ok && v.code === 'DNS_RESOLUTION_FAILED') return v;
	// Public hosts need DNS; internal practice targets never make sense as
	// webhooks — treat loopback/private/denied the same.
	return v;
}
