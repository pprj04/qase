/**
 * User-facing execution health and failure classification.
 *
 * Pipeline error types answer "should this operation retry?". This module
 * answers the product question: "which part of this QA run failed, was the
 * target actually tested, and what should the operator do next?"
 */

export const EXECUTION_FAILURE_CATEGORIES = Object.freeze({
	LLM_PROVIDER: 'llm_provider',
	PROVIDER_CREDENTIALS: 'provider_credentials',
	RATE_LIMIT: 'rate_limit',
	QASE_WORKER: 'qase_worker',
	BROWSER: 'browser',
	BROWSERSTACK: 'browserstack',
	TARGET_APPLICATION: 'target_application',
	TARGET_NETWORK: 'target_network',
	TIMEOUT: 'timeout',
	INTERNAL: 'internal_qase'
});

/** One policy for model/provider failures, regardless of whether they happen
 * while constructing the runtime or after an agent turn has begun. */
export const EXECUTION_RETRY_LIMIT = 2;
export const EXECUTION_RETRY_DELAY_MS = 2000;

const RETRYABLE_EXECUTION_CATEGORIES = new Set(['llm_provider', 'rate_limit', 'timeout']);

const COMPONENTS = ['provider', 'worker', 'browser', 'target'];

export function createExecutionHealth({ provider = null, executionProvider = 'local' } = {}) {
	return {
		version: 1,
		overall: 'running',
		providerName: provider || null,
		executionProvider: executionProvider || 'local',
		components: {
			provider: 'pending',
			worker: 'healthy',
			browser: 'pending',
			target: 'pending'
		},
		lastIssue: null,
		failure: null,
		updatedAt: Date.now()
	};
}

export function markExecutionComponent(health, component, status) {
	const current = health ? structuredClone(health) : createExecutionHealth();
	if (COMPONENTS.includes(component) && ['pending', 'healthy', 'degraded', 'blocked', 'failed', 'not_started'].includes(status)) {
		current.components[component] = status;
	}
	if (current.overall !== 'failed' && !Object.values(current.components).some(value => value === 'failed' || value === 'degraded')) {
		current.overall = 'running';
	}
	current.updatedAt = Date.now();
	return current;
}

export function completeExecutionHealth(health) {
	const current = health ? structuredClone(health) : createExecutionHealth();
	current.overall = 'healthy';
	current.failure = null;
	current.updatedAt = Date.now();
	return current;
}

export function classifyExecutionFailure(error, context = {}) {
	const raw = String(error?.message ?? error ?? 'Unknown execution failure');
	const text = raw.toLowerCase();
	const status = statusFrom(error, context);
	const toolName = String(context.toolName ?? '');
	const stage = String(context.stage ?? 'execution');
	const classifiedContext = Number.isInteger(status) ? { ...context, status } : context;
	const browserstack = context.executionProvider === 'browserstack'
		|| /browserstack|cdp.*(connect|handshake)|wss:\/\//i.test(raw);

	if (browserstack && (status === 401 || status === 403 || /\b(?:401|403)\b|unauthori[sz]ed|forbidden|credential.*(invalid|reject)/i.test(text))) {
		return failure('provider_credentials', 'BROWSERSTACK_AUTH_FAILED',
			'BrowserStack rejected the configured credentials.',
			'Update and test the BrowserStack credentials in Settings, then retry.',
			false, raw, classifiedContext);
	}
	if (browserstack) {
		return failure('browserstack', 'BROWSERSTACK_CONNECTION_FAILED',
			'BrowserStack could not start the requested browser or device.',
			'Check BrowserStack credentials and capacity, run the connection test, then retry.',
			/timeout|429|capacity|unavailable|connection|socket/i.test(text), raw, classifiedContext);
	}
	if (status === 401 || status === 403 || /\b(?:401|403)\b|invalid api key|authentication failed|auth(?:entication)? error|unauthori[sz]ed|forbidden|credential.*(invalid|reject)|api[-_ ]?key.*(?:invalid|reject)/i.test(text)) {
		return failure('provider_credentials', 'PROVIDER_AUTH_FAILED',
			'The model provider rejected QASE credentials.',
			'Open Settings, update or test the provider credential, then retry the run.',
			false, raw, classifiedContext);
	}
	if (status === 429 || /rate.?limit|too many requests|quota exceeded|insufficient quota/i.test(text)) {
		return failure('rate_limit', 'PROVIDER_RATE_LIMITED',
			'The model provider rate limit was reached.',
			'Wait for the provider limit to reset or reduce concurrent runs, then retry.',
			true, raw, classifiedContext);
	}
	if (/timeout|timed out|deadline exceeded|etimedout|headers timeout|went silent/i.test(text)) {
		const providerTimeout = stage === 'agent_turn' || stage === 'provider' || stage === 'runtime_start';
		return failure('timeout', providerTimeout ? 'PROVIDER_TIMEOUT' : 'EXECUTION_TIMEOUT',
			providerTimeout ? 'The model provider did not respond before the timeout.' : 'The execution exceeded its allowed time.',
			'Retry the run. If this repeats, check provider and worker health.',
			true, raw, classifiedContext);
	}
	if (/err_name_not_resolved|enotfound|eai_again|err_connection_refused|err_connection_timed_out|dns/i.test(text)
		&& (toolName === 'browser_open' || /page\.goto|target|navigation/i.test(text))) {
		return failure('target_network', 'TARGET_UNREACHABLE',
			'The browser could not reach the target application.',
			'Check the target URL, DNS, firewall, and whether the application is online.',
			true, raw, classifiedContext);
	}
	if (/http\s*(4\d\d|5\d\d)|status\s*(4\d\d|5\d\d)/i.test(text) && stage === 'target') {
		return failure('target_application', 'TARGET_HTTP_ERROR',
			'The target application returned an error response.',
			'Review the captured network response and target application logs.',
			status >= 500, raw, classifiedContext);
	}
	if (/browser.*(closed|crash|disconnect)|target closed|page.*closed|chromium.*failed|playwright.*failed|frame was detached/i.test(text)
		|| stage === 'browser_tool') {
		return failure('browser', 'BROWSER_EXECUTION_FAILED',
			'The browser could not complete an automation action.',
			'Review the last browser action and evidence. Retry if the browser disconnected.',
			/browser.*(crash|disconnect)|target closed|connection/i.test(text), raw, classifiedContext);
	}
	if ((stage === 'agent_turn' || stage === 'provider' || stage === 'runtime_start')
		&& (/connection error|fetch failed|network error|socket|econn|epipe|enotfound|eai_again|connection reset|gateway timeout|bad gateway|service unavailable/i.test(text)
			|| [500, 502, 503, 504].includes(status))) {
		return failure('llm_provider', 'PROVIDER_CONNECTION_FAILED',
			'QASE lost its connection to the model provider.',
			'Test the model connection in Settings, then retry the run.',
			true, raw, classifiedContext);
	}
	if (/worker.*(exit|crash|unavailable)|runtime.*(start|initiali[sz])|invalid configuration|unknown provider|needs a base url|no api key/i.test(text)) {
		return failure('qase_worker', 'WORKER_START_FAILED',
			'QASE could not start the execution worker.',
			'Check QASE worker health and configuration, then retry.',
			false, raw, classifiedContext);
	}
	return failure('internal_qase', 'INTERNAL_EXECUTION_ERROR',
		'QASE encountered an internal execution error.',
		'Use the correlation ID when reviewing server logs, then retry after the cause is resolved.',
		false, raw, classifiedContext);
}

export function applyExecutionFailure(health, classified, { terminal = true, retryAttempt = 0, maxRetries = 0 } = {}) {
	const next = health ? structuredClone(health) : createExecutionHealth();
	const component = componentFor(classified.category);
	if (component) next.components[component] = terminal ? 'failed' : 'degraded';
	const providerBlockedStartup = terminal && component === 'provider'
		&& next.components.browser === 'pending' && next.components.target === 'pending'
		&& (classified.stage === 'runtime_start' || classified.category === 'provider_credentials');
	if (providerBlockedStartup) {
		next.components.worker = 'blocked';
	}
	const willRetry = !terminal && Boolean(classified.retryable) && retryAttempt < maxRetries;
	const retry = {
		retryable: Boolean(classified.retryable),
		attempt: terminal ? retryAttempt : retryAttempt + 1,
		maxAttempts: maxRetries,
		willRetry,
		nextAttempt: willRetry ? retryAttempt + 1 : null,
		exhausted: terminal && Boolean(classified.retryable) && retryAttempt >= maxRetries
	};
	const issue = { ...classified, retry, occurredAt: Date.now() };
	next.lastIssue = issue;
	next.failure = terminal ? issue : null;
	next.overall = terminal ? 'failed' : (retry.willRetry ? 'retrying' : 'degraded');
	next.updatedAt = issue.occurredAt;
	return next;
}

export function shouldRetryExecutionFailure(classified, retryAttempt = 0, maxRetries = EXECUTION_RETRY_LIMIT) {
	return Boolean(classified?.retryable)
		&& RETRYABLE_EXECUTION_CATEGORIES.has(classified.category)
		&& retryAttempt < maxRetries;
}

/**
 * Execute a startup operation with the same bounded provider-failure policy
 * used by in-run handling. The callback receives every retry/final transition
 * so the caller can persist and stream it without reimplementing decisions.
 */
export async function runWithBoundedExecutionRetries(operation, options = {}) {
	const {
		context = {}, health = createExecutionHealth(),
		maxRetries = EXECUTION_RETRY_LIMIT,
		retryDelayMs = EXECUTION_RETRY_DELAY_MS,
		onTransition = () => {}
	} = options;
	let retryAttempt = 0;
	let currentHealth = health;
	while (true) {
		try {
			const result = await operation({ retryAttempt });
			return { ok: true, result, health: currentHealth, retryAttempt };
		} catch (error) {
			const issue = classifyExecutionFailure(error, context);
			const willRetry = shouldRetryExecutionFailure(issue, retryAttempt, maxRetries);
			currentHealth = applyExecutionFailure(currentHealth, issue, {
				terminal: !willRetry, retryAttempt, maxRetries
			});
			await onTransition({ health: currentHealth, issue, willRetry, retryAttempt, maxRetries, error });
			if (!willRetry) {
				return { ok: false, error, issue, health: currentHealth, retryAttempt };
			}
			retryAttempt += 1;
			if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
		}
	}
}

function componentFor(category) {
	if (['llm_provider', 'provider_credentials', 'rate_limit', 'timeout'].includes(category)) return 'provider';
	if (category === 'qase_worker' || category === 'internal_qase') return 'worker';
	if (category === 'browser' || category === 'browserstack') return 'browser';
	if (category === 'target_application' || category === 'target_network') return 'target';
	return null;
}

function failure(category, code, summary, nextAction, retryable, raw, context) {
	return {
		category,
		code,
		summary,
		nextAction,
		retryable: Boolean(retryable),
		diagnostic: sanitizeDiagnostic(raw),
		stage: context.stage ?? null,
		toolName: context.toolName ?? null,
		status: context.status !== null && context.status !== undefined && Number.isInteger(Number(context.status))
			? Number(context.status) : null
	};
}

function statusFrom(error, context) {
	const candidates = [
		error?.status, error?.statusCode, error?.response?.status,
		error?.cause?.status, error?.cause?.statusCode, error?.cause?.response?.status,
		context.status
	];
	for (const value of candidates) {
		const number = Number(value);
		if (Number.isInteger(number) && number >= 100 && number <= 599) return number;
	}
	const match = String(error?.message ?? error ?? '').match(/(?:status(?:\s+code)?|http)?\s*[:=]?\s*([1-5]\d\d)\b/i);
	return match ? Number(match[1]) : NaN;
}

export function sanitizeDiagnostic(value) {
	let text = String(value ?? '').slice(0, 600);
	text = text.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1••••••');
	text = text.replace(/((?:api[-_ ]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1••••••');
	text = text.replace(/([?&](?:key|token|secret|password)=)[^&#\s]+/gi, '$1••••••');
	return text;
}
