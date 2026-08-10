/**
 * Knowledge Model (Phase 3)
 *
 * Structured knowledge schema with provenance, multi-factor confidence,
 * decay, and validation tracking. Knowledge items represent patterns
 * learned from previous missions — they are EVIDENCE/HINTS, never
 * ground truth.
 *
 * Priority hierarchy (enforced by consumers, not by this module):
 *   CURRENT VERIFIED OBSERVATION
 *     > CURRENT MISSION INTENT
 *       > CURRENT INFERENCE
 *         > HISTORICAL KNOWLEDGE
 */

import { randomUUID } from 'node:crypto';

/* ── Categories ────────────────────────────────────────────────── */

/**
 * Knowledge categories that fit the current QASE architecture.
 * Each category has a set of types for finer classification.
 */
export const KNOWLEDGE_CATEGORIES = {
	application: {
		name: 'Application Pattern',
		description: 'Framework, auth provider, application type, architecture',
		types: ['framework', 'auth_provider', 'app_type', 'architecture'],
	},
	functional: {
		name: 'Functional Pattern',
		description: 'Login, registration, checkout, search, CRUD, onboarding flows',
		types: ['auth_flow', 'registration_flow', 'checkout_flow', 'search_flow', 'crud', 'onboarding', 'navigation'],
	},
	quality: {
		name: 'Quality Pattern',
		description: 'Recurring defects, UX problems, accessibility, security issues',
		types: ['defect', 'ux_issue', 'accessibility_issue', 'security_issue', 'workflow_failure', 'performance_issue'],
	},
	testing: {
		name: 'Testing Pattern',
		description: 'Areas commonly missed, high-risk areas, workflows that frequently fail',
		types: ['high_risk_area', 'commonly_missed', 'untested_workflow', 'edge_case'],
	},
	environmental: {
		name: 'Environmental Pattern',
		description: 'Browser-specific behavior, viewport-specific behavior, network issues',
		types: ['browser_specific', 'viewport_specific', 'network_issue'],
	},
};

export const ALL_CATEGORY_KEYS = Object.keys(KNOWLEDGE_CATEGORIES);

/**
 * Validation results — what happened to a knowledge item in the current mission.
 */
export const VALIDATION_RESULTS = {
	CONFIRMED: 'confirmed',       // Current mission reproduced the same pattern
	SUPPORTED: 'supported',       // Current mission found related evidence (not exact)
	CONTRADICTED: 'contradicted', // Current mission found evidence against the pattern
	NOT_TESTED: 'not_tested',     // Pattern area was not reached/exercised
	IRRELEVANT: 'irrelevant',     // Pattern doesn't apply to this application
};

/**
 * Knowledge status lifecycle.
 */
export const KNOWLEDGE_STATUS = {
	ACTIVE: 'active',         // Knowledge is being used
	INACTIVE: 'inactive',     // Confidence too low or deprecated
	CONTRADICTED: 'contradicted', // Repeatedly contradicted by recent evidence
};

/* ── Confidence Model ──────────────────────────────────────────── */

/**
 * Multi-factor confidence calculation.
 *
 * Factors:
 *   - occurrenceBase: from independent observations (step function)
 *   - recencyFactor: decays over time since lastSeen
 *   - validationBonus: + when confirmed, - when contradicted
 *   - consistencyFactor: ratio of confirmations to total validations
 *
 * Final confidence = clamp(0.01, 0.99, occurrenceBase * recencyFactor + validationBonus + consistencyFactor)
 */

const DECAY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MIN_CONFIDENCE = 0.01;
const MAX_CONFIDENCE = 0.99;

/**
 * Base confidence from occurrence count.
 * Grows logarithmically to avoid over-accumulation.
 */
export function occurrenceBaseConfidence(occurrences) {
	if (occurrences <= 0) return 0;
	if (occurrences === 1) return 0.25;
	if (occurrences === 2) return 0.40;
	if (occurrences === 3) return 0.55;
	if (occurrences === 4) return 0.65;
	if (occurrences >= 10) return 0.85;
	// 5-9: interpolate between 0.70 and 0.82
	return Math.min(0.82, 0.70 + (occurrences - 5) * 0.03);
}

/**
 * Recency factor — exponential decay based on time since lastSeen.
 * Uses a half-life so confidence halves every DECAY_HALF_LIFE_MS.
 *
 * @param {number} lastSeenMs - epoch ms of last observation
 * @param {number} nowMs - current time (default Date.now())
 * @returns {number} factor between 0.3 (very old) and 1.0 (fresh)
 */
export function recencyFactor(lastSeenMs, nowMs = Date.now()) {
	const ageMs = nowMs - lastSeenMs;
	if (ageMs <= 0) return 1.0;
	// Exponential decay: factor = 0.3 + 0.7 * 0.5^(age / halfLife)
	// Floor at 0.3 so very old knowledge doesn't vanish completely
	const halfLives = ageMs / DECAY_HALF_LIFE_MS;
	return Math.max(0.3, 0.3 + 0.7 * Math.pow(0.5, halfLives));
}

/**
 * Validation bonus from post-mission validations.
 * Confirmed adds, contradicted subtracts, not_tested is neutral.
 *
 * @param {object[]} validations - array of { result, timestamp }
 * @returns {number} bonus between -0.30 and +0.15
 */
export function validationBonus(validations = []) {
	if (!validations || validations.length === 0) return 0;

	let bonus = 0;
	for (const v of validations) {
		if (v.result === VALIDATION_RESULTS.CONFIRMED) bonus += 0.05;
		else if (v.result === VALIDATION_RESULTS.SUPPORTED) bonus += 0.03;
		else if (v.result === VALIDATION_RESULTS.CONTRADICTED) bonus -= 0.10;
		// NOT_TESTED and IRRELEVANT: no change
	}
	// Clamp
	return Math.max(-0.30, Math.min(0.15, bonus));
}

/**
 * Consistency factor — ratio of positive validations to total.
 * Low consistency (many contradictions relative to confirmations) reduces confidence.
 *
 * @param {object[]} validations
 * @returns {number} factor between 0.5 and 1.0
 */
export function consistencyFactor(validations = []) {
	if (!validations || validations.length === 0) return 1.0;

	const positive = validations.filter(v =>
		v.result === VALIDATION_RESULTS.CONFIRMED || v.result === VALIDATION_RESULTS.SUPPORTED
	).length;
	const negative = validations.filter(v =>
		v.result === VALIDATION_RESULTS.CONTRADICTED
	).length;
	const total = positive + negative;
	if (total === 0) return 1.0;

	const ratio = positive / total;
	// Map ratio [0, 1] → factor [0.5, 1.0]
	return 0.5 + 0.5 * ratio;
}

/**
 * Calculate the full multi-factor confidence for a knowledge item.
 *
 * @param {object} item - knowledge item with occurrences, lastSeen, validations
 * @param {number} nowMs - current time
 * @returns {number} confidence between 0.01 and 0.99
 */
export function calculateConfidence(item, nowMs = Date.now()) {
	const base = occurrenceBaseConfidence(item.occurrences || 0);
	const recency = recencyFactor(item.lastSeen || nowMs, nowMs);
	const vBonus = validationBonus(item.validations);
	const consistency = consistencyFactor(item.validations);

	const raw = base * recency * consistency + vBonus;
	return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, raw));
}

/**
 * Determine if knowledge should be marked inactive based on confidence.
 */
export function shouldDeactivate(item, nowMs = Date.now()) {
	const conf = calculateConfidence(item, nowMs);
	const contradictions = (item.validations || []).filter(v => v.result === VALIDATION_RESULTS.CONTRADICTED).length;
	// Deactivate if confidence very low AND has been contradicted at least twice
	return conf < 0.10 && contradictions >= 2;
}

/* ── Knowledge Item Factory ────────────────────────────────────── */

/**
 * Create a new knowledge item with full schema and provenance.
 *
 * @param {object} opts
 * @returns {object} structured knowledge item
 */
export function createKnowledgeItem({
	category,
	type,
	pattern,
	description = '',
	framework = null,
	authProvider = null,
	appType = null,
	recommendation = '',
	sourceMissionId,
	sourceFindingId = null,
	sourceSessionId = null,
	applicableConditions = [],
}) {
	const now = Date.now();
	return {
		// Identity
		id: `kp_${randomUUID().slice(0, 8)}`,
		category: category || 'quality',
		type: type || 'defect',

		// Content (sanitized by caller)
		pattern: (pattern || '').slice(0, 200),
		description: (description || '').slice(0, 500),
		recommendation: (recommendation || '').slice(0, 500),

		// Matching metadata
		framework: framework || null,
		authProvider: authProvider || null,
		appType: appType || null,
		applicableConditions: applicableConditions.slice(0, 10),

		// Confidence (computed by calculateConfidence)
		occurrences: 1,
		confidence: 0.25,

		// Lifecycle timestamps
		firstSeen: now,
		lastSeen: now,
		lastValidated: null,

		// Status
		status: KNOWLEDGE_STATUS.ACTIVE,

		// Provenance — full audit trail
		sourceMissions: [{
			missionId: sourceMissionId || null,
			findingId: sourceFindingId,
			sessionId: sourceSessionId,
			timestamp: now,
		}],

		// Validation history
		validations: [],

		// Contradiction tracking
		contradictions: [],
	};
}

/**
 * Validate a knowledge item's schema.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateKnowledgeItem(item) {
	const errors = [];

	if (!item.id || typeof item.id !== 'string') errors.push('Missing or invalid id');
	if (!item.category || !KNOWLEDGE_CATEGORIES[item.category]) errors.push(`Invalid category: ${item.category}`);
	if (!item.pattern || typeof item.pattern !== 'string') errors.push('Missing or invalid pattern');
	if (typeof item.occurrences !== 'number' || item.occurrences < 0) errors.push('Invalid occurrences');
	if (typeof item.confidence !== 'number') errors.push('Invalid confidence');
	if (!Array.isArray(item.sourceMissions)) errors.push('sourceMissions must be an array');
	if (!Array.isArray(item.validations)) errors.push('validations must be an array');
	if (!Array.isArray(item.contradictions)) errors.push('contradictions must be an array');

	return { valid: errors.length === 0, errors };
}

/* ── Serialization ─────────────────────────────────────────────── */

/**
 * Serialize for persistence (strips computed fields, keeps all data).
 */
export function serializeKnowledgeItem(item) {
	return JSON.parse(JSON.stringify(item));
}

/**
 * Deserialize from stored JSON (validates and fills defaults).
 */
export function deserializeKnowledgeItem(data) {
	return {
		id: data.id,
		category: data.category || 'quality',
		type: data.type || 'defect',
		pattern: data.pattern || '',
		description: data.description || '',
		recommendation: data.recommendation || '',
		framework: data.framework || null,
		authProvider: data.authProvider || null,
		appType: data.appType || null,
		applicableConditions: data.applicableConditions || [],
		occurrences: data.occurrences || 1,
		confidence: data.confidence || 0.25,
		firstSeen: data.firstSeen || Date.now(),
		lastSeen: data.lastSeen || Date.now(),
		lastValidated: data.lastValidated || null,
		status: data.status || KNOWLEDGE_STATUS.ACTIVE,
		sourceMissions: data.sourceMissions || [],
		validations: data.validations || [],
		contradictions: data.contradictions || [],
	};
}

/* ── Migration ─────────────────────────────────────────────────── */

/**
 * Migrate a legacy Phase 1 knowledge pattern to the new schema.
 * Legacy format: { id, framework, authProvider, appType, pattern, issue,
 *                  recommendation, fixPrompt, source: {missionId, findingId},
 *                  occurrences, confidence, firstSeen, lastSeen }
 */
export function migrateLegacyPattern(legacy) {
	const now = Date.now();
	return deserializeKnowledgeItem({
		id: legacy.id,
		category: 'quality',
		type: classifyPatternType(legacy.pattern || legacy.issue || ''),
		pattern: legacy.pattern || legacy.issue || '',
		description: legacy.issue || legacy.pattern || '',
		recommendation: legacy.recommendation || legacy.fixPrompt || '',
		framework: legacy.framework || null,
		authProvider: legacy.authProvider || null,
		appType: legacy.appType || null,
		applicableConditions: [],
		occurrences: legacy.occurrences || 1,
		confidence: legacy.confidence || 0.25,
		firstSeen: legacy.firstSeen || now,
		lastSeen: legacy.lastSeen || now,
		lastValidated: null,
		status: KNOWLEDGE_STATUS.ACTIVE,
		sourceMissions: [{
			missionId: legacy.source?.missionId || null,
			findingId: legacy.source?.findingId || null,
			sessionId: null,
			timestamp: legacy.firstSeen || now,
		}],
		validations: [],
		contradictions: [],
	});
}

/**
 * Heuristic classification of a pattern text into a type.
 */
function classifyPatternType(text) {
	const t = (text || '').toLowerCase();
	if (/login|auth|session|token|password|otp|2fa/.test(t)) return 'auth_flow';
	if (/regist|sign.?up|create account|onboard/.test(t)) return 'registration_flow';
	if (/checkout|cart|payment|order|purchase/.test(t)) return 'checkout_flow';
	if (/search|filter|sort/.test(t)) return 'search_flow';
	if (/form|input|submit|validation/.test(t)) return 'crud';
	if (/accessib|aria|screen reader|keyboard|contrast/.test(t)) return 'accessibility_issue';
	if (/security|xss|injection|csrf|csp/.test(t)) return 'security_issue';
	if (/performance|slow|timeout|load time/.test(t)) return 'performance_issue';
	if (/responsive|viewport|mobile|layout break/.test(t)) return 'viewport_specific';
	return 'defect';
}

/* ── Summary ───────────────────────────────────────────────────── */

/**
 * Produce a compact summary for API/UI display.
 */
export function summarizeKnowledgeItem(item) {
	return {
		id: item.id,
		category: item.category,
		type: item.type,
		pattern: item.pattern,
		framework: item.framework,
		authProvider: item.authProvider,
		appType: item.appType,
		confidence: Math.round((item.confidence || 0) * 100) / 100,
		occurrences: item.occurrences,
		status: item.status,
		lastSeen: item.lastSeen,
		lastValidated: item.lastValidated,
		validationCount: (item.validations || []).length,
		contradictionCount: (item.contradictions || []).length,
		sourceMissionCount: (item.sourceMissions || []).length,
	};
}
