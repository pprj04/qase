/** Deep-link helpers — port of the legacy ?run=<uuid> handling. */

/** Same shape as legacy RUN_ID_PATTERN (v1-v8 UUIDs, case-insensitive). */
export const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read a valid `?run=` id from the URL; returns the lowercased id or null.
 */
export function readRunFromUrl(): string | null {
  const requested = new URLSearchParams(window.location.search).get('run');
  if (requested && RUN_ID_PATTERN.test(requested)) return requested.toLowerCase();
  return null;
}

/**
 * Strip the `run` param whether or not it was a valid/consumable id (legacy
 * parity: stale handles are cleaned from the URL too). Keeps any other query
 * params and the hash.
 */
export function consumeRunParam(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('run')) return;
  params.delete('run');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}
