/**
 * Phase 8 — Domain Understanding Engine
 *
 * Hypothesis-based domain classification using multiple evidence sources.
 * Instead of immediately deciding "this is an analytics app", generates
 * multiple hypotheses, collects evidence, and selects the best-supported one.
 *
 * Evidence sources (weighted):
 *   1. Mission intent (build prompt, requirements)     — weight: 0.35
 *   2. Static evidence (page text, headings, nav)       — weight: 0.25
 *   3. Structural evidence (routes, forms, UI elements) — weight: 0.20
 *   4. Interactive evidence (observed behaviors)         — weight: 0.15
 *   5. Knowledge patterns                                — weight: 0.05
 *
 * Confidence rules:
 *   - Single weak source → LOW confidence, mark uncertain
 *   - Two+ sources agree → MEDIUM confidence
 *   - Three+ sources agree → HIGH confidence
 *   - Contradiction between sources → confidence reduced
 *   - If best score < threshold → domain = "unknown"
 */

import { DOMAIN_CATALOG, PROVENANCE, getDomainExpectedFeatures, getDomainRiskAreas } from './intentModel.js';

// ─── Confidence Thresholds ──────────────────────────────────────────

const DOMAIN_CONFIDENCE_THRESHOLD = 0.35;  // Below this → domain = "unknown"
const HIGH_CONFIDENCE_THRESHOLD = 0.65;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.45;

// ─── Evidence Source Weights ────────────────────────────────────────

const SOURCE_WEIGHTS = Object.freeze({
  intent: 0.35,
  static: 0.25,
  structural: 0.20,
  interactive: 0.15,
  knowledge: 0.05,
});

// ─── Domain Classifier ──────────────────────────────────────────────

/**
 * Classify application domain using multiple evidence sources.
 *
 * @param {object} params
 * @param {object} params.intentDomainHypotheses - From intentModel.generateDomainHypothesesFromIntent
 * @param {object} params.inventory - From featureGap.extractAppInventory
 * @param {object} params.session - Session with capturedSteps, activities, findings
 * @param {object[]} params.knowledgePatterns - Relevant knowledge patterns (if any)
 * @returns {object} { domain, domainName, confidence, hypotheses, evidence, method, contradictions }
 */
function classifyDomain({ intentDomainHypotheses = [], inventory = {}, session = {}, knowledgePatterns = [] }) {
  const hypotheses = {};
  const evidenceBySource = {};
  const contradictions = [];

  // ── Source 1: Intent hypotheses ──────────────────────────────────
  // Phase 9.1: Improved confidence scaling — strong intent evidence
  // (many keyword matches) should boost confidence closer to the source weight.
  evidenceBySource.intent = [];
  if (intentDomainHypotheses.length > 0) {
    for (const hyp of intentDomainHypotheses) {
      // Phase 9.1: Better scaling formula.
      // Old: weight * (score / (score + 1)) — maxes at weight but dampens strongly
      // New: weight * min(1.0, score / 3) — reaches full weight at 3+ keyword matches
      // This means 3+ keywords from build prompt → full intent source contribution.
      const intentFactor = Math.min(1.0, hyp.score / 3);
      addToHypothesis(hypotheses, hyp.domainId, SOURCE_WEIGHTS.intent * intentFactor, 'intent', hyp.matchedKeywords);
      evidenceBySource.intent.push({
        domain: hyp.domainId,
        domainName: hyp.domainName,
        score: hyp.score,
        matchedKeywords: hyp.matchedKeywords,
        weight: SOURCE_WEIGHTS.intent * intentFactor,
        reason: `Build prompt/requirements mention: ${hyp.matchedKeywords.join(', ')}`,
      });
    }
  }

  // ── Source 2: Static evidence (page text, headings, nav labels) ──
  evidenceBySource.static = [];
  const staticEvidence = extractStaticDomainEvidence(session, inventory);
  for (const item of staticEvidence) {
    addToHypothesis(hypotheses, item.domainId, SOURCE_WEIGHTS.static * item.weight, 'static', item.evidence);
    evidenceBySource.static.push(item);
  }

  // ── Source 3: Structural evidence (routes, forms, UI) ────────────
  evidenceBySource.structural = [];
  const structuralEvidence = extractStructuralDomainEvidence(session, inventory);
  for (const item of structuralEvidence) {
    addToHypothesis(hypotheses, item.domainId, SOURCE_WEIGHTS.structural * item.weight, 'structural', item.evidence);
    evidenceBySource.structural.push(item);
  }

  // ── Source 4: Interactive evidence (observed behaviors) ──────────
  evidenceBySource.interactive = [];
  const interactiveEvidence = extractInteractiveDomainEvidence(session, inventory);
  for (const item of interactiveEvidence) {
    addToHypothesis(hypotheses, item.domainId, SOURCE_WEIGHTS.interactive * item.weight, 'interactive', item.evidence);
    evidenceBySource.interactive.push(item);
  }

  // ── Source 5: Knowledge patterns ─────────────────────────────────
  evidenceBySource.knowledge = [];
  if (knowledgePatterns && knowledgePatterns.length > 0) {
    for (const pattern of knowledgePatterns) {
      if (pattern.metadata && pattern.metadata.appType) {
        const domainId = mapAppTypeToDomain(pattern.metadata.appType);
        if (domainId && DOMAIN_CATALOG[domainId]) {
          addToHypothesis(hypotheses, domainId, SOURCE_WEIGHTS.knowledge, 'knowledge', [`pattern:${pattern.pattern.slice(0, 50)}`]);
          evidenceBySource.knowledge.push({
            domainId,
            domainName: DOMAIN_CATALOG[domainId].name,
            weight: SOURCE_WEIGHTS.knowledge,
            evidence: [`pattern:${pattern.pattern.slice(0, 50)}`],
            reason: `Historical pattern match`,
          });
        }
      }
    }
  }

  // ── Resolve hypotheses ───────────────────────────────────────────
  const sortedHypotheses = Object.values(hypotheses).sort((a, b) => b.totalScore - a.totalScore);
  const best = sortedHypotheses[0];
  const second = sortedHypotheses[1];

  // Check for contradictions
  if (best && second) {
    const scoreDiff = best.totalScore - second.totalScore;
    if (scoreDiff < 0.05 && best.sources.size >= 2 && second.sources.size >= 2) {
      contradictions.push({
        description: `Ambiguous domain: ${best.domainName} (${best.totalScore.toFixed(3)}) vs ${second.domainName} (${second.totalScore.toFixed(3)})`,
        domains: [best.domainId, second.domainId],
        impact: 'confidence_reduced',
      });
    }
  }

  // Determine final domain
  let domain, domainName, confidence, method;

  if (!best || best.totalScore < DOMAIN_CONFIDENCE_THRESHOLD) {
    domain = 'unknown';
    domainName = 'Unknown';
    confidence = 0.1;
    method = 'insufficient_evidence';
  } else if (contradictions.length > 0 && best.totalScore < HIGH_CONFIDENCE_THRESHOLD) {
    domain = best.domainId;
    domainName = best.domainName;
    confidence = best.totalScore * 0.7; // Reduced due to contradiction
    method = 'best_effort_ambiguous';
  } else {
    domain = best.domainId;
    domainName = best.domainName;
    confidence = best.totalScore;

    if (best.sources.size >= 3 && confidence >= HIGH_CONFIDENCE_THRESHOLD) {
      method = 'multi_source_consensus';
    } else if (best.sources.size >= 2) {
      method = 'dual_source';
    } else {
      method = 'single_source';
    }
  }

  // Phase 9.1: Build confidence explanation for auditability
  const confidenceExplanation = {
    domain,
    domainName,
    confidence: Math.round(confidence * 100) / 100,
    method,
    supportingSignals: [],
    conflictingSignals: [],
    evidenceCount: best ? best.allEvidence.length : 0,
    sourceCount: best ? best.sources.size : 0,
  };

  if (best) {
    // Supporting signals
    if (best.sources.has('intent')) {
      const intentHyps = (evidenceBySource.intent || []).filter(e => e.domain === best.domainId);
      confidenceExplanation.supportingSignals.push({
        source: 'intent',
        weight: SOURCE_WEIGHTS.intent,
        reason: `Build prompt/requirements match ${intentHyps.reduce((s, h) => s + h.score, 0)} domain keyword(s)`,
      });
    }
    if (best.sources.has('static')) {
      confidenceExplanation.supportingSignals.push({
        source: 'static',
        weight: SOURCE_WEIGHTS.static,
        reason: 'Page text/headings contain domain-specific terms',
      });
    }
    if (best.sources.has('structural')) {
      confidenceExplanation.supportingSignals.push({
        source: 'structural',
        weight: SOURCE_WEIGHTS.structural,
        reason: 'Routes/forms/UI elements match domain patterns',
      });
    }
    if (best.sources.has('interactive')) {
      confidenceExplanation.supportingSignals.push({
        source: 'interactive',
        weight: SOURCE_WEIGHTS.interactive,
        reason: 'Observed behaviors confirm domain functionality',
      });
    }
  }

  if (contradictions.length > 0) {
    for (const c of contradictions) {
      confidenceExplanation.conflictingSignals.push({
        description: c.description,
        impact: c.impact,
      });
    }
  }

  return {
    domain,
    domainName,
    confidence: Math.round(confidence * 100) / 100,
    hypotheses: sortedHypotheses.map(h => ({
      domainId: h.domainId,
      domainName: h.domainName,
      score: Math.round(h.totalScore * 1000) / 1000,
      sources: Array.from(h.sources),
      evidenceCount: h.allEvidence.length,
    })),
    evidence: evidenceBySource,
    method,
    contradictions,
    supportingDomains: sortedHypotheses.slice(0, 3).map(h => h.domainId),
    confidenceExplanation,
  };
}

// ─── Hypothesis Accumulation ────────────────────────────────────────

function addToHypothesis(hypotheses, domainId, score, source, evidenceItems) {
  if (!hypotheses[domainId]) {
    hypotheses[domainId] = {
      domainId,
      domainName: DOMAIN_CATALOG[domainId]?.name || domainId,
      totalScore: 0,
      sources: new Set(),
      allEvidence: [],
    };
  }
  hypotheses[domainId].totalScore += score;
  hypotheses[domainId].sources.add(source);
  for (const e of (evidenceItems || [])) {
    hypotheses[domainId].allEvidence.push({ source, evidence: e });
  }
}

// ─── Static Evidence Extraction ─────────────────────────────────────

function extractStaticDomainEvidence(session, inventory) {
  const evidence = [];
  const text = collectAllText(session, inventory).toLowerCase();

  if (!text.trim()) return evidence;

  // Score each domain against text content
  for (const [domainId, domain] of Object.entries(DOMAIN_CATALOG)) {
    if (domainId === 'generic') continue;
    let hits = 0;
    const matched = [];
    for (const kw of domain.keywords) {
      if (text.includes(kw.toLowerCase())) {
        hits += 1;
        matched.push(kw);
      }
    }
    if (hits > 0) {
      evidence.push({
        domainId,
        domainName: domain.name,
        weight: Math.min(hits / Math.max(domain.keywords.length, 1), 1.0),
        evidence: matched.map(kw => `text:${kw}`),
        reason: `Page text contains: ${matched.join(', ')}`,
      });
    }
  }

  return evidence;
}

function collectAllText(session, inventory) {
  const parts = [];

  // From inventory
  if (inventory.pages) {
    for (const page of inventory.pages) {
      parts.push(page.title || '', page.path || '', ...(page.headings || []));
    }
  }

  // Phase 9.2: From captured steps — use REAL field names (target, label, value, displayLabel)
  // Old code used step.title/step.description which don't exist on capturedSteps.
  if (session.capturedSteps) {
    for (const step of session.capturedSteps) {
      parts.push(step.target || '', step.label || '', step.displayLabel || '', step.value || '', step.url || '');
    }
  }

  // Phase 9.2: From activities — use REAL field names (toolName, detail, input)
  // Old code checked type === 'text' which never matches (type is always 'tool').
  if (session.activities) {
    for (const act of session.activities) {
      parts.push(act.detail || '', act.toolName || '');
      // Extract text from input object
      if (act.input) {
        if (typeof act.input === 'string') {
          parts.push(act.input);
        } else {
          parts.push(...Object.values(act.input).map(v => typeof v === 'string' ? v : ''));
        }
      }
    }
  }

  // From findings
  if (session.findings) {
    for (const f of session.findings) {
      parts.push(f.title || '', f.description || '');
    }
  }

  return parts.filter(Boolean).join(' ');
}

// ─── Structural Evidence Extraction ─────────────────────────────────

function extractStructuralDomainEvidence(session, inventory) {
  const evidence = [];
  const signals = extractStructuralSignals(session, inventory);

  // Check for e-commerce signals
  if (signals.productGrid || signals.cartButton || signals.checkoutForm) {
    evidence.push({
      domainId: 'ecommerce',
      domainName: DOMAIN_CATALOG.ecommerce.name,
      weight: 0.8,
      evidence: ['structure:product_grid', 'structure:cart', 'structure:checkout'].slice(0, signals.productGrid + signals.cartButton + signals.checkoutForm > 1 ? 3 : 1),
      reason: 'Product grid / cart / checkout structure detected',
    });
  }

  // Check for dashboard/analytics signals
  if (signals.statCards || signals.charts || signals.dataTables) {
    evidence.push({
      domainId: 'analytics',
      domainName: DOMAIN_CATALOG.analytics.name,
      weight: 0.8,
      evidence: ['structure:stat_cards', 'structure:charts', 'structure:data_tables'].slice(0, 3),
      reason: 'Dashboard elements (stat cards, charts, data tables) detected',
    });
  }

  // Check for project management signals
  if (signals.kanbanColumns || signals.taskCards) {
    evidence.push({
      domainId: 'project_management',
      domainName: DOMAIN_CATALOG.project_management.name,
      weight: 0.8,
      evidence: ['structure:kanban', 'structure:task_cards'],
      reason: 'Kanban board / task cards detected',
    });
  }

  // Check for marketing signals
  if (signals.heroSection || signals.pricingCards || signals.testimonials) {
    evidence.push({
      domainId: 'marketing',
      domainName: DOMAIN_CATALOG.marketing.name,
      weight: 0.8,
      evidence: ['structure:hero', 'structure:pricing', 'structure:testimonials'],
      reason: 'Marketing page elements (hero, pricing, testimonials) detected',
    });
  }

  // Check for CRM signals
  if (signals.contactTable || signals.pipelineStages || signals.leadForm) {
    evidence.push({
      domainId: 'crm',
      domainName: DOMAIN_CATALOG.crm.name,
      weight: 0.8,
      evidence: ['structure:contact_table', 'structure:pipeline', 'structure:lead_form'],
      reason: 'CRM elements (contacts, pipeline, leads) detected',
    });
  }

  // Check for SaaS dashboard signals
  if (signals.settingsForm || signals.userTable || signals.apiKeySection) {
    evidence.push({
      domainId: 'saas_dashboard',
      domainName: DOMAIN_CATALOG.saas_dashboard.name,
      weight: 0.7,
      evidence: ['structure:settings', 'structure:user_table', 'structure:api_keys'],
      reason: 'SaaS admin elements (settings, user table, API keys) detected',
    });
  }

  return evidence;
}

function extractStructuralSignals(session, inventory) {
  const signals = {
    productGrid: false, cartButton: false, checkoutForm: false,
    statCards: false, charts: false, dataTables: false,
    kanbanColumns: false, taskCards: false,
    heroSection: false, pricingCards: false, testimonials: false,
    contactTable: false, pipelineStages: false, leadForm: false,
    settingsForm: false, userTable: false, apiKeySection: false,
  };

  const text = collectAllText(session, inventory).toLowerCase();

  // Structural detection from text patterns
  if (/\b(add to cart|cart total|your cart)\b/i.test(text) || text.includes('cart-count')) signals.cartButton = true;
  if (/\b(checkout|place order|shipping address)\b/i.test(text)) signals.checkoutForm = true;
  if (/\b(product|price|\$\d+)\b/i.test(text) && inventory.pages && inventory.pages.length > 1) signals.productGrid = true;
  if (/\b(total users|total revenue|mrr|active users|stat)\b/i.test(text)) signals.statCards = true;
  if (/\b(chart|graph|visualization)\b/i.test(text)) signals.charts = true;
  if (/\b(revenue table|user table|data table)\b/i.test(text) || (inventory.pages && inventory.pages.some(p => (p.title || '').toLowerCase().includes('table')))) signals.dataTables = true;
  if (/\b(to do|in progress|review|done)\b/i.test(text) && /\b(column|board)\b/i.test(text)) signals.kanbanColumns = true;
  if (/\b(task|assignee|priority)\b/i.test(text)) signals.taskCards = true;
  if (/\b(hero|get started|welcome to)\b/i.test(text)) signals.heroSection = true;
  if (/\b(pricing|plan|tier|\$\d+\/mo)\b/i.test(text)) signals.pricingCards = true;
  if (/\b(testimonial|what.*customers say|review)\b/i.test(text)) signals.testimonials = true;
  if (/\b(contact|name.*email.*company)\b/i.test(text) && /\b(table|list)\b/i.test(text)) signals.contactTable = true;
  if (/\b(pipeline|stage|new.*contacted.*won)\b/i.test(text)) signals.pipelineStages = true;
  if (/\b(lead|prospect)\b/i.test(text) && /\b(form|add)\b/i.test(text)) signals.leadForm = true;
  if (/\b(settings|preferences|configuration)\b/i.test(text)) signals.settingsForm = true;
  if (/\b(users?|team members?)\b/i.test(text) && /\b(table|list)\b/i.test(text)) signals.userTable = true;
  if (/\b(api key|generate key|token)\b/i.test(text)) signals.apiKeySection = true;

  // From inventory capabilities
  if (inventory.capabilities) {
    for (const cap of inventory.capabilities) {
      const c = cap.toLowerCase();
      if (c.includes('cart')) signals.cartButton = true;
      if (c.includes('checkout')) signals.checkoutForm = true;
      if (c.includes('product')) signals.productGrid = true;
      if (c.includes('chart') || c.includes('dashboard')) signals.charts = true;
      if (c.includes('settings')) signals.settingsForm = true;
      if (c.includes('api')) signals.apiKeySection = true;
    }
  }

  // From form fields
  if (inventory.formFields) {
    const fieldText = inventory.formFields.map(f => f.label || f.name || '').join(' ').toLowerCase();
    if (fieldText.includes('card') || fieldText.includes('cvv')) signals.checkoutForm = true;
    if (fieldText.includes('email') && fieldText.includes('company')) signals.contactTable = true;
  }

  return signals;
}

// ─── Interactive Evidence Extraction ────────────────────────────────

function extractInteractiveDomainEvidence(session, inventory) {
  const evidence = [];
  const steps = session.capturedSteps || [];

  // Look for domain-specific interactions
  const interactions = {
    ecommerce: 0,
    crm: 0,
    project_management: 0,
    analytics: 0,
    saas_dashboard: 0,
    marketing: 0,
  };

  // Phase 9.2: Use REAL field names from capturedSteps.
  // Old code read step.title/step.description which don't exist.
  // Real fields: action, target, label, displayLabel, value, url
  for (const step of steps) {
    const text = `${step.target || ''} ${step.label || ''} ${step.displayLabel || ''} ${step.value || ''} ${step.url || ''}`.toLowerCase();
    const action = (step.action || '').toLowerCase();

    // Only count actual interaction actions (not snapshots/screenshots)
    if (action === 'snapshot' || action === 'screenshot' || action === 'diagnostics') continue;

    if (text.includes('cart') || text.includes('checkout') || text.includes('product') || text.includes('order') || text.includes('price')) {
      interactions.ecommerce++;
    }
    if (text.includes('contact') || text.includes('lead') || text.includes('pipeline') || text.includes('deal')) {
      interactions.crm++;
    }
    if (text.includes('task') || text.includes('board') || text.includes('kanban') || text.includes('sprint') || text.includes('column')) {
      interactions.project_management++;
    }
    if (text.includes('dashboard') || text.includes('chart') || text.includes('revenue') || text.includes('metric') || text.includes('analytics') || text.includes('user') && text.includes('table')) {
      interactions.analytics++;
    }
    if (text.includes('settings') || text.includes('api key') || text.includes('user management') || text.includes('invite')) {
      interactions.saas_dashboard++;
    }
    if (text.includes('pricing') || text.includes('plan') || text.includes('testimonial') || text.includes('hero') || text.includes('sign up') || text.includes('get started')) {
      interactions.marketing++;
    }
  }

  // Also extract from activities (report_finding, update_todo contain domain text)
  if (session.activities) {
    for (const act of session.activities) {
      const detail = (act.detail || '').toLowerCase();
      const inputText = typeof act.input === 'object'
        ? Object.values(act.input || {}).map(v => typeof v === 'string' ? v : '').join(' ').toLowerCase()
        : (typeof act.input === 'string' ? act.input.toLowerCase() : '');

      const combined = detail + ' ' + inputText;

      if (combined.includes('cart') || combined.includes('checkout') || combined.includes('product') || combined.includes('order') || combined.includes('price')) {
        interactions.ecommerce++;
      }
      if (combined.includes('contact') || combined.includes('lead') || combined.includes('pipeline') || combined.includes('deal')) {
        interactions.crm++;
      }
      if (combined.includes('task') || combined.includes('board') || combined.includes('kanban') || combined.includes('sprint') || combined.includes('column')) {
        interactions.project_management++;
      }
      if (combined.includes('dashboard') || combined.includes('chart') || combined.includes('revenue') || combined.includes('metric') || combined.includes('analytics')) {
        interactions.analytics++;
      }
      if (combined.includes('settings') || combined.includes('api key') || combined.includes('user management') || combined.includes('invite')) {
        interactions.saas_dashboard++;
      }
      if (combined.includes('pricing') || combined.includes('plan') || combined.includes('testimonial') || combined.includes('hero') || combined.includes('sign up') || combined.includes('get started')) {
        interactions.marketing++;
      }
    }
  }

  for (const [domainId, count] of Object.entries(interactions)) {
    if (count >= 2) {
      evidence.push({
        domainId,
        domainName: DOMAIN_CATALOG[domainId]?.name || domainId,
        weight: Math.min(count / 10, 0.8),
        evidence: [`interaction_count:${count}`],
        reason: `Agent interacted with ${domainId}-related elements ${count} times`,
      });
    }
  }

  return evidence;
}

// ─── Helper: Map appType to domain ──────────────────────────────────

function mapAppTypeToDomain(appType) {
  const mapping = {
    'crm': 'crm',
    'ecommerce': 'ecommerce',
    'e-commerce': 'ecommerce',
    'shop': 'ecommerce',
    'project_management': 'project_management',
    'kanban': 'project_management',
    'task_board': 'project_management',
    'analytics': 'analytics',
    'dashboard': 'analytics',
    'saas_dashboard': 'saas_dashboard',
    'admin': 'saas_dashboard',
    'marketing': 'marketing',
    'landing_page': 'marketing',
    'blog': 'blog',
    'social': 'social',
    'education': 'education',
    'lms': 'education',
    'healthcare': 'healthcare',
  };
  return mapping[appType?.toLowerCase()] || null;
}

// ─── Domain Verification ────────────────────────────────────────────

/**
 * Given a domain classification, verify it by checking that expected
 * structural signals are present. This prevents domain confusion (e.g.,
 * hallucinating GitHub features for an analytics dashboard).
 *
 * @param {object} domainResult - Result from classifyDomain
 * @param {object} inventory - App inventory
 * @returns {object} { verified, confidence, warnings }
 */
function verifyDomainClassification(domainResult, inventory = {}) {
  if (domainResult.domain === 'unknown') {
    return { verified: false, confidence: domainResult.confidence, warnings: ['Cannot verify unknown domain'] };
  }

  const domain = DOMAIN_CATALOG[domainResult.domain];
  if (!domain) {
    return { verified: false, confidence: 0, warnings: [`Unknown domain: ${domainResult.domain}`] };
  }

  const warnings = [];

  // Check: Does the domain's expected features appear anywhere in the app?
  const text = collectAllText({}, inventory).toLowerCase();
  let keywordHits = 0;
  for (const kw of domain.keywords) {
    if (text.includes(kw.toLowerCase())) {
      keywordHits++;
    }
  }

  // If we classified as domain X but NONE of its keywords appear in the app text,
  // this is likely a hallucination.
  if (keywordHits === 0) {
    warnings.push(`Domain "${domain.name}" has ZERO keyword matches in application text — likely hallucination`);
    return {
      verified: false,
      confidence: domainResult.confidence * 0.3,
      warnings,
    };
  }

  // If only 1 keyword matches out of many, warn
  if (keywordHits === 1 && domain.keywords.length > 3) {
    warnings.push(`Domain "${domain.name}" has only 1/${domain.keywords.length} keyword matches — weak evidence`);
    return {
      verified: true,
      confidence: domainResult.confidence * 0.7,
      warnings,
    };
  }

  return {
    verified: true,
    confidence: domainResult.confidence,
    warnings: [],
  };
}

// ─── Expected Feature Filtering by Domain ───────────────────────────

/**
 * Given a domain, return the expected features that are domain-appropriate.
 * This prevents generating nonsensical features (e.g., GitHub features for analytics).
 *
 * @param {string} domainId - Classified domain
 * @returns {object[]} Filtered expected features
 */
function getDomainFeaturesForClassification(domainId) {
  return getDomainExpectedFeatures(domainId);
}

/**
 * Check if a candidate feature is compatible with the classified domain.
 * Returns false if the feature would be nonsensical for this domain.
 */
function isFeatureCompatibleWithDomain(featureName, domainId) {
  // If domain unknown, allow all features (don't restrict based on uncertainty)
  if (!domainId || domainId === 'unknown') return true;

  const domain = DOMAIN_CATALOG[domainId];
  if (!domain) return true;

  // Check if feature is in the domain's expected features
  const domainFeatures = domain.expectedFeatures.map(f => f.toLowerCase());
  if (domainFeatures.includes(featureName.toLowerCase())) return true;

  // Check cross-domain compatibility map
  const compatibleCrossDomain = {
    // Auth/search/notifications are universal
    'user_authentication': true,
    'user_registration': true,
    'search': true,
    'notifications': true,
    'responsive_design': true,
    'accessibility': true,
    'data_export': true,
    'email_integration': true,
  };

  if (compatibleCrossDomain[featureName]) return true;

  // Check: is this feature clearly from a DIFFERENT domain?
  for (const [otherDomainId, otherDomain] of Object.entries(DOMAIN_CATALOG)) {
    if (otherDomainId === domainId || otherDomainId === 'generic') continue;
    const otherFeatures = otherDomain.expectedFeatures.map(f => f.toLowerCase());
    if (otherFeatures.includes(featureName.toLowerCase())) {
      // This feature belongs to a different domain — flag as incompatible
      return false;
    }
  }

  // If not clearly from another domain, allow it (might be a custom feature)
  return true;
}

export { classifyDomain };
export { verifyDomainClassification };
export { getDomainFeaturesForClassification };
export { isFeatureCompatibleWithDomain };
export { collectAllText };
export { extractStaticDomainEvidence };
export { extractStructuralDomainEvidence };
export { extractInteractiveDomainEvidence };
export { extractStructuralSignals };
export { SOURCE_WEIGHTS };
export { DOMAIN_CONFIDENCE_THRESHOLD };
export { HIGH_CONFIDENCE_THRESHOLD };
export { MEDIUM_CONFIDENCE_THRESHOLD };
