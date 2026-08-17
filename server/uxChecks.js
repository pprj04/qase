/**
 * Phase 17 — UX check catalog (pure, deterministic).
 *
 * Each check receives a `pageData` observation (as produced by uxSweep.js)
 * and returns CheckResult(s) with status PASS | ISSUE | UNVERIFIED.
 *
 * Rules:
 *  - Deterministic only. No LLM, no guessing.
 *  - Insufficient data => UNVERIFIED, never ISSUE (uncertainty is preserved).
 *  - Every ISSUE carries evidence (structured references into pageData).
 *
 * pageData shape (per page per viewport):
 * {
 *   url, title, viewport: {width,height,label},
 *   nav: { links: [{href,text,visible}], navElementCount, uniqueDestinations },
 *   headings: { h1: [{text}], h2: [...], h3plus: [{level,text}], order: [{level,text}] },
 *   forms: [{ action, method, fields: [{name,type,required,hasLabel,labelText,placeholder,ariaLabel,autocomplete}], submitLabel }],
 *   buttons: [{ text, accessibleName, type }],
 *   links: [{ href, text, internal, external, emptyHref }],
 *   images: [{ src, alt, decorative }],
 *   lang, docTitle,
 *   viewportMeta: { present, width, initialScale, userScalable },
 *   responsive: { scrollWidth, clientWidth, horizontalOverflow, overflowingSelectors, touchTargetsBelowMin: [{selector,rect}], clippedText: [{selector}] },
 *   consoleErrors: [ {text} ],
 *   errorStates: [ { context, text, raw, preservesInput, hasRecovery } ],   // captured by probes
 *   feedback: { formSubmitObserved, loadingIndicatorSeen, successMessageSeen, failureMessageSeen, durationMs },
 *   interactive: { elementsWithoutName: [selector], positiveTabIndex: [selector], focusableCount },
 *   deadEnd: { outboundLinks, hasNav },
 *   navigationDepth,
 *   dataCollection: { ok, error }   // sweep-level transport status for this page
 * }
 */

export const CHECK_STATUS = Object.freeze({ PASS: 'PASS', ISSUE: 'ISSUE', UNVERIFIED: 'UNVERIFIED' });

export const UX_DIMENSIONS = Object.freeze([
	'NAVIGATION',
	'CLARITY',
	'CONSISTENCY',
	'FEEDBACK',
	'ERROR_HANDLING',
	'FORM_USABILITY',
	'INFORMATION_HIERARCHY',
	'ACCESSIBILITY',
	'RESPONSIVENESS',
]);

/** Dimension used by the friction analyzer (separate module) — kept here for a single enum source. */
export const FRICTION_DIMENSION = 'USER_FLOW_FRICTION';

/* ── shared helpers ─────────────────────────────────────────────── */

const MIN_TOUCH_TARGET_PX = 24;      // borderline mobile target (44 is the a11y ideal; we flag <24 hard, 24–43 soft)
const TOUCH_TARGET_SOFT_PX = 44;
const CLIP_THRESHOLD_PX = 4;

function ev(kind, detail) {
	return { kind, detail };
}

function result(checkId, dimension, status, { severity = 'info', detail = '', evidence = [], viewport = null } = {}) {
	return {
		checkId,
		dimension,
		status,
		severity: status === 'ISSUE' ? severity : 'none',
		detail,
		evidence,
		viewport,
	};
}

const isMobileViewport = (vd) => Boolean(vd && vd.width <= 500);

/* ── NAVIGATION checks ──────────────────────────────────────────── */

function checkNavPresence(pd) {
	const c = 'nav_presence';
	if (!pd?.nav || typeof pd.nav.navElementCount !== 'number') {
		return result(c, 'NAVIGATION', CHECK_STATUS.UNVERIFIED, { detail: 'navigation data not collected' });
	}
	if (pd.nav.navElementCount > 0) {
		return result(c, 'NAVIGATION', CHECK_STATUS.PASS, { detail: `${pd.nav.navElementCount} nav landmark(s)` });
	}
	// No <nav> landmark. UNVERIFIED unless we also saw no links at all (page is a dead end).
	if (Array.isArray(pd.links) && pd.links.length === 0 && pd.deadEnd && pd.deadEnd.outboundLinks === 0) {
		return result(c, 'NAVIGATION', CHECK_STATUS.ISSUE, {
			severity: 'medium', detail: 'Page has no navigation landmark and no outbound links (dead end)',
			evidence: [ev('dom', 'nav.navElementCount=0; links.length=0')],
		});
	}
	return result(c, 'NAVIGATION', CHECK_STATUS.UNVERIFIED, {
		detail: 'no nav landmark found; custom navigation pattern possible',
	});
}

function checkDeadEnd(pd) {
	const c = 'navigation_dead_end';
	if (!pd?.deadEnd) return result(c, 'NAVIGATION', CHECK_STATUS.UNVERIFIED);
	if (pd.deadEnd.outboundLinks > 0) return result(c, 'NAVIGATION', CHECK_STATUS.PASS, { detail: `${pd.deadEnd.outboundLinks} outbound links` });
	return result(c, 'NAVIGATION', CHECK_STATUS.ISSUE, {
		severity: 'medium',
		detail: 'No outbound navigation from this page — user reaches a dead end',
		evidence: [ev('dom', 'deadEnd.outboundLinks=0')],
	});
}

function checkBrokenInternalLinks(pd) {
	const c = 'navigation_broken_internal_links';
	const links = pd?.links;
	if (!Array.isArray(links)) return result(c, 'NAVIGATION', CHECK_STATUS.UNVERIFIED);
	const empty = links.filter(l => l.emptyHref || (!l.href && l.text));
	if (empty.length > 0) {
		return result(c, 'NAVIGATION', CHECK_STATUS.ISSUE, {
			severity: 'high',
			detail: `${empty.length} link(s) have empty href (do nothing on click)`,
			evidence: empty.slice(0, 5).map(l => ev('dom', `link text="${(l.text || '').slice(0, 40)}" href empty`)),
		});
	}
	return result(c, 'NAVIGATION', CHECK_STATUS.PASS, { detail: `${links.length} links, none empty` });
}

/* ── CLARITY checks ─────────────────────────────────────────────── */

function checkDocTitle(pd) {
	const c = 'clarity_document_title';
	// Title is only knowable when the document was actually loaded (dataCollection ok + title field present).
	if (!pd || pd.docTitle === undefined || pd.dataCollection?.ok === false) return result(c, 'CLARITY', CHECK_STATUS.UNVERIFIED);
	if (!pd.docTitle || String(pd.docTitle).trim().length < 3) {
		return result(c, 'CLARITY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: 'Document title is missing or too short to orient the user',
			evidence: [ev('dom', `docTitle=${JSON.stringify(pd.docTitle ?? null)}`)],
		});
	}
	return result(c, 'CLARITY', CHECK_STATUS.PASS, { detail: `title="${pd.docTitle.slice(0, 60)}"` });
}

function checkPageHeading(pd) {
	const c = 'clarity_page_heading';
	if (!pd?.headings || !Array.isArray(pd.headings.h1)) return result(c, 'CLARITY', CHECK_STATUS.UNVERIFIED);
	if (pd.headings.h1.length === 1) return result(c, 'CLARITY', CHECK_STATUS.PASS, { detail: 'single h1 present' });
	if (pd.headings.h1.length === 0) {
		// Only an issue when the page HAS content headings at all below h1, or has no h2 either (untitled page).
		const hasSubheads = (pd.headings.h2?.length ?? 0) > 0 || (pd.headings.h3plus?.length ?? 0) > 0;
		if (!hasSubheads) return result(c, 'CLARITY', CHECK_STATUS.UNVERIFIED, { detail: 'no headings found; page may be app-shell with dynamic content' });
		return result(c, 'CLARITY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: 'Page has section headings but no top-level h1 — primary purpose not stated',
			evidence: [ev('dom', `h1=0, h2=${pd.headings.h2.length}`)],
		});
	}
	return result(c, 'CLARITY', CHECK_STATUS.ISSUE, {
		severity: 'low',
		detail: `${pd.headings.h1.length} h1 elements — ambiguous page topic`,
		evidence: [ev('dom', `h1 count=${pd.headings.h1.length}`)],
	});
}

/* ── CONSISTENCY checks ─────────────────────────────────────────── */

/**
 * Cross-page consistency — receives the site-level sweep result, not a single page.
 * Compares shared nav presence, title prefixes, and heading conventions across pages.
 */
export function checkCrossPageConsistency(pagesData) {
	const c = 'consistency_cross_page';
	const pages = Object.values(pagesData).filter(p => p && p.dataCollection?.ok);
	if (pages.length < 2) {
		return result(c, 'CONSISTENCY', CHECK_STATUS.UNVERIFIED, { detail: 'fewer than 2 pages collected' });
	}
	const evidence = [];
	const issues = [];
	// Nav landmark present on some pages but not others
	const withNav = pages.filter(p => (p.nav?.navElementCount ?? 0) > 0).length;
	if (withNav > 0 && withNav < pages.length) {
		issues.push(`navigation landmark present on ${withNav}/${pages.length} pages`);
		evidence.push(ev('dom', `nav on ${withNav}/${pages.length} pages`));
	}
	// Title convention: do titles share a stable suffix/prefix (brand)?
	const titles = pages.map(p => p.docTitle || '').filter(Boolean);
	if (titles.length >= 2) {
		const brandish = titles.filter(t => t === titles[0]).length;
		if (brandish === titles.length && titles[0].length > 0) {
			issues.push('identical page titles across different pages');
			// Per-page refs (≥2 pages guaranteed here) so the issue always meets the
			// evidence invariant: a VERIFIED issue needs ≥2 refs (or 1 screenshot).
			const pageRefs = pages
				.filter(p => p.docTitle)
				.slice(0, 4)
				.map(p => ev('dom', `"${String(p.docTitle).slice(0, 40)}" on ${p.url || 'page'}`));
			evidence.push(...pageRefs, ev('dom', `all titles = "${titles[0].slice(0, 40)}"`));
		}
	}
	if (issues.length > 0) {
		return result(c, 'CONSISTENCY', CHECK_STATUS.ISSUE, { severity: 'low', detail: issues.join('; '), evidence });
	}
	return result(c, 'CONSISTENCY', CHECK_STATUS.PASS, { detail: `${pages.length} pages consistent on checked signals` });
}

/* ── FEEDBACK checks ────────────────────────────────────────────── */

function checkActionFeedback(pd) {
	const c = 'feedback_action_feedback';
	const fb = pd?.feedback;
	if (!fb || !fb.formSubmitObserved) {
		// No form submit probe ran on this page — cannot judge feedback.
		return result(c, 'FEEDBACK', CHECK_STATUS.UNVERIFIED, { detail: 'no form submission observed on this page' });
	}
	const duration = fb.durationMs ?? 0;
	// Instantaneous actions (<300ms) do not require a loading indicator.
	const needsLoading = duration >= 1000;
	const missing = [];
	const evidence = [];
	if (needsLoading && !fb.loadingIndicatorSeen) { missing.push('loading indicator'); evidence.push(ev('probe', `duration=${duration}ms, no loading indicator`)); }
	if (!fb.successMessageSeen && !fb.failureMessageSeen) {
		missing.push('success/failure message');
		evidence.push(ev('probe', 'no success or failure message appeared after submit'));
	}
	if (missing.length > 0) {
		return result(c, 'FEEDBACK', CHECK_STATUS.ISSUE, {
			severity: missing.length > 1 ? 'medium' : 'low',
			detail: `Form submission completed without: ${missing.join(', ')}`,
			evidence,
		});
	}
	return result(c, 'FEEDBACK', CHECK_STATUS.PASS, { detail: `feedback observed (duration=${duration}ms)` });
}

/* ── ERROR_HANDLING checks ──────────────────────────────────────── */

export const ERROR_EXPERIENCE_KINDS = Object.freeze([
	'TECHNICAL_ERROR_EXPOSURE',
	'UNHELPFUL_ERROR',
	'MISSING_RECOVERY',
	'DATA_LOSS_RISK',
	'GOOD_ERROR_HANDLING',
]);

function checkErrorExperience(pd) {
	const c = 'error_experience';
	const errs = pd?.errorStates;
	if (!Array.isArray(errs) || errs.length === 0) {
		return result(c, 'ERROR_HANDLING', CHECK_STATUS.UNVERIFIED, { detail: 'no error state observed (probes found no failing path)' });
	}
	const results = [];
	for (const e of errs) {
		const evidence = [ev('probe', `context="${(e.context || '').slice(0, 60)}", text="${String(e.text || '').slice(0, 120)}"`)];
		const text = String(e.text || '');
		// Technical exposure: stack traces / raw exceptions surfaced to the user
		if (/(\bstack trace\b|at [\w$.]+ \(|TypeError:|ReferenceError:|Uncaught \w+|syntax error near|SQLSTATE|\/api\/\S+ 500|status[: ]*5\d\d)/i.test(text)) {
			results.push(result(c, 'ERROR_HANDLING', CHECK_STATUS.ISSUE, {
				severity: 'high',
				detail: 'Raw technical error shown to user',
				evidence: evidence.concat([ev('classification', 'TECHNICAL_ERROR_EXPOSURE')]),
			}));
			continue;
		}
		// Unhelpful: single generic word, no next step
		if (text.trim().length > 0 && text.trim().length <= 12 && !/\?/.test(text)) {
			results.push(result(c, 'ERROR_HANDLING', CHECK_STATUS.ISSUE, {
				severity: 'medium',
				detail: 'Unhelpful error message (too short to explain what failed)',
				evidence: evidence.concat([ev('classification', 'UNHELPFUL_ERROR')]),
			}));
			continue;
		}
		// Missing recovery
		if (!e.hasRecovery) {
			results.push(result(c, 'ERROR_HANDLING', CHECK_STATUS.ISSUE, {
				severity: 'medium',
				detail: 'Error message gives no recovery path',
				evidence: evidence.concat([ev('classification', 'MISSING_RECOVERY')]),
			}));
			continue;
		}
		if (e.preservesInput === false) {
			results.push(result(c, 'ERROR_HANDLING', CHECK_STATUS.ISSUE, {
				severity: 'high',
				detail: 'Error path discards user input (data loss risk)',
				evidence: evidence.concat([ev('classification', 'DATA_LOSS_RISK')]),
			}));
			continue;
		}
		results.push(result(c, 'ERROR_HANDLING', CHECK_STATUS.PASS, {
			detail: 'Error message understandable with recovery guidance',
			evidence: evidence.concat([ev('classification', 'GOOD_ERROR_HANDLING')]),
		}));
	}
	return results;
}

/* ── FORM_USABILITY checks ──────────────────────────────────────── */

function checkFormLabels(pd) {
	const c = 'form_field_labels';
	const forms = pd?.forms;
	if (!Array.isArray(forms) || forms.length === 0) return result(c, 'FORM_USABILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no forms on this page' });
	const unlabeled = [];
	let fieldCount = 0;
	for (const form of forms) {
		for (const f of form.fields || []) {
			fieldCount++;
			const named = Boolean(f.hasLabel || f.labelText || f.ariaLabel || (f.placeholder && ['search', 'text', 'email', 'url', 'tel'].includes(f.type)));
			if (!named) unlabeled.push(f);
		}
	}
	if (unlabeled.length > 0) {
		return result(c, 'FORM_USABILITY', CHECK_STATUS.ISSUE, {
			severity: unlabeled.length >= 3 ? 'medium' : 'low',
			detail: `${unlabeled.length}/${fieldCount} form field(s) have no label, aria-label, or explanatory placeholder`,
			evidence: unlabeled.slice(0, 5).map(f => ev('dom', `input name="${f.name || '?'}" type=${f.type || 'text'} unlabeled`)),
		});
	}
	return result(c, 'FORM_USABILITY', CHECK_STATUS.PASS, { detail: `${fieldCount} fields all labeled` });
}

function checkInputTypes(pd) {
	const c = 'form_input_types';
	const forms = pd?.forms;
	if (!Array.isArray(forms) || forms.length === 0) return result(c, 'FORM_USABILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no forms on this page' });
	const bad = [];
	for (const form of forms) {
		for (const f of form.fields || []) {
			const looksEmail = /mail/i.test(f.name || '') || /mail/i.test(f.labelText || '') || /mail/i.test(f.placeholder || '');
			const looksTel = /phone|tel[-_]?(number)?/i.test(f.name || '') || /phone/i.test(f.labelText || '');
			if (looksEmail && f.type !== 'email' && f.type !== 'text') bad.push(f);
			else if (looksEmail && f.type === 'text') bad.push({ ...f, reason: 'email-like field uses type=text (no mobile keyboard / validation)' });
			else if (looksTel && f.type !== 'tel') bad.push(f);
		}
	}
	if (bad.length > 0) {
		return result(c, 'FORM_USABILITY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: `${bad.length} field(s) use inappropriate input types`,
			evidence: bad.slice(0, 5).map(f => ev('dom', `field "${f.name || '?'}" type=${f.type ?? '?'}${f.reason ? ' — ' + f.reason : ''}`)),
		});
	}
	return result(c, 'FORM_USABILITY', CHECK_STATUS.PASS, { detail: 'input types appropriate' });
}

function checkRequiredMarking(pd) {
	const c = 'form_required_marking';
	const forms = pd?.forms;
	if (!Array.isArray(forms) || forms.length === 0) return result(c, 'FORM_USABILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no forms on this page' });
	// Only judge when the form HAS client-side validation feedback (i.e., we saw required fields flagged).
	const totalFields = forms.reduce((n, fm) => n + (fm.fields?.length ?? 0), 0);
	const requiredCount = forms.reduce((n, fm) => n + (fm.fields?.filter(f => f.required).length ?? 0), 0);
	if (requiredCount === 0) {
		// No required fields visible in DOM: cannot know whether requiredness is enforced server-side only.
		return result(c, 'FORM_USABILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no required fields marked in DOM' });
	}
	return result(c, 'FORM_USABILITY', CHECK_STATUS.PASS, { detail: `${requiredCount}/${totalFields} fields marked required` });
}

function checkPasswordFields(pd) {
	const c = 'form_password_handling';
	const forms = pd?.forms;
	if (!Array.isArray(forms) || forms.length === 0) return result(c, 'FORM_USABILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no forms on this page' });
	const pwFields = [];
	for (const form of forms) {
		for (const f of form.fields || []) if (f.type === 'password') pwFields.push(f);
	}
	if (pwFields.length === 0) return result(c, 'FORM_USABILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no password fields' });
	const bad = pwFields.filter(f => f.autocomplete == null || f.autocomplete === '' || (typeof f.autocomplete === 'string' && !/new-password|current-password/i.test(f.autocomplete)));
	if (bad.length > 0) {
		return result(c, 'FORM_USABILITY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: `${bad.length} password field(s) lack proper autocomplete attribute`,
			evidence: bad.slice(0, 3).map(f => ev('dom', `password field autocomplete=${JSON.stringify(f.autocomplete)}`)),
		});
	}
	return result(c, 'FORM_USABILITY', CHECK_STATUS.PASS, { detail: 'password fields have autocomplete hints' });
}

/* ── INFORMATION_HIERARCHY checks ───────────────────────────────── */

function checkHeadingOrder(pd) {
	const c = 'hierarchy_heading_order';
	const order = pd?.headings?.order;
	if (!Array.isArray(order) || order.length === 0) return result(c, 'INFORMATION_HIERARCHY', CHECK_STATUS.UNVERIFIED, { detail: 'no headings collected' });
	let prev = 0;
	const skips = [];
	for (const h of order) {
		if (prev && h.level > prev + 1) skips.push(`${prev}→${h.level}`);
		prev = h.level;
	}
	if (skips.length > 0) {
		return result(c, 'INFORMATION_HIERARCHY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: `Heading levels skip (${skips.join(', ')})`,
			evidence: skips.slice(0, 4).map(s => ev('dom', `heading level skip ${s}`)),
		});
	}
	return result(c, 'INFORMATION_HIERARCHY', CHECK_STATUS.PASS, { detail: `${order.length} headings in order` });
}

/* ── ACCESSIBILITY checks ───────────────────────────────────────── */

function checkImagesAlt(pd) {
	const c = 'a11y_image_alt';
	const imgs = pd?.images;
	if (!Array.isArray(imgs) || imgs.length === 0) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no images' });
	const missing = imgs.filter(i => !i.alt && !i.decorative);
	if (missing.length > 0) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: missing.length >= 3 ? 'medium' : 'low',
			detail: `${missing.length}/${imgs.length} informative image(s) missing alt text`,
			evidence: missing.slice(0, 5).map(i => ev('dom', `img src="${String(i.src).slice(0, 60)}" missing alt`)),
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: `${imgs.length} images all have alt or are decorative` });
}

function checkInteractiveNames(pd) {
	const c = 'a11y_interactive_names';
	const inter = pd?.interactive;
	if (!inter || !Array.isArray(inter.elementsWithoutName)) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED);
	if (inter.elementsWithoutName.length > 0) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: inter.elementsWithoutName.length >= 3 ? 'medium' : 'low',
			detail: `${inter.elementsWithoutName.length} interactive element(s) have no accessible name`,
			evidence: inter.elementsWithoutName.slice(0, 5).map(s => ev('dom', `unnamed interactive: ${s}`)),
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: 'interactive elements named' });
}

function checkLang(pd) {
	const c = 'a11y_document_lang';
	if (!pd || pd.lang === undefined) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED);
	if (!pd.lang) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: 'html lang attribute missing — screen readers cannot select voice/language',
			evidence: [ev('dom', 'html@lang empty')],
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: `lang="${pd.lang}"` });
}

function checkPositiveTabindex(pd) {
	const c = 'a11y_positive_tabindex';
	const inter = pd?.interactive;
	if (!inter || !Array.isArray(inter.positiveTabIndex)) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED);
	if (inter.positiveTabIndex.length > 0) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: 'medium',
			detail: `${inter.positiveTabIndex.length} element(s) use positive tabindex (breaks natural tab order)`,
			evidence: inter.positiveTabIndex.slice(0, 5).map(s => ev('dom', `tabindex>0: ${s}`)),
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: 'no positive tabindex' });
}

function checkHeadingStructureA11y(pd) {
	// h1 presence is ALSO an a11y concern; reuse heading data but report under ACCESSIBILITY only for missing-h1-with-content.
	const c = 'a11y_heading_structure';
	const order = pd?.headings?.order;
	if (!Array.isArray(order) || order.length === 0) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED, { detail: 'no headings collected' });
	if (!order.some(h => h.level === 1)) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: 'No h1 — assistive tech lacks a page landmark topic',
			evidence: [ev('dom', `headings found: ${order.slice(0, 5).map(h => 'h' + h.level).join(',')}`)],
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: 'h1 present' });
}

function checkViewportMeta(pd) {
	const c = 'a11y_viewport_zoom';
	const vm = pd?.viewportMeta;
	if (!vm) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED, { detail: 'viewport meta not collected' });
	if (vm.userScalable === false) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: 'high',
			detail: 'Pinch-zoom disabled (user-scalable=no) — low-vision users cannot magnify',
			evidence: [ev('dom', 'meta viewport user-scalable=no')],
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: 'zoom not disabled' });
}

/**
 * a11y_landmarks — main landmark present (screen-reader region navigation).
 * UNVERIFIED when the sweep didn't collect landmarks (older sweeps / transport fail).
 */
function checkLandmarks(pd) {
	const c = 'a11y_landmarks';
	const lm = pd?.landmarks;
	if (!lm || lm.main === undefined) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED, { detail: 'landmarks not collected' });
	if (lm.main === 0) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: 'medium',
			detail: 'No <main> / [role=main] landmark — screen-reader users cannot jump to primary content',
			evidence: [ev('dom', `main=${lm.main} header=${lm.header} footer=${lm.footer}`)],
		});
	}
	if (lm.main > 1) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: 'low',
			detail: `${lm.main} main landmarks — should be exactly one`,
			evidence: [ev('dom', `main=${lm.main}`)],
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: 'single main landmark present' });
}

/**
 * a11y_focus_order — interactive elements actually receive programmatic focus.
 * Uses the per-element focus probe from the sweep (focusables[]).
 */
function checkFocusOrder(pd) {
	const c = 'a11y_focus_order';
	const fs = pd?.interactive?.focusables;
	if (!Array.isArray(fs) || fs.length === 0) return result(c, 'ACCESSIBILITY', CHECK_STATUS.UNVERIFIED, { detail: 'focus probe not collected' });
	const notFocusable = fs.filter(f => f && f.focusable === false);
	if (notFocusable.length > 0) {
		return result(c, 'ACCESSIBILITY', CHECK_STATUS.ISSUE, {
			severity: 'medium',
			detail: `${notFocusable.length}/${fs.length} interactive elements cannot receive programmatic focus (keyboard unreachable)`,
			evidence: notFocusable.slice(0, 4).map(f => ev('dom', `${f.sel || 'element'} not focusable`)),
		});
	}
	return result(c, 'ACCESSIBILITY', CHECK_STATUS.PASS, { detail: `${fs.length} interactive elements focusable` });
}


/* ── RESPONSIVENESS checks (mobile/tablet viewports only) ──────── */

function checkHorizontalOverflow(pd) {
	const c = 'resp_horizontal_overflow';
	const r = pd?.responsive;
	if (!r || typeof r.scrollWidth !== 'number') return result(c, 'RESPONSIVENESS', CHECK_STATUS.UNVERIFIED);
	if (!isMobileViewport(pd.viewport) && !(pd.viewport?.width <= 900)) {
		// overflow check only meaningful on constrained viewports
		return result(c, 'RESPONSIVENESS', CHECK_STATUS.UNVERIFIED, { detail: 'not a constrained viewport' });
	}
	if (r.horizontalOverflow && r.scrollWidth > (pd.viewport?.width ?? r.clientWidth ?? 0) + CLIP_THRESHOLD_PX) {
		return result(c, 'RESPONSIVENESS', CHECK_STATUS.ISSUE, {
			severity: 'high',
			detail: `Horizontal scrolling required (${r.scrollWidth}px content in ${pd.viewport?.width}px viewport)`,
			evidence: [ev('screenshot', `scrollWidth=${r.scrollWidth} at ${pd.viewport?.width}x${pd.viewport?.height}`), ...((r.overflowingSelectors || []).slice(0, 3).map(s => ev('dom', `overflowing: ${s}`)))],
		});
	}
	return result(c, 'RESPONSIVENESS', CHECK_STATUS.PASS, { detail: 'no horizontal overflow' });
}

function checkTouchTargets(pd) {
	const c = 'resp_touch_targets';
	const r = pd?.responsive;
	if (!r || !Array.isArray(r.touchTargetsBelowMin)) return result(c, 'RESPONSIVENESS', CHECK_STATUS.UNVERIFIED);
	if (!isMobileViewport(pd.viewport)) return result(c, 'RESPONSIVENESS', CHECK_STATUS.UNVERIFIED, { detail: 'touch targets evaluated only on mobile viewports' });
	const hard = r.touchTargetsBelowMin.filter(t => (t.rect?.width ?? 99) < MIN_TOUCH_TARGET_PX || (t.rect?.height ?? 99) < MIN_TOUCH_TARGET_PX);
	const soft = r.touchTargetsBelowMin.filter(t => !hard.includes(t));
	if (hard.length > 0 || soft.length >= 3) {
		return result(c, 'RESPONSIVENESS', CHECK_STATUS.ISSUE, {
			severity: hard.length > 0 ? 'medium' : 'low',
			detail: `${hard.length} target(s) < ${MIN_TOUCH_TARGET_PX}px, ${soft.length} below ${TOUCH_TARGET_SOFT_PX}px recommended`,
			evidence: r.touchTargetsBelowMin.slice(0, 5).map(t => ev('dom', `small target ${t.selector} (${Math.round(t.rect?.width ?? 0)}×${Math.round(t.rect?.height ?? 0)}px)`)),
		});
	}
	return result(c, 'RESPONSIVENESS', CHECK_STATUS.PASS, { detail: 'touch targets adequate' });
}

function checkClippedText(pd) {
	const c = 'resp_clipped_text';
	const r = pd?.responsive;
	if (!r || !Array.isArray(r.clippedText)) return result(c, 'RESPONSIVENESS', CHECK_STATUS.UNVERIFIED, { detail: 'clip detection not available' });
	if (r.clippedText.length > 0) {
		return result(c, 'RESPONSIVENESS', CHECK_STATUS.ISSUE, {
			severity: 'medium',
			detail: `${r.clippedText.length} text block(s) clipped at this viewport`,
			evidence: r.clippedText.slice(0, 4).map(t => ev('dom', `clipped: ${t.selector}`)),
		});
	}
	return result(c, 'RESPONSIVENESS', CHECK_STATUS.PASS, { detail: 'no clipped text detected' });
}

function checkViewportMetaResponsive(pd) {
	const c = 'resp_viewport_meta';
	const vm = pd?.viewportMeta;
	if (!vm) return result(c, 'RESPONSIVENESS', CHECK_STATUS.UNVERIFIED);
	if (vm.present === false) {
		return result(c, 'RESPONSIVENESS', CHECK_STATUS.ISSUE, {
			severity: 'high',
			detail: 'No viewport meta tag — mobile browsers render at desktop width and zoom out',
			evidence: [ev('dom', 'meta[name=viewport] absent')],
		});
	}
	return result(c, 'RESPONSIVENESS', CHECK_STATUS.PASS, { detail: 'viewport meta present' });
}

function checkConsoleErrors(pd) {
	const c = 'console_errors';
	const errs = pd?.consoleErrors;
	if (!Array.isArray(errs)) return result(c, 'ERROR_HANDLING', CHECK_STATUS.UNVERIFIED);
	if (errs.length > 0) {
		return result(c, 'ERROR_HANDLING', CHECK_STATUS.ISSUE, {
			severity: errs.length >= 5 ? 'medium' : 'low',
			detail: `${errs.length} console error(s) during page interaction`,
			evidence: errs.slice(0, 3).map(e => ev('console', String(e.text).slice(0, 160))),
		});
	}
	return result(c, 'ERROR_HANDLING', CHECK_STATUS.PASS, { detail: 'no console errors' });
}

/* ── catalog registry ───────────────────────────────────────────── */

/** Per-page checks: receive a single pageData object. */
export const PAGE_CHECKS = Object.freeze([
	checkNavPresence,
	checkDeadEnd,
	checkBrokenInternalLinks,
	checkDocTitle,
	checkPageHeading,
	checkActionFeedback,
	checkErrorExperience,   // returns array
	checkFormLabels,
	checkInputTypes,
	checkRequiredMarking,
	checkPasswordFields,
	checkHeadingOrder,
	checkImagesAlt,
	checkInteractiveNames,
	checkLang,
	checkPositiveTabindex,
	checkHeadingStructureA11y,
	checkViewportMeta,
	checkLandmarks,
	checkFocusOrder,
	checkHorizontalOverflow,
	checkTouchTargets,
	checkClippedText,
	checkViewportMetaResponsive,
	checkConsoleErrors,
]);

/** Run all page checks over one pageData. Returns flat array of CheckResults. */
export function runPageChecks(pageData) {
	if (!pageData || pageData.dataCollection?.ok === false) {
		// Transport failed for this page — every check is UNVERIFIED with reason.
		return PAGE_CHECKS.map(fn => {
			const probe = fn({ __unavailable: true });
			return Array.isArray(probe) ? probe : probe;
		}).map(r => ({ ...r, status: CHECK_STATUS.UNVERIFIED, detail: `page data unavailable (${pageData.dataCollection?.error ?? 'sweep failed'})`, severity: 'none', evidence: [] }));
	}
	const out = [];
	for (const fn of PAGE_CHECKS) {
		const r = fn(pageData);
		if (Array.isArray(r)) out.push(...r);
		else out.push(r);
	}
	return out;
}

/** Site-level checks: receive the full pagesData map {urlKey: pageData}. */
export const SITE_CHECKS = Object.freeze([
	checkCrossPageConsistency,
]);

export function runSiteChecks(pagesData) {
	return SITE_CHECKS.map(fn => fn(pagesData));
}
