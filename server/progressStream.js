/** Bound SDK silence and reasoning-only loops without overlapping retries. */
export async function* progressStream(createStream, signal, {
 idleMs = 120_000, progressMs = 300_000, cleanupMs = 5_000
} = {}) {
 const attempt = new AbortController();
 let idleTimer, progressTimer, pending, iterator, timedOut = false, ended = false;
 let wake;
 const interrupted = new Promise(resolve => { wake = resolve; });
 const stop = () => { attempt.abort(); wake({ interrupted: true }); };
 const expire = () => { timedOut = true; stop(); };
 const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(expire, idleMs); };
 const armProgress = () => { clearTimeout(progressTimer); progressTimer = setTimeout(expire, progressMs); };
 signal?.addEventListener('abort', stop, { once: true });
 try {
  if (signal?.aborted) { stop(); return; }
  iterator = createStream(attempt.signal)[Symbol.asyncIterator]();
  armIdle(); armProgress();
  while (!attempt.signal.aborted) {
   pending = Promise.resolve().then(() => attempt.signal.aborted ? { done: true } : iterator.next());
   const result = await Promise.race([pending, interrupted]);
   if (result.interrupted || attempt.signal.aborted) break;
   if (result.done) { ended = true; break; }
   armIdle();
   if (result.value.type === 'tool_result' && result.value.result?.success !== false) armProgress();
   yield result.value;
  }
 } finally {
  clearTimeout(idleTimer); clearTimeout(progressTimer);
  signal?.removeEventListener('abort', stop);
  if (iterator && !ended) {
   attempt.abort();
   // A timed-out iterator must finish both its pending next() and return()
   // before callers can retry. A stuck executor instead ends in an error.
   let timer;
   const closed = await Promise.race([
    (async () => { try { await pending; } catch {} await iterator.return?.(); return true; })().catch(() => false),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), cleanupMs); })
   ]);
   clearTimeout(timer);
   if (!closed) {
    const error = new Error('The agent stopped responding and could not shut down safely. Start a new run to continue; automatic retry was stopped to avoid repeating actions.');
    error.code = 'QASE_STREAM_UNRESPONSIVE';
    throw error;
   }
  }
 }
 if (timedOut && !signal?.aborted) {
  const error = new Error('The agent made no progress within the allowed time.');
  error.code = 'QASE_PROGRESS_TIMEOUT';
  throw error;
 }
}
