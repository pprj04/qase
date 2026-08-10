/**
 * Application Model — Structured representation of QASE's understanding
 * of an application under test.
 *
 * The model separates four types of information:
 *   A. INTENT     — what the user says should exist (mission context)
 *   B. OBSERVED   — what QASE actually observed (exploration data)
 *   C. INFERENCE  — what QASE reasons from the evidence
 *   D. UNKNOWN    — what QASE cannot confidently determine
 *
 * Purpose is an OUTPUT of understanding, derived from multiple evidence
 * sources — not a keyword-matching guess made before analysis.
 *
 * This module provides:
 *   - createAppModel()         — factory for an empty model
 *   - validateAppModel(model)  — structural validation
 *   - serializeAppModel(model) — JSON-safe serialization
 *   - deserializeAppModel(raw) — restore from persisted JSON
 */

/**
 * Confidence value with an explainable basis.
 * Every confidence number must have human-readable reasons.
 *
 * @typedef {Object} ExplainableConfidence
 * @property {number} value     - 0.0 to 1.0
 * @property {string[]} basis   - human-readable reasons supporting this value
 */

/**
 * Evidence reference — links a conclusion to its supporting evidence.
 *
 * @typedef {Object} EvidenceRef
 * @property {string} id          - unique evidence id
 * @property {string} source      - 'mission_context' | 'static' | 'interactive' | 'knowledge' | 'heuristic' | 'llm'
 * @property {string} type        - 'intent' | 'observation' | 'inference'
 * @property {string} description - what was observed/inferred
 * @property {number} [timestamp] - when (ms epoch), if available
 */

/**
 * Creates an empty Application Model with all fields initialized.
 *
 * @param {Object} opts
 * @param {string} opts.missionId
 * @param {string} opts.targetUrl
 * @returns {Object} empty model ready to be populated
 */
export function createAppModel({ missionId = null, targetUrl = null } = {}) {
	const now = Date.now();
	return {
		// ── Identity ──
		missionId,
		targetUrl,
		name: null,
		applicationId: null,
		createdAt: now,
		updatedAt: now,

		// ── Status ──
		// 'discovered' → raw evidence collected
		// 'understood' → model populated, high confidence
		// 'partially_understood' → model populated, gaps remain
		// 'uncertain' → insufficient evidence
		status: 'discovered',

		// ── A. INTENT (User/Build Intent) ──
		intent: {
			buildPrompt: null,
			requirements: [],
			businessGoals: null,
			hasTestCredentials: false,
			derivedExpectations: {
				features: [],   // [{ name, source, confidence }]
				workflows: [],  // [{ name, steps: string[], source }]
				roles: [],      // [{ name, source }]
			},
		},

		// ── B. OBSERVED (Application Behavior) ──
		observed: {
			pages: [],          // [{ url, title? }]
			pageCount: 0,
			formFields: [],     // string[]
			authState: {
				hasLogin: false,
				hasLogout: false,
				hasRegister: false,
				loginVerified: false,
				loginBroken: false,
			},
			capabilities: {},    // { search: bool, dashboard: bool, ... }
			verifiedFeatures: {}, // { search: bool, payment: bool, ... }
			brokenFeatures: {},   // { search: bool, payment: bool, ... }
			framework: null,
			authProvider: null,
			pageTransitions: [], // [{ from, to, action }]
			explorationDepth: 0,
			explorationConfidence: 0,
		},

		// ── C. INFERENCE (Reasoned Understanding) ──
		understanding: {
			purpose: {
				id: null,           // 'crm' | 'ecommerce' | ... | 'unknown' | 'uncertain'
				name: null,
				source: null,       // 'heuristic' | 'llm' | 'context' | 'merged'
				heuristicBaseline: null, // preserve original heuristic result
				llmResult: null,    // preserve LLM result if used
			},
			applicationType: null,  // from heuristic appType detection
			domain: null,           // e.g., 'payments', 'healthcare', 'education'
			roles: [],              // [{ name, source: 'context'|'observed'|'inferred', confidence }]
			features: {
				expected: [],   // [{ name, category, severity, source, confidence }]
				observed: [],   // [{ name, source, evidenceRef }]
				verified: [],   // [{ name, evidenceRef }]
				broken: [],     // [{ name, evidenceRef }]
				unverified: [], // [{ name, reason }]
			},
			workflows: [],          // [{ name, purpose, expectedSteps: [{id,name,status}], confidence, source }]
			authenticationModel: {
				type: null,      // 'form_based' | 'oauth' | 'none' | 'unknown'
				verified: false,
				evidence: null,
			},
		},

		// ── D. UNKNOWN ──
		unknowns: [],  // [{ description, category, reason, blocking }]

		// ── Conflicts ──
		conflicts: [],  // [{ description, expectedValue, observedValue, sources, impact, confidence }]

		// ── Confidence ──
		confidence: {
			overall: { value: 0, basis: [] },
			purpose: { value: 0, basis: [] },
			features: { value: 0, basis: [] },
			workflows: { value: 0, basis: [] },
			context: { value: 0, basis: [] },
		},

		// ── Evidence Lineage ──
		evidence: [],  // EvidenceRef[]

		// ── Metadata ──
		metadata: {
			heuristicUsed: false,
			llmUsed: false,
			sourcesConsulted: [],
			warnings: [],
		},
	};
}

/**
 * Creates a confidence value with explainable basis.
 *
 * @param {number} value - 0.0 to 1.0
 * @param {string[]} basis - reasons supporting this value
 * @returns {ExplainableConfidence}
 */
export function makeConfidence(value, basis = []) {
	const clamped = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
	return { value: clamped, basis: basis.filter(Boolean) };
}

/**
 * Adds an evidence record to the model and returns its id.
 *
 * @param {Object} model - the app model
 * @param {string} source - evidence source category
 * @param {string} type - 'intent' | 'observation' | 'inference'
 * @param {string} description - what was observed/inferred
 * @param {number} [timestamp]
 * @returns {string} the evidence id
 */
export function addEvidence(model, source, type, description, timestamp = null) {
	const id = `ev-${model.evidence.length + 1}-${Date.now().toString(36)}`;
	model.evidence.push({
		id,
		source,
		type,
		description: String(description).slice(0, 500), // cap length for safety
		timestamp: timestamp || Date.now(),
	});
	return id;
}

/**
 * Adds an unknown entry to the model.
 *
 * @param {Object} model
 * @param {string} description - what is unknown
 * @param {string} category - 'auth' | 'feature' | 'workflow' | 'integration' | 'data' | 'other'
 * @param {string} reason - why it is unknown
 * @param {boolean} [blocking] - does this block further understanding?
 */
export function addUnknown(model, description, category, reason, blocking = false) {
	model.unknowns.push({ description, category, reason, blocking });
}

/**
 * Adds a conflict entry when evidence disagrees.
 *
 * @param {Object} model
 * @param {string} description
 * @param {string} expectedValue
 * @param {string} observedValue
 * @param {string[]} sources
 * @param {string} impact
 * @param {number} confidence
 */
export function addConflict(model, description, expectedValue, observedValue, sources, impact, confidence) {
	model.conflicts.push({
		description,
		expectedValue,
		observedValue,
		sources,
		impact,
		confidence: Math.max(0, Math.min(1, confidence)),
	});
}

/**
 * Validates the structural integrity of an Application Model.
 * Returns a list of issues (empty = valid).
 *
 * @param {Object} model
 * @returns {string[]} issues found
 */
export function validateAppModel(model) {
	const issues = [];

	if (!model || typeof model !== 'object') {
		return ['Model is not an object'];
	}

	const requiredTopLevel = ['missionId', 'targetUrl', 'status', 'intent', 'observed', 'understanding', 'unknowns', 'conflicts', 'confidence', 'evidence'];
	for (const key of requiredTopLevel) {
		if (!(key in model)) {
			issues.push(`Missing top-level field: ${key}`);
		}
	}

	const validStatuses = ['discovered', 'understood', 'partially_understood', 'uncertain'];
	if (model.status && !validStatuses.includes(model.status)) {
		issues.push(`Invalid status: ${model.status}`);
	}

	// Confidence values must be 0-1 with basis arrays
	if (model.confidence) {
		for (const [key, conf] of Object.entries(model.confidence)) {
			if (typeof conf?.value !== 'number' || conf.value < 0 || conf.value > 1) {
				issues.push(`Confidence.${key}.value must be 0-1, got: ${conf?.value}`);
			}
			if (!Array.isArray(conf?.basis)) {
				issues.push(`Confidence.${key}.basis must be an array`);
			}
		}
	}

	// Evidence entries must have required fields
	if (Array.isArray(model.evidence)) {
		for (const ev of model.evidence) {
			if (!ev.source || !ev.type || !ev.description) {
				issues.push(`Evidence entry missing required fields: ${JSON.stringify(ev).slice(0, 100)}`);
			}
		}
	}

	return issues;
}

/**
 * Serializes the model for JSON persistence.
 * Removes any non-serializable fields.
 *
 * @param {Object} model
 * @returns {Object} JSON-safe object
 */
export function serializeAppModel(model) {
	return JSON.parse(JSON.stringify(model));
}

/**
 * Deserializes a model from persisted JSON.
 * Validates structure and fills missing fields with defaults.
 *
 * @param {Object} raw
 * @returns {Object} restored model
 */
export function deserializeAppModel(raw) {
	if (!raw || typeof raw !== 'object') return createAppModel();

	const base = createAppModel({ missionId: raw.missionId, targetUrl: raw.targetUrl });

	// Shallow merge top-level fields
	for (const key of Object.keys(base)) {
		if (key in raw) {
			if (typeof base[key] === 'object' && !Array.isArray(base[key]) && typeof raw[key] === 'object') {
				base[key] = { ...base[key], ...raw[key] };
			} else {
				base[key] = raw[key];
			}
		}
	}

	return base;
}

/**
 * Determines the model status based on evidence quality and confidence.
 *
 * @param {Object} model
 * @returns {string} 'understood' | 'partially_understood' | 'uncertain'
 */
export function determineStatus(model) {
	const overall = model.confidence.overall.value;
	const evidenceCount = model.evidence.length;
	const hasPurpose = model.understanding.purpose?.id && model.understanding.purpose.id !== 'unknown';

	if (overall >= 0.7 && hasPurpose && evidenceCount >= 5) {
		return 'understood';
	} else if ((overall >= 0.3 || hasPurpose) && evidenceCount >= 3) {
		return 'partially_understood';
	} else {
		return 'uncertain';
	}
}

/**
 * Generates a human-readable summary of the application model.
 * Used for API responses and UI display.
 *
 * @param {Object} model
 * @returns {Object} summary with key fields
 */
export function summarizeAppModel(model) {
	const purpose = model.understanding.purpose;
	const features = model.understanding.features;

	return {
		status: model.status,
		purpose: purpose ? {
			id: purpose.id,
			name: purpose.name,
			confidence: model.confidence.purpose.value,
			confidenceBasis: model.confidence.purpose.basis,
			source: purpose.source,
		} : null,
		applicationType: model.understanding.applicationType,
		domain: model.understanding.domain,
		roles: model.understanding.roles,
		features: {
			expectedCount: features.expected.length,
			observedCount: features.observed.length,
			verifiedCount: features.verified.length,
			brokenCount: features.broken.length,
			unverifiedCount: features.unverified.length,
			expected: features.expected.map(f => f.name),
			observed: features.observed.map(f => f.name),
			verified: features.verified.map(f => f.name),
		},
		workflows: model.understanding.workflows.map(w => ({
			name: w.name,
			stepsTotal: w.expectedSteps?.length || 0,
			stepsObserved: w.expectedSteps?.filter(s => s.status === 'observed' || s.status === 'verified').length || 0,
			confidence: w.confidence,
		})),
		unknowns: model.unknowns.map(u => u.description),
		conflicts: model.conflicts.map(c => c.description),
		confidence: {
			overall: model.confidence.overall.value,
			purpose: model.confidence.purpose.value,
			features: model.confidence.features.value,
			workflows: model.confidence.workflows.value,
		},
		evidenceCount: model.evidence.length,
		metadata: model.metadata,
	};
}
