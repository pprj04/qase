/**
 * Real Application Validation Harness v2
 *
 * Deeper exploration: BFS crawl up to 20+ pages per app, capture
 * structured data on every page (headings, forms, buttons, links,
 * search inputs, navigation items). Report honest metrics.
 *
 * Usage: node tests/validate-real-apps.js
 */
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import {
	analyzeFeatureGaps,
	extractAppInventory,
	inferAppPurpose,
	detectWorkflowSteps,
	analyzeWorkflowGaps,
} from '../server/featureGap.js';

/* ── Test Matrix ─────────────────────────────────────────────────── */

const TEST_APPS = [
	// ── Content / Documentation (5) ──
	{ name: 'Wikipedia', url: 'https://en.wikipedia.org', expected: 'content', category: 'Content' },
	{ name: 'Hacker News', url: 'https://news.ycombinator.com', expected: 'content', category: 'Content' },
	{ name: 'Vue.js Docs', url: 'https://vuejs.org', expected: 'content', category: 'Content' },
	{ name: 'MDN Web Docs', url: 'https://developer.mozilla.org', expected: 'content', category: 'Content' },
	{ name: 'Ghost Blog', url: 'https://demo.ghost.io', expected: 'content', category: 'Content' },

	// ── Marketing / Landing (5) ──
	{ name: 'Example.com', url: 'https://www.example.com', expected: 'marketing', category: 'Marketing' },
	{ name: 'Stripe', url: 'https://stripe.com', expected: 'marketing', category: 'Marketing' },
	{ name: 'Vercel', url: 'https://vercel.com', expected: 'marketing', category: 'Marketing' },
	{ name: 'Strapi', url: 'https://strapi.io', expected: 'marketing', category: 'Marketing' },
	{ name: 'Tailwind CSS', url: 'https://tailwindcss.com', expected: 'marketing', category: 'Marketing' },

	// ── E-commerce (5) ──
	{ name: 'Vue Storefront', url: 'https://demo.storefrontcloud.io', expected: 'ecommerce', category: 'E-commerce' },
	{ name: 'Medusa Store', url: 'https://medusa-testing-testing.vercel.app', expected: 'ecommerce', category: 'E-commerce' },
	{ name: 'Fake Store API', url: 'https://fakestoreapi.com', expected: 'marketing', category: 'E-commerce' },
	{ name: 'Saleor Demo', url: 'https://demo.saleor.io', expected: 'ecommerce', category: 'E-commerce' },
	{ name: 'BigCommerce Demo', url: 'https://www.bigcommerce.com', expected: 'marketing', category: 'E-commerce' },

	// ── Developer Tools / Platforms (5) ──
	{ name: 'GitHub Explore', url: 'https://github.com/explore', expected: 'developer_platform', category: 'Developer' },
	{ name: 'GitLab Explore', url: 'https://about.gitlab.com', expected: 'marketing', category: 'Developer' },
	{ name: 'npm Registry', url: 'https://www.npmjs.com', expected: 'developer_platform', category: 'Developer' },
	{ name: 'Docker Hub', url: 'https://hub.docker.com', expected: 'developer_platform', category: 'Developer' },
	{ name: 'Postman', url: 'https://www.postman.com', expected: 'marketing', category: 'Developer' },

	// ── Productivity / Tools (5) ──
	{ name: 'Notion Templates', url: 'https://www.notion.so', expected: 'marketing', category: 'Productivity' },
	{ name: 'Obsidian', url: 'https://obsidian.md', expected: 'marketing', category: 'Productivity' },
	{ name: 'Excalidraw', url: 'https://excalidraw.com', expected: 'productivity', category: 'Productivity' },
	{ name: 'Draw.io', url: 'https://app.diagrams.net', expected: 'productivity', category: 'Productivity' },
	{ name: 'CryptPad', url: 'https://cryptpad.fr', expected: 'productivity', category: 'Productivity' },

	// ── CMS (5) ──
	{ name: 'WordPress.com', url: 'https://wordpress.com', expected: 'marketing', category: 'CMS' },
	{ name: 'Drupal', url: 'https://www.drupal.org', expected: 'marketing', category: 'CMS' },
	{ name: 'Ghost.org', url: 'https://ghost.org', expected: 'marketing', category: 'CMS' },
	{ name: 'Sanity.io', url: 'https://www.sanity.io', expected: 'marketing', category: 'CMS' },
	{ name: 'Contentful', url: 'https://www.contentful.com', expected: 'marketing', category: 'CMS' },
];

/* ── Deep Exploration ─────────────────────────────────────────────── */

const MAX_PAGES = 20;
const PAGE_TIMEOUT = 15000;
const NAV_TIMEOUT = 20000;

async function exploreApp(browser, appConfig) {
	const context = await browser.newContext({
		userAgent: 'QaseValidation/2.0 (+https://drytis.dev)',
		viewport: { width: 1280, height: 720 },
		ignoreHTTPSErrors: true,
	});
	const page = await context.newPage();
	const capturedSteps = [];
	const activities = [];
	const visited = new Set();
	const queue = [];

	try {
		const origin = new URL(appConfig.url).origin;

		// Start with homepage
		queue.push(appConfig.url);

		let pageCount = 0;
		while (queue.length > 0 && pageCount < MAX_PAGES) {
			const currentUrl = queue.shift();
			const urlObj = tryParseUrl(currentUrl);
			if (!urlObj) continue;

			// Normalize: strip fragments, avoid duplicates
			const normalized = urlObj.origin + urlObj.pathname + urlObj.search;
			if (visited.has(normalized)) continue;
			if (urlObj.origin !== origin) continue;
			// Skip non-page URLs
			if (/\.(png|jpg|jpeg|gif|svg|css|js|pdf|zip|xml|rss|json|ico)$/i.test(urlObj.pathname)) continue;

			visited.add(normalized);
			pageCount++;

			try {
				await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
			} catch {
				continue; // Skip pages that don't load
			}

			const path = urlObj.pathname === '/' ? '/' : urlObj.pathname;
			const pageTitle = await page.title().catch(() => '');

			capturedSteps.push({
				action: 'navigate',
				url: currentUrl,
				target: path,
			});

			// Extract structured page data
			const pageData = await page.evaluate(() => {
				const headings = [...document.querySelectorAll('h1, h2')]
					.map(e => e.textContent?.trim()).filter(Boolean).slice(0, 10);
				const allLinks = [...document.querySelectorAll('a[href]')].map(a => ({
					text: a.textContent?.trim().slice(0, 80),
					href: a.href,
				}));
				const forms = [...document.querySelectorAll('form')].map(f => ({
					inputs: [...f.querySelectorAll('input, textarea, select')].map(i => ({
						type: i.type || i.tagName.toLowerCase(),
						name: i.name || i.placeholder || '',
						placeholder: i.placeholder || '',
					})),
					action: f.action || '',
				}));
				const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit]')]
					.map(b => b.textContent?.trim() || b.value || '').filter(Boolean).slice(0, 15);
				const searchInputs = document.querySelectorAll(
					'input[type=search], input[placeholder*=search i], [role=searchbox], [aria-label*=search i], form[action*=search i]'
				);
				const navItems = [...document.querySelectorAll('nav a, header a, .nav a, .menu a')]
					.map(a => a.textContent?.trim()).filter(Boolean).slice(0, 20);
				const bodyText = document.body?.innerText?.slice(0, 3000) || '';
				return { headings, allLinks, forms, buttons, searchCount: searchInputs.length, navItems, bodyText };
			}).catch(() => ({
				headings: [], allLinks: [], forms: [], buttons: [], searchCount: 0, navItems: [], bodyText: ''
			}));

			// Build activity summary
			const headingSummary = pageData.headings.slice(0, 3).join('; ');
			const formSummary = pageData.forms.length > 0
				? ` (${pageData.forms.length} form${pageData.forms.length > 1 ? 's' : ''})`
				: '';
			activities.push({
				detail: `${pageTitle || path}: ${headingSummary || pageData.bodyText.slice(0, 120)}${formSummary}`,
				summary: `Visited ${path}`,
			});

			// Record search detection
			if (pageData.searchCount > 0) {
				activities.push({
					detail: `Search input detected on ${path}`,
					summary: 'Search functionality available',
				});
			}

			// Record forms
			for (const form of pageData.forms) {
				for (const input of form.inputs) {
					if (input.type === 'email' || input.type === 'password' || input.type === 'text' && input.placeholder) {
						activities.push({
							detail: `${input.type} field: ${input.placeholder || input.name}`,
							summary: `Form field on ${path}`,
						});
					}
				}
			}

			// Collect interesting links for further exploration
			// Priority: nav items, then all links
			const priorityPatterns = [
				/about/i, /login|signin/i, /signup|register/i, /pricing/i,
				/contact/i, /docs|documentation/i, /help|support/i,
				/features/i, /blog/i, /search/i, /cart|basket/i,
				/products?/i, /dashboard/i, /api/i, /download/i,
				/tems|privacy/i, /community|forum/i, /marketplace/i,
				/board|kanban|project/i, /repo|code/i, /note|doc|wiki/i,
			];

			const interestingLinks = pageData.allLinks.filter(link => {
				try {
					const u = new URL(link.href, origin);
					if (u.origin !== origin) return false;
					if (visited.has(u.origin + u.pathname + u.search)) return false;
					return priorityPatterns.some(p => p.test(u.pathname) || p.test(link.text || ''));
				} catch { return false; }
			});

			// Also add some non-priority links for broader exploration
			const otherLinks = pageData.allLinks
				.filter(link => !interestingLinks.includes(link))
				.filter(link => {
					try {
						const u = new URL(link.href, origin);
						return u.origin === origin &&
							!visited.has(u.origin + u.pathname + u.search) &&
							u.pathname !== '/';
					} catch { return false; }
				})
				.slice(0, 5);

			// Queue links for exploration (priority first, then others)
			for (const link of [...interestingLinks, ...otherLinks]) {
				queue.push(link.href);
			}
		}

		// Build session
		const homepageTitle = activities[0]?.detail || appConfig.name;
		const session = {
			id: randomUUID(),
			projectId: 'validation',
			targetUrl: appConfig.url,
			capturedSteps,
			activities,
			findings: [],
			todos: [],
			report: {
				summary: `${appConfig.name}: ${homepageTitle}. Explored ${pageCount} pages.`,
				covered: [],
				notCovered: [],
			},
		};

		return { session, pagesExplored: pageCount };

	} finally {
		await context.close();
	}
}

function tryParseUrl(urlStr) {
	try { return new URL(urlStr); } catch { return null; }
}

/* ── Main ────────────────────────────────────────────────────────── */

async function main() {
	console.log('\n═══════════════════════════════════════════════════════════════════');
	console.log('  QASE REAL APPLICATION VALIDATION v2 — DEEPER EXPLORATION');
	console.log('═══════════════════════════════════════════════════════════════════\n');
	console.log(`Apps to test: ${TEST_APPS.length}\n`);

	const browser = await chromium.launch({ headless: true });
	const results = [];
	const failed = [];

	for (const app of TEST_APPS) {
		process.stdout.write(`  ${app.name.padEnd(25)} `);
		try {
			const { session, pagesExplored } = await exploreApp(browser, app);

			const inventory = extractAppInventory(session);
			const purpose = inferAppPurpose(inventory, session);
			const { gaps, journey } = analyzeFeatureGaps(session);
			const wfSteps = detectWorkflowSteps(inventory, session, purpose.id);

			const purposeCorrect = purpose.id === app.expected;
			const status = purposeCorrect ? '✅' : '❌';

			process.stdout.write(
				`→ ${status} ${purpose.id} (${Math.round(purpose.confidence * 100)}%) | ` +
				`${pagesExplored}p | ${inventory.pages.length} inv | ` +
				`${gaps.length} gaps (${gaps.filter(g => g.isWorkflowGap).length} wf)\n`
			);

			results.push({
				app: app.name,
				url: app.url,
				category: app.category,
				expected: app.expected,
				detected: purpose.id,
				detectedName: purpose.name,
				confidence: Math.round(purpose.confidence * 100),
				correct: purposeCorrect,
				signals: purpose.signals,
				pagesExplored,
				inventoryPages: inventory.pages.length,
				explorationConfidence: Math.round(inventory.explorationConfidence * 100),
				hasLogin: inventory.auth.hasLogin,
				capabilities: inventory.capabilities,
				totalGaps: gaps.length,
				workflowGaps: gaps.filter(g => g.isWorkflowGap).length,
				featureGaps: gaps.filter(g => !g.isWorkflowGap).length,
				journeySteps: journey.length,
				journeyDetected: journey.filter(j => j.detected).length,
				topGaps: gaps.slice(0, 5).map(g => ({
					feature: g.feature.slice(0, 60),
					severity: g.severity,
					confidence: Math.round(g.confidence * 100),
					workflow: g.isWorkflowGap || false,
				})),
			});
		} catch (err) {
			process.stdout.write(`→ ❌ ERROR: ${err.message.slice(0, 80)}\n`);
			failed.push({ app: app.name, error: err.message });
		}
	}

	await browser.close();

	/* ── Report ─────────────────────────────────────────────────── */

	console.log('\n\n═══════════════════════════════════════════════════════════════════');
	console.log('  VALIDATION RESULTS');
	console.log('═══════════════════════════════════════════════════════════════════\n');

	// By category
	const categories = [...new Set(results.map(r => r.category))];
	for (const cat of categories) {
		const catResults = results.filter(r => r.category === cat);
		const correct = catResults.filter(r => r.correct).length;
		console.log(`${cat}: ${correct}/${catResults.length} correct`);
		for (const r of catResults) {
			const status = r.correct ? '✅' : '❌';
			console.log(
				`  ${status} ${r.app.padEnd(25)} ` +
				`expected=${r.expected.padEnd(20)} ` +
				`detected=${r.detected.padEnd(20)} ` +
				`conf=${r.confidence}% `.padEnd(8) +
				`pages=${r.pagesExplored} `
			);
		}
		console.log();
	}

	// Overall metrics
	const totalValid = results.length;
	const totalCorrect = results.filter(r => r.correct).length;
	const errors = failed.length;

	console.log('─── METRICS ───────────────────────────────────────────────────────\n');
	console.log(`Apps Tested:                  ${totalValid} (+${errors} failed to load)`);
	console.log(`Purpose Detection Accuracy:   ${totalCorrect}/${totalValid} (${Math.round(totalCorrect / totalValid * 100)}%)`);
	console.log(`Avg Pages Explored:           ${(results.reduce((s, r) => s + r.pagesExplored, 0) / totalValid).toFixed(1)}`);
	console.log(`Avg Exploration Confidence:   ${Math.round(results.reduce((s, r) => s + r.explorationConfidence, 0) / totalValid)}%`);
	console.log(`Avg Purpose Confidence:       ${Math.round(results.reduce((s, r) => s + r.confidence, 0) / totalValid)}%`);
	console.log(`Total Gaps Found:             ${results.reduce((s, r) => s + r.totalGaps, 0)}`);
	console.log(`  Workflow Gaps:              ${results.reduce((s, r) => s + r.workflowGaps, 0)}`);
	console.log(`  Feature Gaps:               ${results.reduce((s, r) => s + r.featureGaps, 0)}`);
	console.log(`Apps with Workflow Activity:  ${results.filter(r => r.journeySteps > 0).length}/${totalValid}`);

	// Confidence distribution
	const lowConf = results.filter(r => r.confidence < 20).length;
	const midConf = results.filter(r => r.confidence >= 20 && r.confidence < 40).length;
	const highConf = results.filter(r => r.confidence >= 40).length;
	console.log(`\nPurpose Confidence Distribution:`);
	console.log(`  <20%:  ${lowConf} apps`);
	console.log(`  20-40%: ${midConf} apps`);
	console.log(`  40%+:  ${highConf} apps`);

	// Misclassifications
	const mismatches = results.filter(r => !r.correct);
	if (mismatches.length > 0) {
		console.log(`\n─── MISCLASSIFICATIONS ────────────────────────────────────────────\n`);
		for (const m of mismatches) {
			console.log(`${m.app}: expected=${m.expected} got=${m.detected} (${m.confidence}%)`);
			console.log(`  signals: ${m.signals.slice(0, 5).join(', ')}`);
			console.log(`  pages explored: ${m.pagesExplored}, exploration conf: ${m.explorationConfidence}%`);
		}
	}

	// JSON output
	console.log('\n─── JSON OUTPUT ───────────────────────────────────────────────────\n');
	console.log(JSON.stringify({ results, failed }, null, 2));
}

main().catch(err => {
	console.error('Validation failed:', err);
	process.exit(1);
});
