import { createHash } from 'node:crypto';

export function authThrottleKey(value) {
	return createHash('sha256').update(String(value)).digest('hex');
}

const WINDOW_MS = 15 * 60_000;
const MAX_KEYS = 10_000;

/**
 * Fixed-window auth throttle.
 *
 * The map is bounded by oldest-window eviction (never a hard refuse): when the
 * key cap is reached the entries with the EARLIEST expiry are evicted first.
 * Refusing new keys instead (the old behaviour) let an attacker flood the
 * `account:` namespace with one bogus key per request until every fresh key —
 * including legitimate visitors' `ip:` keys — was rejected with 429, a
 * site-wide auth DoS. Eviction keeps the throttle a per-key limiter instead.
 */
export function createAuthThrottle({ now = Date.now } = {}) {
	const windows = new Map();
	const sweep = (time) => {
		for (const [id, entry] of windows) {
			if (entry.expires <= time) windows.delete(id);
		}
	};
	return (key, limit) => {
		const time = now();
		sweep(time);
		if (!windows.has(key)) {
			// Map preserves insertion order; expired entries were just swept, so
			// the first MAX_KEYS entries are the oldest live windows.
			if (windows.size >= MAX_KEYS) {
				let toEvict = windows.size - MAX_KEYS + 1;
				for (const id of windows.keys()) {
					if (toEvict-- <= 0) break;
					windows.delete(id);
				}
			}
			windows.set(key, { count: 0, expires: time + WINDOW_MS });
		}
		return ++windows.get(key).count <= limit;
	};
}
