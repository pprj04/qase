import { createOperationalLogger } from './operationalLogger.js';

const ACTIVE_STATUSES = new Set(['running', 'awaiting_input']);

/**
 * Self-keepalive for containerized deployments.
 *
 * Workspace containers pause after an inbound-traffic idle window. During an
 * agent run the server is busy (LLM streaming, Chromium automation) but
 * receives almost no inbound HTTP requests, so the platform can pause the
 * container mid-run; the subsequent resume restarts the process and the run
 * is lost (marked `interrupted` by the run store on load).
 *
 * While at least one run is active, the server pings its own /healthz over
 * loopback on a fixed interval, which counts as inbound traffic and keeps the
 * container awake. A short hysteresis window after the last active run avoids
 * start/stop churn for back-to-back runs.
 */
export function createRunKeepalive(options = {}) {
	const intervalMs = options.intervalMs ?? 60_000;
	const quietAfterMs = options.quietAfterMs ?? 120_000;
	const getUrl = options.getUrl ?? (() => null);
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const logger = options.logger ?? createOperationalLogger({ component: 'qase-keepalive' });

	let timer = null;
	let lastActiveAt = 0;
	let stopped = false;

	function tick() {
		const active = lastActiveAt > 0 && Date.now() - lastActiveAt < quietAfterMs;
		if (!active) {
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
			return;
		}
		const url = getUrl();
		if (!url) return;
		fetchImpl(url, { headers: { 'user-agent': 'qase-keepalive' } })
			.catch(error => {
				// The keepalive must never take the process down; a failed
				// self-ping is retried on the next tick.
				logger.warn('keepalive.ping.failed', { errorName: error?.name ?? 'UnknownError' });
			});
	}

	return {
		/** Call whenever a run is (or may be) active. */
		noteActive() {
			if (stopped) return;
			lastActiveAt = Date.now();
			if (!timer) {
				timer = setInterval(tick, intervalMs);
				timer.unref?.();
			}
		},
		/** Stop permanently and clear the timer. */
		stop() {
			stopped = true;
			if (timer) {
				clearInterval(timer);
				timer = null;
			}
		}
	};
}

/** True when a run status means the agent loop is in flight or paused on input. */
export function isRunStatusActive(status) {
	return ACTIVE_STATUSES.has(status);
}
