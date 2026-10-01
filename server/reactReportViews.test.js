import assert from 'node:assert/strict';
import { test } from 'node:test';

// The pure presentation libs now live ONLY as the React TS ports (legacy UI
// modules were removed in Phase 7). Each test compiles the TS source and
// asserts the behavioral contract directly — these assertions were validated
// against the legacy implementations before removal.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

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

test('React sqaPresentation groups unresolved results by evidence mode', async () => {
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
	const reactGroups = react.groupSqaUnresolvedResults(results);
	assert.equal(reactGroups.failures.length, 1);
	assert.equal(reactGroups.reviewer.length, 1);
	assert.equal(reactGroups.mixed.length, 1);
	assert.equal(reactGroups.automated.length, 1);

	// Lifecycle contract: only finalizedAt is final.
	const draft = { assessment: { verdict: 'blocked' }, observations: [] };
	assert.equal(react.describeSqaLifecycle(draft, 'idle', 0).phase, 'ready');
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

test('React followUp helpers dedupe case-insensitively and gate on inputs', async () => {
	const out = compileTs({
		'followUp.ts': src('followUp.ts'),
	});
	const react = await import(`file://${join(out, 'followUp.js')}`);
	const report = {
		notCovered: ['Checkout flow', '  Search  ', 'checkout flow'],
		recommendations: ['Test mobile nav'],
	};
	// Dedupe is case-insensitive and trims whitespace.
	assert.deepEqual(react.followUpSuggestions(report), ['Checkout flow', 'Search', 'Test mobile nav']);
	const message = react.buildFollowUpMessage('https://example.com', ['Checkout flow', 'Test mobile nav']);
	assert.match(message, /https:\/\/example\.com/);
	assert.match(message, /Checkout flow/);
	assert.equal(react.buildFollowUpMessage(undefined, ['a']), null);
	assert.equal(react.buildFollowUpMessage('https://example.com', []), null);
});

test('React fix prompt builder produces the canonical prompt shape', async () => {
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
	assert.match(reactMarkdown, /# Fix prompts — 2 findings/);
	assert.match(reactMarkdown, /CRITICAL\] Checkout broken/);
	assert.match(reactMarkdown, /What I need from you/);
	assert.ok(reactMarkdown.includes('Open /cart'), 'steps included');
});
