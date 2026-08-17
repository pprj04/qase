/**
 * Phase 8 — Mission Intent Model
 *
 * Structured representation of what the user intended to build.
 * Every expected feature/workflow carries provenance: where did this expectation come from?
 *
 * Provenance classes:
 *   EXPLICIT          — user directly stated it in build prompt or requirements
 *   INFERRED          — derived from context (e.g., "CRM with leads" → contact management)
 *   DOMAIN_STANDARD   — expected for this app domain (e.g., e-commerce → cart)
 *   KNOWLEDGE         — from historical knowledge patterns
 *   UNKNOWN           — no basis, placeholder
 *
 * Design principles:
 *   - NEVER fabricate intent. If unavailable, intentAvailability = "unknown".
 *   - Provenance is mandatory for every expectation.
 *   - Explicit > Inferred > Domain Standard > Knowledge in confidence.
 */

// ─── Provenance Types ───────────────────────────────────────────────

const PROVENANCE = Object.freeze({
  EXPLICIT: 'explicit',
  INFERRED: 'inferred',
  DOMAIN_STANDARD: 'domain_standard',
  KNOWLEDGE: 'knowledge',
  UNKNOWN: 'unknown',
});

const PROVENANCE_WEIGHTS = Object.freeze({
  [PROVENANCE.EXPLICIT]: 1.0,
  [PROVENANCE.INFERRED]: 0.7,
  [PROVENANCE.DOMAIN_STANDARD]: 0.5,
  [PROVENANCE.KNOWLEDGE]: 0.4,
  [PROVENANCE.UNKNOWN]: 0.1,
});

// ─── Intent Availability ────────────────────────────────────────────

const INTENT_AVAILABILITY = Object.freeze({
  FULL: 'full',           // build prompt + requirements + objectives
  PARTIAL: 'partial',     // some intent fields present
  URL_ONLY: 'url_only',   // only URL, no intent
  UNKNOWN: 'unknown',     // cannot determine
});

// ─── Domain Catalog ─────────────────────────────────────────────────
// Maps domain keywords to canonical domains. Used for hypothesis generation.

const DOMAIN_CATALOG = Object.freeze({
  crm: {
    id: 'crm',
    name: 'CRM',
    keywords: ['crm', 'customer', 'contact', 'lead', 'pipeline', 'deal', 'sales', 'prospect'],
    expectedFeatures: ['contact_management', 'lead_management', 'pipeline', 'deal_tracking', 'activity_logging'],
    workflows: ['lead_to_deal', 'contact_lifecycle'],
    riskAreas: ['data_persistence', 'role_based_access', 'search'],
  },
  ecommerce: {
    id: 'ecommerce',
    name: 'E-Commerce',
    keywords: ['ecommerce', 'e-commerce', 'shop', 'store', 'cart', 'checkout', 'product', 'order', 'payment'],
    expectedFeatures: ['product_browsing', 'cart', 'checkout', 'order_placement', 'search', 'user_account', 'order_history'],
    workflows: ['browse_to_checkout', 'product_search'],
    riskAreas: ['payment_validation', 'cart_persistence', 'auth', 'data_security'],
  },
  project_management: {
    id: 'project_management',
    name: 'Project Management',
    keywords: ['task', 'kanban', 'board', 'project', 'sprint', 'team', 'todo', 'issue', 'ticket'],
    expectedFeatures: ['task_management', 'board_view', 'task_creation', 'task_assignment', 'progress_tracking'],
    workflows: ['task_lifecycle', 'sprint_planning'],
    riskAreas: ['data_persistence', 'collaboration', 'notifications'],
  },
  analytics: {
    id: 'analytics',
    name: 'Analytics Dashboard',
    keywords: ['analytics', 'dashboard', 'metric', 'chart', 'revenue', 'mrr', 'stat', 'kpi', 'report'],
    expectedFeatures: ['dashboard_overview', 'data_visualization', 'data_tables', 'filtering', 'export'],
    workflows: ['view_metrics', 'drill_down'],
    riskAreas: ['data_accuracy', 'real_data_vs_placeholder', 'export_functionality'],
  },
  marketing: {
    id: 'marketing',
    name: 'Marketing / Landing Page',
    keywords: ['landing', 'marketing', 'hero', 'pricing', 'testimonial', 'feature', 'cta', 'signup'],
    expectedFeatures: ['hero_section', 'feature_highlight', 'pricing_display', 'testimonials', 'navigation'],
    workflows: ['signup_flow', 'navigate_sections'],
    riskAreas: ['cta_functionality', 'responsive_design', 'link_validity'],
  },
  blog: {
    id: 'blog',
    name: 'Blog / Content',
    keywords: ['blog', 'article', 'post', 'content', 'author', 'comment'],
    expectedFeatures: ['post_listing', 'post_detail', 'author_info', 'comments'],
    workflows: ['read_article', 'browse_posts'],
    riskAreas: ['content_rendering', 'comment_moderation'],
  },
  saas_dashboard: {
    id: 'saas_dashboard',
    name: 'SaaS Admin Dashboard',
    keywords: ['saas', 'admin', 'user management', 'settings', 'api key', 'subscription', 'billing'],
    expectedFeatures: ['user_management', 'settings', 'dashboard_overview', 'api_management', 'billing'],
    workflows: ['invite_user', 'configure_settings'],
    riskAreas: ['settings_persistence', 'api_key_security', 'role_permissions'],
  },
  social: {
    id: 'social',
    name: 'Social Platform',
    keywords: ['social', 'feed', 'post', 'follow', 'like', 'comment', 'share', 'profile'],
    expectedFeatures: ['feed', 'post_creation', 'user_profile', 'follow_system', 'interaction'],
    workflows: ['create_post', 'browse_feed'],
    riskAreas: ['content_moderation', 'privacy', 'real_time_updates'],
  },
  education: {
    id: 'education',
    name: 'Education / LMS',
    keywords: ['course', 'lesson', 'quiz', 'student', 'teacher', 'grade', 'assignment', 'learning'],
    expectedFeatures: ['course_listing', 'lesson_viewing', 'assessment', 'progress_tracking'],
    workflows: ['take_course', 'complete_assignment'],
    riskAreas: ['progress_persistence', 'content_access'],
  },
  healthcare: {
    id: 'healthcare',
    name: 'Healthcare',
    keywords: ['patient', 'appointment', 'medical', 'doctor', 'clinic', 'health', 'prescription'],
    expectedFeatures: ['appointment_management', 'patient_records', 'prescription_tracking'],
    workflows: ['schedule_appointment', 'view_records'],
    riskAreas: ['hipaa_compliance', 'data_security', 'access_control'],
  },
  generic: {
    id: 'generic',
    name: 'Generic Web Application',
    keywords: [],
    expectedFeatures: ['navigation', 'responsive_design'],
    workflows: [],
    riskAreas: [],
  },
});

// ─── Context keyword → feature mapping ──────────────────────────────
// Maps build-prompt keywords to expected features with provenance

const CONTEXT_FEATURE_MAP = Object.freeze({
  // Auth-related
  'login': { feature: 'user_authentication', domain: null },
  'sign in': { feature: 'user_authentication', domain: null },
  'signup': { feature: 'user_registration', domain: null },
  'sign up': { feature: 'user_registration', domain: null },
  'register': { feature: 'user_registration', domain: null },
  'auth': { feature: 'user_authentication', domain: null },
  'authentication': { feature: 'user_authentication', domain: null },

  // CRM
  'contact': { feature: 'contact_management', domain: 'crm' },
  'lead': { feature: 'lead_management', domain: 'crm' },
  'pipeline': { feature: 'pipeline', domain: 'crm' },
  'deal': { feature: 'deal_tracking', domain: 'crm' },
  'customer': { feature: 'contact_management', domain: 'crm' },
  'crm': { feature: 'contact_management', domain: 'crm' },

  // E-commerce
  'cart': { feature: 'cart', domain: 'ecommerce' },
  'checkout': { feature: 'checkout', domain: 'ecommerce' },
  'product': { feature: 'product_browsing', domain: 'ecommerce' },
  'order': { feature: 'order_management', domain: 'ecommerce' },
  'shop': { feature: 'product_browsing', domain: 'ecommerce' },
  'store': { feature: 'product_browsing', domain: 'ecommerce' },
  'payment': { feature: 'payment_processing', domain: 'ecommerce' },
  'wishlist': { feature: 'wishlist', domain: 'ecommerce' },
  'review': { feature: 'product_reviews', domain: 'ecommerce' },

  // Project management
  'task': { feature: 'task_management', domain: 'project_management' },
  'kanban': { feature: 'board_view', domain: 'project_management' },
  'board': { feature: 'board_view', domain: 'project_management' },
  'sprint': { feature: 'sprint_tracking', domain: 'project_management' },
  'project': { feature: 'project_management', domain: 'project_management' },
  'todo': { feature: 'task_management', domain: 'project_management' },

  // Analytics
  'dashboard': { feature: 'dashboard_overview', domain: 'analytics' },
  'chart': { feature: 'data_visualization', domain: 'analytics' },
  'analytics': { feature: 'data_analysis', domain: 'analytics' },
  'metric': { feature: 'metrics_display', domain: 'analytics' },
  'revenue': { feature: 'revenue_tracking', domain: 'analytics' },
  'report': { feature: 'reporting', domain: 'analytics' },
  'export': { feature: 'data_export', domain: null },
  'kpi': { feature: 'metrics_display', domain: 'analytics' },

  // SaaS / Admin
  'settings': { feature: 'settings_management', domain: 'saas_dashboard' },
  'api key': { feature: 'api_key_management', domain: 'saas_dashboard' },
  'user management': { feature: 'user_management', domain: 'saas_dashboard' },
  'team': { feature: 'team_management', domain: 'saas_dashboard' },
  'billing': { feature: 'billing_management', domain: 'saas_dashboard' },
  'subscription': { feature: 'subscription_management', domain: 'saas_dashboard' },
  'invite': { feature: 'user_invitation', domain: 'saas_dashboard' },

  // Marketing
  'hero': { feature: 'hero_section', domain: 'marketing' },
  'pricing': { feature: 'pricing_display', domain: 'marketing' },
  'testimonial': { feature: 'testimonials', domain: 'marketing' },
  'landing': { feature: 'landing_page', domain: 'marketing' },
  'cta': { feature: 'call_to_action', domain: 'marketing' },

  // Social
  'feed': { feature: 'feed', domain: 'social' },
  'profile': { feature: 'user_profile', domain: 'social' },
  'follow': { feature: 'follow_system', domain: 'social' },

  // Generic
  'search': { feature: 'search', domain: null },
  'notification': { feature: 'notifications', domain: null },
  'email': { feature: 'email_integration', domain: null },
  'upload': { feature: 'file_upload', domain: null },
  'calendar': { feature: 'calendar', domain: null },
  'chat': { feature: 'messaging', domain: null },
  'message': { feature: 'messaging', domain: null },
});

// ─── Intent Model Factory ───────────────────────────────────────────

/**
 * Create a structured Mission Intent from raw mission fields.
 *
 * @param {object} raw - Raw mission fields: { buildPrompt, requirements, objectives, businessGoals, targetUrl, constraints, ... }
 * @returns {object} Structured intent model
 */
function createMissionIntent(raw = {}) {
  const {
    buildPrompt,
    requirements,
    objectives,
    businessGoals,
    targetAudience,
    userRoles,
    constraints,
    expectedFeatures: rawExpected,
    expectedWorkflows: rawWorkflows,
    targetUrl,
  } = raw;

  // Determine intent availability
  const hasBuildPrompt = buildPrompt && typeof buildPrompt === 'string' && buildPrompt.trim().length > 0;
  const hasRequirements = Array.isArray(requirements) && requirements.length > 0;
  const hasObjectives = Array.isArray(objectives) && objectives.length > 0;
  const hasBusinessGoals = businessGoals && typeof businessGoals === 'string' && businessGoals.trim().length > 0;
  const hasExplicitExpected = Array.isArray(rawExpected) && rawExpected.length > 0;

  const intentFields = [hasBuildPrompt, hasRequirements, hasObjectives, hasBusinessGoals, hasExplicitExpected];
  const presentCount = intentFields.filter(Boolean).length;

  let intentAvailability;
  if (presentCount >= 2) {
    intentAvailability = INTENT_AVAILABILITY.FULL;
  } else if (presentCount === 1) {
    intentAvailability = INTENT_AVAILABILITY.PARTIAL;
  } else if (targetUrl) {
    intentAvailability = INTENT_AVAILABILITY.URL_ONLY;
  } else {
    intentAvailability = INTENT_AVAILABILITY.UNKNOWN;
  }

  // Derive expected features with provenance
  const expectedFeatures = deriveExpectedFeatures({
    buildPrompt, requirements, objectives, rawExpected, hasBuildPrompt, hasRequirements, hasExplicitExpected, hasObjectives,
  });

  // Derive expected workflows with provenance
  const expectedWorkflows = deriveExpectedWorkflows({
    buildPrompt, requirements, rawWorkflows, hasBuildPrompt, hasRequirements,
  });

  // Derive domain hypotheses from intent
  const domainHypotheses = generateDomainHypothesesFromIntent({
    buildPrompt, requirements, objectives,
  });

  return {
    intentAvailability,
    buildPrompt: buildPrompt || null,
    requirements: requirements || [],
    objectives: objectives || [],
    businessGoals: businessGoals || null,
    targetAudience: targetAudience || null,
    userRoles: userRoles || [],
    constraints: constraints || {},
    expectedFeatures,
    expectedWorkflows,
    domainHypotheses,
    createdAt: new Date().toISOString(),
  };
}

// ─── Expected Feature Derivation ────────────────────────────────────

function deriveExpectedFeatures({ buildPrompt, requirements, objectives, rawExpected, hasBuildPrompt, hasRequirements, hasExplicitExpected, hasObjectives }) {
  const features = [];
  const seen = new Set();

  // Priority 1: Explicitly provided expected features
  if (hasExplicitExpected) {
    for (const feat of rawExpected) {
      const name = typeof feat === 'string' ? feat : feat.name;
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      features.push({
        id: `feat_explicit_${features.length}`,
        name,
        description: typeof feat === 'object' ? (feat.description || '') : '',
        source: PROVENANCE.EXPLICIT,
        priority: 'required',
        confidence: 1.0,
        evidenceRefs: ['user_provided_expected_features'],
      });
    }
  }

  // Priority 2: Explicit requirements array
  if (hasRequirements) {
    for (const req of requirements) {
      if (typeof req !== 'string') continue;
      const matched = matchFeatureFromText(req);
      for (const m of matched) {
        if (seen.has(m.feature)) continue;
        seen.add(m.feature);
        features.push({
          id: `feat_req_${features.length}`,
          name: m.feature,
          description: `Derived from requirement: "${req.slice(0, 100)}"`,
          source: PROVENANCE.EXPLICIT,
          priority: 'required',
          confidence: 0.95,
          evidenceRefs: [`requirement:${req.slice(0, 60)}`],
        });
      }
    }
  }

  // Priority 3: Build prompt keywords
  if (hasBuildPrompt) {
    const matched = matchFeatureFromText(buildPrompt);
    for (const m of matched) {
      if (seen.has(m.feature)) continue;
      seen.add(m.feature);
      features.push({
        id: `feat_prompt_${features.length}`,
        name: m.feature,
        description: `Derived from build prompt keyword: "${m.keyword}"`,
        source: PROVENANCE.EXPLICIT,
        priority: 'expected',
        confidence: 0.9,
        evidenceRefs: [`build_prompt:${m.keyword}`],
      });
    }
  }

  // Priority 4: Objectives
  if (hasObjectives) {
    for (const obj of objectives) {
      if (typeof obj !== 'string') continue;
      const matched = matchFeatureFromText(obj);
      for (const m of matched) {
        if (seen.has(m.feature)) continue;
        seen.add(m.feature);
        features.push({
          id: `feat_obj_${features.length}`,
          name: m.feature,
          description: `Derived from objective: "${obj.slice(0, 100)}"`,
          source: PROVENANCE.INFERRED,
          priority: 'expected',
          confidence: 0.75,
          evidenceRefs: [`objective:${obj.slice(0, 60)}`],
        });
      }
    }
  }

  return features;
}

// ─── Expected Workflow Derivation ───────────────────────────────────

function deriveExpectedWorkflows({ buildPrompt, requirements, rawWorkflows, hasBuildPrompt, hasRequirements }) {
  const workflows = [];
  const seen = new Set();

  // Explicit workflows (highest priority — always included)
  if (Array.isArray(rawWorkflows)) {
    for (const wf of rawWorkflows) {
      const name = typeof wf === 'string' ? wf : wf.name;
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      workflows.push({
        name,
        steps: typeof wf === 'object' ? (wf.steps || []) : [],
        source: PROVENANCE.EXPLICIT,
        confidence: 1.0,
        evidenceRefs: ['user_provided_workflows'],
      });
    }
  }

  // Phase 9.1: Infer workflows from build prompt, BUT use domain filtering.
  // Only add workflows for domains that appear in the PRIMARY intent, not
  // secondary mentions. For example, a marketing site that mentions "project
  // management tool" should get marketing workflows, not PM workflows.
  if (hasBuildPrompt) {
    const matched = matchFeatureFromText(buildPrompt);
    const domains = new Map(); // domainId → { score, keywords }

    for (const m of matched) {
      if (m.domain) {
        if (!domains.has(m.domain)) {
          domains.set(m.domain, { score: 0, keywords: [] });
        }
        const entry = domains.get(m.domain);
        entry.score += 1;
        entry.keywords.push(m.keyword);
      }
    }

    // Phase 9.1: Sort domains by score. Only add workflows for the TOP domain
    // (the primary domain of the application) unless multiple domains have
    // equal scores (genuinely ambiguous app).
    const sortedDomains = [...domains.entries()].sort((a, b) => b[1].score - a[1].score);

    // Use only the primary domain for workflow inference.
    // Secondary domains (lower scores) are likely just contextual mentions.
    if (sortedDomains.length > 0) {
      const [primaryDomainId, primaryData] = sortedDomains[0];
      const domain = DOMAIN_CATALOG[primaryDomainId];
      if (domain && domain.workflows) {
        for (const wfName of domain.workflows) {
          if (seen.has(wfName)) continue;
          seen.add(wfName);
          workflows.push({
            name: wfName,
            steps: [],
            source: PROVENANCE.INFERRED,
            confidence: 0.7,
            evidenceRefs: [`build_prompt_domain:${primaryDomainId}`],
          });
        }
      }

      // If there's a close second domain (score within 1 of primary), add its workflows too
      if (sortedDomains.length > 1) {
        const [secondDomainId, secondData] = sortedDomains[1];
        if (secondData.score >= primaryData.score - 1) {
          const secondDomain = DOMAIN_CATALOG[secondDomainId];
          if (secondDomain && secondDomain.workflows) {
            for (const wfName of secondDomain.workflows) {
              if (seen.has(wfName)) continue;
              seen.add(wfName);
              workflows.push({
                name: wfName,
                steps: [],
                source: PROVENANCE.INFERRED,
                confidence: 0.6,
                evidenceRefs: [`build_prompt_domain:${secondDomainId}`],
              });
            }
          }
        }
      }
    }
  }

  // Always add universal auth workflow
  if (!seen.has('user_login')) {
    workflows.push({
      name: 'user_login',
      steps: [],
      source: PROVENANCE.DOMAIN_STANDARD,
      confidence: 0.5,
      evidenceRefs: ['universal_auth'],
    });
  }

  return workflows;
}

// ─── Domain Hypothesis Generation ───────────────────────────────────

/**
 * Generate domain hypotheses from intent text (build prompt, requirements, objectives).
 * Returns scored hypotheses — does NOT pick a winner yet. Evidence collection happens later.
 */
function generateDomainHypothesesFromIntent({ buildPrompt, requirements, objectives }) {
  const text = [buildPrompt || '', ...(requirements || []), ...(objectives || [])].join(' ').toLowerCase();

  if (!text.trim()) return [];

  const scores = {};
  for (const [domainId, domain] of Object.entries(DOMAIN_CATALOG)) {
    if (domainId === 'generic') continue;
    let score = 0;
    const matchedKeywords = [];
    for (const kw of domain.keywords) {
      if (text.includes(kw.toLowerCase())) {
        score += 1;
        matchedKeywords.push(kw);
      }
    }
    if (score > 0) {
      scores[domainId] = {
        domainId,
        domainName: domain.name,
        score,
        matchedKeywords,
        evidenceRefs: matchedKeywords.map(kw => `intent_keyword:${kw}`),
      };
    }
  }

  // Sort by score descending
  return Object.values(scores).sort((a, b) => b.score - a.score);
}

// ─── Feature Text Matching ──────────────────────────────────────────

function matchFeatureFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  const matches = [];
  const seen = new Set();

  for (const [keyword, mapping] of Object.entries(CONTEXT_FEATURE_MAP)) {
    if (lower.includes(keyword) && !seen.has(mapping.feature)) {
      seen.add(mapping.feature);
      matches.push({ keyword, feature: mapping.feature, domain: mapping.domain });
    }
  }

  return matches;
}

// ─── Expected Features from Domain ──────────────────────────────────

/**
 * Generate domain-standard expected features for a given domain.
 * These have lower confidence than intent-derived features.
 */
function getDomainExpectedFeatures(domainId) {
  const domain = DOMAIN_CATALOG[domainId];
  if (!domain) return [];

  return domain.expectedFeatures.map((name, i) => ({
    id: `feat_domain_${domainId}_${i}`,
    name,
    description: `Standard feature for ${domain.name} applications`,
    source: PROVENANCE.DOMAIN_STANDARD,
    priority: 'expected',
    confidence: PROVENANCE_WEIGHTS[PROVENANCE.DOMAIN_STANDARD],
    evidenceRefs: [`domain_catalog:${domainId}`],
  }));
}

/**
 * Get domain risk areas.
 */
function getDomainRiskAreas(domainId) {
  const domain = DOMAIN_CATALOG[domainId];
  if (!domain) return [];
  return domain.riskAreas || [];
}

/**
 * Get domain standard workflows.
 */
function getDomainWorkflows(domainId) {
  const domain = DOMAIN_CATALOG[domainId];
  if (!domain) return [];
  return domain.workflows || [];
}

// ─── Serialization ──────────────────────────────────────────────────

function serializeIntent(intent) {
  return JSON.parse(JSON.stringify(intent));
}

function isIntentAvailable(intent) {
  if (!intent) return false;
  return intent.intentAvailability === INTENT_AVAILABILITY.FULL || intent.intentAvailability === INTENT_AVAILABILITY.PARTIAL;
}

// ─── Exports ────────────────────────────────────────────────────────

export { PROVENANCE };
export { PROVENANCE_WEIGHTS };
export { INTENT_AVAILABILITY };
export { DOMAIN_CATALOG };
export { CONTEXT_FEATURE_MAP };
export { createMissionIntent };
export { deriveExpectedFeatures };
export { deriveExpectedWorkflows };
export { generateDomainHypothesesFromIntent };
export { matchFeatureFromText };
export { getDomainExpectedFeatures };
export { getDomainRiskAreas };
export { getDomainWorkflows };
export { serializeIntent };
export { isIntentAvailable };
