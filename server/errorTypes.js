/**
 * Structured error classification for the Qase execution pipeline.
 *
 * Phase 1 — Execution Reliability
 *
 * Every failure in the pipeline is classified into one of five categories
 * so that the orchestrator, agent runtime, and mission finalization logic
 * can make consistent retry/skip/abort decisions without ad-hoc regex
 * matching scattered across modules.
 *
 * Categories:
 *   transient     — retryable, short-lived (timeout, 429, empty LLM response)
 *   infrastructure — retryable, external dependency (network, DNS, 5xx)
 *   application    — non-retryable, bug in the code (assertion, logic error)
 *   config         — non-retryable, misconfiguration (missing API key, bad URL)
 *   terminal       — non-retryable, deliberate stop (abort, cancel, shutdown)
 */

/* ── Error Types ─────────────────────────────────────────────────── */

export const ERROR_TYPES = {
	TRANSIENT: 'transient',
	INFRASTRUCTURE: 'infrastructure',
	APPLICATION: 'application',
	CONFIG: 'config',
	TERMINAL: 'terminal'
};

/**
 * A classified error carrying its type and whether it should be retried.
 *
 * The original error is preserved in .cause so stack traces are intact
 * and any existing code that catches Error still works.
 */
export class PipelineError extends Error {
	constructor(message, type, { cause, retryable, context } = {}) {
		super(message, { cause });
		this.name = 'PipelineError';
		this.errorType = type;
		this.retryable = Boolean(retryable);
		this.context = context || {};
	}

	toJSON() {
		return {
			errorType: this.errorType,
			message: this.message,
			retryable: this.retryable,
			context: this.context
		};
	}
}

/* ── Retryability ────────────────────────────────────────────────── */

const RETRYABLE_TYPES = new Set([ERROR_TYPES.TRANSIENT, ERROR_TYPES.INFRASTRUCTURE]);

/** True if the error type warrants a retry attempt. */
export function isRetryableType(type) {
	return RETRYABLE_TYPES.has(type);
}

/**
 * Classifies an arbitrary error (PipelineError, fetch Error, LLM status, etc.)
 * into one of the ERROR_TYPES values.
 *
 * This is the single source of truth for error classification — the same
 * patterns that existed in agent.js's isRetryableModelTimeout and
 * testGen.js's isRetryableLLMError are consolidated here.
 */
export function classifyError(error) {
	if (!error) return ERROR_TYPES.APPLICATION;

	// Already classified
	if (error instanceof PipelineError) {
		return error.errorType;
	}

	// Abort / cancel
	if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
		return ERROR_TYPES.TERMINAL;
	}

	const message = String(error.message || error).toLowerCase();
	const status = error.status || error.statusCode;

	// Status-code based classification
	if (typeof status === 'number') {
		if (status === 429) return ERROR_TYPES.TRANSIENT;
		if (status >= 500 && status <= 599) return ERROR_TYPES.INFRASTRUCTURE;
		if (status === 401 || status === 403) return ERROR_TYPES.CONFIG;
		if (status === 400) return ERROR_TYPES.APPLICATION;
	}

	// Message-pattern classification
	// Terminal: deliberate stops
	if (/abort|cancel|stopped by user|signal/.test(message)) {
		return ERROR_TYPES.TERMINAL;
	}

	// Config: missing credentials or endpoints
	if (/no api key|api key.*not|missing.*key|not configured|unauthorized/i.test(message)) {
		return ERROR_TYPES.CONFIG;
	}

	// Transient: timeouts and rate limits
	if (/timeout|timed out|deadline exceeded|etimedout|empty response|empty content/i.test(message)) {
		return ERROR_TYPES.TRANSIENT;
	}

	// Infrastructure: network failures
	if (/econnreset|econnrefused|enotfound|eai_again|fetch failed|socket hang up|network error|epipe|econnaborted/i.test(message)) {
		return ERROR_TYPES.INFRASTRUCTURE;
	}

	// Default: treat unknowns as application errors (non-retryable)
	return ERROR_TYPES.APPLICATION;
}

/**
 * Wraps an error in a PipelineError if it isn't one already.
 * Preserves the original as .cause.
 */
export function wrapError(error, context = {}) {
	if (error instanceof PipelineError) {
		return error;
	}
	const type = classifyError(error);
	return new PipelineError(
		error instanceof Error ? error.message : String(error),
		type,
		{
			cause: error,
			retryable: isRetryableType(type),
			context
		}
	);
}

/* ── Bounded retry helper ────────────────────────────────────────── */

/**
 * Executes an async function with bounded retries on retryable errors.
 *
 * @param {Function} fn       — async function to execute
 * @param {object}   options
 * @param {number}   options.maxRetries    — max retry attempts (default 2)
 * @param {number}   options.delayMs       — delay between retries (default 3000)
 * @param {number}   options.timeoutMs     — per-attempt timeout (optional)
 * @param {string}   options.label         — label for logging
 * @returns {Promise<*>} the result of fn
 * @throws {PipelineError} the last error, wrapped
 */
export async function withRetry(fn, options = {}) {
	const {
		maxRetries = 2,
		delayMs = 3000,
		timeoutMs = null,
		label = 'operation'
	} = options;

	let lastError;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (attempt > 0) {
			const delay = delayMs * attempt; // linear backoff
			await new Promise(resolve => setTimeout(resolve, delay));
			console.error(`[retry] ${label} attempt ${attempt}/${maxRetries} after: ${lastError.message}`);
		}

		try {
			if (timeoutMs) {
				return await Promise.race([
					fn(attempt),
					new Promise((_, reject) => {
						const timer = setTimeout(() => {
							reject(new PipelineError(
								`${label} timed out after ${timeoutMs}ms`,
								ERROR_TYPES.TRANSIENT,
								{ retryable: true, context: { timeoutMs } }
							));
						}, timeoutMs);
						timer.unref?.();
					})
				]);
			}
			return await fn(attempt);
		} catch (error) {
			lastError = wrapError(error, { label, attempt });
			if (!lastError.retryable || attempt >= maxRetries) {
				throw lastError;
			}
		}
	}

	throw lastError;
}
