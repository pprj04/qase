/**
 * Knowledge Layer (Phase 3)
 *
 * A pattern store that lets QASE learn from past missions and apply that
 * knowledge to future ones. Phase 3 transforms this from a write-only
 * data dump into a real reusable intelligence capability.
 *
 * Write AFTER each mission: extract validated patterns from findings + app model.
 * Read BEFORE each mission: match app metadata → surface relevant patterns as hints.
 * Validate AFTER each mission: classify each relevant pattern (confirmed/contradicted/etc).
 *
 * CRITICAL: Historical knowledge is evidence/hints, NOT ground truth.
 * Current evidence ALWAYS outranks historical knowledge.
 *
 * Key improvements over Phase 1:
 *   - Atomic writes (no corruption on crash)
 *   - Multi-factor confidence (occurrence + recency + validation + consistency)
 *   - Confidence decay (old knowledge fades)
 *   - App Model-aware relevance matching (not just OR-based keyword)
 *   - Post-mission validation (confirmed/supported/contradicted/not_tested)
 *   - Conflict detection (historical vs current evidence)
 *   - Deduplication with similarity matching
 *   - Bounded growth (max patterns, LRU eviction)
 *   - Prompt injection sanitization on all stored content
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './atomicWrite.js';
import {
	createKnowledgeItem,
	validateKnowledgeItem,
	calculateConfidence,
	shouldDeactivate,
	migrateLegacyPattern,
	serializeKnowledgeItem,
	deserializeKnowledgeItem,
	summarizeKnowledgeItem,
	KNOWLEDGE_CATEGORIES,
	KNOWLEDGE_STATUS,
	VALIDATION_RESULTS,
	ALL_CATEGORY_KEYS,
} from './knowledgeModel.js';

/* ── Constants ──────────────────────────────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', '.qase', 'knowledge.json');

const MAX_PATTERNS = 500; // Bounded growth
const SAVE_DEBOUNCE_MS = 500;
const SIMILARITY_THRESHOLD = 0.65; // For dedup matching

/* ── Storage ───────────────────────────────────────────────────── */

let patterns = [];
let saveTimer = null;
let dirty = false;

/* ── Persistence (Atomic) ──────────────────────────────────────── */

function load() {
	try {
		if (!existsSync(FILE)) return;
		const raw = readFileSync(FILE, 'utf8');
		const data = JSON.parse(raw);
		if (!Array.isArray(data)) { patterns = []; return; }

		// Migrate legacy patterns (Phase 1 schema → Phase 3 schema)
		patterns = data.map(item => {
			// Phase 3 schema check: has 'category' field
			if (item.category && ALL_CATEGORY_KEYS.includes(item.category)) {
				return deserializeKnowledgeItem(item);
			}
			// Legacy Phase 1 schema: migrate
			return migrateLegacyPattern(item);
		});
	} catch (err) {
		console.error('[knowledge] load failed:', err.message);
		patterns = [];
	}
}

function flushSave() {
	dirty = false;
	try {
		mkdirSync(dirname(FILE), { recursive: true });
		atomicWrite(FILE, JSON.stringify(patterns, null, 2));
	} catch (err) {
		console.error('[knowledge] save failed:', err.message);
	}
}

function scheduleSave() {
	dirty = true;
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		if (!dirty) return;
		flushSave();
	}, SAVE_DEBOUNCE_MS);
}

/** Force immediate save (used in tests). */
export function _flushSync() {
	if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
	if (dirty) flushSave();
}

/* ── Sanitization ──────────────────────────────────────────────── */

/**
 * Sanitize text before storing as knowledge.
 * Strips potential prompt injection patterns and dangerous content.
 */
function sanitizeText(text) {
	if (!text || typeof text !== 'string') return '';
	let s = text.slice(0, 500); // Length cap
	// Strip instruction injection patterns
	s = s.replace(/ignore\s+(previous|prior|above)\s+(instructions?|prompts?)/gi, '');
	s = s.replace(/you\s+are\s+(now|a)\s+/gi, '');
	s = s.replace(/act\s+as\s+(if\s+)?/gi, '');
	s = s.replace(/(system|assistant|user|role)\s*:\s*/gi, '');
	s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
	s = s.replace(/<[^>]+>/g, '');
	s = s.replace(/javascript:/gi, '');
	s = s.replace(/data:text\/html/gi, '');
	return s.trim();
}

/**
 * Sanitize all string fields of a knowledge item.
 */
function sanitizeKnowledgeItem(item) {
	item.pattern = sanitizeText(item.pattern);
	item.description = sanitizeText(item.description);
	item.recommendation = sanitizeText(item.recommendation);
	return item;
}

/* ── Pattern Extraction (unchanged API) ────────────────────────── */

/**
 * Detects framework/auth/appType hints from session data.
 * Preserved from Phase 1 — works on text content of session steps/activities.
 *
 * @param {object} session
 * @returns {{ framework?: string, authProvider?: string, appType?: string }}
 */
export function detectAppMetadata(session) {
	const meta = {};

	const allText = [
		session.targetUrl || '',
		...(session.capturedSteps ?? []).map(s => `${s.url || ''} ${s.target || ''} ${s.label || ''} ${s.outcome?.titleAfter || ''}`),
		...(session.activities ?? []).map(a => `${a.detail || ''} ${a.label || ''}`),
		session.report?.summary || ''
	].join(' ').toLowerCase();

	// Framework detection
	if (/next\.js|_next\/|__next|next\/image/.test(allText)) meta.framework = 'next.js';
	else if (/nuxt|_nuxt\//.test(allText)) meta.framework = 'nuxt';
	else if (/react|__react|react-dom/.test(allText)) meta.framework = 'react';
	else if (/vue|__vue|vue\.js/.test(allText)) meta.framework = 'vue';
	else if (/angular|ng-|_ng/.test(allText)) meta.framework = 'angular';
	else if (/svelte|sveltekit/.test(allText)) meta.framework = 'svelte';

	// Auth provider detection
	if (/clerk|clerk\.com|__clerk/.test(allText)) meta.authProvider = 'clerk';
	else if (/auth0|auth0\.com/.test(allText)) meta.authProvider = 'auth0';
	else if (/firebase|firebaseauth/.test(allText)) meta.authProvider = 'firebase';
	else if (/supabase|supabase\.co/.test(allText)) meta.authProvider = 'supabase';
	else if (/okta|okta\.com/.test(allText)) meta.authProvider = 'okta';

	// App type detection
	if (/shop|store|product|cart|checkout|wishlist/.test(allText)) meta.appType = 'ecommerce';
	else if (/blog|article|post|news|magazine/.test(allText)) meta.appType = 'content';
	else if (/dashboard|analytics|chart|metric|report/.test(allText)) meta.appType = 'dashboard';
	else if (/crm|lead|pipeline|contact|deal/.test(allText)) meta.appType = 'crm';
	else if (/landing|hero|marketing|pricing|sign.?up/.test(allText)) meta.appType = 'marketing';
	else if (/saas|subscription|workspace|organization|team/.test(allText)) meta.appType = 'saas';

	return meta;
}

/* ── Normalization & Deduplication ─────────────────────────────── */

/**
 * Normalize an issue string for deduplication.
 */
export function normalizeIssue(issue) {
	return (issue || '')
		.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}

/**
 * Compute similarity between two normalized strings.
 * Uses token overlap (Jaccard similarity) — simple and effective for short texts.
 *
 * @param {string} a - normalized text
 * @param {string} b - normalized text
 * @returns {number} 0 to 1
 */
export function textSimilarity(a, b) {
	if (!a || !b) return 0;
	if (a === b) return 1;
	const tokensA = new Set(a.split(' ').filter(Boolean));
	const tokensB = new Set(b.split(' ').filter(Boolean));
	if (tokensA.size === 0 || tokensB.size === 0) return 0;
	const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
	const union = new Set([...tokensA, ...tokensB]).size;
	return intersection / union;
}

/**
 * Determine if two patterns are similar enough to be considered duplicates.
 * Considers: text similarity + metadata overlap (framework, authProvider).
 *
 * @param {object} existing - existing knowledge item
 * @param {string} newIssueNorm - normalized new issue text
 * @param {object} newMeta - { framework, authProvider }
 * @returns {boolean}
 */
function isDuplicate(existing, newIssueNorm, newMeta) {
	const existingNorm = normalizeIssue(existing.pattern || existing.issue || '');

	// Exact match → always duplicate
	if (existingNorm === newIssueNorm) return true;

	// High text similarity + metadata agreement
	const sim = textSimilarity(existingNorm, newIssueNorm);
	if (sim < SIMILARITY_THRESHOLD) return false;

	// Must also agree on framework and auth provider (if specified)
	const fwMatch = !existing.framework || !newMeta.framework || existing.framework === newMeta.framework;
	const authMatch = !existing.authProvider || !newMeta.authProvider || existing.authProvider === newMeta.authProvider;

	return fwMatch && authMatch;
}

/* ── Confidence Recalculation ──────────────────────────────────── */

/**
 * Recalculate confidence for a pattern and update its status.
 */
function recalculateConfidence(item) {
	item.confidence = calculateConfidence(item);
	if (shouldDeactivate(item)) {
		item.status = KNOWLEDGE_STATUS.CONTRADICTED;
	} else if (item.confidence < 0.05) {
		item.status = KNOWLEDGE_STATUS.INACTIVE;
	} else if (item.status === KNOWLEDGE_STATUS.INACTIVE && item.confidence > 0.10) {
		item.status = KNOWLEDGE_STATUS.ACTIVE;
	}
}

/* ── Knowledge Writing ─────────────────────────────────────────── */

/**
 * Extract notable findings as knowledge patterns.
 * Enhanced for Phase 3:
 *   - Uses similarity-based deduplication (not just exact key match)
 *   - Applies multi-factor confidence
 *   - Sanitizes all stored content
 *   - Tracks provenance per mission
 *   - Enforces bounded growth
 *
 * @param {object[]} findings — session findings
 * @param {object} session — the session
 * @param {string} missionId — source mission
 * @returns {object[]} new and accumulated patterns
 */
export function writeKnowledge(findings, session, missionId) {
	const meta = detectAppMetadata(session);
	const now = Date.now();
	const results = [];
	const sessionId = session.id || null;

	for (const f of findings) {
		// Only extract notable findings (severity >= medium)
		const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
		const sev = sevOrder[f.severity] ?? 5;
		if (sev > 2) continue;

		const issueNorm = normalizeIssue(f.title || f.observed || f.description || '');
		if (!issueNorm || issueNorm.length < 10) continue;

		// Find existing similar pattern
		const existing = patterns.find(p =>
			p.status !== KNOWLEDGE_STATUS.INACTIVE &&
			isDuplicate(p, issueNorm, meta)
		);

		if (existing) {
			// Accumulate
			existing.occurrences += 1;
			existing.lastSeen = now;
			existing.confidence = calculateConfidence(existing);

			// Add provenance
			existing.sourceMissions.push({
				missionId,
				findingId: f.id || null,
				sessionId,
				timestamp: now,
			});

			// Update recommendation if richer
			const newRec = sanitizeText(f.recommendation || f.fixPrompt || '');
			if (newRec && existing.recommendation.length < newRec.length) {
				existing.recommendation = newRec;
			}

			results.push({ action: 'accumulated', pattern: existing });
		} else {
			// Create new pattern with full Phase 3 schema
			const item = sanitizeKnowledgeItem(createKnowledgeItem({
				category: classifyCategory(f, issueNorm),
				type: classifyType(issueNorm),
				pattern: issueNorm,
				description: f.title || f.observed || f.description || '',
				framework: meta.framework || null,
				authProvider: meta.authProvider || null,
				appType: meta.appType || null,
				recommendation: f.recommendation || f.fixPrompt || 'Investigate and validate.',
				sourceMissionId: missionId,
				sourceFindingId: f.id || null,
				sourceSessionId: sessionId,
			}));
			item.confidence = calculateConfidence(item);
			patterns.push(item);
			results.push({ action: 'created', pattern: item });
		}
	}

	// Enforce bounded growth — evict lowest-confidence oldest patterns
	if (patterns.length > MAX_PATTERNS) {
		patterns.sort((a, b) => b.confidence - a.confidence || b.lastSeen - a.lastSeen);
		patterns = patterns.slice(0, MAX_PATTERNS);
	}

	if (results.length > 0) scheduleSave();
	return results;
}

/**
 * Classify a finding into a knowledge category.
 */
function classifyCategory(finding, issueNorm) {
	const text = issueNorm || '';
	const cat = finding.category || '';
	if (/accessib|aria|screen reader/.test(text)) return 'quality';
	if (/security|xss|injection|csrf/.test(text)) return 'quality';
	if (/performance|slow|timeout/.test(text)) return 'quality';
	if (/login|auth|session|password|regist|checkout|cart|search|form/.test(text)) return 'functional';
	if (/responsive|viewport|mobile|browser/.test(text)) return 'environmental';
	if (/framework|react|vue|angular|next\.js/.test(text)) return 'application';
	return 'quality';
}

/**
 * Classify a pattern into a type.
 */
function classifyType(issueNorm) {
	const t = issueNorm || '';
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

/* ── Knowledge Query (Enhanced) ────────────────────────────────── */

/**
 * Query the knowledge base for patterns relevant to this app.
 *
 * Phase 3 enhancements:
 *   - Relevance scoring (not just OR matching)
 *   - App Model-aware matching (purpose, roles, features, workflows)
 *   - Structured hints with provenance
 *   - Only returns ACTIVE patterns
 *
 * @param {object} metadata — { framework?, authProvider?, appType?, purpose?, features?[] }
 * @returns {{ patterns: object[], hints: object[], summary: string }}
 */
export function queryKnowledge(metadata = {}) {
	const now = Date.now();

	// Filter to active patterns only
	const active = patterns.filter(p => p.status === KNOWLEDGE_STATUS.ACTIVE);

	// Score each pattern for relevance
	const scored = active.map(p => ({
		item: p,
		relevance: relevanceScore(p, metadata),
		reason: relevanceReason(p, metadata),
	}));

	// Filter to patterns with any relevance > 0
	const matched = scored.filter(s => s.relevance > 0);

	// Sort by relevance × confidence (most useful first)
	matched.sort((a, b) =>
		(b.relevance * b.item.confidence) - (a.relevance * a.item.confidence)
	);

	// Build structured hints
	const hints = matched.slice(0, 10).map(s => ({
		id: s.item.id,
		category: s.item.category,
		type: s.item.type,
		pattern: s.item.pattern,
		confidence: Math.round(s.item.confidence * 100) / 100,
		occurrences: s.item.occurrences,
		lastValidated: s.item.lastValidated,
		relevance: Math.round(s.relevance * 100) / 100,
		reason: s.reason,
		recommendation: s.item.recommendation || '',
		sourceMissions: s.item.sourceMissions.length,
	}));

	// Build summary
	const summaryParts = [];
	if (matched.length > 0) {
		summaryParts.push(`${matched.length} knowledge pattern${matched.length > 1 ? 's' : ''} matched`);
		const high = matched.filter(s => s.relevance * s.item.confidence > 0.5);
		if (high.length > 0) {
			summaryParts.push(`${high.length} high-relevance pattern${high.length > 1 ? 's' : ''}`);
		}
	}

	return {
		patterns: matched.map(s => s.item),
		hints,
		summary: summaryParts.join(', ') || 'No matching patterns',
	};
}

/**
 * Calculate relevance score for a pattern against query metadata.
 * Uses weighted matching — more specific matches score higher.
 *
 * @param {object} pattern - knowledge item
 * @param {object} metadata - query metadata
 * @returns {number} 0 to 1
 */
function relevanceScore(pattern, metadata) {
	let score = 0;
	let factors = 0;

	// Framework match (weight: 0.3)
	if (metadata.framework && pattern.framework) {
		factors++;
		if (pattern.framework === metadata.framework) score += 0.3;
	}

	// Auth provider match (weight: 0.3)
	if (metadata.authProvider && pattern.authProvider) {
		factors++;
		if (pattern.authProvider === metadata.authProvider) score += 0.3;
	}

	// App type match (weight: 0.2)
	if (metadata.appType && pattern.appType) {
		factors++;
		if (pattern.appType === metadata.appType) score += 0.2;
	}

	// Purpose match (weight: 0.1) — from App Model
	if (metadata.purpose && pattern.appType) {
		factors++;
		// Map purpose → appType loosely
		const purposeToType = {
			ecommerce: 'ecommerce', crm: 'crm', admin_dashboard: 'dashboard',
			marketing: 'marketing', saas_platform: 'saas',
		};
		const expectedType = purposeToType[metadata.purpose];
		if (expectedType && pattern.appType === expectedType) score += 0.1;
	}

	// Feature overlap (weight: 0.1) — from App Model
	if (metadata.features && Array.isArray(metadata.features) && metadata.features.length > 0) {
		factors++;
		const patternText = (pattern.pattern + ' ' + pattern.description).toLowerCase();
		const overlap = metadata.features.filter(f =>
			patternText.includes(f.toLowerCase().split(' ')[0])
		).length;
		if (overlap > 0) score += Math.min(0.1, overlap * 0.03);
	}

	// If no factors were checked (metadata is empty), return 0 — no relevance
	return factors > 0 ? score : 0;
}

/**
 * Generate a human-readable reason for why a pattern matched.
 */
function relevanceReason(pattern, metadata) {
	const reasons = [];
	if (metadata.framework && pattern.framework === metadata.framework) {
		reasons.push(`same framework (${pattern.framework})`);
	}
	if (metadata.authProvider && pattern.authProvider === metadata.authProvider) {
		reasons.push(`same auth provider (${pattern.authProvider})`);
	}
	if (metadata.appType && pattern.appType === metadata.appType) {
		reasons.push(`same app type (${pattern.appType})`);
	}
	return reasons.length > 0 ? reasons.join(', ') : 'keyword match';
}

/* ── Knowledge Validation ──────────────────────────────────────── */

/**
 * Validate knowledge patterns against current mission evidence.
 *
 * For each ACTIVE pattern that was relevant to this mission, determine
 * what happened: confirmed, supported, contradicted, not_tested, or irrelevant.
 *
 * @param {object[]} relevantPatterns - patterns that were surfaced before/during mission
 * @param {object} session - completed session with findings + appModel
 * @param {string} missionId - current mission
 * @returns {object[]} validation results
 */
export function validateKnowledge(relevantPatterns, session, missionId) {
	const now = Date.now();
	const results = [];

	const sessionFindings = session.findings || [];
	const sessionSteps = session.capturedSteps || [];
	const sessionUrls = new Set(sessionSteps.map(s => s.url || '').filter(Boolean));
	const sessionText = [
		...(sessionFindings.map(f => `${f.title || ''} ${f.description || ''}`)),
		...(sessionSteps.map(s => `${s.label || ''} ${s.outcome?.titleAfter || ''}`)),
		session.report?.summary || '',
	].join(' ').toLowerCase();

	for (const pattern of relevantPatterns) {
		const item = patterns.find(p => p.id === pattern.id);
		if (!item) continue;

		const result = classifyValidation(item, sessionFindings, sessionText, sessionUrls, sessionSteps);
		const validation = {
			result,
			missionId,
			timestamp: now,
			detail: '',
		};

		// Record validation
		item.validations.push(validation);
		item.lastValidated = now;

		if (result === VALIDATION_RESULTS.CONFIRMED) {
			validation.detail = 'Pattern reproduced in current mission';
		} else if (result === VALIDATION_RESULTS.SUPPORTED) {
			validation.detail = 'Related evidence found in current mission';
		} else if (result === VALIDATION_RESULTS.CONTRADICTED) {
			validation.detail = 'Current evidence contradicts this pattern';
			item.contradictions.push({
				missionId,
				timestamp: now,
				evidence: validation.detail,
			});
		} else if (result === VALIDATION_RESULTS.NOT_TESTED) {
			validation.detail = 'Pattern area was not reached in current mission';
		} else {
			validation.detail = 'Pattern not relevant to current application';
		}

		// Recalculate confidence after validation
		recalculateConfidence(item);

		results.push({
			id: item.id,
			pattern: item.pattern,
			result,
			confidence: item.confidence,
			status: item.status,
			detail: validation.detail,
		});
	}

	if (results.length > 0) scheduleSave();
	return results;
}

/**
 * Classify how a pattern was validated against current evidence.
 */
function classifyValidation(pattern, findings, sessionText, sessionUrls, sessionSteps) {
	const patternNorm = normalizeIssue(pattern.pattern || pattern.issue || '');

	// Check if any finding matches the pattern
	const matchingFindings = findings.filter(f => {
		const fNorm = normalizeIssue(f.title || f.observed || f.description || '');
		return textSimilarity(patternNorm, fNorm) >= 0.4;
	});

	if (matchingFindings.length > 0) {
		return VALIDATION_RESULTS.CONFIRMED;
	}

	// Check if session text contains the pattern topic
	if (sessionText.includes(patternNorm.slice(0, 30))) {
		// The area was reached but no matching finding — check if it was "verified OK"
		// or just mentioned in passing
		const verifiedSteps = sessionSteps.filter(s =>
			s.outcome?.status === 'success' &&
			normalizeIssue(s.label || '').includes(patternNorm.slice(0, 10))
		);
		if (verifiedSteps.length > 0 && matchingFindings.length === 0) {
			// Pattern area was tested and no defect found → contradicted
			return VALIDATION_RESULTS.CONTRADICTED;
		}
		return VALIDATION_RESULTS.SUPPORTED;
	}

	// Check if any URL in the pattern's area was visited
	const patternUrlMatch = sessionSteps.some(s =>
		s.outcome?.urlAfter && normalizeIssue(s.outcome.urlAfter).includes(patternNorm.slice(0, 10))
	);
	if (patternUrlMatch) {
		return VALIDATION_RESULTS.SUPPORTED;
	}

	// Pattern area was never reached
	return VALIDATION_RESULTS.NOT_TESTED;
}

/* ── Conflict Detection ────────────────────────────────────────── */

/**
 * Detect conflicts between historical knowledge and current evidence.
 *
 * @param {object[]} relevantPatterns - knowledge patterns that were relevant
 * @param {object} appModel - Application Model from Phase 2
 * @param {object[]} findings - current session findings
 * @returns {object[]} conflicts
 */
export function detectKnowledgeConflicts(relevantPatterns, appModel, findings) {
	const conflicts = [];

	for (const pattern of relevantPatterns) {
		const patternNorm = normalizeIssue(pattern.pattern || pattern.issue || '');

		// Check: does current evidence contradict this pattern?
		// E.g., knowledge says "login fails" but appModel says login verified
		const modelFeatures = appModel?.understanding?.features || {};
		const verifiedFeatures = [
			...(modelFeatures.verified || []),
			...(modelFeatures.observed || []),
		].map(f => typeof f === 'string' ? f.toLowerCase() : (f.name || '').toLowerCase());

		// Pattern claims something is broken, but evidence shows it works
		const patternTopic = extractPatternTopic(patternNorm);
		if (patternTopic) {
			const contradictedByEvidence = verifiedFeatures.some(vf => vf.includes(patternTopic));
			if (contradictedByEvidence) {
				conflicts.push({
					patternId: pattern.id,
					pattern: pattern.pattern,
					historicalClaim: `${pattern.pattern} (historical, confidence: ${pattern.confidence?.toFixed(2)})`,
					currentEvidence: `${patternTopic} verified as working in current mission`,
					resolution: 'current_evidence_wins',
					impact: 'Pattern confidence should decrease',
				});
			}
		}

		// Check: does any current finding directly contradict the pattern?
		// E.g., knowledge says "search fails" but a finding says "search works correctly"
		for (const f of findings) {
			const fNorm = normalizeIssue(f.title || f.description || '');
			if (textSimilarity(patternNorm, fNorm) > 0.4) {
				const patternClaimsFailure = /fail|broken|error|bug|missing|broken|incorrect|wrong/.test(patternNorm);
				const findingSaysWorking = /works|correct|passing|success|verified|functional/.test(fNorm);
				if (patternClaimsFailure && findingSaysWorking) {
					conflicts.push({
						patternId: pattern.id,
						pattern: pattern.pattern,
						historicalClaim: pattern.pattern,
						currentEvidence: f.title || f.description,
						resolution: 'current_evidence_wins',
						impact: 'Direct contradiction — pattern may be outdated',
					});
				}
			}
		}
	}

	return conflicts;
}

/**
 * Extract the key topic from a pattern for feature matching.
 */
function extractPatternTopic(patternNorm) {
	if (/login|auth|sign.?in/.test(patternNorm)) return 'login';
	if (/regist|sign.?up/.test(patternNorm)) return 'registration';
	if (/checkout|cart|payment/.test(patternNorm)) return 'checkout';
	if (/search|filter/.test(patternNorm)) return 'search';
	if (/dashboard/.test(patternNorm)) return 'dashboard';
	if (/contact|lead|deal/.test(patternNorm)) return 'contact';
	return null;
}

/* ── Exploration Hints ─────────────────────────────────────────── */

/**
 * Generate exploration hints for the agent based on relevant knowledge.
 *
 * CRITICAL: These are HINTS, not instructions. Knowledge guides WHERE to look,
 * never dictates WHAT IS TRUE.
 *
 * @param {object[]} relevantPatterns - knowledge patterns
 * @returns {string} formatted hint text for agent prompt (sanitized, delimited)
 */
export function generateExplorationHints(relevantPatterns) {
	if (!relevantPatterns || relevantPatterns.length === 0) return '';

	const lines = [
		'',
		'# Historical Knowledge Signals (UNTRUSTED — use as guidance only)',
		'',
		'The following patterns were observed in PREVIOUS missions on SIMILAR applications.',
		'These are historical hints, NOT current facts. Validate everything independently.',
		'Current evidence always overrides historical knowledge.',
		'',
	];

	const top = relevantPatterns
		.filter(p => p.confidence > 0.15)
		.slice(0, 5);

	for (const p of top) {
		const sanitizedPattern = sanitizeText(p.pattern || p.issue || '');
		const sanitizedRec = sanitizeText(p.recommendation || '');
		const conf = Math.round((p.confidence || 0) * 100);
		lines.push(`- [HISTORICAL SIGNAL] ${sanitizedPattern}`);
		lines.push(`  Confidence: ${conf}% | Observed: ${p.occurrences || 1} mission(s)`);
		if (sanitizedRec) lines.push(`  Suggestion: ${sanitizedRec}`);
		lines.push('');
	}

	lines.push('Remember: Validate these areas but do not assume the pattern holds.');
	lines.push('');

	return lines.join('\n');
}

/* ── Utility (Enhanced) ────────────────────────────────────────── */

export function getAllPatterns() {
	const now = Date.now();
	// Recalculate confidence for all patterns (applies decay)
	for (const p of patterns) {
		recalculateConfidence(p);
	}
	return [...patterns].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getPatternById(id) {
	const item = patterns.find(p => p.id === id);
	if (item) recalculateConfidence(item);
	return item || null;
}

/**
 * Get patterns for a specific mission.
 */
export function getPatternsForMission(missionId) {
	return patterns.filter(p =>
		p.sourceMissions?.some?.(s => s.missionId === missionId)
	).map(p => summarizeKnowledgeItem(p));
}

/**
 * Get pattern provenance (full audit trail).
 */
export function getPatternProvenance(id) {
	const item = patterns.find(p => p.id === id);
	if (!item) return null;
	return {
		id: item.id,
		pattern: item.pattern,
		sourceMissions: item.sourceMissions || [],
		validations: item.validations || [],
		contradictions: item.contradictions || [],
		confidence: item.confidence,
		occurrences: item.occurrences,
		firstSeen: item.firstSeen,
		lastSeen: item.lastSeen,
		lastValidated: item.lastValidated,
		status: item.status,
	};
}

export function deletePattern(id) {
	const idx = patterns.findIndex(p => p.id === id);
	if (idx === -1) return false;
	patterns.splice(idx, 1);
	scheduleSave();
	return true;
}

export function clearAllPatterns() {
	patterns = [];
	scheduleSave();
}

/**
 * Get knowledge statistics.
 */
export function getKnowledgeStats() {
	const now = Date.now();
	let active = 0, inactive = 0, contradicted = 0;
	let totalConfidence = 0;
	const categoryCounts = {};

	for (const p of patterns) {
		recalculateConfidence(p);
		if (p.status === KNOWLEDGE_STATUS.ACTIVE) active++;
		else if (p.status === KNOWLEDGE_STATUS.INACTIVE) inactive++;
		else if (p.status === KNOWLEDGE_STATUS.CONTRADICTED) contradicted++;
		totalConfidence += p.confidence;
		categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
	}

	return {
		total: patterns.length,
		active,
		inactive,
		contradicted,
		avgConfidence: patterns.length > 0 ? totalConfidence / patterns.length : 0,
		categoryCounts,
	};
}

/**
 * Apply confidence decay to all patterns.
 * Called periodically or before queries.
 */
export function applyDecay() {
	const now = Date.now();
	for (const p of patterns) {
		recalculateConfidence(p);
	}
	scheduleSave();
}

/* ── Init ──────────────────────────────────────────────────────── */

load();
