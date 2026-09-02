'use strict';

/**
 * R1 — agent runtime-kick lifecycle + startTurn guard (structural units).
 *
 * Hermetic tests for the G7 seam: the pendingRuntimeKick flag must bracket
 * the ENTIRE ensureRuntime window (set before the first await, cleared on
 * success AND on throw), and startTurn's terminal-mission guard must refuse
 * to enter runTurn for an already-finalized mission. The behavior is driven
 * live in reliability-lifecycle.test.js Part 1 via probeSession; these
 * structural checks pin the source shape so a refactor cannot silently
 * drop the bracket.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Strip line comments and block comments so structural scans hit code only. */
function prologueOnly(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

describe('R1/G7 — ensureRuntime pendingRuntimeKick bracket', () => {
	const src = readFileSync(join(ROOT, 'server/agent.js'), 'utf8');
	const start = src.indexOf('export async function ensureRuntime');
	const end = src.indexOf('\nexport ', start + 1);
	const body = src.slice(start, end === -1 ? undefined : end);

	test('ensureRuntime exists in the source', () => {
		assert.ok(start !== -1, 'function found');
	});

	test('flag is set before any await (first statement after the cache-return)', () => {
		// Comments are stripped FIRST; all indices are computed on the
		// stripped text so they stay consistent.
		const code = prologueOnly(body);
		const setIdx = code.indexOf('record.pendingRuntimeKick = true');
		assert.ok(setIdx !== -1, 'flag set present');
		const prologue = code.slice(0, setIdx);
		const awaitMatches = [...prologue.matchAll(/\bawait\b/g)];
		assert.equal(awaitMatches.length, 0, `no executable await before the flag is set (found ${awaitMatches.length})`);
	});

	test('flag cleared on the success path AND in a finally (throw path)', () => {
		const clears = body.match(/pendingRuntimeKick = false/g) || [];
		assert.ok(clears.length >= 2, `expected ≥2 clears (success + finally), found ${clears.length}`);
		assert.ok(/finally\s*\{/.test(body), 'finally block present');
	});
});

describe('R1/G7 — startTurn terminal-mission guard (index.js structural)', () => {
	const src = readFileSync(join(ROOT, 'server/index.js'), 'utf8');
	const start = src.indexOf('function startTurn');
	const body = src.slice(start, src.indexOf('\n}', src.indexOf('runTurn(session', start)) + 2);

	test('startTurn exists and guards terminal missions before runTurn', () => {
		assert.ok(start !== -1, 'function found');
		assert.ok(body.includes('isTerminalStatus(mission.status)'), 'terminal guard present');
		assert.ok(body.includes("kind: 'error'"), 'refusal leaves an honest system message');
		assert.ok(body.indexOf('isTerminalStatus(mission.status)') < body.indexOf('runTurn(session'), 'guard runs BEFORE the turn starts');
	});
});
