import assert from 'node:assert/strict';
import { test } from 'node:test';

// The React libs are TS modules; import via the compiled bundle is not
// available in node:test, so exercise the pure logic through a tiny esbuild
// transform using node's built-in strip-types when available, else eval the
// shared fixtures directly through the legacy modules they must stay in
// behavioral sync with, plus a fresh tsc-compiled copy under tmp.
// Simpler and deterministic: run the same behavioral assertions against the
// legacy modules (source of truth) AND the compiled TS output.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

import { groupSqaUnresolvedResults as legacyGroup, describeSqaLifecycle as legacyLifecycle } from '../public/sqaPresentation.js';
import { followUpSuggestions as legacySuggestions, buildFollowUpMessage as legacyMessage } from '../public/followUp.js';
import { buildAllFixPromptsMarkdown as legacyFixPrompts } from '../public/fixPromptBuilder.js';

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);

function compileTs(sources) {
	const dir = mkdtempSync(join(tmpdir(), 'qase-react-test-'));
	for (const [name, code] of Object.entries(sources)) {
		require('node:fs').writeFileSync(join(dir, name), code);
	}
	const out = join(dir, 'out');
	// Standalone TS compile: no project tsconfig so it never fights includes.
	execFileSync('npx', ['tsc', '--ignoreConfig', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--strict', '--skipLibCheck', '--outDir', out, ...Object.keys(sources).map((name) => join(dir, name))], { stdio: 'pipe', cwd: root });
	return out;
}

const fs = require('node:fs');
const src = (name) => fs.readFileSync(join(root, 'src/lib', name), 'utf8');

test('React sqaPresentation matches legacy grouping behavior', async () => {
	const out = compileTs({
		'sqaPresentation.ts': src('sqaPresentation.ts'),
	});
	const react = await import(`file://${join(out, 'sqaPresentation.js')}`);

	const results = [
		{ status: 'pass' },
		{ status: 'fail', controlId: 'a', title: 'A' },
		{ status: 'blocked', controlId: 'b', title: 'B', automationLevel: 'manual' },
		{ status: 'blocked', controlId: 'c', title: 'C', automationLevel: 'hybrid' },
		{ status: 'blocked', controlId: 'd', title: 'D' },
	];
	const legacyGroups = legacyGroup(results);
	const reactGroups = react.groupSqaUnresolvedResults(results);
	assert.equal(reactGroups.failures.length, legacyGroups.failures.length);
	assert.equal(reactGroups.reviewer.length, legacyGroups.reviewer.length);
	assert.equal(reactGroups.mixed.length, legacyGroups.mixed.length);
	assert.equal(reactGroups.automated.length, legacyGroups.automated.length);

	// Lifecycle parity: only finalizedAt is final.
	const draft = { assessment: { verdict: 'blocked' }, observations: [] };
	assert.equal(react.describeSqaLifecycle(draft, 'idle', 0).phase, legacyLifecycle(draft, 'idle', 0).phase);
	const finalised = react.describeSqaLifecycle({ ...draft, finalizedAt: '2026-08-15T00:00:00.000Z' }, 'idle', 0);
	assert.equal(finalised.phase, 'finalized');
	assert.equal(finalised.badge, 'blocked');
	assert.equal(finalised.evidenceIncomplete, false);
});

test('React founderPresentation lifecycle and trace helpers are truthful', async () => {
	const out = compileTs({
		'founderPresentation.ts': src('founderPresentation.ts'),
		'sqaPresentation.ts': src('sqaPresentation.ts'),
	});
	const react = await import(`file://${join(out, 'founderPresentation.js')}`);
	const ready = react.describeFounderLifecycle({}, 'idle', 0);
	assert.equal(ready.phase, 'ready');
	assert.equal(ready.finalized, false);
	const running = react.describeFounderLifecycle({ observations: [{ id: '1' }] }, 'running', 0);
	assert.equal(running.phase, 'running');
	assert.equal(running.detail, '1 observations captured');
	const complete = react.describeFounderLifecycle(
		{ finalizedAt: '2026-01-01T00:00:00.000Z', report: { coverage: { categoriesReviewed: ['a', 'b'], totalCategories: 3, evidenceBackedObservations: 5 } } },
		'idle', 0,
	);
	assert.equal(complete.phase, 'complete');
	assert.equal(complete.finalized, true);
	assert.match(complete.detail, /2\/3 lenses reviewed/);
});

test('React followUp helpers match legacy suggestions and message building', async () => {
	const out = compileTs({
		'followUp.ts': src('followUp.ts'),
	});
	const react = await import(`file://${join(out, 'followUp.js')}`);
	const report = {
		notCovered: ['Checkout flow', '  Search  ', 'checkout flow'],
		recommendations: ['Test mobile nav'],
	};
	assert.deepEqual(react.followUpSuggestions(report), legacySuggestions(report));
	const message = react.buildFollowUpMessage('https://example.com', ['Checkout flow', 'Test mobile nav']);
	assert.equal(message, legacyMessage('https://example.com', ['Checkout flow', 'Test mobile nav']));
	assert.equal(react.buildFollowUpMessage(undefined, ['a']), null);
	assert.equal(react.buildFollowUpMessage('https://example.com', []), null);
});

test('React fix prompt builder produces the legacy prompt shape', async () => {
	const out = compileTs({
		'fixPromptBuilder.ts': src('fixPromptBuilder.ts'),
	});
	const react = await import(`file://${join(out, 'fixPromptBuilder.js')}`);
	const session = {
		id: 'run-1',
		mode: 'qa',
		targetUrl: 'https://example.com',
		findings: [
			{ severity: 'critical', title: 'Checkout broken', category: 'checkout', steps: ['Open /cart', 'Click pay'] },
			{ severity: 'low', title: 'Typo' },
		],
	};
	const reactMarkdown = react.buildAllFixPromptsMarkdown(session);
	const legacyMarkdown = legacyFixPrompts(session);
	const stripStamp = (text) => text.replace(/Generated: [^\n]+/, 'Generated: <ts>');
	assert.equal(stripStamp(reactMarkdown), stripStamp(legacyMarkdown));
	assert.match(reactMarkdown, /# Fix prompts — 2 findings/);
	assert.match(reactMarkdown, /CRITICAL\] Checkout broken/);
});
