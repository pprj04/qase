/**
 * Phase 17 — headless multi-viewport UX sweep.
 *
 * Deterministic observation collector. Launches a headless browser (same launch
 * pattern as replay.js), visits target pages at desktop / tablet / mobile
 * viewports, and collects per-page observations in the exact shape
 * uxChecks.js expects (see the pageData contract at the top of uxChecks.js).
 *
 * Guarantees (spec invariants):
 *  - NEVER throws to the caller; transport errors become dataCollection:{ok:false}.
 *  - Bounded: N pages (default 12) × 3 viewports, 10s per page, hard wall clock
 *    timeout (default 120s) — QASE_UX_SWEEP_TIMEOUT_MS.
 *  - No LLM anywhere. Everything recorded here was observed in the DOM.
 *  - All strings pass through redactString before leaving this module.
 */

import { chromium } from 'playwright';
import { redactString } from './findingIntelligence.js';

export const VIEWPORTS = Object.freeze([
	{ label: 'desktop', width: 1280, height: 800 },
	{ label: 'tablet', width: 768, height: 1024 },
	{ label: 'mobile', width: 375, height: 667 },
]);

const MAX_PAGES = 12;
const PAGE_TIMEOUT_MS = 10_000;
const NAV_TIMEOUT_MS = 8_000;
const SWEEP_TIMEOUT_DEFAULT_MS = 120_000;

const redactStr = (s, max = 200) => (s === null || s === undefined ? null : redactString(String(s)).slice(0, max));
const redactNum = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** Resolve the browser executable using the same fallback chain as replay.js. */
async function resolveChromiumPath() {
	const fs = await import('node:fs');
	const path = await import('node:path');
	const os = await import('node:os');
	const HOME = os.homedir();
	const cacheDir = path.join(HOME, '.cache', 'ms-playwright');
	const candidates = [];
	try {
		if (fs.existsSync(cacheDir)) {
			for (const name of fs.readdirSync(cacheDir).sort().reverse()) {
				if (name.startsWith('chromium_headless_shell-')) {
					candidates.push(path.join(cacheDir, name, 'chrome-linux', 'headless_shell'));
				}
				if (name.startsWith('chromium-')) {
					candidates.push(path.join(cacheDir, name, 'chrome-linux', 'chrome'));
				}
			}
		}
	} catch { /* cache dir unreadable */ }
	for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
		if (fs.existsSync(p)) candidates.push(p);
	}
	for (const p of candidates) {
		try {
			fs.accessSync(p, fs.constants.X_OK);
			const fd = fs.openSync(p, 'r');
			const buf = Buffer.alloc(4);
			fs.readSync(fd, buf, 0, 4, 0);
			fs.closeSync(fd);
			if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return p;
		} catch { /* not usable */ }
	}
	return null;
}

async function launchSweepBrowser() {
	const exe = await resolveChromiumPath();
	const opts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] };
	if (exe) opts.executablePath = exe;
	try {
		return await chromium.launch(opts);
	} catch {
		return await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
	}
}

/* ── page data extraction (runs IN the page) ─────────────────────── */

const EXTRACT_SCRIPT = `(() => {
	const vis = (el) => {
		try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch { return false; }
	};
	const accName = (el) => {
		const n = (el.getAttribute('aria-label') || '').trim();
		if (n) return n;
		const lab = el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '';
		if (lab) return lab;
		return (el.textContent || el.value || el.title || '').trim().replace(/\\s+/g, ' ');
	};
	const sel = (el) => {
		if (el.id) return '#' + el.id;
		if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
		const tag = el.tagName.toLowerCase();
		const name = el.getAttribute('name');
		if (name) return tag + '[name="' + name + '"]';
		const aria = el.getAttribute('aria-label');
		if (aria) return tag + '[aria-label="' + aria.slice(0, 30) + '"]';
		return tag + (el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/)[0] : '');
	};

	const navEls = document.querySelectorAll('nav, [role="navigation"]');
	const linksAll = Array.from(document.querySelectorAll('a[href], a'));
	const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
	const forms = Array.from(document.querySelectorAll('form')).map((fm) => ({
		action: fm.getAttribute('action') || '',
		method: (fm.getAttribute('method') || 'get').toLowerCase(),
		fields: Array.from(fm.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea')).map((el) => {
			const lab = el.labels && el.labels[0] ? el.labels[0].textContent.trim().slice(0, 80) : '';
			return {
				name: el.getAttribute('name') || '',
				type: (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase(),
				required: el.required === true || el.hasAttribute('required'),
				hasLabel: Boolean(lab),
				labelText: lab,
				placeholder: el.getAttribute('placeholder') || '',
				ariaLabel: el.getAttribute('aria-label') || '',
				autocomplete: el.getAttribute('autocomplete') || '',
			};
		}),
		submitLabel: (() => { const b = fm.querySelector('button[type=submit], input[type=submit], button:not([type])'); return b ? (b.textContent || b.value || '').trim().slice(0, 60) : ''; })(),
	}));
	const buttons = Array.from(document.querySelectorAll('button, [role=button], input[type=button], input[type=submit]')).slice(0, 80).map((b) => ({
		text: (b.textContent || '').trim().slice(0, 80),
		accessibleName: accName(b).slice(0, 80),
		type: b.getAttribute('type') || '',
	}));
	const images = Array.from(document.querySelectorAll('img')).slice(0, 120).map((i) => ({
		src: (i.currentSrc || i.getAttribute('src') || '').slice(0, 160),
		alt: i.hasAttribute('alt') ? i.getAttribute('alt') : null,
		decorative: i.getAttribute('role') === 'presentation' || i.getAttribute('aria-hidden') === 'true',
	}));

	const vmEl = document.querySelector('meta[name=viewport]');
	const vmContent = vmEl ? (vmEl.getAttribute('content') || '') : '';
	const viewportMeta = {
		present: Boolean(vmEl),
		width: /width\\s*=/.test(vmContent) ? (vmContent.match(/width\\s*=\\s*([\\w.]+)/) || [])[1] || null : null,
		initialScale: /initial-scale\\s*=/.test(vmContent) ? parseFloat((vmContent.match(/initial-scale\\s*=\\s*([\\d.]+)/) || [])[1]) : null,
		userScalable: /user-scalable\\s*=\\s*no|maximum-scale\\s*=\\s*1(?!\\.)/i.test(vmContent) ? false : null,
	};
	// a11y landmarks + autofill signals (Phase 17 AC-13: ≥8 dedicated a11y checks)
	const landmarks = {
		main: document.querySelectorAll('main, [role=main]').length,
		header: document.querySelectorAll('header, [role=banner]').length,
		footer: document.querySelectorAll('footer, [role=contentinfo]').length,
		skipLink: Array.from(document.querySelectorAll('a[href^="#"]')).some((a) => /skip|jump/i.test((a.textContent || '') + (a.getAttribute('aria-label') || ''))),
	};
	const focusableAll = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [role=button]'));
	const focusables = focusableAll.map((el) => ({ sel: sel(el), focusable: (() => { try { el.focus(); return document.activeElement === el; } catch { return false; } })() }));

	// Responsive metrics
	const de = document.documentElement;
	const overflowing = [];
	try {
		for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 400)) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && (r.right > window.innerWidth + 4 || r.left < -4) && vis(el)) {
				overflowing.push(sel(el) + ' (right=' + Math.round(r.right) + ')');
				if (overflowing.length >= 6) break;
			}
		}
	} catch { /* best-effort */ }
	const touchTargets = [];
	try {
		const INTERACTIVE = 'a, button, input, select, textarea, [role=button], [onclick]';
		for (const el of Array.from(document.querySelectorAll(INTERACTIVE)).slice(0, 200)) {
			if (!vis(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.width > 0 && (r.width < 44 || r.height < 44)) {
				touchTargets.push({ selector: sel(el), rect: { width: Math.round(r.width), height: Math.round(r.height) } });
				if (touchTargets.length >= 15) break;
			}
		}
	} catch { /* best-effort */ }
	const clipped = [];
	try {
		for (const el of Array.from(document.querySelectorAll('p, span, h1, h2, h3, h4, td, th, li, a, button, label')).slice(0, 300)) {
			if (!vis(el)) continue;
			const cs = getComputedStyle(el);
			const overX = el.scrollWidth - el.clientWidth;
			if (cs.overflowX !== 'visible' && overX > 4 && el.textContent && el.textContent.trim().length > 0) {
				clipped.push(sel(el) + ' (clip=' + overX + 'px)');
				if (clipped.length >= 6) break;
			}
		}
	} catch { /* best-effort */ }

	const interactiveEls = Array.from(document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [tabindex]'));
	const withoutName = [];
	const positiveTab = [];
	try {
		for (const el of interactiveEls.slice(0, 250)) {
			if (el.getAttribute('tabindex') && parseInt(el.getAttribute('tabindex'), 10) > 0) positiveTab.push(sel(el));
			if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && !accName(el)) withoutName.push(sel(el));
			if (el.tagName === 'A' && el.getAttribute('href') && !accName(el)) withoutName.push(sel(el));
		}
	} catch { /* best-effort */ }

	const sameOrigin = (href) => { try { return new URL(href, location.href).origin === location.origin; } catch { return false; } };
	const anchors = Array.from(document.querySelectorAll('a[href]'));
	const outbound = anchors.filter((a) => {
		try {
			const u = new URL(a.href, location.href);
			return u.origin === location.origin && u.pathname !== location.pathname;
		} catch { return false; }
	});

	return {
		url: location.href,
		docTitle: document.title || '',
		lang: document.documentElement.getAttribute('lang') || '',
		nav: {
			navElementCount: navEls.length,
			uniqueDestinations: new Set(anchors.map((a) => { try { return new URL(a.href, location.href).pathname; } catch { return null; } }).filter(Boolean)).size,
		},
		headings: {
			h1: headings.filter((h) => h.tagName === 'H1').map((h) => ({ text: h.textContent.trim().slice(0, 120) })),
			h2: headings.filter((h) => h.tagName === 'H2').map((h) => ({ text: h.textContent.trim().slice(0, 120) })),
			h3plus: headings.filter((h) => ['H3', 'H4', 'H5', 'H6'].includes(h.tagName)).map((h) => ({ level: parseInt(h.tagName[1], 10), text: h.textContent.trim().slice(0, 120) })),
			order: headings.map((h) => ({ level: parseInt(h.tagName[1], 10), text: h.textContent.trim().slice(0, 120) })),
		},
		forms,
		buttons,
		links: anchors.slice(0, 200).map((a) => {
			const href = a.getAttribute('href');
			let internal = null;
			try { internal = new URL(a.href, location.href).origin === location.origin; } catch { internal = null; }
			return {
				href: href === null ? null : (href === '' ? '' : String(new URL(a.href, location.href).href).slice(0, 200)),
				text: (a.textContent || '').trim().slice(0, 80),
				internal,
				emptyHref: href === '' || href === '#',
			};
		}),
		images,
		viewportMeta,
		responsive: {
			scrollWidth: de.scrollWidth,
			clientWidth: de.clientWidth,
			horizontalOverflow: de.scrollWidth > de.clientWidth + 4,
			overflowingSelectors: overflowing,
			touchTargetsBelowMin: touchTargets,
			clippedText: clipped,
		},
		interactive: {
			elementsWithoutName: withoutName.slice(0, 10),
			positiveTabIndex: positiveTab.slice(0, 10),
			focusableCount: interactiveEls.length,
			focusables: focusables.slice(0, 120),
		},
		landmarks,
		deadEnd: {
			outboundLinks: outbound.length,
			hasNav: navEls.length > 0,
		},
		navigationDepth: 0,
	};
})()`;

/** Feedback probe: submit the first visible form empty and watch for messaging. */
async function probeFormFeedback(page) {
	const start = Date.now();
	const out = { formSubmitObserved: false, loadingIndicatorSeen: false, successMessageSeen: false, failureMessageSeen: false, durationMs: null };
	try {
		const formHandle = await page.$('form:visible');
		if (!formHandle) return out;
		const countText = async () => await page.evaluate(() => document.body.innerText.length);
		const before = await countText();
		const submitted = await formHandle.evaluate((f) => {
			if (typeof f.requestSubmit === 'function') { f.requestSubmit(); return true; }
			f.submit(); return true;
		}).catch(() => false);
		if (!submitted) return out;
		out.formSubmitObserved = true;
		await page.waitForTimeout(1_600);
		out.durationMs = Date.now() - start;
		const after = await page.evaluate(() => document.body.innerText);
		const delta = after.length - before;
		const text = after.toLowerCase();
		if (/loading|spinner|please wait|saving|processing/.test(text)) out.loadingIndicatorSeen = true;
		if (/success|thank|saved|created|added|completed|done/.test(text)) out.successMessageSeen = true;
		if (/error|invalid|failed|required|must|cannot/.test(text) && delta > 0) out.failureMessageSeen = true;
		return out;
	} catch {
		out.formSubmitObserved = true;
		out.durationMs = Date.now() - start;
		return out;
	}
}

/** Error-state probe: capture any visible error text. */
async function probeErrorStates(page) {
	try {
		return await page.evaluate(() => {
			const SEL = '[class*=error i], [class*=alert i], [class*=warn i], [role=alert], [class*=invalid i], [class*=message i]';
			const out = [];
			for (const el of Array.from(document.querySelectorAll(SEL)).slice(0, 6)) {
				const t = (el.textContent || '').trim();
				if (t.length > 2 && t.length < 400 && el.getBoundingClientRect().height > 0) {
					out.push({
						context: el.className.toString().slice(0, 60) || el.getAttribute('role') || 'unknown',
						text: t.slice(0, 300),
						raw: t.slice(0, 300),
						preservesInput: (() => {
							const inputs = el.closest('form') ? el.closest('form').querySelectorAll('input:not([type=hidden])') : [];
							return inputs.length === 0 ? null : Array.from(inputs).every((i) => i.value === i.defaultValue);
						})(),
						hasRecovery: /try again|retry|correct|fix|check|enter|provide|fill|go back|back to/i.test(t),
					});
				}
			}
			return out;
		});
	} catch { return []; }
}

/** Redact a whole pageData tree (strings only) before it leaves the sweep. */
function redactPageData(pd) {
	const R = (s, max) => (typeof s === 'string' ? redactString(s).slice(0, max ?? 300) : s);
	try {
		return {
			...pd,
			url: R(pd.url, 300),
			docTitle: R(pd.docTitle, 200),
			nav: pd.nav,
			headings: {
				h1: (pd.headings?.h1 ?? []).map((h) => ({ text: R(h.text, 120) })),
				h2: (pd.headings?.h2 ?? []).map((h) => ({ text: R(h.text, 120) })),
				h3plus: (pd.headings?.h3plus ?? []).map((h) => ({ level: h.level, text: R(h.text, 120) })),
				order: (pd.headings?.order ?? []).map((h) => ({ level: h.level, text: R(h.text, 120) })),
			},
			forms: (pd.forms ?? []).map((f) => ({
				...f,
				action: R(f.action, 200),
				fields: (f.fields ?? []).map((fd) => ({
					...fd, name: R(fd.name, 80), labelText: R(fd.labelText, 80),
					placeholder: R(fd.placeholder, 80), ariaLabel: R(fd.ariaLabel, 80),
				})),
				submitLabel: R(f.submitLabel, 60),
			})),
			buttons: (pd.buttons ?? []).map((b) => ({ ...b, text: R(b.text, 80), accessibleName: R(b.accessibleName, 80) })),
			links: (pd.links ?? []).map((l) => ({ ...l, href: R(l.href, 200), text: R(l.text, 80) })),
			images: (pd.images ?? []).map((i) => ({ ...i, src: R(i.src, 160), alt: i.alt === null ? null : R(i.alt, 160) })),
			responsive: { ...pd.responsive, overflowingSelectors: (pd.responsive?.overflowingSelectors ?? []).map((s) => R(s, 120)), clippedText: (pd.responsive?.clippedText ?? []).map((s) => R(s, 120)) },
			interactive: { ...pd.interactive, elementsWithoutName: (pd.interactive?.elementsWithoutName ?? []).map((s) => R(s, 120)), positiveTabIndex: (pd.interactive?.positiveTabIndex ?? []).map((s) => R(s, 120)) },
			viewportMeta: pd.viewportMeta,
			lang: pd.lang,
			consoleErrors: (pd.consoleErrors ?? []).map((e) => ({ ...e, text: R(e.text, 200) })),
			errorStates: (pd.errorStates ?? []).map((e) => ({ ...e, context: R(e.context, 60), text: R(e.text, 300), raw: undefined })),
			feedback: pd.feedback,
			deadEnd: pd.deadEnd,
			dataCollection: pd.dataCollection,
		};
	} catch {
		return { ...pd, dataCollection: { ok: false, error: 'redaction_failed' } };
	}
}

/**
 * Collect observations for one page at one viewport.
 * Returns pageData (never throws; failure → dataCollection.ok=false).
 */
async function collectPageData(context, url, viewport, signal) {
	const page = await context.newPage();
	const consoleErrors = [];
	page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push({ text: msg.text() }); });
	page.on('pageerror', (err) => consoleErrors.push({ text: String(err?.message || err) }));
	page.setDefaultTimeout(PAGE_TIMEOUT_MS);
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS, signal });
		await page.waitForTimeout(700); // settle: render, hydration, layout
		let data = await page.evaluate(EXTRACT_SCRIPT);
		data.consoleErrors = consoleErrors.slice(0, 10);
		data.errorStates = await probeErrorStates(page);
		data.feedback = await probeFormFeedback(page);
		data.dataCollection = { ok: true };
		return redactPageData(data);
	} catch (err) {
		if (signal?.aborted) throw err;
		let data = { url, viewport, dataCollection: { ok: false, error: redactStr(err?.message || err, 160) }, consoleErrors: consoleErrors.slice(0, 10), feedback: null };
		return redactPageData(data);
	} finally {
		await page.close().catch(() => {});
	}
}

/**
 * Run the full sweep.
 *
 * opts:
 *   pages       — array of absolute URLs to visit (REQUIRED; caller discovers)
 *   timeoutMs   — total sweep wall-clock budget (default 120s, env override)
 *
 * Returns { pages: {key: pageData}, sweepMeta } — key = `${url}#${viewport}`.
 */
export async function runUxSweep(opts = {}) {
	const pages = (opts.pages || []).map(String).slice(0, MAX_PAGES).map((u) => { try { return new URL(u).href; } catch { return null; } }).filter(Boolean);
	const timeoutMs = Number(opts.timeoutMs ?? process.env.QASE_UX_SWEEP_TIMEOUT_MS ?? SWEEP_TIMEOUT_DEFAULT_MS) || SWEEP_TIMEOUT_DEFAULT_MS;
	const startedAt = Date.now();
	const sweepMeta = { startedAt, pagesRequested: pages.length, viewports: VIEWPORTS.map((v) => v.label), pagesVisited: 0, okPages: 0, failedPages: 0, durationMs: null, timedOut: false, error: null };

	if (pages.length === 0) {
		return { pages: {}, sweepMeta };
	}

	const ac = new AbortController();
	const wall = setTimeout(() => ac.abort(), timeoutMs);
	let browser = null;
	try {
		browser = await launchSweepBrowser();
		const resultPages = {};
		for (const url of pages) {
			for (const vp of VIEWPORTS) {
				const key = `${url}#${vp.label}`;
				if (Date.now() - startedAt > timeoutMs - 5_000) { sweepMeta.timedOut = true; break; }
				try {
					const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
					const pd = await collectPageData(context, url, vp, ac.signal);
					await context.close();
					pd.viewport = { ...vp };
					resultPages[key] = pd;
					sweepMeta.pagesVisited++;
					if (pd.dataCollection?.ok) sweepMeta.okPages++; else sweepMeta.failedPages++;
				} catch (err) {
					if (ac.signal.aborted) { sweepMeta.timedOut = true; break; }
					resultPages[key] = { url, viewport: vp, dataCollection: { ok: false, error: redactStr(err?.message || err, 160) } };
					sweepMeta.failedPages++;
					sweepMeta.pagesVisited++;
				}
			}
			if (sweepMeta.timedOut) break;
		}
		sweepMeta.durationMs = Date.now() - startedAt;
		return { pages: resultPages, sweepMeta };
	} catch (err) {
		sweepMeta.error = redactStr(err?.message || err, 200);
		sweepMeta.durationMs = Date.now() - startedAt;
		return { pages: {}, sweepMeta };
	} finally {
		clearTimeout(wall);
		if (browser) await browser.close().catch(() => {});
	}
}

/** Discover candidate page URLs from a session's observations (no new deps). */
export function discoverPages(session) {
	const urls = new Set();
	try { if (session?.targetUrl) urls.add(new URL(session.targetUrl).href); } catch { /* invalid */ }
	const addIfAbs = (u) => { if (!u) return; try { const a = new URL(u, session?.targetUrl); if (['http:', 'https:'].includes(a.protocol)) urls.add(a.href); } catch { /* skip */ } };
	for (const s of session?.capturedSteps ?? []) {
		addIfAbs(s.url || s.urlAfter || s.pageUrl);
	}
	for (const p of session?.appInventory?.pages ?? []) addIfAbs(typeof p === 'string' ? p : p?.url);
	for (const u of session?.appInventory?.urls ?? []) addIfAbs(u);
	return [...urls].slice(0, MAX_PAGES);
}
