import test from 'node:test';
import assert from 'node:assert/strict';
import { progressStream } from './progressStream.js';

const options = { idleMs: 20, progressMs: 60, cleanupMs: 20 };
async function collect(stream) { const parts = []; for await (const part of stream) parts.push(part); return parts; }
function stalled(signal) { return (async function* () { await new Promise(resolve => { signal.addEventListener('abort', resolve, { once: true }); }); })(); }

test('silent stream is aborted and safely retryable after closing', async () => {
 let aborted = false;
 await assert.rejects(collect(progressStream(signal => { signal.addEventListener('abort', () => { aborted = true; }); return stalled(signal); }, undefined, options)), error => error.code === 'QASE_PROGRESS_TIMEOUT');
 assert.equal(aborted, true);
});
test('continuous reasoning cannot extend the action deadline', async () => {
 await assert.rejects(collect(progressStream(signal => (async function* () { while (!signal.aborted) { await new Promise(r => setTimeout(r, 2)); yield { type: 'reasoning', content: 'thinking' }; } })(), undefined, options)), error => error.code === 'QASE_PROGRESS_TIMEOUT');
});
test('healthy tool progress is delivered and resets its deadline', async () => {
 const parts = await collect(progressStream(() => (async function* () { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 10)); yield { type: 'tool_result' }; } })(), undefined, { ...options, idleMs: 100, progressMs: 40 }));
 assert.equal(parts.length, 6);
});
test('user cancellation closes the stream without a timeout retry', async () => {
 const controller = new AbortController();
 const task = collect(progressStream(signal => stalled(signal), controller.signal, options));
 controller.abort();
 assert.deepEqual(await task, []);
});
test('uncooperative stream fails explicitly instead of allowing concurrent retry', async () => {
 await assert.rejects(collect(progressStream(() => ({ [Symbol.asyncIterator]() { return this; }, next: () => new Promise(() => {}), return: () => new Promise(() => {}) }), undefined, options)), error => error.code === 'QASE_STREAM_UNRESPONSIVE');
});
test('breaking at a published report closes the iterator', async () => {
 let closed = false;
 for await (const part of progressStream(() => (async function* () { try { yield { type: 'tool_result' }; } finally { closed = true; } })(), undefined, options)) break;
 assert.equal(closed, true);
});

test('repeated failed tools do not count as action progress', async () => {
 await assert.rejects(collect(progressStream(signal => (async function* () { while (!signal.aborted) { await new Promise(r => setTimeout(r, 2)); yield { type: 'tool_result', result: { success: false } }; } })(), undefined, options)), error => error.code === 'QASE_PROGRESS_TIMEOUT');
});
