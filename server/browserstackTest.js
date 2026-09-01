/**
 * BUILD B0.1 — BrowserStack connection validation (REAL probe, never fake).
 *
 * Two-stage test:
 *   1. AUTH — GET https://api.browserstack.com/automate/plan.json with HTTP
 *      Basic auth (BrowserStack's lightweight authenticated endpoint).
 *   2. CDP  — WebSocket handshake to wss://cdp.browserstack.com/playwright
 *      (the same endpoint replay.js executes test cases on). No session is
 *      opened, so no Automate minutes are consumed.
 *
 * Success requires BOTH stages: authentication proves the credentials, the
 * CDP handshake proves the execution path. Credentials-exist is never enough.
 *
 * Guarantees:
 *  - Never returns or logs the access key; usernames are masked.
 *  - Injectable fetchImpl / wsFactory so tests exercise every branch offline.
 */

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const AUTH_URL = 'https://api.browserstack.com/automate/plan.json';
const CDP_HOST = 'wss://cdp.browserstack.com/playwright';
const DEFAULT_TIMEOUT_MS = 10_000;

/** 'tRuEje' → 'tRu****je' — safe to show in a browser. */
export function maskUser(user) {
	const u = String(user ?? '');
	if (!u) return '';
	if (u.length <= 5) return '****';
	return `${u.slice(0, 3)}****${u.slice(-2)}`;
}

/** Redact any accidental key-looking token from a message. */
function redact(text, key) {
	let out = String(text ?? '');
	if (key) {
		out = out.split(String(key)).join('••••••');
	}
	out = out.replace(/(?:key|token|password|authorization)\s*[:=]\s*\S{8,}/gi, '$1: ••••••');
	return out.slice(0, 400);
}

async function probeAuth({ user, key, timeoutMs, fetchImpl }) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(AUTH_URL, {
			method: 'GET',
			headers: {
				Authorization: `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`,
				Accept: 'application/json'
			},
			signal: controller.signal
		});
		if (response.status === 401 || response.status === 403) {
			return { ok: false, code: 'invalid_credentials', httpStatus: response.status, message: 'BrowserStack rejected the credentials (HTTP 401/403). Check the username and access key in Settings.' };
		}
		if (!response.ok) {
			return { ok: false, code: 'http_error', httpStatus: response.status, message: `BrowserStack returned HTTP ${response.status}. Check BrowserStack status or the account plan.` };
		}
		let plan = null;
		try {
			plan = await response.json();
		} catch {
			plan = null;
		}
		return { ok: true, code: 'authenticated', httpStatus: response.status, plan: plan && typeof plan === 'object' ? Object.keys(plan).slice(0, 8) : null };
	} catch (error) {
		if (error?.name === 'AbortError' || /abort/i.test(String(error?.message ?? ''))) {
			return { ok: false, code: 'timeout', message: `BrowserStack did not respond within ${Math.round(timeoutMs / 1000)}s. Check network egress to api.browserstack.com.` };
		}
		return { ok: false, code: 'network_error', message: `Could not reach BrowserStack: ${redact(error?.message ?? 'network error', key)}` };
	} finally {
		clearTimeout(timer);
	}
}

/** Wrap the `ws` package WebSocket in an EventEmitter-ish for probeCdp. */
function makeDefaultWsFactory() {
	let WS;
	try {
		({ WebSocket: WS } = require('ws'));
	} catch {
		return null;
	}
	if (typeof WS !== 'function') return null;
	return (url, opts) => {
		const bus = new EventEmitter();
		try {
			const ws = new WS(url, opts);
			ws.on('open', () => bus.emit('open'));
			ws.on('message', data => bus.emit('message', data));
			ws.on('error', err => bus.emit('error', err));
			ws.on('unexpected-response', (_req, res) => bus.emit('unexpected-response', res?.statusCode));
			ws.on('close', (code, reason) => bus.emit('close', code, reason ? String(reason ?? '') : ''));
			bus.close = () => { try { ws.close(); } catch { /* noop */ } };
		} catch (error) {
			setTimeout(() => bus.emit('error', error)).unref?.();
		}
		return bus;
	};
}

async function probeCdp({ user, key, timeoutMs, wsFactory }) {
	const caps = encodeURIComponent(JSON.stringify({
		browser: 'chrome',
		os: 'OS X',
		os_version: 'Sonoma',
		// C4.1-FIX — documented BrowserStack Playwright CDP capability names
		// (was browserstack.user/browserstack.key — ignored by the endpoint,
		// causing the false REST-pass / CDP-fail divergence this probe detects).
		'browserstack.username': user,
		'browserstack.accessKey': key,
		name: 'Qase connection test'
	}));
	// C4.1 — the wss endpoint ALWAYS completes the TLS/101 upgrade, even for
	// garbage credentials, and only then sends its application-level verdict
	// (first frame, or a 1001 close carrying "Invalid username or password").
	// 'open' alone therefore proves NOTHING about authentication. The probe
	// now waits for the first app-level signal:
	//   - first text frame            → the endpoint accepted the session (ok)
	//   - close 1001/1008 w/ message  → classify (auth vs transient)
	//   - close without message/open  → keep waiting until timeout, then report
	//     unreachable (matches previous behavior for dead networks).
	return new Promise(resolve => {
		let settled = false;
		let ws;
		let opened = false;
		let openTimer;
		const done = result => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(openTimer);
			try { ws?.close?.(); } catch { /* already closed */ }
			resolve(result);
		};
		let timer;
		const CLASSIFY = {
			// Post-open close with an explicit auth verdict from BrowserStack.
			authReject(message) {
				const m = String(message ?? '');
				if (/invalid (username|user) or (password|access key)/i.test(m) || /authentication/i.test(m)) {
					return {
						ok: false, code: 'invalid_credentials',
						message: 'BrowserStack rejected the credentials at the CDP execution endpoint (invalid username or password). Check the username and access key in Settings.'
					};
				}
				return {
					ok: false, code: 'cdp_rejected',
					message: `CDP endpoint closed the session: ${redact(m || 'no reason given', key)}. Test-case execution on BrowserStack will fail — verify the account and network.`
				};
			}
		};
		try {
			ws = wsFactory(`${CDP_HOST}?caps=${caps}`, { handshakeTimeout: timeoutMs });
		} catch (error) {
			return resolve({ ok: false, code: 'cdp_error', message: `CDP endpoint unreachable: ${redact(error?.message ?? 'error', key)}` });
		}
		timer = setTimeout(() => done({
			ok: false, code: opened ? 'cdp_timeout' : 'cdp_unreachable',
			message: opened
				? `CDP endpoint accepted the connection but sent no session data within ${Math.round(timeoutMs / 1000)}s.`
				: `CDP handshake failed: endpoint did not complete the handshake within ${Math.round(timeoutMs / 1000)}s. This is the endpoint test-case execution uses.`
		}), timeoutMs);
		const onOpen = () => {
			opened = true;
			// Handshake upgraded — wait for the app-level verdict (frame or close).
			// If nothing arrives at all within the remaining budget, the overall
			// timer above classifies it.
		};
		const onFrame = data => {
			// First application-level frame = the endpoint accepted the session
			// (it allocated a worker and spoke CDP/Playwright protocol).
			const text = String(data ?? '');
			done({ ok: true, code: 'cdp_reachable', note: text ? redact(text.slice(0, 80), key) : undefined });
		};
		const onError = err => {
			if (opened) {
				// Post-open transport error — usually accompanies the auth close.
				done(CLASSIFY.authReject(err?.message));
			} else {
				done({ ok: false, code: 'cdp_unreachable', message: `CDP handshake failed: ${redact(err?.message ?? 'error', key)}. This is the endpoint test-case execution uses.` });
			}
		};
		const onClose = (codeOrRes, reason) => {
			if (!opened) {
				// Closed without ever upgrading.
				const status = typeof codeOrRes === 'number' ? null : codeOrRes?.statusCode;
				done({
					ok: false, code: 'cdp_rejected',
					message: status
						? `CDP endpoint rejected the connection (HTTP ${status}). Test-case execution on BrowserStack may fail.`
						: 'CDP endpoint refused the connection (closed without upgrading). Test-case execution on BrowserStack will fail — verify the account and network.'
				});
				return;
			}
			// Post-open close: BrowserStack's application-level verdict.
			const reasonText = typeof reason === 'object' && reason ? String(reason.reason ?? '') : String(reason ?? '');
			const verdict = CLASSIFY.authReject(reasonText || '');
			// Give a stray error event a tick to win with a richer message.
			openTimer = setTimeout(() => done(verdict), 50);
		};
		const onUnexpected = res => {
			done({ ok: false, code: 'cdp_rejected', message: `CDP endpoint rejected the connection (non-101 response${typeof res === 'number' ? ` HTTP ${res}` : ''}). Test-case execution on BrowserStack may fail.` });
		};
		ws.once?.('open', onOpen);
		ws.once?.('message', onFrame);
		ws.once?.('error', onError);
		ws.once?.('close', onClose);
		ws.once?.('unexpected-response', onUnexpected);
	});
}

/**
 * Run the full BrowserStack connection test.
 *
 * @param {object} input
 * @param {string} input.user
 * @param {string} input.key   — never echoed back
 * @param {number} [input.timeoutMs=10000]
 * @param {Function} [input.fetchImpl=fetch]
 * @param {Function} [input.wsFactory] — (url, opts) => EventEmitter-ish ws
 * @param {Function} [input.nowImpl=Date.now]
 * @returns {Promise<object>} redacted result
 */
export async function testBrowserstackConnection(input = {}) {
	const user = String(input.user ?? '').trim();
	const key = String(input.key ?? '').trim();
	const timeoutMs = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : DEFAULT_TIMEOUT_MS;
	const fetchImpl = input.fetchImpl ?? fetch;
	const wsFactory = input.wsFactory ?? makeDefaultWsFactory();
	const now = (input.nowImpl ?? Date.now)();

	if (!user || !key) {
		return {
			ok: false,
			code: 'missing_credentials',
			message: 'BrowserStack username and access key are required. Fill both fields in Settings and try again.',
			maskedUser: maskUser(user),
			auth: null,
			cdp: null,
			lastVerifiedTs: now
		};
	}

	const started = Date.now();
	const auth = await probeAuth({ user, key, timeoutMs, fetchImpl });
	if (!auth.ok) {
		return {
			ok: false,
			code: auth.code,
			message: auth.message,
			maskedUser: maskUser(user),
			auth: { ok: false, code: auth.code, httpStatus: auth.httpStatus ?? null },
			cdp: null,
			lastVerifiedTs: now
		};
	}

	let cdp = { ok: null, code: 'not_probed', message: 'CDP probe unavailable in this runtime.' };
	if (wsFactory) {
		cdp = await probeCdp({ user, key, timeoutMs, wsFactory });
	}

	// C4.1 — if the CDP stage proves the credentials invalid (post-open auth
	// rejection), that verdict outranks the REST auth success: the SAME
	// credentials are rejected by the execution endpoint the agent path uses.
	// This is the exact observed failure shape (REST 200 + CDP 1001 close).
	if (cdp.ok === false) {
		return {
			ok: false,
			code: cdp.code,
			message: cdp.code === 'invalid_credentials'
				? `${cdp.message} (The REST API accepted the login, but the CDP execution endpoint rejected the same credentials — re-copy the username and access key from BrowserStack; do not retype them.)`
				: cdp.message,
			maskedUser: maskUser(user),
			auth: { ok: true, code: 'authenticated', httpStatus: auth.httpStatus },
			cdp: { ok: false, code: cdp.code },
			lastVerifiedTs: now,
			latencyMs: Date.now() - started
		};
	}

	return {
		ok: true,
		code: 'connected',
		message: cdp.ok === true
			? 'Connected to BrowserStack — credentials valid and the CDP execution endpoint is reachable.'
			: 'Authenticated with BrowserStack. CDP probe unavailable in this runtime; credentials are valid.',
		maskedUser: maskUser(user),
		auth: { ok: true, code: 'authenticated', httpStatus: auth.httpStatus },
		cdp: { ok: cdp.ok, code: cdp.code },
		lastVerifiedTs: now,
		latencyMs: Date.now() - started
	};
}
