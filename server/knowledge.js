/**
 * Knowledge Layer (Phase 1)
 *
 * A pattern store that lets Qase learn from past missions and apply that
 * knowledge to future ones.
 *
 * Write AFTER each mission: extract notable findings → patterns.
 * Read BEFORE each mission: match app metadata → surface known patterns.
 *
 * Phase 1 is intentionally minimal: JSON file, simple schema, keyword matching.
 * Phase 2 will add framework-specific rules, cross-mission correlation, etc.
 *
 * See: .drytis/KNOWLEDGE.md for the full design.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── Constants ──────────────────────────────────────────────────── */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', '.qase', 'knowledge.json');

/* ── Storage ───────────────────────────────────────────────────── */

let patterns = [];
let saveTimer = null;
let dirty = false;

/* ── Persistence ───────────────────────────────────────────────── */

function load() {
	try {
		if (!existsSync(FILE)) return;
		const raw = readFileSync(FILE, 'utf8');
		patterns = JSON.parse(raw);
		if (!Array.isArray(patterns)) patterns = [];
	} catch (err) {
		console.error('[knowledge] load failed:', err.message);
		patterns = [];
	}
}

function scheduleSave() {
	dirty = true;
	if (saveTimer) return;
	saveTimer = setTimeout(() => {
		saveTimer = null;
		if (!dirty) return;
		dirty = false;
		try {
			mkdirSync(dirname(FILE), { recursive: true });
			writeFileSync(FILE, JSON.stringify(patterns, null, 2));
		} catch (err) {
			console.error('[knowledge] save failed:', err.message);
		}
	}, 500);
}

/* ── Confidence Model ──────────────────────────────────────────── */

/**
 * Confidence increases with occurrences:
 *   1  →  0.3  (anecdotal)
 *   2  →  0.5  (pattern emerging)
 *   3  →  0.7  (likely real)
 *   5  →  0.85 (strong pattern)
 *   10+→  0.95 (well-established)
 */
function confidenceForOccurrences(n) {
	if (n >= 10) return 0.95;
	if (n >= 5) return 0.85;
	if (n >= 3) return 0.7;
	if (n >= 2) return 0.5;
	return 0.3;
}

/* ── Pattern Extraction ────────────────────────────────────────── */

/**
 * Detects framework hints from session data.
 * Looks at URLs, DOM hints, JavaScript bundle patterns.
 *
 * @param {object} session
 * @returns {{ framework?: string, authProvider?: string, appType?: string }}
 */
export function detectAppMetadata(session) {
	const meta = {};

	const allText = [
		session.targetUrl || '',
		...(session.capturedSteps ?? []).map(s => `${s.url || ''} ${s.target || ''} ${s.label || ''}`),
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

	// App type detection (for knowledge matching)
	if (/shop|store|product|cart|checkout|wishlist/.test(allText)) meta.appType = 'ecommerce';
	else if (/blog|article|post|news|magazine/.test(allText)) meta.appType = 'content';
	else if (/dashboard|analytics|chart|metric|report/.test(allText)) meta.appType = 'dashboard';
	else if (/crm|lead|pipeline|contact|deal/.test(allText)) meta.appType = 'crm';
	else if (/landing|hero|marketing|pricing|sign.?up/.test(allText)) meta.appType = 'marketing';
	else if (/saas|subscription|workspace|organization|team/.test(allText)) meta.appType = 'saas';

	return meta;
}

/**
 * Generates a normalized pattern key from framework, authProvider, and a
 * normalized version of the issue text. Used for deduplication.
 */
function patternKey(framework, authProvider, issueNorm) {
	return [framework || '*', authProvider || '*', issueNorm].join('|');
}

/**
 * Normalize an issue string for deduplication.
 * Lowercase, strip punctuation, collapse whitespace.
 */
function normalizeIssue(issue) {
	return (issue || '')
		.toLowerCase()
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}

/**
 * Extract notable findings as knowledge patterns.
 * Only findings with severity >= medium are considered.
 *
 * @param {object[]} findings — session findings
 * @param {object} session — the session (for metadata extraction)
 * @param {string} missionId — source mission
 * @returns {object[]} new and accumulated patterns
 */
export function writeKnowledge(findings, session, missionId) {
	const meta = detectAppMetadata(session);
	const now = Date.now();
	const results = [];

	for (const f of findings) {
		// Only extract notable findings
		const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
		const sev = sevOrder[f.severity] ?? 5;
		if (sev > 2) continue; // skip low/info

		const issueNorm = normalizeIssue(f.title || f.observed || f.description || '');
		if (!issueNorm || issueNorm.length < 10) continue;

		const key = patternKey(meta.framework, meta.authProvider, issueNorm);

		// Check for existing pattern
		let existing = patterns.find(p =>
			patternKey(p.framework, p.authProvider, normalizeIssue(p.issue)) === key
		);

		if (existing) {
			// Accumulate
			existing.occurrences += 1;
			existing.confidence = confidenceForOccurrences(existing.occurrences);
			existing.lastSeen = now;
			// Update recommendation if the new one is richer
			if ((f.recommendation || f.fixPrompt) && existing.recommendation.length < (f.recommendation || '').length) {
				existing.recommendation = f.recommendation || existing.recommendation;
			}
			results.push({ action: 'accumulated', pattern: existing });
		} else {
			// Create new pattern
			const pattern = {
				id: `kp_${randomUUID().slice(0, 8)}`,
				framework: meta.framework || null,
				authProvider: meta.authProvider || null,
				appType: meta.appType || null,
				pattern: issueNorm.slice(0, 100),
				issue: f.title || f.observed || f.description || issueNorm,
				recommendation: f.recommendation || f.fixPrompt || 'Investigate and fix.',
				fixPrompt: f.fixPrompt || null,
				source: {
					missionId,
					findingId: f.id || null
				},
				occurrences: 1,
				confidence: confidenceForOccurrences(1),
				firstSeen: now,
				lastSeen: now
			};
			patterns.push(pattern);
			results.push({ action: 'created', pattern });
		}
	}

	if (results.length > 0) scheduleSave();
	return results;
}

/* ── Knowledge Query (Pre-Mission) ─────────────────────────────── */

/**
 * Query the knowledge base for patterns relevant to this app.
 * Matches on framework, authProvider, and app type.
 *
 * @param {object} metadata — { framework?, authProvider?, appType? }
 * @returns {{ patterns: object[], hints: string[] }}
 */
export function queryKnowledge(metadata = {}) {
	const matches = patterns.filter(p => {
		if (metadata.framework && p.framework === metadata.framework) return true;
		if (metadata.authProvider && p.authProvider === metadata.authProvider) return true;
		if (metadata.appType && p.appType === metadata.appType) return true;
		return false;
	});

	// Sort by confidence descending, then occurrences
	matches.sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);

	// Generate capability hints based on matched patterns
	const hints = [];
	if (matches.some(p => p.authProvider === 'clerk')) {
		hints.push('Clerk auth detected — known issues exist. Deepen auth testing.');
	}
	if (matches.some(p => /login|auth|session|timeout/.test(p.pattern))) {
		hints.push('Authentication issues detected in knowledge base. Prioritize auth flow testing.');
	}
	if (matches.some(p => /checkout|cart|payment/.test(p.pattern))) {
		hints.push('E-commerce issues detected. Test full purchase flow.');
	}
	if (matches.some(p => p.occurrences >= 3 && p.confidence >= 0.7)) {
		hints.push('High-confidence recurring patterns found. These are likely real issues.');
	}

	return { patterns: matches, hints };
}

/* ── Utility ───────────────────────────────────────────────────── */

export function getAllPatterns() {
	return [...patterns].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getPatternById(id) {
	return patterns.find(p => p.id === id) || null;
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

/* ── Init ──────────────────────────────────────────────────────── */

load();
