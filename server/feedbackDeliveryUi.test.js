import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('feedback form names the human-reviewed destination before submission', () => {
	assert.match(html, /id="feedback-description"[^>]*>[^<]*Qase team[^<]*Feedback Inbox[^<]*human review/i);
	assert.match(html, /id="feedback-panel"[^>]+aria-label="Feedback Inbox"/);
	assert.match(html, /<h2 class="perf-title">💬 Feedback Inbox<\/h2>/);
});

test('submitted and edited feedback confirms delivery to the same inbox', () => {
	assert.match(app, /Sent to the Qase team’s Feedback Inbox for human review\./);
	assert.match(app, /Feedback sent to the Qase team’s Feedback Inbox\./);
	assert.match(app, /Feedback updated in the Qase team’s Feedback Inbox\./);
});
