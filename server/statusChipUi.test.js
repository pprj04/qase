import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const html = await readFile('public/index.html', 'utf8');
const app = await readFile('public/app.js', 'utf8');

test('exactly one status chip exists — the panel header chip (#14019)', () => {
	// A duplicated id="status-chip" left a dead 'idle' chip in the run-status
	// row that never updated and contradicted the done pill on completed runs.
	assert.equal((html.match(/id="status-chip"/g) ?? []).length, 1);
	// The surviving chip is the header one, next to the timer/token meta chips.
	assert.match(html, /<div class="head-actions">\s*<span class="status-chip" id="status-chip"/);
});

test('the run-status (progress-top) row renders no status chip', () => {
	const progressTop = html.match(/<div class="progress-top">([\s\S]*?)<\/div>/)?.[1] ?? '';
	assert.ok(progressTop, 'progress-top row must exist');
	assert.doesNotMatch(progressTop, /status-chip/i);
	assert.doesNotMatch(progressTop, />idle</);
});

test('the live status chip is still wired for all run states', async () => {
	// The header chip receives dataset.status + label from setStatus().
	assert.match(app, /el\.statusChip\.dataset\.status = status;/);
    assert.match(app, /el\.statusChip\.textContent = stopping \? 'stopping…' : status === 'awaiting_input'/);
	// CSS styling for every run state still targets the chip.
	const styles = await readFile('public/styles.css', 'utf8');
	for (const state of ['running', 'awaiting_input', 'done', 'error', 'interrupted']) {
		assert.match(styles, new RegExp(`\\.status-chip\\[data-status="${state}"\\]`), `${state} styling missing`);
	}
});
