/**
 * Phase 16 — Bug Intelligence 2.0: deterministic finding-intelligence engine.
 *
 * All scoring here is DETERMINISTIC (no LLM calls). LLM-derived values are inputs
 * (suggestions), never authority: evidence and signals decide. Every score carries
 * a structured, explainable reason.
 */

const CATEGORIES = Object.freeze([
  'FUNCTIONAL', 'UI', 'UX', 'VISUAL', 'API', 'SECURITY', 'PERFORMANCE', 'ACCESSIBILITY',
  'DATA', 'AUTHENTICATION', 'AUTHORIZATION', 'NAVIGATION', 'COMPATIBILITY', 'MOBILE',
  'REGRESSION', 'FEATURE_GAP', 'INFRASTRUCTURE', 'AI_BEHAVIOR', 'COMPLIANCE', 'UNKNOWN',
]);

const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);
const SEVERITY_ORDER = Object.freeze(
  Object.fromEntries(SEVERITIES.map((s, i) => [s, SEVERITIES.length - 1 - i]))
); // info=0 … critical=4

const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

const LIFECYCLE = Object.freeze([
  'DETECTED', 'VERIFYING', 'VERIFIED', 'CLASSIFIED', 'TRIAGED', 'REPORTED',
  'FALSE_POSITIVE', 'DUPLICATE', 'INCONCLUSIVE', 'UNREPRODUCIBLE', 'RESOLVED', 'REOPENED',
]);

const REVIEW_STATUSES = Object.freeze([
  'unreviewed', 'confirmed', 'false_positive', 'duplicate', 'needs_info',
]);

const REPRODUCIBILITIES = Object.freeze([
  'REPRODUCIBLE', 'INTERMITTENT', 'UNREPRODUCIBLE', 'UNKNOWN',
]);

const ROOT_CAUSES = Object.freeze([
  'ui_logic', 'state_management', 'api_failure', 'authentication', 'authorization',
  'data_validation', 'routing', 'configuration', 'integration', 'browser_compat',
  'backend_failure', 'infrastructure', 'unknown',
]);

const RISKS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

// Legacy free-text category (LLM agent output, e.g. "auth", "forms") → enum.
const LEGACY_CATEGORY_MAP = {
  authentication: 'AUTHENTICATION', auth: 'AUTHENTICATION', login: 'AUTHENTICATION',
  authorization: 'AUTHORIZATION', permissions: 'AUTHORIZATION', access: 'AUTHORIZATION',
  forms: 'FUNCTIONAL', form: 'FUNCTIONAL', functionality: 'FUNCTIONAL', functional: 'FUNCTIONAL',
  navigation: 'NAVIGATION', nav: 'NAVIGATION', routing: 'NAVIGATION', menu: 'NAVIGATION',
  console: 'FUNCTIONAL', network: 'API', api: 'API', backend: 'API',
  accessibility: 'ACCESSIBILITY', a11y: 'ACCESSIBILITY', aria: 'ACCESSIBILITY',
  layout: 'UI', visual: 'VISUAL', styling: 'VISUAL', css: 'VISUAL', cosmetic: 'VISUAL',
  performance: 'PERFORMANCE', speed: 'PERFORMANCE', slow: 'PERFORMANCE',
  security: 'SECURITY', vulnerability: 'SECURITY', xss: 'SECURITY', injection: 'SECURITY',
  data: 'DATA', database: 'DATA', validation: 'DATA',
  mobile: 'MOBILE', responsive: 'MOBILE', viewport: 'MOBILE',
  compatibility: 'COMPATIBILITY', browser: 'COMPATIBILITY',
  regression: 'REGRESSION',
  workflow_failure: 'FUNCTIONAL',
  general: 'UNKNOWN', ux: 'UX', content: 'UX', copy: 'UX',
  feature_gap: 'FEATURE_GAP', 'feature gap': 'FEATURE_GAP', missing_feature: 'FEATURE_GAP',
  infrastructure: 'INFRASTRUCTURE', deployment: 'INFRASTRUCTURE',
  ai_behavior: 'AI_BEHAVIOR',
  compliance: 'COMPLIANCE',
};

// Keyword rules (title + expected/actual/observed text) → primary category, in priority order.
// Failure-phrase rules (API/FUNCTIONAL) come before element-noun rules (UI/VISUAL).
const CLASSIFICATION_RULES = [
  { category: 'AUTHENTICATION', keywords: ['login fail', 'cannot log in', 'cannot login', 'log in fail', 'login page', 'sign in', 'sign-in', 'authentication', 'unauthenticated', 'session expired', 'logged out', 'logout', 'credentials'] },
  { category: 'AUTHORIZATION', keywords: ['permission', 'forbidden', '403', 'unauthorized', '401', 'access denied', 'not allowed', 'admin only', 'role'] },
  { category: 'SECURITY', keywords: ['security', 'xss', 'cross-site', 'injection', 'sql injection', 'exposed secret', 'sensitive data', 'data exposure', 'password visible', 'plaintext', 'https', 'mixed content', 'csp', 'csrf', 'token leak'] },
  { category: 'ACCESSIBILITY', keywords: ['accessibility', 'a11y', 'aria-label', 'screen reader', 'keyboard only', 'tab order', 'focus trap', 'contrast ratio', 'alt text', 'aria-', 'wcag'] },
  { category: 'PERFORMANCE', keywords: ['slow', 'performance', 'lag', 'timeout', 'takes too long', 'load time', 'unresponsive for', 'freeze', 'memory leak'] },
  { category: 'DATA', keywords: ['data loss', 'data not saved', 'saved incorrectly', 'corrupt', 'validation error', 'invalid data', 'wrong data', 'incorrect value', 'data mismatch', 'duplicate record'] },
  { category: 'API', keywords: ['api', 'endpoint', 'response code', 'status code', '500 error', 'error 500', '502', '503', '504', 'json response', 'network request failed', 'request failed', 'http error', 'cors'] },
  { category: 'FUNCTIONAL', keywords: ['does not work', "doesn't work", 'fails', 'broken', 'no response', 'nothing happens', 'not functioning', 'error', 'incorrect', 'wrong result', 'does nothing', 'does not complete'] },
  { category: 'NAVIGATION', keywords: ['navigation', 'redirect', 'navigates to', 'should redirect', 'breadcrumb', '404', 'not found page', 'menu item', 'link broken', 'dead link', 'route'] },
  { category: 'MOBILE', keywords: ['mobile', 'viewport', 'responsive', 'breakpoint', 'phone', 'tablet', 'narrow screen', '390px', '768px', 'overlap on small'] },
  { category: 'REGRESSION', keywords: ['regression', 'used to work', 'previously worked', 'no longer works', 'worked before'] },
  { category: 'FEATURE_GAP', keywords: ['feature missing', 'missing feature', 'not implemented', 'no such feature', 'feature gap', 'absent feature'] },
  { category: 'COMPLIANCE', keywords: ['gdpr', 'compliance', 'cookie consent', 'privacy policy', 'terms of service', 'hipaa', 'pci'] },
  { category: 'AI_BEHAVIOR', keywords: ['ai ', 'llm', 'chatbot', 'assistant response', 'model output', 'hallucinat'] },
  { category: 'INFRASTRUCTURE', keywords: ['ssl certificate', 'dns', 'server error', 'deployment', 'build fail', 'infrastructure', 'certificate expired'] },
  { category: 'UX', keywords: ['confusing', 'unclear', 'user experience', 'hard to find', 'unexpected behavior', 'misleading', 'workflow confusing', 'counterintuitive'] },
  { category: 'VISUAL', keywords: ['alignment', 'misaligned', 'overlapping', 'spacing', 'truncated', 'clipped', 'color mismatch', 'pixel', 'visual', 'font size', 'broken image', 'placeholder image', 'placeholder text'] },
  { category: 'UI', keywords: ['button', 'input field', 'dropdown', 'checkbox', 'modal', 'dialog', 'tooltip', 'icon missing', 'label', 'ui element', 'form field', 'disabled state', 'enabled state', 'toggle'] },
];

function normalizeCategory(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (CATEGORIES.includes(v.toUpperCase())) return v.toUpperCase();
  return LEGACY_CATEGORY_MAP[v] || LEGACY_CATEGORY_MAP[v.replace(/_/g, ' ')] || null;
}

function haystack(f) {
  return [f.title, f.category, f.expected, f.actual, f.observed, f.impact].filter(Boolean).join(' \n ').toLowerCase();
}

/**
 * Deterministic classification: legacy category mapping first (highest confidence),
 * then ordered keyword rules over title/expected/actual/observed/impact text.
 * Returns { primary, secondary, confidence, method, matched } — never throws.
 */
function classifyFinding(f) {
  const result = { primary: 'UNKNOWN', secondary: [], confidence: 0.3, method: 'fallback', matched: null };

  // 1. Explicit enum already present on the finding
  if (CATEGORIES.includes(f.primary_category)) {
    return { primary: f.primary_category, secondary: [...(f.secondary_categories || [])], confidence: Math.max(0.8, f.classification_confidence || 0.8), method: 'explicit', matched: 'primary_category' };
  }

  // 2. Legacy free-text category mapping — generic placeholders carry no signal.
  const legacy = normalizeCategory(f.category);
  const legacyGeneric = ['general', 'unknown', 'other', 'misc', ''].includes(String(f.category || '').trim().toLowerCase());
  if (legacy && !legacyGeneric) {
    result.primary = legacy;
    result.confidence = 0.85;
    result.method = 'legacy_category';
    result.matched = f.category;
  }

  // 3. Keyword rules — override generic legacy, refine specific legacy.
  const hay = haystack(f);
  const matches = [];
  for (const rule of CLASSIFICATION_RULES) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw)) { matches.push({ category: rule.category, keyword: kw }); break; }
    }
  }
  if (matches.length > 0) {
    const primary = matches[0].category;
    if (result.method === 'fallback' || legacyGeneric) {
      result.primary = primary;
      result.confidence = result.method === 'fallback' ? 0.75 : 0.8;
      result.method = result.method === 'fallback' ? 'keyword' : 'keyword+legacy';
      result.matched = matches[0].keyword;
    }
    const secondary = [];
    for (const m of matches.slice(0, 4)) {
      if (m.category !== result.primary && !secondary.includes(m.category)) secondary.push(m.category);
    }
    result.secondary = secondary.slice(0, 3);
  } else if (result.secondary.length === 0) {
    // derive one heuristic secondary from URL when text gives nothing
    const u = (f.url || '').toLowerCase();
    if (u.includes('login') || u.includes('auth')) result.secondary = ['AUTHENTICATION'];
    else if (u.includes('checkout') || u.includes('payment')) result.secondary = ['FUNCTIONAL'];
  }

  if (result.primary === 'UNKNOWN' && result.method === 'fallback') result.confidence = 0.3;
  return result;
}

/* ------------------------------------------------------------------ */
/* Severity                                                            */
/* ------------------------------------------------------------------ */

const IMPACT_SIGNALS = [
  { key: 'blocks_critical_workflow', weight: 1.0, desc: 'Blocks a critical workflow' },
  { key: 'prevents_login', weight: 1.0, desc: 'Prevents login / authentication' },
  { key: 'data_loss', weight: 1.0, desc: 'Causes data loss' },
  { key: 'data_exposure', weight: 1.0, desc: 'Exposes sensitive information' },
  { key: 'affects_many_users', weight: 0.6, desc: 'Affects many users' },
  { key: 'no_workaround', weight: 0.6, desc: 'No workaround available' },
  { key: 'production_readiness', weight: 0.5, desc: 'Affects production readiness' },
  { key: 'security_related', weight: 0.9, desc: 'Security related' },
  { key: 'cosmetic_only', weight: -1.0, desc: 'Cosmetic only' },
  { key: 'has_workaround', weight: -0.5, desc: 'Workaround available' },
];

function severitySignals(f, evidence) {
  const hay = haystack(f);
  const evidenceText = (evidence || []).map(e => `${e.type} ${e.target || ''} ${e.observation || ''}`.toLowerCase()).join(' \n ');
  const combined = hay + ' \n ' + evidenceText;
  const signals = {};
  signals.prevents_login = /login|log in|sign in|sign-in|authenticat|credential/.test(combined)
    && /(fail|cannot|can't|error|blocked|denied|stuck|unauthorized|401|403|expired)/.test(combined);
  signals.blocks_critical_workflow = /(checkout|payment|signup|sign up|register|submit|save|purchase|order|onboard)/.test(combined)
    && /(fail|cannot|can't|error|blocked|stuck|nothing happens|does not|doesn't)/.test(combined);
  signals.data_loss = /data loss|lost data|not saved|deleted|disappear|overwrit/.test(combined);
  signals.data_exposure = /expos|leak|visible to|plaintext|unmasked|sensitive|personal data|pii/.test(combined);
  signals.security_related = /security|xss|injection|csrf|vulnerab|forbidden|unauthorized|privilege|password|credential/.test(combined);
  signals.affects_many_users = /(all users|every user|any user|everyone|all attempts|settings page|profile page)/.test(combined) || (typeof f.reproduction_rate === 'number' ? (f.reproduction_rate >= 0.9 && (f.reproduction_attempts || 0) >= 2) : false);
  signals.no_workaround = /(no workaround|only way|cannot proceed|blocked)/.test(combined);
  signals.has_workaround = /workaround|alternative|can still|still possible/.test(combined);
  signals.production_readiness = /(production|release|deploy|live)/.test(combined) && /(block|fail|cannot|critical)/.test(combined);
  signals.cosmetic_only = /cosmetic|alignment|spacing|color|font|typo|pixel|capitaliz/.test(combined) && !/(fail|error|cannot|broken)/.test(combined);
  return signals;
}

/**
 * Deterministic severity: weighted impact-signal score → severity, with rationale.
 * Agent severity is kept unless evidence-derived severity differs by ≥2 levels
 * (then evidence wins; rationale records the override).
 */
function computeSeverity(f, evidence) {
  const signals = severitySignals(f, evidence);
  const hits = [];
  let score = 0;
  for (const def of IMPACT_SIGNALS) {
    if (signals[def.key]) {
      score += def.weight;
      hits.push(def.desc.toLowerCase());
    }
  }
  let severity;
  if (score >= 1.8) severity = 'critical';
  else if (score >= 0.9) severity = 'high';
  else if (score >= 0.4) severity = 'medium';
  else if (score > 0) severity = 'low';
  else severity = 'info';

  const agent = SEVERITIES.includes(f.severity) ? f.severity : 'medium';

  // Security floor: exposure/leak findings never sit below high.
  const secFloor = (signals.data_exposure || signals.security_related) ? 'high' : null;
  if (secFloor && SEVERITY_ORDER[severity] < SEVERITY_ORDER[secFloor]) severity = secFloor;

  const diff = SEVERITY_ORDER[severity] - SEVERITY_ORDER[agent];
  let finalSeverity = agent;
  let method = 'agent';
  let rationale;
  if (diff >= 2) {
    finalSeverity = severity;
    method = 'evidence_override';
    rationale = `Agent said ${agent}; evidence signals (${hits.join(', ') || 'none'}) indicate ${severity}.`;
  } else if (diff === 1 && (signals.data_exposure || signals.security_related)) {
    // One-level upgrade allowed for security/exposure findings (evidence escalates).
    finalSeverity = severity;
    method = 'evidence_escalation';
    rationale = `Security/exposure signals (${hits.join(', ')}) escalate ${agent} → ${severity}.`;
  } else if (score > 0) {
    rationale = `Impact signals: ${hits.join(', ')} (score ${score.toFixed(2)} → ${severity}); agent severity ${agent} retained.`;
  } else {
    rationale = `No concrete impact signals found in text/evidence; agent severity ${agent} retained (default medium if agent did not specify).`;
  }
  if (secFloor) {
    rationale += ` Security floor applied: ${secFloor} minimum for exposure/security signals.`;
    if (SEVERITY_ORDER[finalSeverity] < SEVERITY_ORDER[secFloor]) {
      finalSeverity = secFloor;
      method = 'security_floor';
    }
  }

  const signalCount = hits.length;
  const confidence = Math.min(0.95, 0.4 + 0.15 * signalCount + (evidence && evidence.length >= 2 ? 0.1 : 0));
  return {
    severity: finalSeverity,
    confidence: Number(confidence.toFixed(2)),
    rationale,
    method,
    computed: severity,
    signals,
  };
}

/* ------------------------------------------------------------------ */
/* Priority                                                            */
/* ------------------------------------------------------------------ */

/**
 * Deterministic priority: weighted model over severity, security, workflow criticality,
 * user impact (reproduction rate), confidence, release risk, frequency. No blind
 * CRITICAL→P0 mapping: P0 requires severity critical/high AND (security signal OR
 * reproduction rate ≥ 0.8) AND confidence ≥ 0.7.
 */
function computePriority(f, opts = {}) {
  const sev = SEVERITIES.includes(f.severity) ? f.severity : 'medium';
  const sevW = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[sev];
  const conf = clamp01(f.confidence ?? 0.5);
  const rate = f.reproduction_rate;
  const rateKnown = typeof rate === 'number';
  const rateScore = rateKnown ? (rate >= 0.9 ? 1 : rate >= 0.5 ? 0.6 : rate > 0 ? 0.3 : 0) : 0.5;
  const security = !!opts.securityRelated
    || /security|xss|injection|csrf|unauthorized|exposure|leak/.test(haystack(f));
  const workflowCritical = !!opts.workflowCritical || sevW >= 3;
  const contributions = [];

  let score = sevW * 1.5;
  contributions.push(`severity=${sev} (${sevW * 1.5})`);
  if (security) { score += 1.5; contributions.push('security implication (+1.5)'); }
  else if (workflowCritical) { score += 1.0; contributions.push('critical workflow (+1.0)'); }
  score += rateScore * 1.5;
  contributions.push(`user impact via reproduction rate${rateKnown ? `=${rate}` : ' unknown'} (+${(rateScore * 1.5).toFixed(1)})`);
  score += conf * 1.0;
  contributions.push(`confidence=${conf.toFixed(2)} (+${conf.toFixed(1)})`);
  if (opts.releaseRisk) { score += 0.5; contributions.push('release risk (+0.5)'); }
  if (rateKnown && f.reproduction_attempts >= 3 && rate >= 0.9) { score += 0.5; contributions.push('deterministic repeat failure (+0.5)'); }

  let priority;
  if (score >= 8.5) priority = 'P0';
  else if (score >= 6.5) priority = 'P1';
  else if (score >= 4.0) priority = 'P2';
  else priority = 'P3';

  // Evidence gate on P0 — no blind CRITICAL→P0: a critical-severity finding without
  // the required evidence profile can never be P0, even when the raw score reaches it.
  const p0EvidenceOk = (sevW >= 3) && (security || (rateKnown && rate >= 0.8)) && conf >= 0.7;
  if (priority === 'P0' && !p0EvidenceOk) {
    priority = 'P1';
    score = Math.min(score, 8.4);
    contributions.push('P0 evidence gate not met (needs severity≥high AND (security signal OR reproduction rate ≥0.8) AND confidence ≥0.7) — demoted to P1');
  } else if (!p0EvidenceOk && sevW >= 3 && score >= 6.5) {
    contributions.push('P0 evidence gate not met (needs severity≥high AND (security signal OR reproduction rate ≥0.8) AND confidence ≥0.7) — capped at P1');
  }

  return {
    priority,
    rationale: `Weighted score ${score.toFixed(2)} → ${priority}. ${contributions.join('; ')}.`,
    score: Number(score.toFixed(2)),
  };
}

/* ------------------------------------------------------------------ */
/* Confidence (evidence-based, explainable)                            */
/* ------------------------------------------------------------------ */

const CONFIDENCE_SIGNALS = Object.freeze({
  reproduced: { weight: 0.25, label: 'Reproduced' },
  repeated_reproduction: { weight: 0.10, label: 'Repeated reproduction (≥2 successes)' },
  deterministic_failure: { weight: 0.10, label: 'Deterministic failure (rate 1.0)' },
  console_error: { weight: 0.15, label: 'Console error evidence' },
  network_error: { weight: 0.15, label: 'Network error evidence' },
  dom_evidence: { weight: 0.10, label: 'DOM/state evidence' },
  screenshot_evidence: { weight: 0.08, label: 'Screenshot evidence' },
  expected_actual_mismatch: { weight: 0.15, label: 'Expected vs actual mismatch documented' },
  api_response_evidence: { weight: 0.12, label: 'API response evidence' },
  multiple_observations: { weight: 0.10, label: 'Multiple independent observations' },
});

function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }

/**
 * Evidence-based confidence. LLM self-confidence is deliberately NOT a signal.
 * Returns { confidence, level, signals, contributions } where contributions explain
 * every point awarded.
 */
function computeConfidence(f, evidence = [], observations = 0) {
  const fired = {};
  const contributions = [];
  let score = 0.05; // baseline: an agent observed *something*

  const types = new Set((evidence || []).map(e => e.type));
  const sources = new Set((evidence || []).map(e => e.source).filter(Boolean));
  const okRepro = f.reproducibility === 'REPRODUCIBLE' || f.reproducibility === 'confirmed';
  const attempts = f.reproduction_attempts || 0;
  const successes = f.successful_reproductions || 0;
  if (okRepro) { score += 0.02; } // legacy confirmed: reproduction happened but count unknown

  if (okRepro && successes >= 1) { fired.reproduced = true; score += CONFIDENCE_SIGNALS.reproduced.weight; contributions.push(['reproduced', CONFIDENCE_SIGNALS.reproduced.weight]); }
  if (successes >= 2 || (okRepro && (f.reproduction_attempts || 0) >= 2)) { fired.repeated_reproduction = true; score += CONFIDENCE_SIGNALS.repeated_reproduction.weight; contributions.push(['repeated_reproduction', CONFIDENCE_SIGNALS.repeated_reproduction.weight]); }
  if (typeof f.reproduction_rate === 'number' && f.reproduction_rate >= 1 && attempts >= 2) { fired.deterministic_failure = true; score += CONFIDENCE_SIGNALS.deterministic_failure.weight; contributions.push(['deterministic_failure', CONFIDENCE_SIGNALS.deterministic_failure.weight]); }
  if (types.has('console')) { fired.console_error = true; score += CONFIDENCE_SIGNALS.console_error.weight; contributions.push(['console_error', CONFIDENCE_SIGNALS.console_error.weight]); }
  if (types.has('network')) { fired.network_error = true; score += CONFIDENCE_SIGNALS.network_error.weight; contributions.push(['network_error', CONFIDENCE_SIGNALS.network_error.weight]); }
  if (types.has('api_response')) { fired.api_response_evidence = true; score += CONFIDENCE_SIGNALS.api_response_evidence.weight; contributions.push(['api_response_evidence', CONFIDENCE_SIGNALS.api_response_evidence.weight]); }
  if (types.has('dom')) { fired.dom_evidence = true; score += CONFIDENCE_SIGNALS.dom_evidence.weight; contributions.push(['dom_evidence', CONFIDENCE_SIGNALS.dom_evidence.weight]); }
  if (types.has('screenshot') || types.has('video')) { fired.screenshot_evidence = true; score += CONFIDENCE_SIGNALS.screenshot_evidence.weight; contributions.push(['screenshot_evidence', CONFIDENCE_SIGNALS.screenshot_evidence.weight]); }
  if (f.expected && f.actual && f.expected.trim() && f.actual.trim()) { fired.expected_actual_mismatch = true; score += CONFIDENCE_SIGNALS.expected_actual_mismatch.weight; contributions.push(['expected_actual_mismatch', CONFIDENCE_SIGNALS.expected_actual_mismatch.weight]); }
  if ((observations || 0) >= 2 || sources.size >= 2) { fired.multiple_observations = true; score += CONFIDENCE_SIGNALS.multiple_observations.weight; contributions.push(['multiple_observations', CONFIDENCE_SIGNALS.multiple_observations.weight]); }

  const confidence = Number(clamp01(score).toFixed(2));
  const level = confidence >= 0.9 ? 'VERY_HIGH' : confidence >= 0.7 ? 'HIGH' : confidence >= 0.4 ? 'MEDIUM' : 'LOW';
  if (okRepro && successes === 0 && attempts === 0) contributions.push(['legacy_reproducibility_confirmed', 0.02]);
  return { confidence, level, signals: fired, contributions };
}

/* ------------------------------------------------------------------ */
/* Reproducibility                                                     */
/* ------------------------------------------------------------------ */

const LEGACY_REPRO_MAP = { confirmed: 'REPRODUCIBLE', intermittent: 'INTERMITTENT', unconfirmed: 'UNKNOWN' };

/**
 * Map reproduction attempts → reproducibility enum + rate.
 * attempts=0 → UNKNOWN (never guessed as reproducible without attempts).
 */
function computeReproducibility(f) {
  const legacy = LEGACY_REPRO_MAP[f.reproducibility] || null;
  const attempts = Number.isFinite(f.reproduction_attempts) ? f.reproduction_attempts : 0;
  const successes = Number.isFinite(f.successful_reproductions) ? f.successful_reproductions : 0;
  if (attempts > 0 && successes > attempts) return { reproducibility: 'UNKNOWN', attempts, successes, rate: null };
  let repro;
  if (attempts === 0) repro = legacy || 'UNKNOWN';
  else if (successes === attempts) repro = 'REPRODUCIBLE';
  else if (successes === 0) repro = 'UNREPRODUCIBLE';
  else repro = 'INTERMITTENT';
  const rate = attempts > 0 ? Number((successes / attempts).toFixed(2)) : null;
  return { reproducibility: repro, attempts, successes, rate };
}

/* ------------------------------------------------------------------ */
/* Evidence sufficiency                                                */
/* ------------------------------------------------------------------ */

const SUFFICIENCY_RULES = {
  // category → { minItems, minSources, requiredTypes (any-of) }
  FUNCTIONAL: { minItems: 2, minSources: 2 },
  API: { minItems: 2, minSources: 2 },
  SECURITY: { minItems: 2, minSources: 1, requiredTypes: ['console', 'network', 'api_response', 'dom'] },
  AUTHENTICATION: { minItems: 2, minSources: 1, requiredTypes: ['console', 'network', 'api_response', 'dom'] },
  AUTHORIZATION: { minItems: 2, minSources: 1, requiredTypes: ['console', 'dom', 'api_response'] },
  DATA: { minItems: 2, minSources: 2 },
  default: { minItems: 1, minSources: 1 },
};

/**
 * Evidence sufficiency gate. ZERO typed evidence → NEVER sufficient (never VERIFIED).
 */
function assessEvidenceSufficiency(f, evidence) {
  const category = CATEGORIES.includes(f.primary_category) ? f.primary_category : 'UNKNOWN';
  const rule = SUFFICIENCY_RULES[category] || SUFFICIENCY_RULES.default;
  const items = evidence || [];
  const types = new Set(items.map(e => e.type));
  const sources = new Set(items.map(e => e.source).filter(Boolean));
  const reasons = [];
  let sufficient = true;

  if (items.length === 0) { sufficient = false; reasons.push('No typed evidence linked'); }
  if (items.length < rule.minItems) { sufficient = false; reasons.push(`Only ${items.length} evidence item(s), need ≥${rule.minItems} for ${category}`); }
  if (sources.size < rule.minSources) { sufficient = false; reasons.push(`Only ${sources.size} distinct source(s), need ≥${rule.minSources}`); }
  if (rule.requiredTypes && !rule.requiredTypes.some(t => types.has(t))) {
    sufficient = false;
    reasons.push(`Requires one of [${rule.requiredTypes.join(', ')}] evidence; found [${[...types].join(', ') || 'none'}]`);
  }
  return {
    sufficient,
    required: rule,
    present: { count: items.length, types: [...types], sources: [...sources] },
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* Expected vs actual                                                  */
/* ------------------------------------------------------------------ */

function assessExpectedActual(f) {
  const hasExpected = !!(f.expected && String(f.expected).trim());
  const hasActual = !!(f.actual && String(f.actual).trim());
  let source = 'unknown';
  let uncertain = true;
  if (f.expected_source && ['requirement', 'mission_context', 'app_behavior', 'workflow_expectation'].includes(f.expected_source)) {
    source = f.expected_source; uncertain = false;
  } else if (hasExpected) {
    source = 'app_behavior'; uncertain = false;
  }
  if (!hasExpected && !hasActual) {
    return { expected: null, actual: null, source: 'unknown', uncertain: true, note: 'Neither expected nor actual recorded' };
  }
  return {
    expected: hasExpected ? f.expected : null,
    actual: hasActual ? f.actual : (f.observed || null),
    source,
    uncertain: !hasExpected || (uncertain && !hasExpected),
    note: hasExpected ? null : 'Expected behavior not recorded — expectation uncertain',
  };
}

/* ------------------------------------------------------------------ */
/* Risk                                                                */
/* ------------------------------------------------------------------ */

/**
 * Deterministic risk: impact (severity + security/data-loss signals) × likelihood
 * (reproduction rate / user scope) adjusted by confidence. LLM never picks risk.
 */
function computeRisk(f, opts = {}) {
  const sev = SEVERITIES.includes(f.severity) ? f.severity : 'medium';
  const impactMap = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  let impact = impactMap[sev];
  const hay = haystack(f);
  if (/security|xss|injection|csrf|exposure|leak|unauthorized/.test(hay)) impact += 1;
  if (/data loss|not saved|lost data|deleted/.test(hay)) impact += 1;
  impact = Math.min(5, impact);
  const rate = f.reproduction_rate;
  const likelihood = typeof rate === 'number' ? (rate >= 0.9 ? 3 : rate >= 0.5 ? 2 : rate > 0 ? 1 : 0) : 1.5;
  const conf = clamp01(f.confidence ?? 0.5);
  const score = impact * likelihood * (0.5 + conf / 2);
  let risk;
  if (score >= 9) risk = 'CRITICAL';
  else if (score >= 5) risk = 'HIGH';
  else if (score >= 2) risk = 'MEDIUM';
  else risk = 'LOW';
  return {
    risk,
    reason: `impact=${impact} (severity=${sev}${impact > impactMap[sev] ? ' + security/data signals' : ''}) × likelihood=${likelihood} (${rateKnownDesc(rate)}) × confidence-adjuster=${(0.5 + conf / 2).toFixed(2)} → score ${score.toFixed(2)} → ${risk}`,
    score: Number(score.toFixed(2)),
  };
}

function rateKnownDesc(rate) {
  return typeof rate === 'number' ? `rate=${rate}` : 'rate unknown, assumed 1.5';
}

/* ------------------------------------------------------------------ */
/* Root cause                                                          */
/* ------------------------------------------------------------------ */

const ROOT_CAUSE_RULES = [
  { category: 'authentication', evidence: ['console', 'network', 'api_response'], keywords: [/login|auth|credential|session|token/] },
  { category: 'authorization', evidence: ['console', 'api_response'], keywords: [/permission|forbidden|403|unauthorized|role/] },
  { category: 'api_failure', evidence: ['network', 'api_response'], keywords: [/api|endpoint|500|502|response|request/] },
  { category: 'backend_failure', evidence: ['network', 'api_response', 'console'], keywords: [/server|backend|database|500|timeout/] },
  { category: 'data_validation', evidence: ['api_response', 'dom'], keywords: [/validation|invalid|format|schema/] },
  { category: 'routing', evidence: ['dom', 'console'], keywords: [/route|redirect|404|navigation/] },
  { category: 'state_management', evidence: ['dom', 'console'], keywords: [/state|stale|not updated|refresh|reload/] },
  { category: 'ui_logic', evidence: ['dom', 'screenshot', 'console'], keywords: [/button|click|handler|event|disabled|nothing happens/] },
  { category: 'configuration', evidence: ['network', 'console'], keywords: [/config|environment|cors|misconfigur/] },
  { category: 'integration', evidence: ['network', 'api_response'], keywords: [/integration|third[- ]party|webhook|callback/] },
  { category: 'browser_compat', evidence: ['screenshot', 'dom'], keywords: [/browser|chrome|firefox|safari|viewport/] },
  { category: 'infrastructure', evidence: ['network', 'console'], keywords: [/dns|ssl|certificate|deploy|server/] },
];

/**
 * Root cause stays `unknown` unless evidence backs promotion: requires ≥1 matching
 * evidence type AND a matching keyword. Returns potential causes (never asserted).
 */
function assessRootCause(f, evidence) {
  const hay = haystack(f);
  const types = new Set((evidence || []).map(e => e.type));
  const potentials = [];
  for (const rule of ROOT_CAUSE_RULES) {
    const evMatch = rule.evidence.some(t => types.has(t));
    const kwMatch = rule.keywords.some(re => re.test(hay));
    if (evMatch && kwMatch) potentials.push(rule.category);
    else if (kwMatch) potentials.push(rule.category); // keyword-only → potential, not confirmed
  }
  // A rule is "supported" only when BOTH evidence type AND keyword match.
  const supported = [];
  for (const rule of ROOT_CAUSE_RULES) {
    if (rule.evidence.some(t => types.has(t)) && rule.keywords.some(re => re.test(hay))) supported.push(rule.category);
  }
  const category = supported.length > 0 ? supported[0] : 'unknown';
  const confidence = supported.length > 0
    ? Math.min(0.85, 0.5 + 0.15 * supported.length)
    : 0.2;
  return {
    category,
    confidence: Number(confidence.toFixed(2)),
    potentials: [...new Set(potentials)].slice(0, 5),
    method: supported.length > 0 ? 'evidence_supported' : 'unknown_symptom_only',
  };
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set('a an the is are was were be been being this that these those of to in on for with and or not does do did fail fails failed error broken button page cannot can not work works working'.split(' '));

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !STOPWORDS.has(w));
}

function jaccard(aWords, bWords) {
  const A = new Set(aWords), B = new Set(bWords);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Stable error signature: normalized title words + key error tokens. */
function errorSignature(f) {
  const words = normalizeText([f.title, f.actual, f.observed].filter(Boolean).join(' '));
  const errTokens = words.filter(w => /error|fail|401|403|404|500|502|503|timeout|exception|denied|crash|broken|missing|invalid/.test(w));
  return [...new Set([...words.slice(0, 12), ...errTokens])].sort().join('|');
}

const DUPLICATE_EXACT_THRESHOLD = 0.90;
const DUPLICATE_POSSIBLE_THRESHOLD = 0.62;

/**
 * Deterministic duplicate verdict vs ONE other finding (global store shape).
 * Returns verdict UNIQUE | POSSIBLE_DUPLICATE | DUPLICATE + similarity + signals.
 */
function compareForDuplicates(a, b) {
  if (!a || !b || a.id === b.id) return { verdict: 'UNIQUE', similarity: 0, signals: [] };
  const signals = [];
  let sim = jaccard(normalizeText(a.title), normalizeText(b.title)) * 0.5
    + jaccard(normalizeText(`${a.title} ${a.actual || ''} ${a.observed || ''}`), normalizeText(`${b.title} ${b.actual || ''} ${b.observed || ''}`)) * 0.5;

  const normUrl = u => { try { return new URL(u).pathname; } catch { return (u || '').split('?')[0]; } };
  if (a.url && b.url && normUrl(a.url) === normUrl(b.url)) { sim += 0.15; signals.push('same_page'); }
  const sa = a.primary_category || normalizeCategory(a.category);
  const sb = b.primary_category || normalizeCategory(b.category);
  if (sa && sb && sa === sb) { sim += 0.10; signals.push('same_category'); }
  if (a.workflow_id && b.workflow_id && a.workflow_id === b.workflow_id) { sim += 0.15; signals.push('same_workflow'); }
  if (a.feature_id && b.feature_id && a.feature_id === b.feature_id) { sim += 0.10; signals.push('same_feature'); }
  const sigA = errorSignature(a), sigB = errorSignature(b);
  const sigSim = sigA === sigB ? 1 : jaccard(sigA.split('|'), sigB.split('|'));
  if (sigSim >= 0.8) { sim += 0.15; signals.push('same_error_signature'); }
  if (a.api_endpoint && b.api_endpoint && a.api_endpoint === b.api_endpoint) { sim += 0.15; signals.push('same_api_endpoint'); }
  if (a.component && b.component && a.component === b.component) { sim += 0.10; signals.push('same_component'); }
  sim = Math.min(1, sim);

  // Verdict tiers. DUPLICATE (auto-merge eligible) requires EITHER
  // (a) near-total similarity AND a corroborating identity signal (same error
  //     signature / same page / same api endpoint), or
  // (b) a high error-signature match with strong similarity.
  // High text similarity alone is never enough — two different bugs can share
  // wording.
  let verdict = 'UNIQUE';
  const corroborated = signals.includes('same_error_signature') || signals.includes('same_page') || signals.includes('same_api_endpoint');
  if ((sim >= DUPLICATE_EXACT_THRESHOLD && corroborated) || (sigSim >= 0.9 && sim >= DUPLICATE_POSSIBLE_THRESHOLD + 0.1)) verdict = 'DUPLICATE';
  else if (sim >= DUPLICATE_POSSIBLE_THRESHOLD) verdict = 'POSSIBLE_DUPLICATE';
  return { verdict, similarity: Number(sim.toFixed(3)), signals };
}

/**
 * Find duplicates across the global store. Deterministic; O(n·m) bounded by candidate
 * window (same project + same normalized page OR shared signature prefix; fallback: recent N).
 * Returns { candidates:[{id, verdict, similarity, signals}], canonical }.
 * canonical = earliest (lowest ts) finding among the duplicate cluster.
 */
function detectDuplicates(f, others, opts = {}) {
  const window = opts.window || 500;
  const pool = (others || []).filter(o => o.id !== f.id && (!f.projectId || !o.projectId || f.projectId === o.projectId));
  const candidates = [];
  for (const o of pool.slice(-window)) {
    const { verdict, similarity, signals } = compareForDuplicates(f, o);
    if (verdict !== 'UNIQUE') candidates.push({ id: o.id, verdict, similarity, signals, title: o.title, ts: o.ts });
  }
  candidates.sort((x, y) => y.similarity - x.similarity);
  const dupes = candidates.filter(c => c.verdict === 'DUPLICATE');
  let canonical = null;
  let duplicate_of = null;
  if (dupes.length > 0) {
    const cluster = [f, ...dupes.map(d => pool.find(p => p.id === d.id))].filter(Boolean);
    // Canonical = earliest ts; deterministic tie-break on id (same-millisecond finds).
    canonical = cluster.reduce((min, x) => {
      if (x.ts < min.ts) return x;
      if (x.ts === min.ts && String(x.id) < String(min.id)) return x;
      return min;
    }, cluster[0]);
    duplicate_of = canonical.id === f.id ? null : canonical.id;
  }
  return { candidates: candidates.slice(0, 10), duplicate_of, canonicalId: canonical ? canonical.id : null };
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const LIFECYCLE_TRANSITIONS = Object.freeze({
  DETECTED: ['VERIFYING', 'FALSE_POSITIVE', 'DUPLICATE', 'INCONCLUSIVE', 'RESOLVED'],
  VERIFYING: ['VERIFIED', 'INCONCLUSIVE', 'UNREPRODUCIBLE', 'FALSE_POSITIVE', 'DUPLICATE', 'DETECTED'],
  VERIFIED: ['CLASSIFIED', 'FALSE_POSITIVE', 'DUPLICATE', 'REOPENED', 'RESOLVED', 'INCONCLUSIVE'],
  CLASSIFIED: ['TRIAGED', 'FALSE_POSITIVE', 'DUPLICATE', 'REOPENED', 'RESOLVED'],
  TRIAGED: ['REPORTED', 'FALSE_POSITIVE', 'DUPLICATE', 'REOPENED', 'RESOLVED'],
  REPORTED: ['REOPENED', 'RESOLVED', 'FALSE_POSITIVE', 'DUPLICATE'],
  FALSE_POSITIVE: ['REOPENED'],
  DUPLICATE: ['REOPENED'],
  INCONCLUSIVE: ['VERIFYING', 'REOPENED', 'FALSE_POSITIVE', 'RESOLVED'],
  UNREPRODUCIBLE: ['VERIFYING', 'REOPENED', 'RESOLVED', 'FALSE_POSITIVE'],
  RESOLVED: ['REOPENED', 'REPORTED'],
  REOPENED: ['VERIFYING', 'VERIFIED', 'CLASSIFIED', 'TRIAGED', 'REPORTED', 'RESOLVED'],
});

function validateLifecycleTransition(from, to) {
  if (!LIFECYCLE.includes(to)) return { ok: false, reason: `Unknown lifecycle state ${to}` };
  if (from === to) return { ok: true, reason: 'no-op' };
  const allowed = LIFECYCLE_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    // Evidence gate: VERIFIED is only reachable through VERIFYING (sufficient evidence).
    if (to === 'VERIFIED') {
      return { ok: false, reason: `${from} → VERIFIED requires sufficient evidence: transition to VERIFYING first, then VERIFIED once evidence sufficiency passes` };
    }
    return { ok: false, reason: `${from} → ${to} is not allowed` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Quality score (per-dimension, not collapsed)                        */
/* ------------------------------------------------------------------ */

function computeQuality(f, evidence) {
  const evCount = (evidence || []).length;
  const evidenceScore = Math.min(1, evCount / 3) * 0.6 + (assessEvidenceSufficiency(f, evidence).sufficient ? 0.4 : 0);
  const reproduction = f.reproducibility === 'REPRODUCIBLE' ? 1 : f.reproducibility === 'INTERMITTENT' ? 0.6 : f.reproducibility === 'UNREPRODUCIBLE' ? 0.2 : 0.4;
  const classification = clamp01(f.classification_confidence ?? 0.3);
  const impact = clamp01(f.severity_confidence ?? 0.3);
  const rootCause = f.root_cause_category && f.root_cause_category !== 'unknown'
    ? clamp01(f.root_cause_confidence ?? 0.5) : 0.1;
  const overall = Number((evidenceScore * 0.35 + reproduction * 0.2 + classification * 0.2 + impact * 0.15 + rootCause * 0.1).toFixed(2));
  return {
    evidence: Number(evidenceScore.toFixed(2)),
    reproduction: Number(reproduction.toFixed(2)),
    classification: Number(classification.toFixed(2)),
    impact: Number(impact.toFixed(2)),
    rootCause: Number(rootCause.toFixed(2)),
    overall,
  };
}

/* ------------------------------------------------------------------ */
/* Secret redaction                                                    */
/* ------------------------------------------------------------------ */

const REDACTION_PATTERNS = [
  { name: 'password_assignment', re: /((?:password|passwd|pwd)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi },
  { name: 'api_key_assignment', re: /((?:api[-_]?key|apikey|secret|token)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)/gi },
  { name: 'bearer_token', re: /(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi },
  { name: 'cookie_values', re: /((?:cookie|set-cookie)\s*[:=]\s*)[^\s,;"']+/gi },
  { name: 'sk_key', re: /(sk-[A-Za-z0-9_\-]{8,})/gi },
  { name: 'aws_style_key', re: /(AKIA[0-9A-Z]{16})/g },
  { name: 'jwt', re: /(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g },
  { name: 'json_secret_value', re: /("(?:password|passwd|pwd|secret|api[-_]?key|apikey|token|authorization)"\s*:\s*)"[^"]*"/gi },
  { name: 'private_key_block', re: /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)[\s\S]*?(-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g },
];

const REDACTED = '[REDACTED]';

function redactString(input, options = {}) {
  if (input == null) return input;
  let s = String(input);
  for (const p of REDACTION_PATTERNS) {
    if (p.re.global) {
      if (p.name === 'private_key_block') s = s.replace(p.re, '$1\n[REDACTED]\n$2');
      else s = s.replace(p.re, (m, p1) => (p1 !== undefined ? `${p1}${REDACTED}` : REDACTED));
    }
  }
  return s;
}

function redactEvidenceItem(e) {
  if (!e || typeof e !== 'object') return e;
  const out = { ...e };
  if (out.payload) out.payload = redactString(typeof out.payload === 'string' ? out.payload : JSON.stringify(out.payload), {});
  if (out.observation) out.observation = redactString(out.observation);
  if (out.target && /password|token|secret|key/i.test(out.target)) out.target = redactString(out.target);
  return out;
}

/* ------------------------------------------------------------------ */
/* Workflow / feature linkage                                          */
/* ------------------------------------------------------------------ */

function pageFromUrl(url) {
  try { return new URL(url).pathname; } catch { return null; }
}

/**
 * Derive workflow/feature/component/api linkage deterministically.
 * Returns nulls (UNKNOWN) when not confidently derivable — never invented.
 */
function deriveLinkage(f, evidence, workflows = [], features = []) {
  const page = pageFromUrl(f.url);
  const linkage = { workflow_id: null, feature_id: null, page, component: null, api_endpoint: null, confidence: 0.3, basis: [] };

  // API endpoint from evidence targets/payloads
  for (const e of evidence || []) {
    const t = String(e.target || e.observation || '');
    const m = t.match(/https?:\/\/[^\s"']+|(?:^|["'\s])(\/api\/[^\s"'?]*)/i);
    if (m) { linkage.api_endpoint = m[0].trim(); linkage.basis.push('evidence_api_endpoint'); break; }
  }

  // Component from evidence DOM target
  const domEv = (evidence || []).find(e => e.type === 'dom' || /button|input|form|select|\[data-/i.test(String(e.target || '')));
  if (domEv && domEv.target) {
    const cm = String(domEv.target).match(/(?:button|input|form|select|a|div)\[[^"]*"([^"]{2,40})"/i) || String(domEv.target).match(/(button|input|form|select)\s*[:#]\s*([^\s"']{2,40})/i);
    if (cm) { linkage.component = (cm[1] || cm[2]).slice(0, 40); linkage.basis.push('evidence_dom_target'); }
  }

  // Pre-existing explicit linkage always wins over derived guesses.
  if (f.workflowId) { linkage.workflow_id = f.workflowId; linkage.basis.push('explicit_workflow_id'); }
  if (f.featureId) { linkage.feature_id = f.featureId; linkage.basis.push('explicit_feature_id'); }

  // Workflow match: saved workflow whose name/steps' url overlap the finding's page/title
  const titleWords = new Set(normalizeText(f.title));
  let best = null;
  for (const wf of workflows || []) {
    let score = 0;
    const wfUrl = wf.targetUrl ? pageFromUrl(wf.targetUrl) : null;
    if (page && wfUrl && (page === wfUrl || wfUrl.startsWith(page) || page.startsWith(wfUrl))) score += 0.5;
    const wfNameWords = normalizeText(wf.name);
    const overlap = wfNameWords.filter(w => titleWords.has(w)).length;
    if (wfNameWords.length > 0 && overlap >= 1) score += 0.25 * Math.min(2, overlap);
    for (const st of (wf.steps || []).slice(0, 30)) {
      const stUrl = st.url ? pageFromUrl(st.url) : null;
      if (page && stUrl && stUrl === page) { score += 0.25; break; }
    }
    if (score > (best ? best.score : 0)) best = { wf, score };
  }
  if (!linkage.workflow_id && best && best.score >= 0.5) {
    linkage.workflow_id = best.wf.id;
    linkage.workflow_name = best.wf.name;
    linkage.confidence = Math.min(0.9, 0.5 + best.score / 2);
    linkage.basis.push('workflow_url_and_name_overlap');
  }

  // Feature match by name overlap
  if (!linkage.feature_id) {
    for (const feat of features || []) {
      const fw = normalizeText(feat.name);
      const overlap = fw.filter(w => titleWords.has(w)).length;
      if (fw.length >= 1 && overlap >= Math.max(1, Math.ceil(fw.length / 2))) {
        linkage.feature_id = feat.id;
        linkage.feature_name = feat.name;
        linkage.basis.push('feature_name_overlap');
        break;
      }
    }
  }
  if (!linkage.workflow_id && !linkage.feature_id && !linkage.api_endpoint) linkage.basis.push('no_confident_link');
  return linkage;
}

/* ------------------------------------------------------------------ */
/* Developer summary                                                   */
/* ------------------------------------------------------------------ */

function buildDevSummary(f, evidence) {
  const evCount = (evidence || []).length;
  const evTypes = [...new Set((evidence || []).map(e => e.type))];
  const rc = f.root_cause_category && f.root_cause_category !== 'unknown'
    ? f.root_cause_category : 'unknown (symptom only)';
  const investigation = [];
  if (f.primary_category === 'API' || evTypes.includes('network') || evTypes.includes('api_response')) investigation.push('Inspect the failing network request and its response in devtools');
  if (evTypes.includes('console')) investigation.push('Reproduce with the browser console open and capture the stack trace');
  if (f.workflow_id) investigation.push('Trace the workflow step where the failure occurs end-to-end');
  if (f.expected && f.actual) investigation.push('Compare expected vs actual state at the failing step');
  if (investigation.length === 0) investigation.push('Reproduce manually using the recorded steps and capture console/network output');
  const fix = f.fixPrompt || f.recommendation || null;
  return {
    title: f.title,
    category: f.primary_category || 'UNKNOWN',
    severity: f.severity,
    priority: f.priority || null,
    confidence: f.confidence ?? null,
    reproducibility: f.reproducibility || null,
    expected: f.expected ? redactString(f.expected) : null,
    actual: (f.actual || f.observed) ? redactString(f.actual || f.observed) : null,
    impact: f.impact ? redactString(f.impact) : null,
    evidence: { count: evCount, types: evTypes },
    workflow: f.workflow_id || null,
    feature: f.feature_id || null,
    page: f.page || null,
    api_endpoint: f.api_endpoint || null,
    potentialRootCause: rc,
    rootCausePotentials: f.root_cause_potential || [],
    suggestedInvestigation: investigation,
    recommendedFix: fix ? redactString(fix) : null,
    recommended_fix_source: fix ? 'agent' : null,
    regressionRisk: f.risk ? `Review related areas after fix (${f.risk} risk)` : null,
  };
}

/* ------------------------------------------------------------------ */
/* Orchestration: enrich a single finding                              */
/* ------------------------------------------------------------------ */

const INTELLIGENCE_VERSION = 'phase16-v1';

/**
 * Enrich one finding with deterministic intelligence. Pure function — returns the
 * derived intelligence fields; caller merges into the store. Never throws (best effort).
 */
function enrichFinding(f, ctx = {}) {
  const evidence = ctx.evidence || [];
  const out = { intelligence_version: INTELLIGENCE_VERSION };

  const cls = classifyFinding(f);
  out.primary_category = cls.primary;
  out.secondary_categories = cls.secondary;
  out.classification_confidence = cls.confidence;
  out.classification_method = cls.method;

  const sev = computeSeverity({ ...f, primary_category: cls.primary }, evidence);
  out.severity = sev.severity;
  out.severity_confidence = sev.confidence;
  out.severity_rationale = sev.rationale;

  const repro = computeReproducibility(f);
  out.reproducibility = repro.reproducibility;
  out.reproduction_attempts = repro.attempts;
  out.successful_reproductions = repro.successes;
  out.reproduction_rate = repro.rate;

  // Legacy 'confirmed' reproducibility means the agent reproduced it at least once —
  // carry that through so computeConfidence sees an attempted, successful reproduction.
  const confInput = {
    ...f,
    reproduction_rate: repro.rate,
    reproducibility: repro.reproducibility,
    reproduction_attempts: repro.attempts,
    successful_reproductions: repro.successes,
  };
  if (f.reproducibility === 'confirmed' && repro.attempts === 0) {
    confInput.reproduction_attempts = 1;
    confInput.successful_reproductions = 1;
    confInput.reproduction_rate = null; // count unknown — rate not fabricated
  }
  const conf = computeConfidence(confInput, evidence, ctx.observationCount || 0);
  out.confidence = conf.confidence;
  out.confidence_reason = { level: conf.level, signals: Object.keys(conf.signals), contributions: conf.contributions };

  const suff = assessEvidenceSufficiency({ ...f, primary_category: cls.primary }, evidence);
  out.evidence_sufficiency = suff;

  const exp = assessExpectedActual(f);
  out.expected_uncertain = exp.uncertain;
  out.expected_source = exp.source;

  const linkage = deriveLinkage(f, evidence, ctx.workflows, ctx.features);
  out.workflow_id = linkage.workflow_id;
  out.feature_id = linkage.feature_id;
  // Canonical camelCase mirrors — store + all consumers (filters, UI,
  // affected-workflow/feature, related, grouping) read these.
  if (linkage.workflow_id) out.workflowId = linkage.workflow_id;
  if (linkage.feature_id) out.featureId = linkage.feature_id;
  if (linkage.workflow_name) out.workflow_name = linkage.workflow_name;
  if (linkage.feature_name) out.feature_name = linkage.feature_name;
  out.page = linkage.page;
  out.component = linkage.component;
  out.api_endpoint = linkage.api_endpoint;
  out.linkage_confidence = linkage.confidence;
  out.linkage_basis = linkage.basis;

  const withDerived = { ...f, ...out };
  const prio = computePriority(withDerived);
  out.priority = prio.priority;
  out.priority_rationale = prio.rationale;

  const risk = computeRisk(withDerived);
  out.risk = risk.risk;
  out.risk_reason = risk.reason;

  const rc = assessRootCause(withDerived, evidence);
  out.root_cause_category = rc.category;
  out.root_cause_confidence = rc.confidence;
  out.root_cause_potential = rc.potentials;

  out.quality = computeQuality({ ...f, ...out }, evidence);

  // Lifecycle: derive from evidence + review state (deterministic).
  // hasReproObservation (ctx) distinguishes agent-observed re-test failures
  // from bookkeeping-only revalidate clicks — UNREPRODUCIBLE is only derived
  // for the former.
  out.finding_status = deriveLifecycle({ ...f, ...out, hasReproObservation: ctx.hasReproObservation === true });
  out.review_status = f.review_status || 'unreviewed';

  out.dev_summary = buildDevSummary({ ...f, ...out }, evidence);
  out.evidence_refs = evidence.map(e => e.id).slice(0, 50);
  out.enriched_at = new Date().toISOString();
  return out;
}

/**
 * Deterministic lifecycle derivation from evidence/state:
 * - insufficient evidence → stays DETECTED (or INCONCLUSIVE when expected/actual absent AND no evidence)
 * - sufficient + verified-ish → VERIFYING → VERIFIED only when sufficiency passes AND (reproduced OR ≥2 evidence)
 * - duplicate_of set → DUPLICATE
 * - review_status false_positive → FALSE_POSITIVE
 * - UNREPRODUCIBLE only when failures were OBSERVED BY THE AGENT while
 *   re-testing (hasReproObservation flag) — a bookkeeping-only revalidate
 *   click that found insufficient evidence must NOT fabricate UNREPRODUCIBLE.
 */
function deriveLifecycle(f) {
  if (f.review_status === 'false_positive') return 'FALSE_POSITIVE';
  if (f.duplicate_of && f.review_status !== 'unreviewed') return 'DUPLICATE';
  if (f.hasReproObservation && f.reproduction_attempts >= 1 && f.successful_reproductions === 0) return 'UNREPRODUCIBLE';
  const suff = f.evidence_sufficiency && f.evidence_sufficiency.sufficient;
  if (!suff) {
    if (!f.expected && !f.actual && (f.evidence_sufficiency?.present?.count || 0) === 0) return 'INCONCLUSIVE';
    return 'DETECTED';
  }
  const reproduced = f.reproducibility === 'REPRODUCIBLE';
  if (reproduced || (f.evidence_sufficiency?.present?.count || 0) >= 2) return 'VERIFIED';
  return 'VERIFYING';
}

/* ------------------------------------------------------------------ */
/* Grouped report data (dedup-aware)                                   */
/* ------------------------------------------------------------------ */

function groupFindings(findings, groupBy = 'category') {
  const canonical = findings.filter(f => !f.isDuplicate);
  const dupes = findings.filter(f => f.isDuplicate);
  const keyOf = {
    category: f => f.primary_category || normalizeCategory(f.category) || 'UNKNOWN',
    severity: f => (f.severity || 'medium').toUpperCase(),
    priority: f => f.priority || 'UNTRIAGED',
    workflow: f => f.workflow_name || f.workflow_id || 'UNKNOWN',
    feature: f => f.feature_name || f.feature_id || 'UNKNOWN',
    risk: f => f.risk || 'UNKNOWN',
  }[groupBy];
  if (!keyOf) throw new Error(`Unknown groupBy: ${groupBy}`);
  const groups = {};
  for (const f of canonical) {
    const k = keyOf(f);
    if (!groups[k]) groups[k] = { key: k, total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, findingIds: [] };
    groups[k].total++;
    groups[k].bySeverity[f.severity] = (groups[k].bySeverity[f.severity] || 0) + 1;
    groups[k].findingIds.push(f.id);
  }
  return { groupBy, groups, duplicatesExcluded: dupes.length, canonicalCount: canonical.length, duplicateCount: dupes.length };
}

export {
  CATEGORIES, SEVERITIES, SEVERITY_ORDER, PRIORITIES, LIFECYCLE, REVIEW_STATUSES,
  REPRODUCIBILITIES, ROOT_CAUSES, RISKS, LIFECYCLE_TRANSITIONS, INTELLIGENCE_VERSION,
  CONFIDENCE_SIGNALS, SUFFICIENCY_RULES, IMPACT_SIGNALS, DUPLICATE_EXACT_THRESHOLD, DUPLICATE_POSSIBLE_THRESHOLD,
  classifyFinding, normalizeCategory, computeSeverity, severitySignals, computePriority,
  computeConfidence, computeReproducibility, assessEvidenceSufficiency, assessExpectedActual,
  computeRisk, assessRootCause, compareForDuplicates, detectDuplicates, errorSignature,
  validateLifecycleTransition, computeQuality, redactString, redactEvidenceItem,
  deriveLinkage, buildDevSummary, enrichFinding, deriveLifecycle, groupFindings,
  pageFromUrl, normalizeText, jaccard, clamp01,
};
