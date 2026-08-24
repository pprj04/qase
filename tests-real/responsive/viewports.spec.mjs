/**
 * M1-P2 — RESPONSIVE VIEWPORT SUITE.
 *
 * Renders the key surfaces at 390 (mobile), 820 (tablet), 1280 (desktop) and
 * asserts: no horizontal overflow, navigation usable, modal/bug cards fit.
 * ADVISORY (documents current clipping; fixes belong to M1-P10).
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.QASE_URL || 'http://127.0.0.1:5173';
const SHOTS = path.resolve(__dirname, '..', '..', 'artifacts', 'responsive-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
	['mobile', { width: 390, height: 844 }],
	['tablet', { width: 820, height: 1180 }],
	['desktop', { width: 1280, height: 800 }]
];
const SURFACES = ['#/runs', '#/tests', '#/bugs', '#/schedules', '#/settings'];

const browser = await chromium.launch({ headless: true });
const findings = [];
let pass = 0, fail = 0;
function ok(cond, name, detail = '') {
	if (cond) pass++; else { fail++; findings.push(`${name}${detail ? ` — ${detail}` : ''}`); }
}

for (const [label, viewport] of VIEWPORTS) {
	const ctx = await browser.newContext({ viewport });
	const page = await ctx.newPage();
	for (const hash of SURFACES) {
		const name = hash.replace('#/', '');
		await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' }).catch(() => {});
		await page.waitForTimeout(700);
		const overflow = await page.evaluate(() => {
			const d = document.documentElement;
			return { scrollW: d.scrollWidth, clientW: d.clientWidth };
		});
		ok(overflow.scrollW <= overflow.clientW + 2,
			`${label}/${name} no horizontal overflow`,
			`scrollWidth ${overflow.scrollW} > client ${overflow.clientW}`);
		await page.screenshot({ path: path.join(SHOTS, `${label}-${name}.png`) }).catch(() => {});
	}
	// Navigation usable at this width: some nav affordance visible/clickable
	await page.goto(`${BASE}/#/runs`, { waitUntil: 'networkidle' });
	const navReachable = await page.evaluate(() => {
		const links = Array.from(document.querySelectorAll('a, [role=tab], [class*=nav] button'));
		const visible = links.filter(l => l.getBoundingClientRect().width > 0 && l.getBoundingClientRect().height > 0);
		return visible.length;
	});
	ok(navReachable >= 3, `${label} navigation reachable (${navReachable} visible nav items)`);

	// Bugs cards fit within viewport at this width
	await page.goto(`${BASE}/#/bugs`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1200);
	const cardFit = await page.evaluate(() => {
		const vw = document.documentElement.clientWidth;
		const els = Array.from(document.querySelectorAll('[class*=card], [class*=bug]')).slice(0, 5);
		if (!els.length) return true;
		return els.every(el => el.getBoundingClientRect().right <= vw + 4);
	});
	ok(cardFit, `${label}/bugs cards fit viewport`);
	await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(SHOTS, 'findings.txt'), findings.join('\n') || '(none)');
// Machine-readable summary for the canonical runner.
console.log(`TESTS ${pass + fail}`);
console.log(`PASS ${pass}`);
console.log(`FAIL ${fail}`);
console.log(`RESPONSIVE: ${pass} pass / ${fail} advisory findings`);
findings.forEach(f => console.log(`  ⚠ ${f}`));
process.exit(0); // advisory
