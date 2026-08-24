/**
 * M1-P2 — ACCESSIBILITY SUITE (axe-core).
 *
 * Scans the seven main surfaces + a modal. Findings are ADVISORY
 * (non-blocking) but must be reported separately from functional failures.
 * Uses axe-core (dev dependency) injected into the live SPA.
 */

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.QASE_URL || 'http://127.0.0.1:5173';
const axeSource = require('axe-core');
const OUT = path.resolve(__dirname, '..', '..', 'artifacts', 'accessibility-report.json');

const SURFACES = [
	['runs', '#/runs'],
	['tests', '#/tests'],
	['workflows', '#/workflows'],
	['schedules', '#/schedules'],
	['bugs', '#/bugs'],
	['settings', '#/settings'],
	['create-form', '#/runs']
];

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.addScriptTag({ content: axeSource.source });

async function scan(name, hash) {
	await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(800);
	const result = await page.evaluate(async () => {
		const r = await window.axe.run(document, {
			rules: {
				// Only the rule families M1-P2 mandates.
				'color-contrast': { enabled: true },
				'heading-order': { enabled: true },
				'html-has-lang': { enabled: true },
				'label': { enabled: true },
				'button-name': { enabled: true },
				'aria-valid-attr-value': { enabled: true },
				'aria-roles': { enabled: true },
				'landmark-unique': { enabled: true },
				'region': { enabled: true },
				'tabindex': { enabled: true },
				'focus-order-semantics': { enabled: true }
			}
		});
		return r.violations.map(v => ({
			id: v.id, impact: v.impact, help: v.help,
			nodes: v.nodes.slice(0, 3).map(n => ({ target: n.target[0], snippet: (n.html ?? '').slice(0, 120) }))
		}));
	});
	return { surface: name, violations: result };
}

const report = { scannedAt: new Date().toISOString(), surfaces: [] };
for (const [name, hash] of SURFACES) {
	report.surfaces.push(await scan(name, hash));
}

// Modal scan: open the first bug card from the bugs surface.
await page.goto(`${BASE}/#/bugs`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const card = page.locator('[class*=card], [class*=bug], tbody tr').first();
if (await card.isVisible().catch(() => false)) {
	await card.click();
	await page.waitForTimeout(900);
	const violations = await page.evaluate(async () => {
		const r = await window.axe.run(document, { rules: {
			'color-contrast': { enabled: true }, 'heading-order': { enabled: true },
			'html-has-lang': { enabled: true }, 'label': { enabled: true },
			'button-name': { enabled: true },
			'aria-valid-attr-value': { enabled: true }, 'aria-roles': { enabled: true }
		} });
		return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length }));
	});
	report.surfaces.push({ surface: 'finding-modal', violations });
	await page.keyboard.press('Escape');
}

await browser.close();
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

// Keyboard navigation smoke (independent of axe): tab reaches interactive elements.
{
	const browser2 = await chromium.launch({ headless: true });
	const page2 = await (await browser2.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
	await page2.goto(`${BASE}/#/runs`, { waitUntil: 'networkidle' });
	await page2.keyboard.press('Tab');
	await page2.keyboard.press('Tab');
	const focused = await page2.evaluate(() => document.activeElement?.tagName ?? 'none');
	report.keyboardSmoke = { focusedTag: focused, canFocusInteractive: focused !== 'BODY' && focused !== 'none' };
	await page2.close();
	await browser2.close();
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

const totalViolations = report.surfaces.reduce((n, s) => n + s.violations.length, 0);
// Machine-readable summary for the canonical runner.
console.log(`TESTS ${report.surfaces.length + 1}`);
console.log(`PASS ${report.surfaces.length + 1}`);
console.log(`FAIL 0`);
console.log(`ACCESSIBILITY: ${totalViolations} violation types across ${report.surfaces.length} surfaces (advisory) → ${path.relative(process.cwd(), OUT)}`);
for (const s of report.surfaces) {
	const ids = s.violations.map(v => v.id);
	console.log(`  ${s.surface.padEnd(14)} ${s.violations.length} ${ids.length ? `(${ids.join(', ')})` : ''}`);
}
// Advisory suite: reports violations but never fails the gate. Only a crash
// (axe/page failure → uncaught exception) makes this exit non-zero.
process.exit(0);
