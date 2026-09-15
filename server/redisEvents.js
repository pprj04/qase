import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createClient } from 'redis';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;

function positiveLimit(value, fallback) {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Live cache limits must be positive integers.');
	return value;
}

function redisUrl(environment, allowInsecure) {
	const raw = String(environment.QASE_REDIS_URL ?? '').trim();
	if (!raw) throw new Error('Distributed execution requires QASE_REDIS_URL.');
	const url = new URL(raw);
	if (!['redis:', 'rediss:'].includes(url.protocol)) throw new TypeError('QASE_REDIS_URL must use redis:// or rediss://.');
	if (environment.NODE_ENV === 'production' && url.protocol !== 'rediss:' && !allowInsecure) {
		throw new Error('Production distributed execution requires a TLS rediss:// URL.');
	}
	return raw;
}

export function createRedisEventTransport(options = {}) {
	const now = options.now ?? Date.now;
	const cacheTtlMs = positiveLimit(options.liveCacheTtlMs, 5 * 60_000);
	const cacheMaxEntries = positiveLimit(options.liveCacheMaxEntries, 128);
	const cacheMaxBytes = positiveLimit(options.liveCacheMaxBytes, 16 * 1024 * 1024);
	const environment = options.environment ?? process.env;
	const tenant = options.tenantContext;
	if (!tenant || !UUID_PATTERN.test(tenant.organizationId) || !UUID_PATTERN.test(tenant.projectId)) {
		throw new TypeError('Redis event transport requires trusted tenant UUIDs.');
	}
	const instanceId = options.instanceId ?? randomUUID();
	const url = options.url ?? redisUrl(environment, options.allowInsecure);
	const create = options.createClient ?? createClient;
	const publisher = options.publisher ?? create({ url });
	const subscriber = options.subscriber ?? publisher.duplicate();
	const channel = `qase:v1:${tenant.organizationId}:${tenant.projectId}:events`;
	const frameChannelPrefix = `qase:v1:${tenant.organizationId}:${tenant.projectId}:frames:`;
	const bus = new EventEmitter();
	bus.setMaxListeners(0);
	const live = new Map();
	let liveBytes = 0;
	function removeLive(id) {
		liveBytes -= live.get(id)?.bytes ?? 0;
		live.delete(id);
	}
	function expireLive() {
		const time = now();
		for (const [id, entry] of live) {
			if (entry.expiresAt <= time) removeLive(id);
			else if (entry.frameExpiresAt <= time) {
				delete entry.value.frame;
				delete entry.frameExpiresAt;
				const bytes = Buffer.byteLength(id, 'utf8') + Buffer.byteLength(JSON.stringify(entry.value), 'utf8');
				liveBytes += bytes - entry.bytes;
				entry.bytes = bytes;
			}
		}
	}
	// This is a disposable preview cache, never the authoritative run state.
	// Sweep even without traffic so stale screenshots leave memory promptly.
	const sweepTimer = setInterval(expireLive, Math.min(cacheTtlMs, 30_000));
	sweepTimer.unref?.();
	function cacheLive(id, value, frameExpiresAt) {
		const serialized = JSON.stringify(value);
		const bytes = Buffer.byteLength(id, 'utf8') + Buffer.byteLength(serialized, 'utf8');
		removeLive(id);
		if (bytes > cacheMaxBytes) return;
		while (live.size >= cacheMaxEntries || liveBytes + bytes > cacheMaxBytes) {
			removeLive(live.keys().next().value);
		}
		live.set(id, { value: JSON.parse(serialized), bytes, expiresAt: now() + cacheTtlMs, frameExpiresAt });
		liveBytes += bytes;
	}
	const frameSubscriptions = new Map();
	const framePublications = new Map();
	let loaded = false;
	let closed = false;
	let lastError;
	let closePromise;

	function accept(event) {
		if (closed || !event || typeof event !== 'object' || typeof event.sessionId !== 'string') return;
		expireLive();
		if (event.type === 'run.deleted') {
			removeLive(event.sessionId);
		} else if (event.type === 'frame') {
			const current = { ...live.get(event.sessionId)?.value };
			current.frame = event.frame;
			cacheLive(event.sessionId, current, now() + cacheTtlMs);
		} else if (event.type === 'status') {
			const current = { ...live.get(event.sessionId)?.value };
			current.running = event.status === 'running';
			cacheLive(event.sessionId, current, live.get(event.sessionId)?.frameExpiresAt);
		}
		bus.emit(event.sessionId, event);
		bus.emit('*', event);
	}

	function frameChannel(sessionId) {
		return `${frameChannelPrefix}${Buffer.from(String(sessionId), 'utf8').toString('base64url')}`;
	}

	function receive(message) {
		if (closed || typeof message !== 'string' || Buffer.byteLength(message, 'utf8') > MAX_EVENT_BYTES) return;
		try {
			const envelope = JSON.parse(message);
			if (envelope.source !== instanceId) accept(envelope.event);
		} catch { /* malformed pub/sub messages are ignored */ }
	}

	async function activateFrameSubscription(entry) {
		if (!loaded || closed) return;
		if (entry.activation) return entry.activation;
		if (entry.active) return;
		entry.active = true;
		entry.activation = subscriber.subscribe(entry.channel, receive).catch(error => {
			entry.active = false;
			lastError = error;
			throw error;
		}).finally(() => {
			entry.activation = undefined;
		});
		return entry.activation;
	}

	function publishFrame(sessionId, message) {
		let state = framePublications.get(sessionId);
		if (!state) {
			state = { inFlight: false, pending: undefined };
			framePublications.set(sessionId, state);
		}
		if (state.inFlight) {
			// Redis is slower than capture. Keep only the newest unsent frame;
			// intermediate JPEGs would already be stale when delivered.
			state.pending = message;
			return;
		}

		const flush = async initial => {
			state.inFlight = true;
			let current = initial;
			while (current && loaded && !closed) {
				try {
					await publisher.publish(frameChannel(sessionId), current);
				} catch (error) {
					lastError = error;
				}
				current = state.pending;
				state.pending = undefined;
			}
			state.inFlight = false;
			framePublications.delete(sessionId);
		};
		void flush(message);
	}

	return Object.freeze({
		async load() {
			if (loaded) return;
			publisher.on?.('error', error => { lastError = error; });
			subscriber.on?.('error', error => { lastError = error; });
			await publisher.connect();
			await subscriber.connect();
			await subscriber.subscribe(channel, receive);
			loaded = true;
			await Promise.all([...frameSubscriptions.values()].map(activateFrameSubscription));
			lastError = undefined;
		},
		publish(event) {
			if (closed) return;
			let message;
			try { message = JSON.stringify({ source: instanceId, event }); } catch { return; }
			if (Buffer.byteLength(message, 'utf8') > MAX_EVENT_BYTES) return;
			accept(JSON.parse(message).event);
			if (!loaded) return;
			if (event?.type === 'frame' && typeof event.sessionId === 'string') {
				publishFrame(event.sessionId, message);
				return;
			}
			void publisher.publish(channel, message).catch(error => { lastError = error; });
		},
		async subscribe(sessionId, listener) {
			if (typeof listener !== 'function') throw new TypeError('Event listener must be a function.');
			if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('Session id is required.');
			bus.on(sessionId, listener);
			let entry = frameSubscriptions.get(sessionId);
			if (!entry) {
				entry = { channel: frameChannel(sessionId), count: 0, active: false, activation: undefined };
				frameSubscriptions.set(sessionId, entry);
			}
			entry.count += 1;
			try {
				await activateFrameSubscription(entry);
			} catch (error) {
				bus.off(sessionId, listener);
				entry.count -= 1;
				if (entry.count === 0) frameSubscriptions.delete(sessionId);
				throw error;
			}
			let subscribed = true;
			return () => {
				if (!subscribed) return;
				subscribed = false;
				bus.off(sessionId, listener);
				entry.count -= 1;
				if (entry.count > 0) return;
				frameSubscriptions.delete(sessionId);
				if (entry.active && loaded && !closed) {
					entry.active = false;
					void subscriber.unsubscribe(entry.channel).catch(error => { lastError = error; });
				}
			};
		},
		subscribeAll(listener) {
			bus.on('*', listener);
			return () => bus.off('*', listener);
		},
		getLiveState(sessionId) {
			expireLive();
			const state = live.get(sessionId)?.value;
			return { running: Boolean(state?.running), frame: structuredClone(state?.frame) };
		},
		async check() {
			if (!loaded || closed) return false;
			try {
				const ready = await publisher.ping() === 'PONG';
				if (ready) lastError = undefined;
				return ready;
			} catch (error) { lastError = error; return false; }
		},
		close() {
			closePromise ??= (async () => {
				closed = true;
				clearInterval(sweepTimer);
				await Promise.allSettled([subscriber.close(), publisher.close()]);
				bus.removeAllListeners();
				live.clear();
				liveBytes = 0;
				frameSubscriptions.clear();
				framePublications.clear();
			})();
			return closePromise;
		}
	});
}
