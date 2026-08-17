/**
 * Phase 8 — Duplicate Suppression Engine
 * Phase 9.1 — Intelligent Root-Cause Correlation
 *
 * Correlates findings into root-cause groups. One root cause → one canonical
 * finding, with all supporting observations attached.
 *
 * Phase 9.1 Correlation Strategy (multi-dimensional):
 *   1. Text similarity (Jaccard on tokens)
 *   2. Semantic feature mapping (same feature affected)
 *   3. Proximity (same step/URL)
 *   4. Workflow context (same workflow/step)
 *   5. Root-cause grouping (same underlying issue)
 *   6. Category matching (same bug type)
 *   7. Temporal proximity (close in time)
 *
 * Correlation classifications:
 *   DUPLICATE        — same bug, different observations
 *   RELATED          — same feature/area, different bugs
 *   SAME_ROOT_CAUSE  — different symptoms, underlying cause is shared
 *   INDEPENDENT      — genuinely separate issues
 *
 * The goal is NOT to hide evidence. The goal is ONE ROOT CAUSE + MULTIPLE
 * SUPPORTING OBSERVATIONS. All original observations, evidence, timestamps,
 * and artifacts are preserved.
 */

// ─── Configuration ──────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.38;  // Base text similarity threshold
const FEATURE_MATCH_BONUS = 0.25;   // Bonus when both findings reference same feature
const PROXIMITY_BONUS = 0.15;       // Bonus when findings come from same URL/step
const WORKFLOW_MATCH_BONUS = 0.20;  // Bonus when both findings relate to same workflow
const ROOT_CAUSE_BONUS = 0.15;      // Bonus when same feature + similar text pattern
const CATEGORY_MATCH_BONUS = 0.12;  // Phase 9.1: Bonus when same category
const TEMPORAL_PROXIMITY_BONUS = 0.08; // Phase 9.1: Bonus when findings are close in time
const CORRELATION_THRESHOLD = 0.50;  // Phase 9.1: Overall threshold for correlation

// ─── Duplicate Suppression ──────────────────────────────────────────

/**
 * Correlate findings into groups. Each group has a canonical finding and
 * supporting observations.
 *
 * @param {object[]} findings - Raw findings from agent session
 * @returns {object} { canonical: [...], groups: [...], duplicateCount, originalCount }
 */
function correlateFindings(findings) {
  if (!findings || findings.length === 0) {
    return { canonical: [], groups: [], duplicateCount: 0, originalCount: 0 };
  }

  const originalCount = findings.length;
  const groups = [];
  const assigned = new Set();

  // Sort by severity (critical first) so canonical finding has highest severity
  const sorted = [...findings].sort((a, b) => {
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const aOrder = sevOrder[a.severity] ?? 5;
    const bOrder = sevOrder[b.severity] ?? 5;
    return aOrder - bOrder;
  });

  for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(i)) continue;

    // Start a new group
    const group = {
      canonicalIndex: i,
      canonical: sorted[i],
      supporting: [],
      duplicateIndices: [],
      correlationTypes: [],
    };

    for (let j = i + 1; j < sorted.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = computeFindingSimilarity(sorted[i], sorted[j]);
      if (similarity >= SIMILARITY_THRESHOLD) {
        group.supporting.push(sorted[j]);
        group.duplicateIndices.push(j);
        group.correlationTypes.push(classifyCorrelation(sorted[i], sorted[j]));
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  // Build canonical findings with merged evidence
  const canonical = groups.map(group => {
    const base = { ...group.canonical };

    // Merge evidence references
    const allEvidence = new Set(base.evidenceRefs || []);
    const allArtifacts = new Set(base.artifacts || []);
    const allSteps = new Set(base.steps || []);

    for (const dup of group.supporting) {
      if (dup.evidenceRefs) dup.evidenceRefs.forEach(e => allEvidence.add(e));
      if (dup.artifacts) dup.artifacts.forEach(a => allArtifacts.add(a));
      if (dup.steps) dup.steps.forEach(s => allSteps.add(s));
    }

    if (allEvidence.size > 0) base.evidenceRefs = Array.from(allEvidence);
    if (allArtifacts.size > 0) base.artifacts = Array.from(allArtifacts);
    if (allSteps.size > 0) base.steps = Array.from(allSteps);

    // Record duplicate information with correlation classification
    base.duplicateCount = group.supporting.length;
    base.duplicateTitles = group.supporting.map(d => d.title || d.description || '');
    base.correlations = group.supporting.map((dup, i) => ({
      findingTitle: dup.title || dup.description || '',
      type: group.correlationTypes[i] || 'duplicate',
      evidence: dup.evidenceRefs || [],
    }));
    base.isCanonical = true;

    return base;
  });

  const duplicateCount = originalCount - canonical.length;

  return { canonical, groups, duplicateCount, originalCount };
}

// ─── Finding Similarity ─────────────────────────────────────────────

/**
 * Compute similarity between two findings using multiple signals.
 *
 * @param {object} a - Finding A
 * @param {object} b - Finding B
 * @returns {number} 0-1 similarity score
 */
function computeFindingSimilarity(a, b) {
  // Text similarity (Jaccard on title + description tokens)
  const tokensA = tokenize(`${a.title || ''} ${a.description || ''}`);
  const tokensB = tokenize(`${b.title || ''} ${b.description || ''}`);
  const textSim = jaccardSimilarity(tokensA, tokensB);

  let score = textSim;
  const reasons = [];

  // Feature match bonus: if both reference the same feature
  const featA = extractFeatureFromFinding(a);
  const featB = extractFeatureFromFinding(b);
  if (featA && featB && featA === featB) {
    score += FEATURE_MATCH_BONUS;
    reasons.push('same_feature');
  }

  // Proximity bonus: same URL or step
  if (a.url && b.url && a.url === b.url) {
    score += PROXIMITY_BONUS;
    reasons.push('same_url');
  }
  if (a.stepId && b.stepId && a.stepId === b.stepId) {
    score += PROXIMITY_BONUS;
    reasons.push('same_step');
  }

  // Severity match: same severity boosts confidence it's the same issue
  if (a.severity && b.severity && a.severity === b.severity) {
    score += 0.1;
    reasons.push('same_severity');
  }

  // Phase 9: Workflow match — same workflow + same feature = likely same root cause
  if (a.workflowId && b.workflowId && a.workflowId === b.workflowId) {
    score += WORKFLOW_MATCH_BONUS;
    reasons.push('same_workflow');
  }

  // Phase 9.1: Cross-type workflow-to-feature correlation
  // Workflow failure finding (has workflowId/stepId) vs regular finding (has feature)
  // If the workflow failure is for a workflow that maps to the same feature as the regular finding
  if ((a.workflowId && !b.workflowId) || (!a.workflowId && b.workflowId)) {
    const wfFinding = a.workflowId ? a : b;
    const regFinding = a.workflowId ? b : a;
    // Check if the regular finding's feature is related to the workflow
    const wfFeature = extractWorkflowFeature(wfFinding.workflowId);
    const regFeature = extractFeatureFromFinding(regFinding);
    if (wfFeature && regFeature && wfFeature === regFeature) {
      score += WORKFLOW_MATCH_BONUS * 0.75; // Slightly less than direct workflow match
      reasons.push('workflow_feature_correlation');
    }
  }

  // Phase 9.1: Category match — same category + same feature = likely same issue
  const catA = (a.category || a.type || '').toLowerCase();
  const catB = (b.category || b.type || '').toLowerCase();
  if (catA && catB && catA === catB && catA !== 'workflow_failure') {
    score += CATEGORY_MATCH_BONUS;
    reasons.push('same_category');
  }

  // Phase 9.1: Workflow failure vs functional finding cross-correlation
  // "lead_to_deal: qualify_lead failed" should correlate with "Pipeline is empty"
  if (catA === 'workflow_failure' || catB === 'workflow_failure') {
    const wfFinding = catA === 'workflow_failure' ? a : b;
    const otherFinding = catA === 'workflow_failure' ? b : a;
    const wfFeature = extractWorkflowFeature(wfFinding.workflowId || wfFinding.title || '');
    const otherFeature = extractFeatureFromFinding(otherFinding);
    if (wfFeature && otherFeature && wfFeature === otherFeature) {
      score += ROOT_CAUSE_BONUS;
      reasons.push('root_cause_grouping');
    }
  }

  // Phase 9: Root cause grouping — same feature + similar title
  if (featA && featB && featA === featB) {
    const titleTokensA = tokenize(a.title || '');
    const titleTokensB = tokenize(b.title || '');
    if (titleTokensA.size > 0 && titleTokensB.size > 0) {
      const titleSim = jaccardSimilarity(titleTokensA, titleTokensB);
      if (titleSim >= 0.20) {
        score += ROOT_CAUSE_BONUS;
        reasons.push('title_similarity');
      }
    }
  }

  // Phase 9.1: Temporal proximity — findings close in time about same feature
  if (featA && featB && featA === featB) {
    const timeA = a.detectedAt || a.timestamp || 0;
    const timeB = b.detectedAt || b.timestamp || 0;
    if (timeA && timeB) {
      const diffMs = Math.abs(timeA - timeB);
      const diffMin = diffMs / 60000;
      if (diffMin < 10) {
        score += TEMPORAL_PROXIMITY_BONUS;
        reasons.push('temporal_proximity');
      }
    }
  }

  return Math.min(score, 1.0);
}

/**
 * Map a workflow ID to the primary feature it tests.
 * Used for cross-type correlation between workflow failures and regular findings.
 */
function extractWorkflowFeature(workflowIdOrTitle) {
  const text = (workflowIdOrTitle || '').toLowerCase();
  const mapping = {
    'lead_to_deal': 'lead_management',
    'contact_lifecycle': 'contact_management',
    'browse_to_checkout': 'checkout',
    'product_search': 'search',
    'task_lifecycle': 'task_management',
    'sprint_planning': 'task_management',
    'view_metrics': 'data_visualization',
    'drill_down': 'data_visualization',
    'invite_user': 'user_management',
    'configure_settings': 'settings_management',
    'signup_flow': 'user_registration',
    'navigate_sections': 'navigation',
    'user_login': 'user_authentication',
  };
  for (const [wf, feature] of Object.entries(mapping)) {
    if (text.includes(wf)) return feature;
  }
  // Try extracting from workflow failure title like "lead to deal: qualify lead failed"
  const featurePatterns = [
    [/lead|deal|pipeline/i, 'lead_management'],
    [/contact/i, 'contact_management'],
    [/checkout|payment|cart/i, 'checkout'],
    [/product|browse|shop/i, 'product_browsing'],
    [/task|todo|sprint/i, 'task_management'],
    [/board|kanban/i, 'board_view'],
    [/dashboard|chart|metric|analytic/i, 'data_visualization'],
    [/setting|config/i, 'settings_management'],
    [/auth|login|sign\s?in/i, 'user_authentication'],
    [/signup|regist/i, 'user_registration'],
    [/search/i, 'search'],
    [/pricing|plan/i, 'pricing_display'],
    [/testimonial/i, 'testimonials'],
    [/cta|get started/i, 'call_to_action'],
    [/nav/i, 'navigation'],
    [/invite|user/i, 'user_management'],
  ];
  for (const [pattern, name] of featurePatterns) {
    if (pattern.test(text)) return name;
  }
  return null;
}

/**
 * Classify the relationship between two findings.
 * Phase 9.1: Returns the correlation type for auditability.
 */
function classifyCorrelation(a, b) {
  const score = computeFindingSimilarity(a, b);
  if (score < SIMILARITY_THRESHOLD) return 'independent';

  const featA = extractFeatureFromFinding(a);
  const featB = extractFeatureFromFinding(b);
  const sameFeature = featA && featB && featA === featB;

  const catA = (a.category || a.type || '').toLowerCase();
  const catB = (b.category || b.type || '').toLowerCase();
  const hasWorkflow = catA === 'workflow_failure' || catB === 'workflow_failure';

  // High text similarity → duplicate
  const tokensA = tokenize(`${a.title || ''} ${a.description || ''}`);
  const tokensB = tokenize(`${b.title || ''} ${b.description || ''}`);
  const textSim = jaccardSimilarity(tokensA, tokensB);

  if (textSim >= 0.50) return 'duplicate';
  if (sameFeature && hasWorkflow) return 'same_root_cause';
  if (sameFeature && score >= CORRELATION_THRESHOLD) return 'same_root_cause';
  if (sameFeature) return 'related';
  if (score >= CORRELATION_THRESHOLD + 0.1) return 'duplicate';

  return 'related';
}

// ─── Tokenization & Similarity ──────────────────────────────────────

function tokenize(text) {
  if (!text || typeof text !== 'string') return new Set();
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'and', 'or', 'but', 'not', 'no', 'do', 'does', 'did', 'will', 'would',
    'should', 'could', 'may', 'might', 'must', 'shall', 'can', 'need',
    'on', 'in', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
    'this', 'that', 'these', 'those', 'it', 'its', 'their', 'there',
    'has', 'have', 'had', 'been', 'when', 'where', 'which', 'what',
    'who', 'whom', 'whose', 'how', 'why', 'if', 'then', 'else',
    'but', 'also', 'only', 'just', 'more', 'most', 'some', 'any',
    'all', 'each', 'every', 'both', 'few', 'many', 'much', 'such',
    'so', 'too', 'very', 's', 't', 'd', 'll', 'm', 'o', 're', 've',
    'page', 'app', 'application', 'button', 'element', 'field', 'form',
    'missing', 'broken', 'found', 'shown', 'displayed', 'renders',
  ]);
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Feature Extraction from Findings ───────────────────────────────

function extractFeatureFromFinding(finding) {
  const text = `${finding.title || ''} ${finding.description || ''}`.toLowerCase();

  const featureMap = {
    'login': 'user_authentication',
    'sign in': 'user_authentication',
    'signin': 'user_authentication',
    'auth': 'user_authentication',
    'checkout': 'checkout',
    'payment': 'payment_processing',
    'card': 'payment_processing',
    'cart': 'cart',
    'contact': 'contact_management',
    'lead': 'lead_management',
    'pipeline': 'pipeline',
    'task': 'task_management',
    'board': 'board_view',
    'settings': 'settings_management',
    'api key': 'api_key_management',
    'search': 'search',
    'dashboard': 'dashboard_overview',
    'chart': 'data_visualization',
    'revenue': 'revenue_tracking',
    'metric': 'metrics_display',
    'pricing': 'pricing_display',
    'testimonial': 'testimonials',
    'cta': 'call_to_action',
    'get started': 'call_to_action',
    'nav': 'navigation',
    'menu': 'navigation',
    'mobile': 'responsive_design',
    'responsive': 'responsive_design',
    'overflow': 'responsive_design',
    'email': 'email_integration',
    'export': 'data_export',
    'notification': 'notifications',
    'upload': 'file_upload',
  };

  for (const [keyword, feature] of Object.entries(featureMap)) {
    if (text.includes(keyword)) return feature;
  }

  return null;
}

// ─── Duplicate Report ───────────────────────────────────────────────

/**
 * Generate a summary of duplicate suppression results.
 */
function summarizeSuppression(result) {
  const { canonical, groups, duplicateCount, originalCount } = result;
  const groupsWithDups = groups.filter(g => g.supporting.length > 0);

  return {
    originalCount,
    canonicalCount: canonical.length,
    duplicateCount,
    duplicateRate: originalCount > 0 ? Math.round(duplicateCount / originalCount * 100) : 0,
    groupCount: groups.length,
    groupsWithDuplicates: groupsWithDups.length,
    maxGroupSize: Math.max(...groups.map(g => g.supporting.length + 1), 1),
    examples: groupsWithDups.slice(0, 5).map(g => ({
      canonical: g.canonical.title || g.canonical.description || '',
      duplicateCount: g.supporting.length,
      duplicateTitles: g.supporting.map(d => d.title || d.description || '').slice(0, 3),
    })),
  };
}

export { correlateFindings };
export { computeFindingSimilarity };
export { summarizeSuppression };
export { extractFeatureFromFinding };
export { tokenize };
export { jaccardSimilarity };
export { classifyCorrelation };
export { extractWorkflowFeature };
export { SIMILARITY_THRESHOLD };
