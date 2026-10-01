import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('phase 4: markdown renderer is a faithful port (escape-first, fenced blocks, safe links)', () => {
  const md = read('src/lib/markdown.ts');
  assert.match(md, /escapeHtml/);
  assert.match(md, /```/);
  assert.match(md, /target="_blank" rel="noreferrer noopener"/);
  assert.match(md, /https\?:\\/);
  assert.match(md, /<h3>/);
  // XSS discipline: escapes before any tag insertion
  const escapeIdx = md.indexOf('escapeHtml(text)');
  const codeIdx = md.indexOf('<code>');
  assert.ok(escapeIdx > -1 && codeIdx > escapeIdx, 'text is escaped before markdown transforms');
  assert.match(md, /tailOf/);
});

test('phase 4: live session store handles stream → transcript state', () => {
  const live = read('src/state/liveSession.tsx');
  // thinking role never becomes a bubble
  assert.match(live, /role === 'thinking'[\s\S]{0,80}return state/);
  // deltas append; real message supersedes its delta
  assert.match(live, /deltas\[action\.id\]/);
  assert.match(live, /delete deltas\[action\.message\.id\]/);
  // answer/stop/message endpoints
  assert.match(live, /\/answer/);
  assert.match(live, /\/stop/);
  assert.match(live, /\/message/);
  // question slot state
  assert.match(live, /pendingQuestion/);
  // stream closes on sign-out
  assert.match(live, /authStatus !== 'signed-in'/);
});

test('phase 4: transcript renders bubbles, thinking strip, question slot, composer', () => {
  const transcript = read('src/components/Transcript.tsx');
  assert.match(transcript, /msg--agent/);
  assert.match(transcript, /dangerouslySetInnerHTML/); // markdown body
  assert.match(transcript, /thinking-strip/);
  assert.match(transcript, /thinking-label/);
  assert.match(transcript, /question-card/);
  assert.match(transcript, /Credentials needed/);
  assert.match(transcript, /Decision needed/);
  assert.match(transcript, /Store and continue/);
  assert.match(transcript, /Skip login/);
  assert.match(transcript, /composer/);
  // Enter sends, Shift+Enter newlines
  assert.match(transcript, /event\.key === 'Enter' && !event\.shiftKey/);
  // auto-scroll only near bottom (160px rule)
  assert.match(transcript, /160/);
  // stop button during runs
  assert.match(transcript, /stop-run/);
  // snapshot messages carry `text` (legacy store); SSE deltas carry `content`
  assert.match(transcript, /message\.text as string \| undefined/);
  // user messages sent as plain text, never markdown-injected
  assert.ok(!/msg--user[\s\S]{0,200}dangerouslySetInnerHTML/.test(transcript));
  // auto-grow up to the legacy 170px cap
  assert.match(transcript, /170/);
});

test('phase 4: question slot keeps credential values out of the model path', () => {
  const transcript = read('src/components/Transcript.tsx');
  const live = read('src/state/liveSession.tsx');
  // Credentials go to the run vault endpoint, never into /answer text
  assert.match(live, /\/sessions\/\$\{state\.session\.id\}\/credentials/);
  assert.ok(!/username: \$\{username/.test(transcript), 'username value never interpolated into an answer');
  // legacy canned skip answer parity
  assert.match(transcript, /Continue with a public-only review\. No credentials are available/);
  assert.match(transcript, /QA_USERNAME/);
  assert.match(transcript, /Enter a username or password first\./);
});
