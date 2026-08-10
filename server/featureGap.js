/**
 * Feature Gap Intelligence
 *
 * "Can it find what AI forgot to build?"
 *
 * This is NOT bug detection. Bugs = "this exists but is broken."
 * Feature gaps = "this should exist but doesn't at all."
 *
 * The module takes exploration data from a completed session and
 * reasons about what features the application SHOULD have based on
 * its inferred purpose, then compares against what was actually
 * discovered.
 *
 * Two-phase approach:
 * 1. Heuristic extraction — derive pages, forms, auth state, capabilities
 *    from captured steps, activities, report, todos
 * 2. LLM analysis — reason about the gap between expected and actual
 */

import { randomUUID } from 'node:crypto';
import { getConfig } from './config.js';
import { callLLM } from './testGen.js';

/**
 * Extracts a JSON array or object from an LLM response that may
 * contain markdown fences or surrounding text.
 */
function extractJSON(raw) {
	if (!raw) return null;
	// Strip markdown code fences
	let cleaned = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
	// Try direct parse first
	try { return JSON.parse(cleaned); } catch { /* continue */ }
	// Find first { or [ and last matching close
	const start = cleaned.search(/[[{]/);
	if (start === -1) return null;
	const openChar = cleaned[start];
	const closeChar = openChar === '[' ? ']' : '}';
	const end = cleaned.lastIndexOf(closeChar);
	if (end > start) {
		try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* continue */ }
	}
	return null;
}

/* ── Phase 1: Heuristic Extraction ────────────────────────────── */

/**
 * B2: Extract behavioral evidence from captured step outcomes.
 *
 * This is the key intelligence upgrade — instead of only knowing that a
 * /login page exists, we now know whether login was ATTEMPTED and whether
 * it SUCCEEDED (URL changed after filling password + clicking submit).
 *
 * This feeds into purpose detection (verified login + dashboard = strong
 * SaaS signal) and feature gap analysis ("feature broken" vs "feature missing").
 *
 * @param {object[]} steps — session.capturedSteps (each has .outcome from B1)
 * @returns {object} interactions summary
 */
function extractInteractiveSignals(steps) {
	const result = {
		totalActions: 0,
		successfulActions: 0,
		failedActions: 0,
		successRate: 0,
		verifiedAuth: {
			loginAttempted: false,
			loginSucceeded: false,
			registerAttempted: false,
			registerSucceeded: false,
		},
		verifiedFeatures: {
			search: false,
			payment: false,
			formSubmission: false,
			mediaUpload: false,
		},
		brokenFeatures: {
			search: false,
			payment: false,
			formSubmission: false,
			auth: false,
		},
		pageTransitions: [],
		errorsEncountered: 0,
		dialogInteractions: 0,
	};

	if (!steps || steps.length === 0) return result;

	// Classify each step by its outcome
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const outcome = step.outcome;
		if (!outcome || outcome.status === 'pending') continue;

		result.totalActions++;
		const isSuccess = outcome.status === 'success';
		if (isSuccess) {
			result.successfulActions++;
		} else {
			result.failedActions++;
			result.errorsEncountered++;
		}

		if (outcome.dialogAppeared) {
			result.dialogInteractions++;
		}

		// Capture page transitions (URL changed after action)
		if (isSuccess && outcome.urlAfter && step.url && outcome.urlAfter !== step.url) {
			result.pageTransitions.push({
				from: step.url,
				to: outcome.urlAfter,
				action: step.action,
			});
		}

		// Detect auth flows by examining the action + target + URL
		const stepUrl = (step.url || '').toLowerCase();
		const stepTarget = (step.target || '').toLowerCase();
		const stepLabel = (step.label || '').toLowerCase();
		const stepValue = (step.value || '').toLowerCase();

		// --- Auth flow detection ---
		const isLoginPage = /login|signin|sign-in|auth/.test(stepUrl);
		const isRegisterPage = /regist|signup|sign-up|create.account/.test(stepUrl);
		const isPasswordField = /password|passwd|pwd/.test(stepTarget) || /password|passwd|pwd/.test(stepLabel);
		const isEmailField = /email|username|user/.test(stepTarget) || /email|username/.test(stepLabel);
		const isSubmitAction = step.action === 'click' && /submit|login|sign.in|register|signup|continue|next/.test(stepTarget + stepLabel);

		// Login attempted: fill password on login page, or click submit on login page
		if (isLoginPage && (isPasswordField || (isEmailField && step.action === 'fill'))) {
			result.verifiedAuth.loginAttempted = true;
		}
		if (isLoginPage && isSubmitAction) {
			result.verifiedAuth.loginAttempted = true;
		}

		// Login succeeded: after submit on login page, URL changed away from login
		if (result.verifiedAuth.loginAttempted && isSubmitAction && isSuccess && outcome.urlAfter) {
			const afterUrl = outcome.urlAfter.toLowerCase();
			if (!/login|signin|sign-in/.test(afterUrl)) {
				result.verifiedAuth.loginSucceeded = true;
			}
		}

		// Login broken: submit on login page but failed, OR stayed on login page despite success
		if (result.verifiedAuth.loginAttempted && isSubmitAction) {
			if (!isSuccess) {
				result.brokenFeatures.auth = true;
			} else if (outcome.urlAfter && /login|signin|sign-in/.test(outcome.urlAfter.toLowerCase())) {
				// Submit "succeeded" (no error thrown) but we're still on login page — auth broken
				result.brokenFeatures.auth = true;
			}
		}

		// Register flow
		if (isRegisterPage && (isPasswordField || isEmailField) && step.action === 'fill') {
			result.verifiedAuth.registerAttempted = true;
		}
		if (isRegisterPage && isSubmitAction) {
			result.verifiedAuth.registerAttempted = true;
			if (isSuccess && outcome.urlAfter && !/regist|signup/.test(outcome.urlAfter.toLowerCase())) {
				result.verifiedAuth.registerSucceeded = true;
			}
		}

		// --- Search detection ---
		const isSearchAction = /search|query|find/.test(stepTarget + stepLabel) || step.action === 'type' && /search|query/.test(stepValue);
		if (isSearchAction) {
			if (isSuccess) result.verifiedFeatures.search = true;
			else result.brokenFeatures.search = true;
		}

		// --- Payment / checkout detection ---
		const isPaymentAction = /cart|checkout|payment|pay|purchase|buy/.test(stepUrl + stepTarget + stepLabel);
		if (isPaymentAction && (step.action === 'click' || step.action === 'fill')) {
			if (isSuccess) result.verifiedFeatures.payment = true;
			else result.brokenFeatures.payment = true;
		}

		// --- Form submission detection ---
		if (step.action === 'fill' || step.action === 'select') {
			// If a subsequent submit or click happened and succeeded
			if (i + 1 < steps.length) {
				const next = steps[i + 1];
				if (next.action === 'click' && next.outcome?.status === 'success') {
					result.verifiedFeatures.formSubmission = true;
				} else if (next.action === 'click' && next.outcome?.status === 'failed') {
					result.brokenFeatures.formSubmission = true;
				}
			}
		}

		// --- Media upload detection ---
		const isUploadAction = /upload|file|attach|media/.test(stepTarget + stepLabel + stepUrl);
		if (isUploadAction && (step.action === 'click' || step.action === 'fill')) {
			if (isSuccess) result.verifiedFeatures.mediaUpload = true;
		}
	}

	// Calculate success rate
	if (result.totalActions > 0) {
		result.successRate = result.successfulActions / result.totalActions;
	}

	return result;
}

/**
 * Extracts a structured inventory of what the agent observed.
 * This is the "actual features" side of the comparison.
 *
 * Now also returns an `explorationConfidence` score (0-1) that reflects
 * how thoroughly the agent explored — low page count / few steps = low
 * confidence in any feature gap conclusions.
 */
export function extractAppInventory(session) {
	const steps = session.capturedSteps ?? [];
	const activities = session.activities ?? [];
	const findings = session.findings ?? [];
	const report = session.report ?? {};
	const todos = session.todos ?? [];

	// Distinct pages visited (derive from step URLs AND navigation outcomes)
	const urlSet = new Set();
	for (const step of steps) {
		if (step.url) {
			try {
				const u = new URL(step.url, session.targetUrl);
				// Normalize: strip query params, trailing slashes
				urlSet.add(u.pathname.replace(/\/$/, '') || '/');
			} catch { /* skip invalid URLs */ }
		}
		// Also include pages navigated TO (urlAfter)
		if (step.outcome?.urlAfter) {
			try {
				const u = new URL(step.outcome.urlAfter, session.targetUrl);
				urlSet.add(u.pathname.replace(/\/$/, '') || '/');
			} catch { /* skip */ }
		}
	}
	const pages = [...urlSet].sort();

	// Form interactions detected (fill/select on form fields)
	const formInteractions = steps.filter(s =>
		['fill', 'select', 'check'].includes(s.action)
	);
	const formFields = [...new Set(formInteractions.map(s => s.target?.replace(/[#.]/g, '')))];

	// Auth indicators
	const hasLogin = pages.some(p => /login|signin|sign-in|auth/i.test(p)) ||
		formFields.some(f => /password|passwd|email.*login|username/i.test(f));
	const hasLogout = activities.some(a => /logout|sign out|signout/i.test(a.detail || a.label || ''));
	const hasRegister = pages.some(p => /register|signup|sign-up|create.account/i.test(p));

	// Navigation / structure indicators
	const hasSearch = activities.some(a => /search/i.test(a.detail || a.summary || ''));
	const hasDashboard = pages.some(p => /dashboard|admin|panel|home|app/i.test(p));
	const hasSettings = pages.some(p => /settings|profile|account|preferences/i.test(p));
	const hasPayment = activities.some(a => /payment|checkout|billing|stripe|paypal|card/i.test(a.detail || a.summary || '')) ||
		pages.some(p => /payment|checkout|billing|cart|order/i.test(p));

	// Communication features
	const hasContact = activities.some(a => /contact|support|help|feedback|message/i.test(a.detail || a.summary || ''));
	const hasNotifications = activities.some(a => /notif|alert|inbox|message/i.test(a.detail || a.summary || ''));

	// Content type indicators
	const hasApiDocs = pages.some(p => /api|docs|swagger|developer/i.test(p));
	const hasMedia = activities.some(a => /upload|image|video|file|download/i.test(a.detail || a.summary || ''));

	// App type signals
	const isEcommerce = hasPayment || activities.some(a => /product|cart|order|shop|store/i.test(a.detail || ''));
	const isSaaS = hasDashboard && hasLogin;
	const isMarketing = pages.length <= 5 && !hasLogin && !hasDashboard && !activities.some(a => /article|blog post|news story/i.test(a.detail || ''));
	const isSocial = activities.some(a => /profile|follow|friend|post|feed|timeline|like|comment/i.test(a.detail || ''));

	// Finding categories present
	const findingCategories = [...new Set(findings.map(f => f.category))];

	// Report signals
	const coveredAreas = report.covered ?? [];
	const notCoveredAreas = report.notCovered ?? [];

	// Pending todos = features the agent planned to test but didn't
	const pendingTodos = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');

	// ── Exploration Confidence ──
	// Scales gap confidence based on how thoroughly the agent explored.
	// < 5 steps = barely looked (0.2), 30+ steps = thorough (1.0).
	const stepCount = steps.length;
	const pageCount = pages.length;
	let explorationConfidence;
	if (stepCount >= 40 && pageCount >= 6) {
		explorationConfidence = 1.0;
	} else if (stepCount >= 20 && pageCount >= 4) {
		explorationConfidence = 0.8;
	} else if (stepCount >= 10 && pageCount >= 2) {
		explorationConfidence = 0.6;
	} else if (stepCount >= 5) {
		explorationConfidence = 0.4;
	} else {
		explorationConfidence = 0.2;
	}

	// B2: Extract behavioral evidence from step outcomes
	const interactions = extractInteractiveSignals(steps);

	return {
		pages,
		pageCount,
		formFields,
		auth: { hasLogin, hasLogout, hasRegister },
		capabilities: {
			search: hasSearch,
			dashboard: hasDashboard,
			settings: hasSettings,
			payment: hasPayment,
			contact: hasContact,
			notifications: hasNotifications,
			media: hasMedia,
			apiDocs: hasApiDocs
		},
		interactions,
		appType: {
			ecommerce: isEcommerce,
			saas: isSaaS,
			marketing: isMarketing,
			social: isSocial
		},
		findingCategories,
		coveredAreas,
		notCoveredAreas,
		pendingTodos: pendingTodos.map(t => t.text || t.content),
		explorationDepth: stepCount,
		explorationConfidence,
		hasReport: Boolean(report.summary),
		reportSummary: report.summary || ''
	};
}

/* ── Phase 1b: Purpose Understanding ─────────────────────────── */

/**
 * PURPOSE CATALOG
 *
 * Each purpose defines:
 *   - signals: keywords/indicators that suggest this purpose
 *   - userGenerated: whether end-users create accounts (affects whether
 *     registration is expected)
 *   - expectedFeatures: purpose-specific feature set (beyond generic ones)
 *   - excludeFeatures: features that should NOT be expected for this purpose
 */
export const PURPOSE_CATALOG = [
	{
		id: 'crm',
		name: 'CRM / Customer Relationship Management',
		signals: ['crm', 'lead', 'pipeline', 'deal', 'contact', 'prospect', 'opportunity', 'sales funnel', 'customer'],
		userGenerated: false, // CRM users are employees, not self-registering customers
		expectedFeatures: [
			{ feature: 'Contact/company management', category: 'data', severity: 'critical' },
			{ feature: 'Pipeline or deal tracking', category: 'workflow', severity: 'high' },
			{ feature: 'Activity logging / notes', category: 'workflow', severity: 'medium' },
			{ feature: 'Data export (CSV/Excel)', category: 'data', severity: 'medium' }
		],
		excludeFeatures: ['User registration / sign up']
	},
	{
		id: 'admin_dashboard',
		name: 'Internal Admin Dashboard',
		signals: ['admin', 'panel', 'internal', 'management', 'console', 'backoffice', 'operations'],
		userGenerated: false,
		expectedFeatures: [
			{ feature: 'User/role management', category: 'user_management', severity: 'high' },
			{ feature: 'Data tables with pagination', category: 'ui', severity: 'medium' },
			{ feature: 'Audit log / activity history', category: 'security', severity: 'medium' }
		],
		excludeFeatures: ['User registration / sign up']
	},
	{
		id: 'ecommerce',
		name: 'E-commerce / Online Store',
		signals: ['product', 'cart', 'checkout', 'shop', 'store', 'order', 'price', 'shipping'],
		userGenerated: true,
		expectedFeatures: [
			{ feature: 'Product catalog browsing', category: 'commerce', severity: 'critical' },
			{ feature: 'Shopping cart', category: 'commerce', severity: 'critical' },
			{ feature: 'Checkout / payment flow', category: 'commerce', severity: 'critical' },
			{ feature: 'Product search', category: 'discovery', severity: 'high' },
			{ feature: 'Order history', category: 'commerce', severity: 'medium' }
		],
		excludeFeatures: []
	},
	{
		id: 'saas_platform',
		name: 'SaaS Application',
		signals: ['dashboard', 'workspace', 'project', 'team', 'subscription', 'plan', 'workspace', 'collaboration'],
		userGenerated: true,
		expectedFeatures: [
			{ feature: 'User settings / profile', category: 'user_management', severity: 'high' },
			{ feature: 'Team/workspace management', category: 'user_management', severity: 'medium' },
			{ feature: 'Notifications', category: 'engagement', severity: 'low' }
		],
		excludeFeatures: []
	},
	{
		id: 'marketing',
		name: 'Marketing / Landing Page',
		signals: ['pricing', 'newsletter', 'subscribe', 'get started', 'try free', 'sign up free', 'book a demo', 'request demo', 'our services', 'why choose us', 'testimonial'],
		userGenerated: false,
		expectedFeatures: [
			{ feature: 'Contact form', category: 'communication', severity: 'medium' },
			{ feature: 'Privacy policy link', category: 'legal', severity: 'low' }
		],
		excludeFeatures: ['User registration / sign up', 'Logout / sign out']
	},
	{
		id: 'content',
		name: 'Content / Blog / Documentation / Wiki',
		signals: ['blog', 'article', 'documentation', 'docs', 'guide', 'tutorial', 'help', 'wiki', 'encyclopedia', 'news', 'reference', 'manual', 'read', 'search'],
		userGenerated: false,
		expectedFeatures: [
			{ feature: 'Search functionality', category: 'discovery', severity: 'medium' },
			{ feature: 'Table of contents / navigation', category: 'navigation', severity: 'low' },
			{ feature: 'Categories / tags', category: 'navigation', severity: 'low' }
		],
		excludeFeatures: ['User registration / sign up']
	},
	{
		id: 'social',
		name: 'Social Platform',
		signals: ['profile', 'follow', 'friend', 'post', 'feed', 'timeline', 'like', 'comment', 'share', 'community'],
		userGenerated: true,
		expectedFeatures: [
			{ feature: 'User profiles', category: 'social', severity: 'high' },
			{ feature: 'Feed / timeline', category: 'social', severity: 'high' },
			{ feature: 'Follow / connection system', category: 'social', severity: 'high' }
		],
		excludeFeatures: []
	},
	{
		id: 'cms',
		name: 'CMS / Content Management System',
		signals: ['cms', 'wp-admin', 'content management', 'editor', 'media library', 'publish', 'draft', 'wordpress', 'drupal', 'joomla', 'content management system'],
		userGenerated: false,
		expectedFeatures: [
			{ feature: 'Content editor', category: 'content', severity: 'critical' },
			{ feature: 'Media library', category: 'content', severity: 'medium' },
			{ feature: 'Draft / publish workflow', category: 'workflow', severity: 'high' },
			{ feature: 'Content versioning', category: 'content', severity: 'medium' }
		],
		excludeFeatures: ['User registration / sign up']
	},
	{
		id: 'project_management',
		name: 'Project Management / Issue Tracker',
		signals: ['project', 'task', 'issue', 'sprint', 'kanban', 'backlog', 'ticket', 'milestone', 'epic', 'story', 'board', 'assignee', 'jira', 'trello'],
		userGenerated: true,
		expectedFeatures: [
			{ feature: 'Task / issue creation', category: 'task_management', severity: 'critical' },
			{ feature: 'Board / kanban view', category: 'task_management', severity: 'high' },
			{ feature: 'Task assignment', category: 'task_management', severity: 'high' },
			{ feature: 'Sprint / milestone tracking', category: 'task_management', severity: 'medium' },
			{ feature: 'Labels / tags / categories', category: 'task_management', severity: 'medium' }
		],
		excludeFeatures: []
	},
	{
		id: 'developer_platform',
		name: 'Developer Platform / Code Hosting',
		signals: ['code', 'repository', 'repo', 'commit', 'branch', 'pull request', 'merge', 'pipeline', 'ci', 'cd', 'deploy', 'build', 'release', 'docker', 'kubernetes', 'api key', 'webhook', 'github', 'gitlab'],
		userGenerated: true,
		expectedFeatures: [
			{ feature: 'Repository / project creation', category: 'developer', severity: 'critical' },
			{ feature: 'Code browsing', category: 'developer', severity: 'high' },
			{ feature: 'Branch / version management', category: 'developer', severity: 'high' },
			{ feature: 'Pull request / merge request flow', category: 'developer', severity: 'high' },
			{ feature: 'CI/CD pipeline configuration', category: 'developer', severity: 'medium' }
		],
		excludeFeatures: []
	},
	{
		id: 'productivity',
		name: 'Productivity / Note-taking / Knowledge Base',
		signals: ['note', 'document', 'wiki', 'knowledge', 'page', 'workspace', 'collaboration', 'edit', 'template', 'notion', 'confluence', 'outline', 'calendar', 'reminder', 'task'],
		userGenerated: true,
		expectedFeatures: [
			{ feature: 'Document / note creation', category: 'content', severity: 'critical' },
			{ feature: 'Rich text editor', category: 'content', severity: 'high' },
			{ feature: 'Search across documents', category: 'discovery', severity: 'high' },
			{ feature: 'Templates', category: 'content', severity: 'medium' },
			{ feature: 'Sharing / collaboration', category: 'collaboration', severity: 'medium' }
		],
		excludeFeatures: []
	}
];

/**
 * Infers the application's purpose from exploration data.
 *
 * This is the KEY differentiator: instead of "has login → expect registration",
 * it reasons: "has login + admin signals → internal tool → registration NOT expected".
 *
 * @param {object} inventory — from extractAppInventory
 * @param {object} session — full session (for report summary text)
 * @returns {{ id, name, confidence, signals: string[], userGenerated }}
 */
export function inferAppPurpose(inventory, session) {
	const allText = [
		session?.report?.summary || '',
		...inventory.pages,
		...(session?.activities ?? []).map(a => `${a.detail || ''} ${a.summary || ''}`),
		...(session?.todos ?? []).map(t => t.text || t.content || '')
	].join(' ').toLowerCase();

	const scores = [];

	for (const purpose of PURPOSE_CATALOG) {
		let matchCount = 0;
		const matchedSignals = [];

		for (const signal of purpose.signals) {
			if (allText.includes(signal.toLowerCase())) {
				matchCount++;
				matchedSignals.push(signal);
			}
		}

		// Also check structural indicators
		if (purpose.id === 'admin_dashboard' && inventory.pages.some(p => /admin|panel|console/i.test(p))) {
			matchCount++;
			matchedSignals.push('admin URL pattern');
		}
		if (purpose.id === 'ecommerce' && inventory.capabilities.payment) {
			matchCount += 2; // payment is a strong signal
			matchedSignals.push('payment detected');
		}
		// B2: Verified payment flow — strongest ecommerce signal
		if (purpose.id === 'ecommerce' && inventory.interactions?.verifiedFeatures?.payment) {
			matchCount += 3;
			matchedSignals.push('payment flow verified via interaction');
		}
		if (purpose.id === 'saas_platform' && inventory.appType.saas) {
			matchCount++;
			matchedSignals.push('dashboard + auth');
		}
		// B2: Verified login + dashboard transition — strongest SaaS signal
		if (purpose.id === 'saas_platform' && inventory.interactions?.verifiedAuth?.loginSucceeded) {
			matchCount += 3;
			matchedSignals.push('login verified, reached authenticated area');
		}
		if (purpose.id === 'admin_dashboard' && inventory.interactions?.verifiedAuth?.loginSucceeded) {
			matchCount += 2;
			matchedSignals.push('login verified, admin access confirmed');
		}
		if (purpose.id === 'marketing' && inventory.appType.marketing) {
			matchCount++;
			matchedSignals.push('few pages, no auth');
		}
		if (purpose.id === 'project_management' && inventory.pages.some(p => /board|kanban|backlog|sprint|ticket/i.test(p))) {
			matchCount += 2;
			matchedSignals.push('PM URL pattern');
		}
		if (purpose.id === 'developer_platform' && inventory.pages.some(p => /repo|commit|branch|pull-request|merge-request|pipeline/i.test(p))) {
			matchCount += 2;
			matchedSignals.push('dev platform URL pattern');
		}
		if (purpose.id === 'cms' && inventory.pages.some(p => /wp-admin|\/admin\/|\/dashboard\/.*(?:post|page|content)/i.test(p))) {
			matchCount++;
			matchedSignals.push('CMS URL pattern');
		}
		if (purpose.id === 'productivity' && inventory.pages.some(p => /note|doc|wiki|knowledge/i.test(p))) {
			matchCount++;
			matchedSignals.push('productivity URL pattern');
		}
		// Content sites: many article-like pages + no login = likely content/wiki/docs
		if (purpose.id === 'content' && !inventory.auth.hasLogin && inventory.pages.length > 3) {
			matchCount++;
			matchedSignals.push('many pages, no auth');
		}

		if (matchCount > 0) {
			// Confidence: scaled by match count, capped at 1.0
			const confidence = Math.min(1.0, matchCount / 3);
			scores.push({ ...purpose, confidence, matchCount, matchedSignals });
		}
	}

	// ── Marketing site detection ──
	// A marketing site *describes* a product but doesn't *implement* it.
	// Strong structural signals: pricing page + sign-up CTA + about/contact
	// pages, but NO actual product functionality (no real cart, no dashboard
	// behind login, no kanban board, no code repository).
	// This check runs AFTER purpose scoring so it can override false positives
	// where a product's marketing copy (e.g., Stripe.com) matches product keywords.
	const hasPricingPage = inventory.pages.some(p => /pricing|plans/i.test(p));
	const hasAboutPage = inventory.pages.some(p => /about|company/i.test(p));
	const hasContactPage = inventory.pages.some(p => /contact/i.test(p));
	const hasSignUpCTA = (session?.activities ?? []).some(a => /sign up|get started|try free|book a demo|start free/i.test(a.detail || ''));

	// Marketing detection: pricing + about + signup but NO authenticated product areas
	// Key differentiator: marketing sites may have a /login link but it goes to
	// the actual product, not an auth form on the same site. If there's no
	// dashboard/workspace/board behind that login, it's still marketing.
	const hasFunctionalAuth = inventory.auth.hasLogin && inventory.capabilities.dashboard;
	const marketingStructuralCount = [hasPricingPage, hasAboutPage, hasContactPage, hasSignUpCTA].filter(Boolean).length;
	const isLikelyMarketingSite = marketingStructuralCount >= 2 && !hasFunctionalAuth;

	if (isLikelyMarketingSite) {
		// Only override if current top match isn't already marketing
		// AND the top match is a "product" type that marketing copy often mimics
		const productTypesThatLookLikeMarketing = ['ecommerce', 'developer_platform', 'saas_platform', 'cms', 'crm'];
		const currentTop = scores[0];
		if (currentTop && productTypesThatLookLikeMarketing.includes(currentTop.id)) {
			// Check: does the site have ACTUAL product functionality?
			// E.g., real cart pages, real repo browser, real dashboard behind auth
			// Marketing sites typically have /pricing but NOT /dashboard, /cart, /board
			const hasRealProductPages = inventory.pages.some(p =>
				/dashboard|cart|board|kanban|backlog|repo|pipeline|pull-request|merge-request|issue|ticket|inbox|workspace/i.test(p)
			);
			if (!hasRealProductPages) {
				// This is likely marketing copy for a product, not the product itself
				const marketingTemplate = PURPOSE_CATALOG.find(p => p.id === 'marketing');
				if (marketingTemplate) {
					scores.unshift({
						...marketingTemplate,
						confidence: Math.min(1.0, (currentTop.matchCount + marketingStructuralCount) / 4),
						matchCount: currentTop.matchCount + marketingStructuralCount,
						matchedSignals: [...currentTop.matchedSignals, 'marketing structure (pricing+about+no auth)'],
					});
				}
			}
		}

		// Also boost existing marketing score
		const marketingEntry = scores.find(s => s.id === 'marketing');
		if (marketingEntry && scores[0]?.id !== 'marketing') {
			marketingEntry.matchCount += marketingStructuralCount;
			marketingEntry.confidence = Math.min(1.0, marketingEntry.matchCount / 3);
		}
	}

	// Sort by score
	scores.sort((a, b) => b.matchCount - a.matchCount);

	if (scores.length === 0) {
		// No strong signals — return generic purpose
		return {
			id: 'generic',
			name: 'Generic Web Application',
			confidence: 0.3,
			signals: [],
			userGenerated: inventory.auth.hasLogin,
			expectedFeatures: [],
			excludeFeatures: []
		};
	}

	const best = scores[0];
	return {
		id: best.id,
		name: best.name,
		confidence: best.confidence * inventory.explorationConfidence,
		signals: best.matchedSignals,
		userGenerated: best.userGenerated,
		expectedFeatures: best.expectedFeatures || [],
		excludeFeatures: best.excludeFeatures || []
	};
}

/* ── Phase 2: Purpose-Driven Expected Features ───────────────── */

/**
 * Generates the expected feature set based on the app's PURPOSE, not
 * just its type. Purpose understanding prevents false positives like
 * expecting user registration on an internal admin dashboard.
 *
 * Flow: Understand Purpose → Infer Required Capabilities → Compare
 *
 * @param {object} inventory — from extractAppInventory
 * @param {object} [purpose] — from inferAppPurpose (optional; inferred if absent)
 * @returns {{ expected: object[], purpose: object }}
 */
export function generateExpectedFeatures(inventory, purpose = null, session = null) {
	const expected = [];

	// Infer purpose if not provided
	if (!purpose) {
		purpose = inferAppPurpose(inventory, session);
	}

	const { auth, capabilities } = inventory;
	const expConf = inventory.explorationConfidence || 0.5;

	// Helper: scale confidence by both purpose confidence and exploration depth
	const conf = (base) => Math.round(base * purpose.confidence * expConf * 100) / 100;

	// ── Auth expectations (purpose-aware) ──
	if (auth.hasLogin) {
		// Registration: only expected if app is user-generated (public-facing)
		if (!auth.hasRegister && purpose.userGenerated && !purpose.excludeFeatures.includes('User registration / sign up')) {
			expected.push({
				feature: 'User registration / sign up',
				category: 'authentication',
				whyExpected: `This is a ${purpose.name} where users create their own accounts, but no registration flow was found.`,
				impact: 'New users cannot create accounts, blocking all user acquisition.',
				severity: 'high',
				confidence: conf(0.8)
			});
		}

		// Logout: expected for all authenticated apps
		if (!auth.hasLogout && !purpose.excludeFeatures.includes('Logout / sign out')) {
			expected.push({
				feature: 'Logout / sign out',
				category: 'authentication',
				whyExpected: 'A login system exists but no logout action was detected.',
				impact: 'Users on shared devices cannot securely end their session.',
				severity: 'high',
				confidence: conf(0.75)
			});
		}

		// Password reset: expected for user-generated apps, optional for internal
		if (purpose.userGenerated) {
			expected.push({
				feature: 'Password reset / forgot password',
				category: 'authentication',
				whyExpected: `This ${purpose.name} allows user accounts but no password recovery flow was found.`,
				impact: 'Users who forget their password cannot regain access to their account.',
				severity: 'high',
				confidence: conf(0.7)
			});
		}
	}

	// ── Purpose-specific expectations ──
	for (const pf of purpose.expectedFeatures) {
		// Skip if this capability already exists
		const featureLower = pf.feature.toLowerCase();
		const alreadyExists = inventory.capabilities[featureLower] ||
			inventory.pages.some(p => p.includes(featureLower.split(' ')[0])) ||
			inventory.coveredAreas.some(a => a.toLowerCase().includes(featureLower.split(' ')[0]));

		if (alreadyExists) continue;

		expected.push({
			feature: pf.feature,
			category: pf.category,
			whyExpected: `This appears to be a ${purpose.name}. ${pf.feature} is a standard capability for this type of application.`,
			impact: `Without ${pf.feature}, the application cannot fulfill its core purpose effectively.`,
			severity: pf.severity,
			confidence: conf(0.6)
		});
	}

	// ── Generic expectations ──

	// Settings/profile for authenticated apps
	if (auth.hasLogin && !capabilities.settings && purpose.userGenerated) {
		expected.push({
			feature: 'Account settings / profile management',
			category: 'user_management',
			whyExpected: `Users of this ${purpose.name} should be able to manage their profile and preferences.`,
			impact: 'Users cannot change their name, email, password, or preferences.',
			severity: 'medium',
			confidence: conf(0.55)
		});
	}

	// Form validation
	if (inventory.formFields.length > 0) {
		expected.push({
			feature: 'Form validation and error handling',
			category: 'forms',
			whyExpected: 'Forms were detected but no systematic validation patterns were observed.',
			impact: 'Users may submit invalid data, leading to errors or data corruption.',
			severity: 'medium',
			confidence: conf(0.5)
		});
	}

	// Pending todos — the agent planned to test these but couldn't
	for (const todo of inventory.pendingTodos) {
		expected.push({
			feature: todo,
			category: 'untested',
			whyExpected: `The QA agent planned to test this but could not complete it: "${todo}"`,
			impact: 'This feature may not exist or may not be accessible.',
			severity: 'medium',
			confidence: conf(0.45)
		});
	}

	return { expected, purpose };
}

/* ── Phase 3: Gap Detection ──────────────────────────────────── */

/**
 * Compares expected features against the actual inventory to find gaps.
 * A gap is an expected feature that has no evidence of existing.
 */
export function detectFeatureGaps(expected, inventory) {
	const gaps = [];

	for (const expected_feature of expected) {
		// Skip if the feature was explicitly covered (agent confirmed it works)
		const wasCovered = inventory.coveredAreas.some(area =>
			featureMatchesArea(expected_feature.feature, area)
		);
		if (wasCovered) continue;

		// Skip if there's already a finding about this feature being broken
		// (that's a bug, not a gap — it exists but is broken)
		const hasFinding = inventory.findingCategories.some(cat =>
			expected_feature.category === cat
		);

		// Skip if the feature is already detected as a capability
		// (e.g., search, dashboard, settings, payment, contact)
		const featureLower = expected_feature.feature.toLowerCase();
		const existsAsCapability = Object.entries(inventory.capabilities).some(([cap, has]) => {
			if (!has) return false;
			// Match "search functionality" → capabilities.search
			// Match "product catalog browsing" → not a capability, skip
			return featureLower.includes(cap) && cap.length > 3;
		});
		if (existsAsCapability) continue;

		// Skip if a page URL clearly contains the feature name
		// (e.g., expected "settings" and /settings page was visited)
		const existsAsPage = inventory.pages.some(p =>
			p.includes(featureLower.split(' ')[0]) && featureLower.split(' ')[0].length > 3
		);
		if (existsAsPage) continue;

		gaps.push({
			id: randomUUID(),
			feature: expected_feature.feature,
			category: expected_feature.category,
			whyExpected: expected_feature.whyExpected,
			impact: expected_feature.impact,
			severity: expected_feature.severity,
			confidence: hasFinding ? expected_feature.confidence * 0.5 : expected_feature.confidence,
			evidence: buildGapEvidence(expected_feature, inventory),
			recommendation: buildGapRecommendation(expected_feature),
			fixPrompt: buildGapFixPrompt(expected_feature),
			isExistingButBroken: hasFinding
		});
	}

	return gaps;
}

/**
 * Checks if an expected feature name loosely matches a covered area.
 */
function featureMatchesArea(feature, area) {
	const f = feature.toLowerCase();
	const a = area.toLowerCase();
	// Check for keyword overlap
	const featureWords = f.split(/\s+/).filter(w => w.length > 3);
	return featureWords.some(word => a.includes(word));
}

function buildGapEvidence(expected, inventory) {
	const parts = [];
	parts.push(`Expected feature: ${expected.feature}`);

	if (inventory.auth.hasLogin) parts.push('Login detected');
	if (inventory.appType.saas) parts.push('App type: SaaS (has dashboard + auth)');
	if (inventory.appType.ecommerce) parts.push('App type: e-commerce (has payment/cart)');
	if (inventory.pendingTodos.length > 0) parts.push(`${inventory.pendingTodos.length} planned tests not completed`);

	return parts.join('. ');
}

function buildGapRecommendation(expected) {
	const recs = {
		'authentication': `Implement ${expected.feature}: add the necessary routes, UI components, and backend logic.`,
		'user_management': `Add a settings page where users can manage their ${expected.feature.toLowerCase()}.`,
		'discovery': `Add ${expected.feature} functionality with a search input, backend query, and results display.`,
		'commerce': `Implement ${expected.feature} to support the e-commerce flow.`,
		'forms': `Add client-side and server-side validation to all forms with clear error messages.`,
		'engagement': `Add ${expected.feature} to keep users informed of important events.`,
		'untested': `Investigate whether ${expected.feature} exists and is accessible. If it exists, test it. If not, implement it.`
	};
	return recs[expected.category] || `Implement ${expected.feature}.`;
}

function buildGapFixPrompt(expected) {
	return `Implement: ${expected.feature}. Reason: ${expected.whyExpected} Impact: ${expected.impact} Approach: ${buildGapRecommendation(expected)}`;
}

/* ── Mission Context: Context-Driven Expected Features ───────── */

/**
 * CONTEXT FEATURE MAP
 *
 * Maps keywords from a build prompt to expected features.
 * Context-derived expectations carry confidence=1.0 (ground truth) because
 * they come from the stated intent, not from inference.
 *
 * This is the "understand intent" capability — given "Build a CRM with leads",
 * we know to expect contacts, pipeline, deals BEFORE exploring.
 */
const CONTEXT_KEYWORD_MAP = [
	{
		keywords: ['auth', 'login', 'signin', 'sign in', 'sign-in', 'authentication'],
		features: [
			{ feature: 'Login / authentication', category: 'authentication', severity: 'critical', whyExpected: 'Build prompt mentions authentication.' },
			{ feature: 'Password reset / forgot password', category: 'authentication', severity: 'high', whyExpected: 'Authentication was requested — password reset is expected.' },
			{ feature: 'Session management / logout', category: 'authentication', severity: 'high', whyExpected: 'Authentication was requested — logout is expected.' }
		]
	},
	{
		keywords: ['register', 'registration', 'signup', 'sign up', 'sign-up', 'account creation'],
		features: [
			{ feature: 'User registration / sign up', category: 'authentication', severity: 'critical', whyExpected: 'Build prompt mentions registration.' }
		]
	},
	{
		keywords: ['crm', 'lead', 'pipeline', 'deal', 'opportunity', 'prospect'],
		features: [
			{ feature: 'Contact / company management', category: 'data', severity: 'critical', whyExpected: 'CRM requires contact management.' },
			{ feature: 'Pipeline or deal tracking', category: 'workflow', severity: 'high', whyExpected: 'CRM requires pipeline management.' },
			{ feature: 'Activity logging / notes', category: 'workflow', severity: 'medium', whyExpected: 'CRM requires activity tracking.' },
			{ feature: 'Data export (CSV/Excel)', category: 'data', severity: 'medium', whyExpected: 'CRM data should be exportable.' }
		]
	},
	{
		keywords: ['shop', 'store', 'ecommerce', 'e-commerce', 'cart', 'checkout', 'product'],
		features: [
			{ feature: 'Product browsing / catalog', category: 'commerce', severity: 'critical', whyExpected: 'E-commerce requires product browsing.' },
			{ feature: 'Shopping cart', category: 'commerce', severity: 'critical', whyExpected: 'E-commerce requires a cart.' },
			{ feature: 'Checkout / payment processing', category: 'commerce', severity: 'critical', whyExpected: 'E-commerce requires checkout.' },
			{ feature: 'Order confirmation / receipt', category: 'commerce', severity: 'high', whyExpected: 'E-commerce requires order confirmation.' }
		]
	},
	{
		keywords: ['blog', 'post', 'article', 'cms', 'content management'],
		features: [
			{ feature: 'Content creation / editor', category: 'content', severity: 'critical', whyExpected: 'CMS requires content creation.' },
			{ feature: 'Content listing / archive', category: 'content', severity: 'high', whyExpected: 'CMS requires content listing.' },
			{ feature: 'Categories / tags', category: 'content', severity: 'medium', whyExpected: 'CMS typically has categorization.' }
		]
	},
	{
		keywords: ['dashboard', 'admin', 'analytics', 'metrics', 'reporting', 'panel'],
		features: [
			{ feature: 'Dashboard with metrics / data visualization', category: 'ui', severity: 'high', whyExpected: 'Dashboard requires data display.' },
			{ feature: 'Data filtering / search', category: 'ui', severity: 'medium', whyExpected: 'Dashboard requires data filtering.' },
			{ feature: 'User / role management', category: 'user_management', severity: 'medium', whyExpected: 'Admin panel requires user management.' }
		]
	},
	{
		keywords: ['task', 'todo', 'project management', 'kanban', 'board', 'sprint'],
		features: [
			{ feature: 'Task creation', category: 'workflow', severity: 'critical', whyExpected: 'Task management requires task creation.' },
			{ feature: 'Task assignment', category: 'workflow', severity: 'high', whyExpected: 'Task management requires assignment.' },
			{ feature: 'Status tracking / workflow states', category: 'workflow', severity: 'high', whyExpected: 'Task management requires status tracking.' }
		]
	},
	{
		keywords: ['chat', 'message', 'messaging', 'communication'],
		features: [
			{ feature: 'Message sending / receiving', category: 'communication', severity: 'critical', whyExpected: 'Messaging requires send/receive.' },
			{ feature: 'Message history / threads', category: 'communication', severity: 'high', whyExpected: 'Messaging requires history.' },
			{ feature: 'Notifications', category: 'communication', severity: 'medium', whyExpected: 'Messaging typically has notifications.' }
		]
	},
	{
		keywords: ['booking', 'reservation', 'appointment', 'schedule', 'calendar'],
		features: [
			{ feature: 'Date / time selection', category: 'workflow', severity: 'critical', whyExpected: 'Booking requires date/time selection.' },
			{ feature: 'Booking confirmation', category: 'workflow', severity: 'high', whyExpected: 'Booking requires confirmation.' },
			{ feature: 'Cancellation / modification', category: 'workflow', severity: 'medium', whyExpected: 'Booking should allow changes.' }
		]
	},
	{
		keywords: ['search', 'filter', 'discover'],
		features: [
			{ feature: 'Search functionality', category: 'discovery', severity: 'high', whyExpected: 'Build prompt mentions search.' },
			{ feature: 'Search results display', category: 'discovery', severity: 'high', whyExpected: 'Search requires results display.' }
		]
	},
	{
		keywords: ['notification', 'email', 'alert'],
		features: [
			{ feature: 'Email notifications', category: 'communication', severity: 'medium', whyExpected: 'Build prompt mentions notifications.' }
		]
	},
	{
		keywords: ['payment', 'billing', 'subscription', 'stripe', 'invoice'],
		features: [
			{ feature: 'Payment processing', category: 'commerce', severity: 'critical', whyExpected: 'Build prompt mentions payments.' },
			{ feature: 'Billing management', category: 'commerce', severity: 'high', whyExpected: 'Payment features require billing management.' },
			{ feature: 'Invoice generation', category: 'commerce', severity: 'medium', whyExpected: 'Billing typically includes invoicing.' }
		]
	},
	{
		keywords: ['upload', 'file', 'media', 'image', 'document'],
		features: [
			{ feature: 'File upload', category: 'data', severity: 'high', whyExpected: 'Build prompt mentions file handling.' },
			{ feature: 'File preview / management', category: 'data', severity: 'medium', whyExpected: 'File upload typically includes management.' }
		]
	},
	{
		keywords: ['profile', 'user profile', 'account', 'settings'],
		features: [
			{ feature: 'User profile page', category: 'user_management', severity: 'high', whyExpected: 'Build prompt mentions profiles.' },
			{ feature: 'Settings / preferences', category: 'user_management', severity: 'medium', whyExpected: 'Profiles typically include settings.' }
		]
	},
	{
		keywords: ['landing', 'marketing', 'home page', 'hero'],
		features: [
			{ feature: 'Call-to-action button', category: 'ui', severity: 'medium', whyExpected: 'Landing pages require CTAs.' },
			{ feature: 'Contact / signup form', category: 'ui', severity: 'medium', whyExpected: 'Landing pages typically have contact forms.' }
		]
	},
	{
		keywords: ['api', 'rest', 'endpoint', 'graphql', 'webhook'],
		features: [
			{ feature: 'API documentation', category: 'developer', severity: 'medium', whyExpected: 'API was requested — documentation expected.' },
			{ feature: 'API authentication', category: 'security', severity: 'high', whyExpected: 'API requires authentication.' }
		]
	}
];

/**
 * Derives expected features from mission context (build prompt + requirements).
 * These carry confidence=1.0 because they are ground truth from stated intent.
 *
 * @param {object} context — { buildPrompt?, requirements?, businessGoals? }
 * @returns {object[]} expected features with confidence=1.0, or [] if no context
 */
export function deriveContextFeatures(context = {}) {
	if (!context || typeof context !== 'object') return [];

	// Combine all context text for keyword matching
	const text = [
		context.buildPrompt || '',
		...(Array.isArray(context.requirements) ? context.requirements : []),
		context.businessGoals || ''
	].join(' ').toLowerCase();

	if (!text.trim()) return [];

	const expected = [];
	const seen = new Set();

	for (const entry of CONTEXT_KEYWORD_MAP) {
		const matched = entry.keywords.some(kw => text.includes(kw));
		if (!matched) continue;

		for (const feat of entry.features) {
			if (seen.has(feat.feature)) continue;
			seen.add(feat.feature);
			expected.push({
				feature: feat.feature,
				category: feat.category,
				severity: feat.severity,
				whyExpected: feat.whyExpected,
				impact: `Missing feature explicitly requested in build context.`,
				confidence: 1.0,  // Ground truth — from stated intent
				source: 'context'
			});
		}
	}

	return expected;
}

/**
 * Reconciles context-derived expectations with heuristic-derived ones.
 * Context wins when they disagree. Discrepancies are logged.
 *
 * @param {object[]} contextFeatures — from deriveContextFeatures (confidence=1.0)
 * @param {object[]} heuristicFeatures — from generateExpectedFeatures
 * @returns {{ merged: object[], discrepancies: object[] }}
 */
export function reconcileFeatures(contextFeatures = [], heuristicFeatures = []) {
	const merged = [];
	const discrepancies = [];
	const contextNames = new Set(contextFeatures.map(f => f.feature.toLowerCase()));

	// Context features always included (ground truth)
	merged.push(...contextFeatures);

	// Add heuristic features that don't duplicate context ones
	for (const hFeat of heuristicFeatures) {
		const hName = hFeat.feature.toLowerCase();
		if (contextNames.has(hName)) {
			// Both context and heuristics agree — this is expected, not a discrepancy
			continue;
		}
		// Heuristic-only feature — check if context strongly implies the OPPOSITE
		// (i.e., context says "no registration needed" but heuristic flags "missing registration")
		// For now, flag features the heuristic detected that context didn't mention as potential discrepancies
		// when the heuristic confidence is high enough to be notable
		if (hFeat.confidence >= 0.7) {
			discrepancies.push({
				feature: hFeat.feature,
				reason: 'Heuristic detected a feature not mentioned in mission context',
				contextImplied: false,
				heuristicDetected: true,
				confidence: hFeat.confidence
			});
		}
		merged.push({ ...hFeat, source: 'heuristic' });
	}

	// Check if context expected something that wasn't detected by heuristic at all
	const heuristicNames = new Set(heuristicFeatures.map(f => f.feature.toLowerCase()));
	for (const cFeat of contextFeatures) {
		const cName = cFeat.feature.toLowerCase();
		if (!heuristicNames.has(cName)) {
			discrepancies.push({
				feature: cFeat.feature,
				reason: 'Context expects this feature but heuristic exploration did not detect it',
				contextImplied: true,
				heuristicDetected: false,
				confidence: cFeat.confidence
			});
		}
	}

	return { merged, discrepancies };
}

/* ── Main Entry Point ────────────────────────────────────────── */

/**
 * Runs the full feature gap analysis on a session.
 *
 * Four phases:
 * 1. Extract inventory (pages, auth, capabilities)
 * 2. Derive context features from mission context (if provided), then
 *    infer purpose, generate purpose-driven expected features
 * 3. Reconcile context + heuristic features, detect feature gaps
 * 4. Analyze user journey workflow gaps (missing steps in the business workflow)
 *
 * @param {object} session — completed session with capturedSteps, activities, findings, report
 * @param {object} [missionContext] — { buildPrompt?, requirements?, businessGoals? }
 * @returns {{ gaps: object[], inventory: object, purpose: object, journey: object[], summary: string, contextFeatures?: object[] }}
 */
export function analyzeFeatureGaps(session, missionContext = null) {
	const inventory = extractAppInventory(session);
	const { expected: heuristicExpected, purpose } = generateExpectedFeatures(inventory, null, session);

	// If mission context is provided, derive ground-truth expectations and reconcile
	let contextFeatures = [];
	let expected = heuristicExpected;
	let discrepancies = [];
	if (missionContext) {
		contextFeatures = deriveContextFeatures(missionContext);
		if (contextFeatures.length > 0) {
			const result = reconcileFeatures(contextFeatures, heuristicExpected);
			expected = result.merged;
			discrepancies = result.discrepancies;
		}
	}

	const featureGaps = detectFeatureGaps(expected, inventory);

	// User Journey Understanding — workflow gaps
	const { gaps: workflowGaps, journey } = analyzeWorkflowGaps(inventory, session, purpose);

	// Merge: workflow gaps are deduped against feature gaps by feature name
	const featureNames = new Set(featureGaps.map(g => g.feature.toLowerCase()));
	const uniqueWorkflowGaps = workflowGaps.filter(wg => !featureNames.has(wg.feature.toLowerCase()));
	const allGaps = [...featureGaps, ...uniqueWorkflowGaps];

	// Sort by severity then confidence
	const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
	allGaps.sort((a, b) => {
		const sevDiff = severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
		if (sevDiff !== 0) return sevDiff;
		return b.confidence - a.confidence;
	});

	const wfCount = uniqueWorkflowGaps.length;
	const ctxCount = contextFeatures.length;
	const summary = allGaps.length === 0
		? `No significant feature gaps detected. App purpose: ${purpose.name} (${Math.round(purpose.confidence * 100)}% confidence).${ctxCount ? ` ${ctxCount} expected feature${ctxCount === 1 ? '' : 's'} from context.` : ''}`
		: `${allGaps.length} gap${allGaps.length === 1 ? '' : 's'} detected for ${purpose.name} (${wfCount} workflow gap${wfCount === 1 ? '' : 's'}). ${allGaps.filter(g => g.severity === 'high').length} high priority. Exploration confidence: ${Math.round(inventory.explorationConfidence * 100)}%.${ctxCount ? ` ${ctxCount} expected feature${ctxCount === 1 ? '' : 's'} from context.` : ''}`;

	const result = { gaps: allGaps, inventory, purpose, journey, summary };
	if (contextFeatures.length > 0) result.contextFeatures = contextFeatures;
	if (discrepancies.length > 0) result.discrepancies = discrepancies;
	return result;
}

/**
 * Optionally enhances the gap analysis with LLM reasoning.
 * Uses the existing callLLM infrastructure.
 *
 * @param {object} session
 * @param {object[]} heuristicGaps — gaps from analyzeFeatureGaps
 * @returns {Promise<object[]>} enhanced gaps with LLM-derived insights
 */
export async function enhanceGapsWithLLM(session, heuristicGaps) {
	const config = getConfig();
	if (!config.model || !config.baseUrl) {
		return heuristicGaps; // Can't call LLM, return heuristic results
	}

	const inventory = extractAppInventory(session);
	const report = session.report ?? {};

	const prompt = `You are a software quality expert analyzing an application for missing features.

Application URL: ${session.targetUrl}
App Type: ${JSON.stringify(inventory.appType)}
Pages Found: ${inventory.pages.join(', ') || 'none'}
Auth: ${JSON.stringify(inventory.auth)}
Capabilities: ${JSON.stringify(inventory.capabilities)}
Report Summary: ${report.summary || 'N/A'}
Areas Covered: ${(report.covered ?? []).join('; ') || 'none'}
Areas Not Covered: ${(report.notCovered ?? []).join('; ') || 'none'}

Based on this data, identify features that SHOULD exist in this application but appear to be MISSING entirely (not bugs — features that don't exist at all).

Return a JSON array of gaps:
[
  {
    "feature": "Feature name",
    "category": "authentication|commerce|user_management|discovery|accessibility|engagement|forms|navigation|security",
    "whyExpected": "Why this feature should exist",
    "impact": "What happens without it",
    "recommendation": "How to implement it",
    "severity": "critical|high|medium|low",
    "confidence": 0.0-1.0
  }
]

Only include features you are confident are genuinely missing. Do not include features that already exist but are broken (those are bugs).`;

	try {
		const response = await callLLM(
			'You are a software quality expert. Respond only with valid JSON.',
			prompt
		);
		const llmGaps = extractJSON(response);

		if (!Array.isArray(llmGaps)) return heuristicGaps;

		// Merge: add LLM gaps that don't duplicate heuristic ones
		const existingFeatures = new Set(heuristicGaps.map(g => g.feature.toLowerCase()));
		const merged = [...heuristicGaps];

		for (const gap of llmGaps) {
			if (!existingFeatures.has(String(gap.feature || '').toLowerCase())) {
				merged.push({
					id: randomUUID(),
					feature: gap.feature,
					category: gap.category || 'general',
					whyExpected: gap.whyExpected || '',
					impact: gap.impact || '',
					severity: gap.severity || 'medium',
					confidence: typeof gap.confidence === 'number' ? gap.confidence : 0.6,
					evidence: `LLM analysis identified this as a potential missing feature.`,
					recommendation: gap.recommendation || `Implement ${gap.feature}.`,
					fixPrompt: `Implement: ${gap.feature}. ${gap.whyExpected || ''} ${gap.recommendation || ''}`,
					isExistingButBroken: false
				});
			}
		}

		// Re-sort
		const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
		merged.sort((a, b) => {
			const sevDiff = severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
			if (sevDiff !== 0) return sevDiff;
			return b.confidence - a.confidence;
		});

		return merged;
	} catch (err) {
		console.error('[featureGap] LLM enhancement failed:', err.message);
		return heuristicGaps;
	}
}

/**
 * Converts feature gaps into findings (for integration with existing store).
 * Each gap becomes a finding with category "missing_feature".
 */
export function gapsToFindings(gaps, session) {
	return gaps.map(gap => ({
		id: gap.id || randomUUID(),
		ts: Date.now(),
		sessionId: session.id,
		projectId: session.projectId,
		title: `Missing feature: ${gap.feature}`,
		severity: gap.severity,
		category: 'missing_feature',
		url: session.targetUrl,
		steps: [],
		expected: gap.whyExpected,
		actual: `Feature not found during exploration. ${gap.evidence}`,
		evidence: gap.evidence,
		// Evidence Engine fields
		observed: `No evidence of "${gap.feature}" found during testing.`,
		impact: gap.impact,
		recommendation: gap.recommendation,
		fixPrompt: gap.fixPrompt,
		confidence: gap.confidence,
		reproducibility: 'confirmed',
		isDuplicate: false,
		tags: ['feature_gap', gap.category]
	}));
}

/* ════════════════════════════════════════════════════════════════════
   Phase 5: User Journey Understanding
   ════════════════════════════════════════════════════════════════════

   Instead of just "Settings missing," QASE reasons:
   "This is a CRM. The user journey is Lead → Contact → Opportunity →
   Deal → Invoice. Opportunity exists, but Deal stage is missing."

   A workflow gap is different from a feature gap:
   - Feature gap: "this feature should exist"
   - Workflow gap: "this step in the user journey exists for steps
     before/after it, but the step itself is missing — the user is
     stuck at a dead end"
   ════════════════════════════════════════════════════════════════════ */

/**
 * WORKFLOW TEMPLATES per purpose.
 *
 * Each template defines a sequence of steps the user is expected to
 * follow through the application. Steps have:
 *   - id: unique identifier
 *   - name: human-readable
 *   - signals: keywords/URL patterns that indicate this step exists
 *   - dependsOn: previous step that should exist for this one to make sense
 *   - severity: gap severity if this step is missing but neighbors exist
 */
const WORKFLOW_TEMPLATES = {
	saas_platform: [
		{ id: 'signup', name: 'Account registration', signals: ['sign up', 'register', 'signup', '/register', '/signup'], dependsOn: [], severity: 'high' },
		{ id: 'email_verify', name: 'Email verification', signals: ['verify', 'verification', 'confirm email', 'email confirm'], dependsOn: ['signup'], severity: 'medium' },
		{ id: 'login', name: 'Login', signals: ['login', 'sign in', '/login', '/signin'], dependsOn: [], severity: 'critical' },
		{ id: 'onboarding', name: 'Onboarding / setup wizard', signals: ['onboarding', 'welcome', 'getting started', 'setup wizard', 'initial setup'], dependsOn: ['login'], severity: 'medium' },
		{ id: 'workspace_create', name: 'Create workspace / project', signals: ['create workspace', 'new project', 'create project', 'new workspace'], dependsOn: ['login'], severity: 'high' },
		{ id: 'invite_team', name: 'Invite team members', signals: ['invite', 'team members', 'add member', 'send invitation'], dependsOn: ['workspace_create'], severity: 'medium' },
		{ id: 'subscription', name: 'Subscription / billing', signals: ['subscription', 'billing', 'plan', 'upgrade', 'payment method', 'stripe'], dependsOn: ['login'], severity: 'high' },
	],
	ecommerce: [
		{ id: 'browse', name: 'Browse product catalog', signals: ['products', 'catalog', 'shop', '/products', '/shop'], dependsOn: [], severity: 'critical' },
		{ id: 'product_detail', name: 'View product details', signals: ['product detail', '/products/', 'product page', 'item details'], dependsOn: ['browse'], severity: 'critical' },
		{ id: 'search', name: 'Search products', signals: ['search', 'search bar', 'find products', '/search'], dependsOn: ['browse'], severity: 'high' },
		{ id: 'add_to_cart', name: 'Add to cart', signals: ['add to cart', 'cart', 'add item', '/cart'], dependsOn: ['product_detail'], severity: 'critical' },
		{ id: 'checkout', name: 'Checkout', signals: ['checkout', 'payment', 'pay', '/checkout'], dependsOn: ['add_to_cart'], severity: 'critical' },
		{ id: 'order_confirm', name: 'Order confirmation', signals: ['order confirmation', 'thank you', 'order placed', 'order success', '/order-confirmation'], dependsOn: ['checkout'], severity: 'high' },
		{ id: 'account_register', name: 'Account registration', signals: ['sign up', 'register', 'signup', '/register'], dependsOn: [], severity: 'medium' },
		{ id: 'order_history', name: 'Order history', signals: ['orders', 'order history', 'past orders', '/orders', 'my orders'], dependsOn: ['account_register'], severity: 'medium' },
	],
	crm: [
		{ id: 'login', name: 'Login', signals: ['login', 'sign in', '/login'], dependsOn: [], severity: 'critical' },
		{ id: 'create_lead', name: 'Create lead', signals: ['lead', 'new lead', 'create lead', '/leads'], dependsOn: ['login'], severity: 'critical' },
		{ id: 'qualify_lead', name: 'Qualify lead → contact', signals: ['contact', 'qualify', 'convert lead', '/contacts'], dependsOn: ['create_lead'], severity: 'high' },
		{ id: 'create_opportunity', name: 'Create opportunity', signals: ['opportunity', 'deal', '/deals', '/opportunities'], dependsOn: ['qualify_lead'], severity: 'high' },
		{ id: 'pipeline_stage', name: 'Move through pipeline stages', signals: ['pipeline', 'stage', 'funnel', 'sales stage', '/pipeline'], dependsOn: ['create_opportunity'], severity: 'high' },
		{ id: 'close_deal', name: 'Close deal (won/lost)', signals: ['close', 'won', 'lost', 'closed', 'deal closed'], dependsOn: ['pipeline_stage'], severity: 'high' },
		{ id: 'invoice', name: 'Generate invoice', signals: ['invoice', 'billing', 'quote', '/invoices'], dependsOn: ['close_deal'], severity: 'medium' },
	],
	project_management: [
		{ id: 'login', name: 'Login', signals: ['login', 'sign in', '/login'], dependsOn: [], severity: 'critical' },
		{ id: 'create_project', name: 'Create project', signals: ['new project', 'create project', '/projects/new'], dependsOn: ['login'], severity: 'critical' },
		{ id: 'create_issue', name: 'Create issue / task', signals: ['new issue', 'create task', 'new ticket', '/issues/new'], dependsOn: ['create_project'], severity: 'critical' },
		{ id: 'assign', name: 'Assign to team member', signals: ['assign', 'assignee', 'assigned to'], dependsOn: ['create_issue'], severity: 'high' },
		{ id: 'board', name: 'View on board (kanban)', signals: ['board', 'kanban', '/board'], dependsOn: ['create_issue'], severity: 'high' },
		{ id: 'sprint', name: 'Plan sprint', signals: ['sprint', 'milestone', '/sprint', '/milestone'], dependsOn: ['board'], severity: 'medium' },
		{ id: 'close_issue', name: 'Close / resolve issue', signals: ['close', 'resolve', 'done', 'completed', 'closed'], dependsOn: ['create_issue'], severity: 'high' },
	],
	admin_dashboard: [
		{ id: 'login', name: 'Login', signals: ['login', 'sign in', '/login'], dependsOn: [], severity: 'critical' },
		{ id: 'view_dashboard', name: 'View overview dashboard', signals: ['dashboard', 'overview', '/panel', '/console'], dependsOn: ['login'], severity: 'critical' },
		{ id: 'manage_users', name: 'Manage users', signals: ['users', 'user management', '/users'], dependsOn: ['login'], severity: 'high' },
		{ id: 'view_audit_log', name: 'View audit log', signals: ['audit', 'log', 'activity log', 'history'], dependsOn: ['login'], severity: 'medium' },
		{ id: 'manage_roles', name: 'Manage roles / permissions', signals: ['roles', 'permissions', 'access control', 'rbac'], dependsOn: ['manage_users'], severity: 'medium' },
	],
	marketing: [
		{ id: 'landing', name: 'Landing page', signals: ['home', 'landing', '/'], dependsOn: [], severity: 'critical' },
		{ id: 'learn_more', name: 'Learn more / features', signals: ['features', 'about', 'how it works', '/about'], dependsOn: ['landing'], severity: 'medium' },
		{ id: 'pricing', name: 'View pricing', signals: ['pricing', 'plans', '/pricing'], dependsOn: ['landing'], severity: 'medium' },
		{ id: 'contact', name: 'Contact form', signals: ['contact', 'get in touch', '/contact'], dependsOn: ['landing'], severity: 'medium' },
		{ id: 'cta_signup', name: 'Call to action → sign up', signals: ['sign up', 'get started', 'try free', '/signup'], dependsOn: ['pricing'], severity: 'high' },
	],
	cms: [
		{ id: 'login', name: 'Admin login', signals: ['login', 'admin', '/wp-admin', '/admin'], dependsOn: [], severity: 'critical' },
		{ id: 'create_content', name: 'Create content / post', signals: ['new post', 'create', 'editor', 'add content', '/post-new'], dependsOn: ['login'], severity: 'critical' },
		{ id: 'edit_content', name: 'Edit existing content', signals: ['edit', 'modify', 'update', '/edit'], dependsOn: ['create_content'], severity: 'high' },
		{ id: 'media_library', name: 'Upload / manage media', signals: ['media', 'upload', 'image', 'file', '/upload'], dependsOn: ['create_content'], severity: 'medium' },
		{ id: 'publish', name: 'Publish / schedule content', signals: ['publish', 'draft', 'schedule', 'live'], dependsOn: ['create_content'], severity: 'high' },
		{ id: 'preview', name: 'Preview before publish', signals: ['preview', 'draft preview', 'view before'], dependsOn: ['create_content'], severity: 'low' },
	],
	developer_platform: [
		{ id: 'login', name: 'Login', signals: ['login', 'sign in', '/login'], dependsOn: [], severity: 'critical' },
		{ id: 'create_repo', name: 'Create repository', signals: ['new repo', 'create repository', 'new project', '/new'], dependsOn: ['login'], severity: 'critical' },
		{ id: 'browse_code', name: 'Browse code', signals: ['tree', 'blob', 'source', 'files', '/tree/', '/blob/'], dependsOn: ['create_repo'], severity: 'critical' },
		{ id: 'commit', name: 'Commit changes', signals: ['commit', 'push', 'changes'], dependsOn: ['browse_code'], severity: 'high' },
		{ id: 'pull_request', name: 'Open pull request', signals: ['pull request', 'merge request', 'pr', '/pull/'], dependsOn: ['commit'], severity: 'high' },
		{ id: 'code_review', name: 'Code review', signals: ['review', 'comment', 'approve', 'changes requested'], dependsOn: ['pull_request'], severity: 'medium' },
		{ id: 'merge', name: 'Merge to main', signals: ['merge', 'merged', 'merge button'], dependsOn: ['pull_request'], severity: 'high' },
		{ id: 'ci_pipeline', name: 'CI/CD pipeline', signals: ['pipeline', 'actions', 'ci', 'cd', 'build', 'deploy', '/actions'], dependsOn: ['merge'], severity: 'medium' },
	],
	productivity: [
		{ id: 'login', name: 'Login', signals: ['login', 'sign in', '/login'], dependsOn: [], severity: 'critical' },
		{ id: 'create_doc', name: 'Create document / note', signals: ['new doc', 'new note', 'create', 'new page', '/new'], dependsOn: ['login'], severity: 'critical' },
		{ id: 'edit_doc', name: 'Edit with rich text editor', signals: ['editor', 'edit', 'rich text', 'formatting'], dependsOn: ['create_doc'], severity: 'high' },
		{ id: 'organize', name: 'Organize into folders / tree', signals: ['folder', 'tree', 'sidebar', 'workspace', 'hierarchy'], dependsOn: ['create_doc'], severity: 'medium' },
		{ id: 'search', name: 'Search across documents', signals: ['search', 'find', 'quick find', '/search'], dependsOn: ['create_doc'], severity: 'high' },
		{ id: 'share', name: 'Share / collaborate', signals: ['share', 'collaborate', 'invite', 'permission'], dependsOn: ['create_doc'], severity: 'medium' },
		{ id: 'template', name: 'Use templates', signals: ['template', 'gallery', 'pre-built'], dependsOn: ['create_doc'], severity: 'low' },
	],
};

// Exported for Phase 2 Application Understanding to consume
export { WORKFLOW_TEMPLATES };

/**
 * Detects which workflow steps are present in the exploration data.
 *
 * @param {object} inventory — from extractAppInventory
 * @param {object} session — full session for activity/report text
 * @param {string} purposeId — which workflow template to use
 * @returns {{ detected: Set<string>, evidence: Map<string, string[]> }}
 */
export function detectWorkflowSteps(inventory, session, purposeId) {
	const template = WORKFLOW_TEMPLATES[purposeId];
	if (!template) return { detected: new Set(), evidence: new Map() };

	const allText = [
		session?.report?.summary || '',
		...inventory.pages,
		...(session?.activities ?? []).map(a => `${a.detail || ''} ${a.summary || ''}`),
		...(session?.todos ?? []).map(t => t.text || t.content || ''),
		...(session?.report?.covered ?? []),
		...(session?.report?.notCovered ?? [])
	].join(' ').toLowerCase();

	const detected = new Set();
	const evidence = new Map();

	for (const step of template) {
		const matched = [];
		for (const signal of step.signals) {
			if (allText.includes(signal.toLowerCase())) {
				matched.push(signal);
			}
		}
		if (matched.length > 0) {
			detected.add(step.id);
			evidence.set(step.id, matched);
		}
	}

	return { detected, evidence };
}

/**
 * Analyzes workflow gaps: steps in the user journey that are missing
 * while their neighbors (before or after) exist.
 *
 * A workflow gap is more significant than a generic feature gap because
 * it means the user is stuck — they can reach step N and step N+2, but
 * not the step in between.
 *
 * @param {object} inventory — from extractAppInventory
 * @param {object} session — full session
 * @param {object} purpose — from inferAppPurpose
 * @returns {{ gaps: object[], journey: object[] }}
 */
export function analyzeWorkflowGaps(inventory, session, purpose) {
	const template = WORKFLOW_TEMPLATES[purpose.id];
	if (!template) return { gaps: [], journey: [] };

	const { detected, evidence } = detectWorkflowSteps(inventory, session, purpose.id);
	const expConf = inventory.explorationConfidence || 0.5;

	// Build journey map: each step annotated with detected status
	const journey = template.map(step => ({
		...step,
		detected: detected.has(step.id),
		evidence: evidence.get(step.id) || []
	}));

	const gaps = [];

	for (const step of template) {
		if (detected.has(step.id)) continue;

		// Check if this step is "in the path" — its dependencies or dependents exist
		const depsExist = step.dependsOn.some(dep => detected.has(dep));
		const nextStepsExist = template
			.filter(s => s.dependsOn.includes(step.id))
			.some(s => detected.has(s.id));

		// Only flag as a workflow gap if at least one neighbor exists
		if (!depsExist && !nextStepsExist) continue;

		// Determine gap context
		const existingBefore = step.dependsOn.filter(d => detected.has(d));
		const existingAfter = template
			.filter(s => s.dependsOn.includes(step.id) && detected.has(s.id))
			.map(s => s.name);

		let context = '';
		if (existingBefore.length > 0 && existingAfter.length > 0) {
			context = `Steps before (${existingBefore.map(b => template.find(t => t.id === b)?.name).join(', ')}) and after (${existingAfter.join(', ')}) exist, but "${step.name}" is missing between them.`;
		} else if (existingBefore.length > 0) {
			context = `Step "${template.find(t => t.id === existingBefore[0])?.name}" was completed, but the next expected step "${step.name}" was not found.`;
		} else if (existingAfter.length > 0) {
			context = `"${existingAfter.join(', ')}" was found, but it typically requires "${step.name}" first.`;
		}

		// Scale confidence: workflow gaps with neighbors on both sides are high confidence
		const neighborCount = (existingBefore.length > 0 ? 1 : 0) + (existingAfter.length > 0 ? 1 : 0);
		const baseConfidence = neighborCount >= 2 ? 0.8 : 0.6;
		const confidence = Math.round(baseConfidence * purpose.confidence * expConf * 100) / 100;

		gaps.push({
			id: randomUUID(),
			feature: `Workflow step missing: ${step.name}`,
			category: 'workflow',
			whyExpected: `In a ${purpose.name}, the user journey includes "${step.name}". ${context}`,
			impact: step.dependsOn.length > 0
				? `Users cannot complete the full workflow without this step. ${existingAfter.length > 0 ? `Downstream steps (${existingAfter.join(', ')}) may not function correctly.` : ''}`
				: `This is an entry point for the user journey. Without it, users may not be able to start the workflow.`,
			severity: step.severity,
			confidence,
			evidence: `Workflow analysis: ${context}`,
			recommendation: `Implement the "${step.name}" step in the user journey. Connect it to ${existingBefore.length > 0 ? 'the preceding steps' : 'the entry point'} and ensure it flows into ${existingAfter.length > 0 ? 'the subsequent steps' : 'the rest of the workflow'}.`,
			fixPrompt: `Implement workflow step: ${step.name}. Context: ${context} This is part of the ${purpose.name} user journey.`,
			isExistingButBroken: false,
			isWorkflowGap: true,
			journeyPosition: template.indexOf(step),
			journeyTotal: template.length
		});
	}

	// Sort: gaps with neighbors on both sides first (highest confidence)
	gaps.sort((a, b) => b.confidence - a.confidence);

	return { gaps, journey };
}
