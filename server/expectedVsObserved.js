/**
 * Phase 8 — Expected vs Observed Comparison Engine
 *
 * Compares what the application SHOULD have (expected features, from intent/domain)
 * against what the application ACTUALLY has (observed features, from exploration).
 * Each feature resolves to a status that distinguishes implementation state.
 *
 * Feature statuses:
 *   IMPLEMENTED              — exists and functional
 *   IMPLEMENTED_BUT_BROKEN   — exists but not working
 *   PARTIALLY_IMPLEMENTED    — exists but incomplete
 *   MISSING                  — not found (but was tested)
 *   NOT_TESTED               — not found, but wasn't sufficiently explored
 *   NOT_APPLICABLE           — not relevant for this app
 *   UNKNOWN                  — insufficient data
 *
 * Design:
 *   - NEVER call something "missing" if it was never tested.
 *   - PRESENT does NOT mean FUNCTIONAL.
 *   - Evidence drives every conclusion.
 */

import { PROVENANCE, PROVENANCE_WEIGHTS, getDomainExpectedFeatures, getDomainRiskAreas } from './intentModel.js';
import { isFeatureCompatibleWithDomain } from './domainUnderstanding.js';

// ─── Feature Status Enum ────────────────────────────────────────────

const FEATURE_STATUS = Object.freeze({
  IMPLEMENTED: 'implemented',
  IMPLEMENTED_BUT_BROKEN: 'implemented_but_broken',
  PARTIALLY_IMPLEMENTED: 'partially_implemented',
  MISSING: 'missing',
  NOT_TESTED: 'not_tested',
  NOT_APPLICABLE: 'not_applicable',
  UNKNOWN: 'unknown',
});

// ─── Build Expected Features ────────────────────────────────────────

/**
 * Combine all expected features from intent + domain into a deduplicated list
 * with provenance and priority ordering.
 *
 * @param {object} intent - Mission intent (from intentModel.createMissionIntent)
 * @param {string} classifiedDomain - Domain from domainUnderstanding.classifyDomain
 * @returns {object[]} Sorted expected features
 */
function buildExpectedFeatures(intent, classifiedDomain) {
  const features = [];
  const seen = new Set();

  // Priority 1: Explicit intent features
  if (intent && intent.expectedFeatures) {
    for (const f of intent.expectedFeatures) {
      if (!seen.has(f.name.toLowerCase())) {
        seen.add(f.name.toLowerCase());
        features.push({ ...f, status: null, observations: [] });
      }
    }
  }

  // Priority 2: Domain standard features
  if (classifiedDomain && classifiedDomain !== 'unknown') {
    const domainFeatures = getDomainExpectedFeatures(classifiedDomain);
    for (const f of domainFeatures) {
      if (!seen.has(f.name.toLowerCase())) {
        seen.add(f.name.toLowerCase());
        features.push({ ...f, status: null, observations: [] });
      }
    }
  }

  // Sort by provenance weight (explicit first)
  features.sort((a, b) => {
    const wa = PROVENANCE_WEIGHTS[a.source] || 0;
    const wb = PROVENANCE_WEIGHTS[b.source] || 0;
    return wb - wa;
  });

  return features;
}

// ─── Build Observed Features ────────────────────────────────────────

/**
 * Extract observed features from session data (inventory, capturedSteps, findings).
 * Distinguishes PRESENT from FUNCTIONAL.
 *
 * @param {object} session - Agent session with capturedSteps, findings, inventory
 * @param {object} inventory - App inventory from featureGap
 * @returns {object[]} Observed features
 */
function buildObservedFeatures(session = {}, inventory = {}) {
  const observed = {};
  const text = collectText(session, inventory);

  // ── Comprehensive keyword → feature signature map ──────────────
  // Each entry: [feature, [keywords], evidenceType]
  // More keywords = more robust detection from any session data source.
  const SIGNATURES = [
    // Auth
    ['user_authentication', ['login', 'sign in', 'signin', 'log in', 'password', 'authenticate', 'auth form', 'credentials'], 'auth'],
    ['user_registration', ['sign up', 'signup', 'register', 'registration', 'create account', 'sign-up'], 'registration'],
    // CRM
    ['contact_management', ['contact', 'add contact', 'contact list', 'contact form', 'customer'], 'crm'],
    ['lead_management', ['lead', 'leads', 'lead status', 'add lead'], 'crm'],
    ['pipeline', ['pipeline', 'deal stage', 'sales stage', 'kanban'], 'crm'],
    ['deal_tracking', ['deal', 'close deal', 'won', 'lost', 'opportunity'], 'crm'],
    ['activity_logging', ['activity', 'activity log', 'timeline', 'activity feed'], 'crm'],
    // E-commerce
    ['product_browsing', ['product', 'shop', 'store', 'catalog', 'browse'], 'ecommerce'],
    ['cart', ['cart', 'add to cart', 'shopping cart', 'basket'], 'ecommerce'],
    ['checkout', ['checkout', 'place order', 'complete order'], 'ecommerce'],
    ['order_management', ['order', 'order history', 'track order', 'my orders'], 'ecommerce'],
    ['payment_processing', ['payment', 'pay', 'credit card', 'stripe', 'paypal'], 'ecommerce'],
    ['product_reviews', ['review', 'rating', 'stars', 'testimonial product'], 'ecommerce'],
    ['wishlist', ['wishlist', 'wish list', 'save for later', 'favorite'], 'ecommerce'],
    // Project management
    ['task_management', ['task', 'todo', 'to-do', 'add task', 'create task'], 'pm'],
    ['board_view', ['board', 'kanban', 'column', 'swimlane'], 'pm'],
    ['task_creation', ['create task', 'new task', 'add task', 'task form'], 'pm'],
    ['task_assignment', ['assign', 'assignment', 'assigned to', 'team member'], 'pm'],
    ['progress_tracking', ['progress', 'status', 'in progress', 'done', 'complete'], 'pm'],
    // Analytics
    ['dashboard_overview', ['dashboard', 'overview', 'summary', 'home'], 'analytics'],
    ['data_visualization', ['chart', 'graph', 'plot', 'visualization', 'pie', 'bar chart', 'line chart'], 'analytics'],
    ['data_tables', ['table', 'grid', 'row', 'column', 'data list'], 'analytics'],
    ['filtering', ['filter', 'date range', 'sort', 'search filter'], 'analytics'],
    ['data_export', ['export', 'download', 'csv', 'excel', 'pdf export'], 'analytics'],
    ['metrics_display', ['metric', 'kpi', 'stat', 'revenue', 'growth', 'mrr', 'arr'], 'analytics'],
    // SaaS / Admin
    ['settings_management', ['settings', 'config', 'configuration', 'preferences'], 'saas'],
    ['api_key_management', ['api key', 'api_keys', 'webhook', 'integration'], 'saas'],
    ['user_management', ['user management', 'manage users', 'team', 'invite user', 'member'], 'saas'],
    ['notifications', ['notification', 'alert', 'email notification', 'push'], 'saas'],
    // Marketing
    ['hero_section', ['hero', 'banner', 'headline', 'jumbotron'], 'marketing'],
    ['feature_highlight', ['feature', 'features section', 'what we do', 'capabilities'], 'marketing'],
    ['pricing_display', ['pricing', 'price', 'plan', 'tier', 'subscription plan'], 'marketing'],
    ['testimonials', ['testimonial', 'quote', 'customer review', 'social proof'], 'marketing'],
    ['call_to_action', ['cta', 'get started', 'sign up now', 'try free', 'start free trial'], 'marketing'],
    ['navigation', ['nav', 'menu', 'navigation', 'navbar', 'link'], 'marketing'],
    // Generic
    ['search', ['search', 'search bar', 'find', 'query'], 'generic'],
    ['responsive_design', ['mobile', 'responsive', 'viewport', 'breakpoint'], 'generic'],
    ['email_integration', ['email', 'smtp', 'mail'], 'generic'],
  ];

  // ── From inventory capabilities ──────────────────────────────────
  if (inventory.capabilities) {
    for (const cap of inventory.capabilities) {
      const feature = normalizeFeatureName(cap);
      if (!observed[feature]) {
        observed[feature] = {
          name: feature,
          exists: true,
          functional: true,
          tested: true,
          confidence: 0.8,
          evidenceRefs: [`inventory:${cap}`],
        };
      }
    }
  }

  // ── From inventory form fields ───────────────────────────────────
  if (inventory.formFields) {
    for (const field of inventory.formFields) {
      const label = (field.label || field.name || '').toLowerCase();
      if (label.includes('login') || label.includes('password')) {
        addObserved(observed, 'user_authentication', { evidence: `form_field:${label}`, functional: true, tested: true });
      }
    }
  }

  // ── From inventory routes ────────────────────────────────────────
  if (inventory.pages) {
    for (const page of inventory.pages) {
      const path = (page.path || '').toLowerCase();
      const title = (page.title || '').toLowerCase();
      const combined = path + ' ' + title;

      // Use the signature map for consistent route matching
      for (const [feature, keywords] of SIGNATURES) {
        if (keywords.some(kw => combined.includes(kw))) {
          addObserved(observed, feature, { evidence: `route:${path}`, functional: true, tested: true });
        }
      }
    }
  }

  // ── From captured steps (agent's actual actions) ────────────────
  if (session.capturedSteps) {
    for (const step of session.capturedSteps) {
      const stepText = `${step.title || ''} ${step.description || ''} ${step.url || ''}`.toLowerCase();

      for (const [feature, keywords] of SIGNATURES) {
        if (keywords.some(kw => stepText.includes(kw))) {
          addObserved(observed, feature, { evidence: `step:${step.id || step.url}`, functional: true, tested: true });
        }
      }
    }
  }

  // ── From session turns (agent's LLM observations) ───────────────
  // Turns contain rich text about what the agent saw and did.
  if (session.turns) {
    for (const turn of session.turns) {
      const turnText = `${turn.thought || ''} ${turn.observation || ''} ${turn.summary || ''}`.toLowerCase();

      for (const [feature, keywords] of SIGNATURES) {
        if (keywords.some(kw => turnText.includes(kw))) {
          addObserved(observed, feature, { evidence: `turn:${turn.id || 'unknown'}`, functional: true, tested: true });
        }
      }
    }
  }

  // ── From session activities (capability pipeline events) ────────
  if (session.activities) {
    for (const act of session.activities) {
      const actText = `${act.label || ''} ${act.detail || ''} ${act.description || ''}`.toLowerCase();

      for (const [feature, keywords] of SIGNATURES) {
        if (keywords.some(kw => actText.includes(kw))) {
          addObserved(observed, feature, { evidence: `activity:${act.id || act.label}`, functional: true, tested: true });
        }
      }
    }
  }

  // ── From full text (catches anything not in structured fields) ──
  for (const [feature, keywords] of SIGNATURES) {
    if (keywords.some(kw => text.includes(kw))) {
      addObserved(observed, feature, { evidence: `text_match`, functional: true, tested: false, confidence: 0.4 });
    }
  }

  // ── Override functional=false for features with related findings ─
  if (session.findings) {
    for (const finding of session.findings) {
      const fText = `${finding.title || ''} ${finding.description || ''} ${finding.impact || ''}`.toLowerCase();

      // Use signature map to map findings to features they affect
      for (const [feature, keywords] of SIGNATURES) {
        if (keywords.some(kw => fText.includes(kw))) {
          markFeatureBroken(observed, feature, `finding:${finding.id || finding.title}`);
        }
      }
    }
  }

  return Object.values(observed);
}

function addObserved(observed, name, { evidence, functional = true, tested = true, confidence = 0.7 }) {
  if (!observed[name]) {
    observed[name] = {
      name,
      exists: true,
      functional,
      tested,
      confidence,
      evidenceRefs: [],
    };
  }
  if (!observed[name].evidenceRefs.includes(evidence)) {
    observed[name].evidenceRefs.push(evidence);
  }
  observed[name].confidence = Math.min(observed[name].confidence + 0.05, 1.0);
}

function markFeatureBroken(observed, name, evidence) {
  if (observed[name]) {
    observed[name].functional = false;
    if (!observed[name].evidenceRefs.includes(evidence)) {
      observed[name].evidenceRefs.push(evidence);
    }
  } else {
    // Feature doesn't exist in observed but finding references it — create as broken
    observed[name] = {
      name,
      exists: true,
      functional: false,
      tested: true,
      confidence: 0.8,
      evidenceRefs: [evidence],
    };
  }
}

// ─── Compare Expected vs Observed ───────────────────────────────────

/**
 * Compare expected features against observed features.
 * Each expected feature resolves to one of FEATURE_STATUS values.
 *
 * @param {object[]} expectedFeatures - From buildExpectedFeatures
 * @param {object[]} observedFeatures - From buildObservedFeatures
 * @param {object} options - { classifiedDomain, sessionSteps, exploreDepth }
 * @returns {object} { features: [...], summary: { implemented, broken, missing, notTested, ... } }
 */
function compareExpectedVsObserved(expectedFeatures, observedFeatures, options = {}) {
  const { classifiedDomain, sessionSteps = 0, exploreDepth = 'moderate' } = options;

  const observedMap = new Map();
  for (const f of observedFeatures) {
    observedMap.set(f.name.toLowerCase(), f);
  }

  const results = [];
  const summary = {
    [FEATURE_STATUS.IMPLEMENTED]: 0,
    [FEATURE_STATUS.IMPLEMENTED_BUT_BROKEN]: 0,
    [FEATURE_STATUS.PARTIALLY_IMPLEMENTED]: 0,
    [FEATURE_STATUS.MISSING]: 0,
    [FEATURE_STATUS.NOT_TESTED]: 0,
    [FEATURE_STATUS.NOT_APPLICABLE]: 0,
    [FEATURE_STATUS.UNKNOWN]: 0,
  };

  for (const expected of expectedFeatures) {
    const observed = observedMap.get(expected.name.toLowerCase());

    // Check domain compatibility
    const compatible = isFeatureCompatibleWithDomain(expected.name, classifiedDomain);

    let status;
    let evidenceRefs = expected.evidenceRefs || [];

    if (!compatible && expected.source === PROVENANCE.DOMAIN_STANDARD) {
      // This domain-standard feature doesn't apply — skip it
      status = FEATURE_STATUS.NOT_APPLICABLE;
    } else if (!observed) {
      // Feature not observed
      // Check: was the app sufficiently explored to declare it "missing"?
      const wasTested = wasFeatureSufficientlyTested(expected.name, sessionSteps, exploreDepth);

      if (wasTested) {
        status = FEATURE_STATUS.MISSING;
        evidenceRefs.push('negative:feature_not_found_in_observation');
      } else {
        status = FEATURE_STATUS.NOT_TESTED;
        evidenceRefs.push('negative:insufficient_exploration');
      }
    } else if (observed.exists && observed.functional) {
      status = FEATURE_STATUS.IMPLEMENTED;
      evidenceRefs.push(...observed.evidenceRefs);
    } else if (observed.exists && !observed.functional) {
      status = FEATURE_STATUS.IMPLEMENTED_BUT_BROKEN;
      evidenceRefs.push(...observed.evidenceRefs);
    } else {
      status = FEATURE_STATUS.UNKNOWN;
    }

    summary[status]++;

    results.push({
      ...expected,
      status,
      observed: observed || null,
      evidenceRefs: [...new Set(evidenceRefs)],
    });
  }

  return { features: results, summary };
}

// ─── Feature Testing Sufficiency Check ──────────────────────────────

/**
 * Determine whether the agent explored enough to declare a feature "missing"
 * vs "not tested".
 *
 * Heuristic:
 *   - If <30 steps taken → NOT_TESTED for anything not found
 *   - If 30-80 steps → feature-specific: auth/checkout/cart need targeted interaction
 *   - If >80 steps → assume reasonable coverage, MISSING is OK
 */
function wasFeatureSufficientlyTested(featureName, sessionSteps, exploreDepth) {
  // Low exploration → can't declare missing
  if (sessionSteps < 20) return false;

  // High exploration → can declare missing
  if (sessionSteps >= 80) return true;

  // Moderate exploration: check if the feature requires targeted testing
  const requiresDeepTesting = [
    'user_authentication', 'user_registration', 'checkout', 'payment_processing',
    'order_history', 'wishlist', 'product_reviews', 'shipping',
  ];

  if (requiresDeepTesting.includes(featureName.toLowerCase())) {
    // These features need deep interaction; if steps < 80, mark not_tested
    return false;
  }

  // Standard features can be declared missing at moderate depth
  return true;
}

// ─── Workflow Model ─────────────────────────────────────────────────

/**
 * Build workflow model from expected workflows + observed interactions.
 * Each workflow step tracks: expected, observed, tested, outcome, evidence.
 */
function buildWorkflowModel(expectedWorkflows = [], session = {}, domainId = null) {
  const workflows = [];

  // Add expected workflows
  for (const wf of expectedWorkflows) {
    const steps = resolveWorkflowSteps(wf.name, domainId);
    workflows.push({
      name: wf.name,
      source: wf.source,
      confidence: wf.confidence,
      steps: steps.map(step => ({
        name: step,
        expected: true,
        observed: wasStepObserved(step, session),
        tested: wasStepTested(step, session),
        outcome: resolveStepOutcome(step, session),
        evidence: collectStepEvidence(step, session),
      })),
    });
  }

  return workflows;
}

function resolveWorkflowSteps(workflowName, domainId) {
  const knownWorkflows = {
    'browse_to_checkout': ['browse_products', 'add_to_cart', 'view_cart', 'checkout', 'payment', 'order_confirmation'],
    'product_search': ['enter_search_query', 'view_search_results'],
    'lead_to_deal': ['create_lead', 'qualify_lead', 'advance_pipeline', 'close_deal'],
    'contact_lifecycle': ['create_contact', 'view_contact', 'edit_contact', 'delete_contact'],
    'task_lifecycle': ['create_task', 'assign_task', 'advance_task_status', 'complete_task'],
    'sprint_planning': ['create_sprint', 'assign_tasks', 'track_progress', 'complete_sprint'],
    'view_metrics': ['navigate_to_dashboard', 'view_charts', 'view_stats', 'filter_data'],
    'drill_down': ['view_summary', 'click_detail', 'view_detail_data'],
    'invite_user': ['navigate_to_users', 'click_invite', 'fill_email', 'send_invite'],
    'configure_settings': ['navigate_to_settings', 'modify_fields', 'save_settings', 'verify_persistence'],
    'signup_flow': ['click_cta', 'fill_registration', 'submit_form', 'access_account'],
    'navigate_sections': ['scroll_page', 'click_nav_link', 'view_section_content'],
    'read_article': ['browse_posts', 'click_article', 'read_content'],
    'browse_posts': ['navigate_to_blog', 'view_post_list'],
    'create_post': ['compose_content', 'add_media', 'publish_post'],
    'browse_feed': ['navigate_to_feed', 'scroll_feed', 'interact_with_post'],
  };

  return knownWorkflows[workflowName] || [`start_${workflowName}`, `complete_${workflowName}`];
}

function wasStepObserved(step, session) {
  const text = collectText(session);
  const stepWords = step.split('_');
  return stepWords.some(w => text.includes(w));
}

function wasStepTested(step, session) {
  // If the agent took steps containing the workflow keyword, consider it tested
  if (!session.capturedSteps) return false;
  const stepWords = step.split('_');
  return session.capturedSteps.some(s => {
    const sText = `${s.title || ''} ${s.description || ''} ${s.url || ''}`.toLowerCase();
    return stepWords.some(w => sText.includes(w));
  });
}

function resolveStepOutcome(step, session) {
  if (!session.findings) return 'unknown';
  const stepWords = step.split('_');
  const hasFinding = session.findings.some(f => {
    const fText = `${f.title || ''} ${f.description || ''}`.toLowerCase();
    return stepWords.some(w => fText.includes(w));
  });
  return hasFinding ? 'issue_found' : 'passed';
}

function collectStepEvidence(step, session) {
  const evidence = [];
  if (session.capturedSteps) {
    const stepWords = step.split('_');
    for (const s of session.capturedSteps) {
      const sText = `${s.title || ''} ${s.description || ''} ${s.url || ''}`.toLowerCase();
      if (stepWords.some(w => sText.includes(w))) {
        evidence.push(`step:${s.id || s.url}`);
      }
    }
  }
  return evidence;
}

// ─── Gap Report ─────────────────────────────────────────────────────

/**
 * Generate a gap report from the comparison results.
 * Categorizes gaps into feature gaps and workflow gaps.
 *
 * Phase 9.1: Now also accepts workflowIntelligence from Phase 9's
 * workflowEngine (proper outcome classification) and adds provenance
 * to every gap. Also derives missing features from findings when the
 * finding title/description explicitly says something is absent.
 *
 * @param {object} comparisonResult - From compareExpectedVsObserved
 * @param {object[]} workflowModel - From buildWorkflowModel or workflowEngine
 * @param {object} [options] - Phase 9.1 options
 * @param {object[]} [options.workflowIntelligence] - Phase 9 workflowEngine results
 * @param {object[]} [options.findings] - Session findings (for finding-derived gaps)
 */
function generateGapReport(comparisonResult, workflowModel = [], options = {}) {
  const { workflowIntelligence = null, findings = [] } = options;
  const gaps = {
    missingFeatures: [],
    brokenFeatures: [],
    partialFeatures: [],
    notTestedFeatures: [],
    brokenWorkflows: [],
    incompleteWorkflows: [],
    blockedWorkflows: [],
  };

  for (const feature of comparisonResult.features) {
    switch (feature.status) {
      case FEATURE_STATUS.MISSING:
        gaps.missingFeatures.push({
          name: feature.name,
          source: feature.source,
          priority: feature.priority,
          confidence: feature.confidence,
          evidenceRefs: feature.evidenceRefs,
          provenance: {
            expectedFrom: feature.source,
            observedState: 'not_found',
            classificationReason: 'Feature not observed despite sufficient exploration',
          },
        });
        break;
      case FEATURE_STATUS.IMPLEMENTED_BUT_BROKEN:
        gaps.brokenFeatures.push({
          name: feature.name,
          source: feature.source,
          evidenceRefs: feature.evidenceRefs,
          provenance: {
            expectedFrom: feature.source,
            observedState: 'present_but_nonfunctional',
            classificationReason: 'Feature exists but related findings indicate it is broken',
          },
        });
        break;
      case FEATURE_STATUS.PARTIALLY_IMPLEMENTED:
        gaps.partialFeatures.push(feature);
        break;
      case FEATURE_STATUS.NOT_TESTED:
        gaps.notTestedFeatures.push({
          name: feature.name,
          source: feature.source,
          reason: 'Insufficient exploration to determine status',
          provenance: {
            expectedFrom: feature.source,
            observedState: 'unknown',
            classificationReason: 'Not enough exploration to classify',
          },
        });
        break;
    }
  }

  // ── Phase 9.1: Derive missing/broken features from findings ─────
  // When findings explicitly state something is missing or broken but
  // EVO didn't classify it (e.g., because the feature wasn't in the
  // expected list), add it to the gap report with provenance.
  const existingGapNames = new Set([
    ...gaps.missingFeatures.map(g => g.name.toLowerCase()),
    ...gaps.brokenFeatures.map(g => g.name.toLowerCase()),
  ]);

  for (const finding of findings) {
    const fText = `${finding.title || ''} ${finding.description || ''}`.toLowerCase();
    // Detect "missing" language in findings
    const missingMatch = /\b(missing|not (present|found|available|implemented)|absent|no |doesn't have|does not have|lacks?)\b/.test(fText);
    // Detect "broken" language in findings
    const brokenMatch = /\b(broken|not work(ing)?|fail(s|ed|ing)?|error|crash|invalid|incorrect|wrong)\b/.test(fText);

    if (missingMatch || brokenMatch) {
      // Try to extract feature name from finding
      const featureName = extractFeatureFromFindingText(fText);
      if (featureName && !existingGapNames.has(featureName)) {
        existingGapNames.add(featureName);
        if (missingMatch) {
          gaps.missingFeatures.push({
            name: featureName,
            source: 'finding_inferred',
            confidence: 0.7,
            evidenceRefs: [`finding:${finding.id || finding.title}`],
            provenance: {
              expectedFrom: 'finding_analysis',
              observedState: 'not_found',
              classificationReason: `Finding indicates absence: "${(finding.title || '').slice(0, 80)}"`,
            },
          });
        } else {
          gaps.brokenFeatures.push({
            name: featureName,
            source: 'finding_inferred',
            evidenceRefs: [`finding:${finding.id || finding.title}`],
            provenance: {
              expectedFrom: 'finding_analysis',
              observedState: 'present_but_broken',
              classificationReason: `Finding indicates broken: "${(finding.title || '').slice(0, 80)}"`,
            },
          });
        }
      }
    }
  }

  // ── Workflow gaps ──────────────────────────────────────────────
  // Phase 9.1: Prefer workflowIntelligence (Phase 9 engine results)
  // over the old keyword-based workflowModel.
  const wfSource = workflowIntelligence?.workflows || workflowModel;

  for (const wf of wfSource) {
    // Phase 9 engine uses validatedSteps with outcome; old model uses steps with outcome
    const steps = wf.validatedSteps || wf.steps || [];
    const wfOutcome = wf.outcome; // Phase 9 engine: 'failed', 'blocked', 'pass', etc.

    const brokenSteps = steps.filter(s =>
      s.outcome === 'issue_found' ||
      s.outcome === 'failed' ||
      s.outcome === 'FAILED'
    );
    const untestedSteps = steps.filter(s =>
      !s.tested ||
      s.outcome === 'not_tested' ||
      s.outcome === 'NOT_TESTED' ||
      s.outcome === 'unknown' ||
      s.outcome === 'UNKNOWN'
    );

    // Phase 9.1: Also handle blocked workflows
    if (wfOutcome === 'blocked' || (brokenSteps.length > 0 && untestedSteps.length > brokenSteps.length)) {
      gaps.blockedWorkflows.push({
        name: wf.name || wf.workflow?.name,
        blockedSteps: brokenSteps.map(s => s.name),
        untestedSteps: untestedSteps.map(s => s.name).filter(n => !brokenSteps.some(b => b.name === n)),
        provenance: {
          classificationReason: `Workflow blocked at: ${wf.firstFailedStep || 'early step'}`,
        },
      });
    }

    if (brokenSteps.length > 0) {
      gaps.brokenWorkflows.push({
        name: wf.name || wf.workflow?.name,
        brokenSteps: brokenSteps.map(s => s.name),
        provenance: {
          classificationReason: `${brokenSteps.length} step(s) produced unexpected results`,
        },
      });
    }
    if (untestedSteps.length > 0) {
      gaps.incompleteWorkflows.push({
        name: wf.name || wf.workflow?.name,
        untestedSteps: untestedSteps.map(s => s.name),
        provenance: {
          classificationReason: `${untestedSteps.length} step(s) not tested`,
        },
      });
    }
  }

  return gaps;
}

/**
 * Extract a canonical feature name from finding text.
 * Used to derive gap entries from findings that mention features
 * not in the expected feature list.
 */
function extractFeatureFromFindingText(text) {
  const featurePatterns = [
    [/auth(?:entication)?|login|sign\s?in/i, 'user_authentication'],
    [/sign\s?up|regist(?:er|ration)/i, 'user_registration'],
    [/contact/i, 'contact_management'],
    [/lead/i, 'lead_management'],
    [/pipeline/i, 'pipeline'],
    [/deal/i, 'deal_tracking'],
    [/checkout|payment/i, 'checkout'],
    [/cart|basket/i, 'cart'],
    [/product|catalog/i, 'product_browsing'],
    [/task|todo/i, 'task_management'],
    [/chart|graph|visualization/i, 'data_visualization'],
    [/dashboard|overview/i, 'dashboard_overview'],
    [/\bboard\b|kanban/i, 'board_view'],
    [/setting|config/i, 'settings_management'],
    [/api\s?key/i, 'api_key_management'],
    [/search/i, 'search'],
    [/pricing|plan|tier/i, 'pricing_display'],
    [/testimonial/i, 'testimonials'],
    [/cta|get started|sign up now/i, 'call_to_action'],
    [/hero|banner/i, 'hero_section'],
    [/filter/i, 'filtering'],
    [/export/i, 'data_export'],
    [/notification|alert/i, 'notifications'],
    [/webhook/i, 'api_key_management'],
    [/user role|role management/i, 'user_management'],
    [/mobile|responsive/i, 'responsive_design'],
    [/nav(?:igation)?|menu/i, 'navigation'],
    [/review|rating/i, 'product_reviews'],
    [/wishlist/i, 'wishlist'],
    [/order history/i, 'order_management'],
    [/email/i, 'email_integration'],
  ];
  for (const [pattern, name] of featurePatterns) {
    if (pattern.test(text)) return name;
  }
  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────

function normalizeFeatureName(name) {
  const map = {
    'login': 'user_authentication',
    'sign in': 'user_authentication',
    'signup': 'user_registration',
    'cart management': 'cart',
    'product catalog': 'product_browsing',
    'contact management': 'contact_management',
    'lead management': 'lead_management',
    'task management': 'task_management',
    'board view': 'board_view',
    'settings': 'settings_management',
    'api keys': 'api_key_management',
    'search functionality': 'search',
    'data export': 'data_export',
    'file upload': 'file_upload',
    'notifications': 'notifications',
    'email integration': 'email_integration',
  };
  const lower = name.toLowerCase().trim();
  return map[lower] || lower.replace(/\s+/g, '_');
}

function collectText(session = {}, inventory = {}) {
  const parts = [];
  if (inventory.pages) {
    for (const p of inventory.pages) {
      parts.push(p.title || '', p.path || '');
    }
  }
  if (session.capturedSteps) {
    for (const s of session.capturedSteps) {
      parts.push(s.title || '', s.description || '', s.url || '');
    }
  }
  if (session.findings) {
    for (const f of session.findings) {
      parts.push(f.title || '', f.description || '');
    }
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export { FEATURE_STATUS };
export { buildExpectedFeatures };
export { buildObservedFeatures };
export { compareExpectedVsObserved };
export { wasFeatureSufficientlyTested };
export { buildWorkflowModel };
export { generateGapReport };
export { addObserved };
export { markFeatureBroken };
export { normalizeFeatureName };
export { extractFeatureFromFindingText };
