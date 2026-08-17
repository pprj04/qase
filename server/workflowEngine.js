/**
 * Phase 9 — Workflow Intelligence & Evidence-Driven Validation
 *
 * Transforms workflows from a post-hoc reporting artifact into an
 * execution-driving intelligence layer.
 *
 * Pipeline:
 *   hardenWorkflowModel → prioritizeWorkflows → buildWorkflowContextForPrompt
 *   → (agent explores with workflow guidance)
 *   → classifyWorkflowOutcomes → connectWorkflowResultsToComparison
 *   → generateWorkflowFindings → (Phase 8 dedup + evidence)
 *
 * Design principles:
 *   - Workflows are NOT hardcoded scripts. They are structured expectations
 *     that guide the agent's exploration.
 *   - Step validation is evidence-driven (from capturedSteps + findings),
 *     NOT keyword-only matching.
 *   - Provenance and priority determine testing order.
 *   - Failed workflows produce findings connected to features via Phase 8 EVO.
 *   - Re-validation classifies CONFIRMED/INTERMITTENT/NOT_REPRODUCED/BLOCKED.
 */

import { PROVENANCE, PROVENANCE_WEIGHTS } from './intentModel.js';

// ─── Constants ──────────────────────────────────────────────────────

const WORKFLOW_OUTCOME = Object.freeze({
  PASS: 'pass',
  FAILED: 'failed',
  PARTIALLY_COMPLETED: 'partially_completed',
  BLOCKED: 'blocked',
  NOT_TESTED: 'not_tested',
  NOT_APPLICABLE: 'not_applicable',
  UNKNOWN: 'unknown',
});

const STEP_OUTCOME = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  NOT_TESTED: 'not_tested',
  UNKNOWN: 'unknown',
});

const VALIDATION_METHOD = Object.freeze({
  ELEMENT_VISIBLE: 'element_visible',
  ELEMENT_CLICKABLE: 'element_clickable',
  FORM_ACCEPTS_INPUT: 'form_accepts_input',
  NAVIGATION_OCCURRED: 'navigation_occurred',
  CONTENT_CHANGED: 'content_changed',
  NO_CONSOLE_ERROR: 'no_console_error',
  URL_CHANGED: 'url_changed',
  DATA_PERSISTED: 'data_persisted',
  API_RESPONDED: 'api_responded',
  VISUAL_INSPECTION: 'visual_inspection',
});

const REVALIDATION_RESULT = Object.freeze({
  CONFIRMED: 'confirmed',
  INTERMITTENT: 'intermittent',
  NOT_REPRODUCED: 'not_reproduced',
  BLOCKED: 'blocked',
});

const CRITICALITY = Object.freeze({
  CRITICAL: 'critical',     // auth, checkout, core CRUD
  HIGH: 'high',            // primary user flow
  MEDIUM: 'medium',        // secondary features
  LOW: 'low',             // nice-to-have
});

// Priority weights for deterministic scoring
const PRIORITY_WEIGHTS = Object.freeze({
  EXPLICIT_REQUIREMENT: 40,
  AUTH_DEPENDENT: 25,
  CRITICAL_PATH: 20,
  BUSINESS_GOAL: 15,
  DOMAIN_STANDARD: 10,
  KNOWLEDGE: 5,
  PREVIOUSLY_FAILED: 30,   // workflows that failed before get re-test priority
});

// ─── Step Templates ─────────────────────────────────────────────────
// Canonical step definitions per workflow type. These provide the
// expected structure but are NOT execution scripts — the agent decides
// how to interact based on the actual DOM.

const WORKFLOW_STEP_TEMPLATES = Object.freeze({
  // CRM workflows
  lead_to_deal: [
    { name: 'navigate_to_leads', action: 'navigate', target: 'leads_page', expectedResult: 'leads_list_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'create_lead', action: 'interact', target: 'create_lead_form', expectedResult: 'lead_created', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'qualify_lead', action: 'interact', target: 'lead_qualify_action', expectedResult: 'lead_status_changed', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'advance_pipeline', action: 'interact', target: 'pipeline_stages', expectedResult: 'lead_advanced', validationMethod: VALIDATION_METHOD.VISUAL_INSPECTION, evidenceRequired: true },
    { name: 'close_deal', action: 'interact', target: 'deal_close_action', expectedResult: 'deal_closed', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
  ],
  contact_lifecycle: [
    { name: 'navigate_to_contacts', action: 'navigate', target: 'contacts_page', expectedResult: 'contacts_list_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'create_contact', action: 'interact', target: 'add_contact_button', expectedResult: 'contact_form_or_contact_created', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'view_contact', action: 'interact', target: 'contact_detail', expectedResult: 'contact_details_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'edit_contact', action: 'interact', target: 'edit_contact_button', expectedResult: 'contact_updated', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'delete_contact', action: 'interact', target: 'delete_contact_button', expectedResult: 'contact_removed', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
  ],
  configure_settings: [
    { name: 'navigate_to_settings', action: 'navigate', target: 'settings_page', expectedResult: 'settings_form_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'modify_fields', action: 'interact', target: 'settings_inputs', expectedResult: 'inputs_editable', validationMethod: VALIDATION_METHOD.FORM_ACCEPTS_INPUT, evidenceRequired: true },
    { name: 'save_settings', action: 'interact', target: 'save_button', expectedResult: 'settings_saved_confirmation', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'verify_persistence', action: 'verify', target: 'page_after_reload', expectedResult: 'settings_persisted', validationMethod: VALIDATION_METHOD.DATA_PERSISTED, evidenceRequired: true },
  ],

  // E-commerce workflows
  browse_to_checkout: [
    { name: 'browse_products', action: 'navigate', target: 'product_listings', expectedResult: 'products_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'add_to_cart', action: 'interact', target: 'add_to_cart_button', expectedResult: 'item_added_to_cart', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'view_cart', action: 'navigate', target: 'cart_page', expectedResult: 'cart_contents_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'checkout', action: 'interact', target: 'checkout_button', expectedResult: 'checkout_form_or_payment_step', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'payment', action: 'verify', target: 'payment_form', expectedResult: 'payment_form_functional', validationMethod: VALIDATION_METHOD.FORM_ACCEPTS_INPUT, evidenceRequired: true },
    { name: 'order_confirmation', action: 'verify', target: 'confirmation_page', expectedResult: 'order_placed_confirmation', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
  ],
  product_search: [
    { name: 'enter_search_query', action: 'interact', target: 'search_input', expectedResult: 'search_accepts_input', validationMethod: VALIDATION_METHOD.FORM_ACCEPTS_INPUT, evidenceRequired: true },
    { name: 'view_search_results', action: 'verify', target: 'search_results', expectedResult: 'relevant_results_displayed', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
  ],

  // Project management workflows
  task_lifecycle: [
    { name: 'create_task', action: 'interact', target: 'add_task_button', expectedResult: 'task_form_or_task_created', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'assign_task', action: 'interact', target: 'task_assignment', expectedResult: 'task_assigned', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'advance_task_status', action: 'interact', target: 'task_status_control', expectedResult: 'status_changed', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'complete_task', action: 'interact', target: 'task_complete_action', expectedResult: 'task_marked_done', validationMethod: VALIDATION_METHOD.VISUAL_INSPECTION, evidenceRequired: true },
  ],
  sprint_planning: [
    { name: 'create_sprint', action: 'interact', target: 'sprint_creation', expectedResult: 'sprint_created', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'assign_tasks', action: 'interact', target: 'task_assignment', expectedResult: 'tasks_assigned_to_sprint', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'track_progress', action: 'verify', target: 'progress_indicator', expectedResult: 'progress_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'complete_sprint', action: 'interact', target: 'sprint_complete_action', expectedResult: 'sprint_completed', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
  ],

  // Analytics workflows
  view_metrics: [
    { name: 'navigate_to_dashboard', action: 'navigate', target: 'dashboard_page', expectedResult: 'dashboard_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'view_charts', action: 'verify', target: 'chart_elements', expectedResult: 'charts_rendered', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'view_stats', action: 'verify', target: 'stat_cards', expectedResult: 'stats_displayed', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'filter_data', action: 'interact', target: 'filter_controls', expectedResult: 'data_filtered', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
  ],
  drill_down: [
    { name: 'view_summary', action: 'verify', target: 'summary_view', expectedResult: 'summary_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'click_detail', action: 'interact', target: 'detail_link_or_button', expectedResult: 'detail_expanded', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'view_detail_data', action: 'verify', target: 'detail_view', expectedResult: 'granular_data_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
  ],

  // SaaS workflows
  invite_user: [
    { name: 'navigate_to_users', action: 'navigate', target: 'users_page', expectedResult: 'user_list_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'click_invite', action: 'interact', target: 'invite_button', expectedResult: 'invite_form_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'fill_email', action: 'interact', target: 'email_input', expectedResult: 'email_accepted', validationMethod: VALIDATION_METHOD.FORM_ACCEPTS_INPUT, evidenceRequired: true },
    { name: 'send_invite', action: 'interact', target: 'send_invite_button', expectedResult: 'invite_sent_confirmation', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
  ],

  // Marketing workflows
  signup_flow: [
    { name: 'click_cta', action: 'interact', target: 'signup_cta_button', expectedResult: 'signup_form_or_modal', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'fill_registration', action: 'interact', target: 'registration_form', expectedResult: 'form_accepts_input', validationMethod: VALIDATION_METHOD.FORM_ACCEPTS_INPUT, evidenceRequired: true },
    { name: 'submit_form', action: 'interact', target: 'submit_button', expectedResult: 'form_submitted', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'access_account', action: 'verify', target: 'post_signup_view', expectedResult: 'account_access_granted', validationMethod: VALIDATION_METHOD.URL_CHANGED, evidenceRequired: true },
  ],
  navigate_sections: [
    { name: 'scroll_page', action: 'interact', target: 'page_body', expectedResult: 'page_scrollable', validationMethod: VALIDATION_METHOD.VISUAL_INSPECTION, evidenceRequired: true },
    { name: 'click_nav_link', action: 'interact', target: 'navigation_links', expectedResult: 'section_displayed', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'view_section_content', action: 'verify', target: 'section_content', expectedResult: 'content_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
  ],

  // Auth workflow (universal)
  user_login: [
    { name: 'navigate_to_login', action: 'navigate', target: 'login_page_or_modal', expectedResult: 'login_form_visible', validationMethod: VALIDATION_METHOD.ELEMENT_VISIBLE, evidenceRequired: true },
    { name: 'enter_credentials', action: 'interact', target: 'login_form_inputs', expectedResult: 'inputs_accepted', validationMethod: VALIDATION_METHOD.FORM_ACCEPTS_INPUT, evidenceRequired: true },
    { name: 'submit_login', action: 'interact', target: 'login_submit_button', expectedResult: 'session_established', validationMethod: VALIDATION_METHOD.CONTENT_CHANGED, evidenceRequired: true },
    { name: 'verify_authenticated', action: 'verify', target: 'post_login_view', expectedResult: 'authenticated_state_confirmed', validationMethod: VALIDATION_METHOD.URL_CHANGED, evidenceRequired: true },
  ],
});

// ─── Domain → Workflow Catalog (Phase 9.1) ──────────────────────────

/**
 * Maps domains to their canonical workflows.
 * Used by filterWorkflowsByDomain to prevent domain mismatch
 * (e.g., marketing apps getting CRM workflows).
 */
const DOMAIN_WORKFLOW_CATALOG = Object.freeze({
  crm: ['lead_to_deal', 'contact_lifecycle', 'configure_settings', 'user_login'],
  ecommerce: ['browse_to_checkout', 'product_search', 'user_login'],
  project_management: ['task_lifecycle', 'sprint_planning', 'user_login'],
  analytics: ['view_metrics', 'drill_down', 'user_login'],
  marketing: ['signup_flow', 'navigate_sections', 'user_login'],
  saas_dashboard: ['view_metrics', 'drill_down', 'invite_user', 'configure_settings', 'user_login'],
  blog: ['read_article', 'browse_posts', 'user_login'],
  social: ['create_post', 'browse_feed', 'user_login'],
  education: ['take_course', 'complete_assignment', 'user_login'],
  healthcare: ['schedule_appointment', 'view_records', 'user_login'],
  generic: ['user_login'],
});

// Universal workflows that apply to all domains
const UNIVERSAL_WORKFLOWS = new Set(['user_login', 'configure_settings', 'signup_flow']);

/**
 * Phase 9.1: Filter workflows by confirmed domain.
 * Removes workflows that don't belong to the domain unless explicitly requested.
 */
function filterWorkflowsByDomain(workflows, confirmedDomain) {
  const domainWorkflows = DOMAIN_WORKFLOW_CATALOG[confirmedDomain] || DOMAIN_WORKFLOW_CATALOG.generic;
  const domainSet = new Set(domainWorkflows);

  return workflows.filter(wf => {
    // Always keep explicitly-requested workflows
    if (wf.provenance === 'explicit') return true;
    // Keep if it's in the domain catalog
    if (domainSet.has(wf.name)) return true;
    // Keep universal workflows
    if (UNIVERSAL_WORKFLOWS.has(wf.name)) return true;
    // Filter out workflows from other domains
    return false;
  });
}

// ─── Workflow Hardening (Step 1) ────────────────────────────────────

/**
 * Enriches raw expected workflows with canonical step structure.
 *
 * Input: expectedWorkflows from intentModel [{name, steps[], source, confidence, evidenceRefs}]
 * Output: hardened workflows with full step definitions
 */
function hardenWorkflowModel(expectedWorkflows = [], domainId = null, intent = null) {
  const hardened = [];

  for (const wf of expectedWorkflows) {
    const template = WORKFLOW_STEP_TEMPLATES[wf.name];

    // Build canonical steps: use template if available, else derive from raw steps
    const stepDefs = template
      ? template.map((s, i) => ({
          id: `${wf.name}_step_${i + 1}`,
          ...s,
          expected: true,
        }))
      : (wf.steps || [`start_${wf.name}`, `complete_${wf.name}`]).map((stepName, i) => ({
          id: `${wf.name}_step_${i + 1}`,
          name: stepName,
          action: i === 0 ? 'navigate' : 'interact',
          target: stepName,
          expectedResult: `${stepName}_completed`,
          validationMethod: VALIDATION_METHOD.VISUAL_INSPECTION,
          evidenceRequired: true,
          expected: true,
        }));

    // Determine criticality
    const criticality = determineCriticality(wf.name, wf.source, intent);

    // Determine preconditions
    const preconditions = determinePreconditions(wf.name, domainId);

    hardened.push({
      id: wf.name,
      name: wf.name,
      purpose: describeWorkflowPurpose(wf.name),
      priority: 0, // Set by prioritizeWorkflows
      provenance: wf.source || PROVENANCE.UNKNOWN,
      confidence: wf.confidence || PROVENANCE_WEIGHTS[wf.source] || 0.1,
      preconditions,
      steps: stepDefs,
      expectedOutcome: describeExpectedOutcome(wf.name),
      criticality,
      evidenceRefs: wf.evidenceRefs || [],
    });
  }

  return hardened;
}

function determineCriticality(workflowName, source, intent) {
  // Auth is always critical
  if (workflowName.includes('login') || workflowName.includes('auth')) {
    return CRITICALITY.CRITICAL;
  }
  // Checkout/payment is critical for e-commerce
  if (workflowName.includes('checkout') || workflowName.includes('payment')) {
    return CRITICALITY.CRITICAL;
  }
  // Explicit workflows are at least high
  if (source === PROVENANCE.EXPLICIT) {
    return CRITICALITY.HIGH;
  }
  // Core CRUD workflows (create, edit, delete entities)
  if (workflowName.includes('lifecycle') || workflowName.includes('contact') || workflowName.includes('task')) {
    return CRITICALITY.HIGH;
  }
  // Settings, signup are medium
  if (workflowName.includes('settings') || workflowName.includes('signup') || workflowName.includes('invite')) {
    return CRITICALITY.MEDIUM;
  }
  return CRITICALITY.LOW;
}

function determinePreconditions(workflowName, domainId) {
  const preconditions = [];

  // Most workflows require the app to be loaded
  preconditions.push('app_loaded');

  // Auth-dependent workflows
  if (!workflowName.includes('login') && !workflowName.includes('signup') && !workflowName.includes('navigate')) {
    preconditions.push('authenticated_or_accessible');
  }

  // E-commerce workflows may need products
  if (workflowName.includes('checkout') || workflowName.includes('cart')) {
    preconditions.push('products_available');
  }

  return preconditions;
}

function describeWorkflowPurpose(name) {
  const descriptions = {
    'lead_to_deal': 'Track a lead through pipeline stages to deal closure',
    'contact_lifecycle': 'Create, view, edit, and delete contacts',
    'browse_to_checkout': 'Browse products, add to cart, and complete checkout',
    'product_search': 'Search for products and view results',
    'task_lifecycle': 'Create, assign, advance, and complete tasks',
    'sprint_planning': 'Create sprints, assign tasks, and track progress',
    'view_metrics': 'View dashboard charts, stats, and filter data',
    'drill_down': 'Navigate from summary to detailed data views',
    'invite_user': 'Invite new users to the platform',
    'configure_settings': 'Modify settings and verify persistence',
    'signup_flow': 'Complete user registration from CTA to account access',
    'navigate_sections': 'Navigate between page sections via links',
    'user_login': 'Authenticate via login form',
  };
  return descriptions[name] || `Execute the ${name.replace(/_/g, ' ')} workflow`;
}

function describeExpectedOutcome(name) {
  const outcomes = {
    'lead_to_deal': 'Lead progresses through pipeline stages to closed deal',
    'contact_lifecycle': 'Contact can be created, viewed, edited, and deleted',
    'browse_to_checkout': 'Products can be browsed, added to cart, and checked out',
    'product_search': 'Search returns relevant product results',
    'task_lifecycle': 'Task can be created, assigned, advanced, and completed',
    'sprint_planning': 'Sprints can be created, populated, and completed',
    'view_metrics': 'Dashboard displays charts, stats, and supports filtering',
    'drill_down': 'Summary data can be drilled into detailed views',
    'invite_user': 'User invitation can be sent successfully',
    'configure_settings': 'Settings can be modified and persist after reload',
    'signup_flow': 'User can register and access their account',
    'navigate_sections': 'All navigation links lead to correct sections',
    'user_login': 'User can authenticate and reach authenticated state',
  };
  return outcomes[name] || `${name.replace(/_/g, ' ')} completes successfully`;
}

// ─── Workflow Prioritization (Step 2) ───────────────────────────────

/**
 * Deterministic workflow prioritization.
 * Higher score = higher priority = should be tested first.
 */
function prioritizeWorkflows(workflows, intent = {}, domain = {}, knowledge = {}) {
  const scored = workflows.map(wf => {
    let score = 0;
    const reasons = [];

    // Explicit user requirement
    if (wf.provenance === PROVENANCE.EXPLICIT) {
      score += PRIORITY_WEIGHTS.EXPLICIT_REQUIREMENT;
      reasons.push('explicit_requirement');
    }

    // Auth dependency
    if (wf.preconditions?.includes('authenticated_or_accessible')) {
      score += PRIORITY_WEIGHTS.AUTH_DEPENDENT;
      reasons.push('auth_dependent');
    }

    // Critical path
    if (wf.criticality === CRITICALITY.CRITICAL) {
      score += PRIORITY_WEIGHTS.CRITICAL_PATH;
      reasons.push('critical_path');
    } else if (wf.criticality === CRITICALITY.HIGH) {
      score += PRIORITY_WEIGHTS.CRITICAL_PATH * 0.7;
      reasons.push('high_criticality');
    }

    // Business goal alignment
    const businessGoals = intent.businessGoals || '';
    if (businessGoals && workflowRelatesToGoal(wf.name, businessGoals)) {
      score += PRIORITY_WEIGHTS.BUSINESS_GOAL;
      reasons.push('business_goal_aligned');
    }

    // Domain standard
    if (wf.provenance === PROVENANCE.DOMAIN_STANDARD) {
      score += PRIORITY_WEIGHTS.DOMAIN_STANDARD;
      reasons.push('domain_standard');
    }

    // Knowledge-based
    if (wf.provenance === PROVENANCE.KNOWLEDGE) {
      score += PRIORITY_WEIGHTS.KNOWLEDGE;
      reasons.push('knowledge_based');
    }

    // Previously failed (from knowledge patterns)
    if (knowledge.patterns) {
      const hasFailurePattern = knowledge.patterns.some(p =>
        p.type === 'failure_pattern' && p.workflowId === wf.id
      );
      if (hasFailurePattern) {
        score += PRIORITY_WEIGHTS.PREVIOUSLY_FAILED;
        reasons.push('previously_failed');
      }
    }

    // Confidence bonus
    score += (wf.confidence || 0.5) * 10;

    return { ...wf, priority: Math.round(score), priorityReasons: reasons };
  });

  // Sort by priority descending
  scored.sort((a, b) => b.priority - a.priority);

  return scored;
}

function workflowRelatesToGoal(workflowName, businessGoals) {
  const goals = businessGoals.toLowerCase();
  const wf = workflowName.toLowerCase().replace(/_/g, ' ');
  // Simple heuristic: if any word from the workflow name appears in business goals
  const wfWords = wf.split(' ').filter(w => w.length > 3);
  return wfWords.some(w => goals.includes(w));
}

// ─── Workflow Context for Agent Prompt (Step 9) ─────────────────────

/**
 * Builds a text block for injection into the agent's task prompt.
 * Lists prioritized workflows with their steps so the agent knows
 * what to test and in what order.
 */
function buildWorkflowContextForPrompt(workflows = [], maxWorkflows = 8) {
  if (!workflows.length) return '';

  const top = workflows.slice(0, maxWorkflows);
  const lines = ['\n\nEXPECTED WORKFLOWS (test these systematically, in priority order):'];

  for (const wf of top) {
    const criticalityTag = wf.criticality === CRITICALITY.CRITICAL ? ' [CRITICAL]' :
                           wf.criticality === CRITICALITY.HIGH ? ' [HIGH]' : '';
    lines.push(`\n  ${wf.priority}. ${wf.name.replace(/_/g, ' ')}${criticalityTag}`);
    lines.push(`     Purpose: ${wf.purpose}`);

    for (const step of wf.steps) {
      const stepDesc = `     → ${step.name.replace(/_/g, ' ')}: ${step.expectedResult.replace(/_/g, ' ')}`;
      lines.push(stepDesc);
    }

    if (wf.expectedOutcome) {
      lines.push(`     Expected outcome: ${wf.expectedOutcome}`);
    }
  }

  lines.push('\n  IMPORTANT: Test these workflows step-by-step. For each step, verify the expected');
  lines.push('  result actually occurs. Report a finding if any step fails. Also explore beyond');
  lines.push('  these workflows for unexpected issues.');

  return lines.join('\n');
}

// ─── Step Validation (Steps 4-5, Phase 9.1 evidence-driven) ─────────

/**
 * Validates workflow steps against actual session data.
 *
 * Phase 9.1: Evidence-driven validation. A step can only PASS if there is
 * concrete evidence the agent actually interacted with the relevant element
 * and the expected result was observed. Keyword text alone CANNOT produce
 * a PASS. Text matches without action evidence produce UNKNOWN, not PASS.
 *
 * Evidence sources (in priority order):
 *   1. Findings that match the step → FAILED
 *   2. Captured steps (browser actions) matching step action/target → tested
 *   3. Activities (capability pipeline events) → observed
 *   4. Session text matches → observed (weak evidence, cannot PASS alone)
 *
 * Outcome rules:
 *   - Finding related to step → FAILED (strong evidence of failure)
 *   - Captured step match + observation match + no finding → PASSED
 *   - Captured step match but no observation → NOT_TESTED (tried but couldn't verify)
 *   - Text mention only → UNKNOWN (saw the word but no action evidence)
 *   - Nothing at all → NOT_TESTED
 *   - Blocked by prior step failure → BLOCKED
 */
function validateWorkflowSteps(workflow, session = {}, priorStepsFailed = false) {
  let blocked = priorStepsFailed;

  const validatedSteps = workflow.steps.map(step => {
    const evidence = collectStepEvidenceEnhanced(step, session);

    const hasFinding = evidence.relatedFindings.length > 0;
    const hasActionEvidence = evidence.capturedStepRefs.length > 0;
    const hasObservation = evidence.observations.length > 0;
    const hasStrongEvidence = evidence.strongEvidence; // browser action + visible result

    let outcome;

    // If a prior step in this workflow failed, subsequent steps are blocked
    if (blocked) {
      outcome = STEP_OUTCOME.BLOCKED;
    } else if (hasFinding) {
      // Finding referencing this step → FAILED
      outcome = STEP_OUTCOME.FAILED;
      blocked = true; // Block subsequent steps
    } else if (hasActionEvidence && hasStrongEvidence) {
      // Agent performed an action AND we can verify the expected result
      // This is the ONLY path to PASSED — requires concrete browser evidence
      outcome = STEP_OUTCOME.PASSED;
    } else if (hasActionEvidence && !hasStrongEvidence) {
      // Agent performed an action but we can't verify the result
      outcome = STEP_OUTCOME.UNKNOWN;
    } else if (hasObservation) {
      // Something was observed but no action evidence
      // Text keyword match alone → UNKNOWN (never PASS)
      outcome = STEP_OUTCOME.UNKNOWN;
    } else {
      // No evidence at all
      outcome = STEP_OUTCOME.NOT_TESTED;
    }

    return {
      ...step,
      observed: hasObservation,
      tested: hasActionEvidence,
      outcome,
      evidence: evidence.capturedStepRefs,
      relatedFindings: evidence.relatedFindings,
      observations: evidence.observations,
      evidenceStrength: hasStrongEvidence ? 'strong' : (hasActionEvidence ? 'medium' : (hasObservation ? 'weak' : 'none')),
    };
  });

  return validatedSteps;
}

/**
 * Enhanced step evidence collection.
 * Phase 9.1: Distinguishes action evidence (browser clicks/navigations) from
 * passive text mentions. Only action evidence can support a PASS outcome.
 */
function collectStepEvidenceEnhanced(step, session = {}) {
  const result = {
    capturedStepRefs: [],
    observations: [],
    relatedFindings: [],
    strongEvidence: false, // Phase 9.1: True only when browser action + visible result
  };

  const stepWords = step.name.split('_').filter(w => w.length > 2);
  const targetWords = (step.target || '').split('_').filter(w => w.length > 2);
  const expectedResultWords = (step.expectedResult || '').split('_').filter(w => w.length > 2);
  const allWords = [...new Set([...stepWords, ...targetWords, ...expectedResultWords])];

  let actionEvidenceCount = 0;
  let observationEvidenceCount = 0;

  // Match against captured steps (agent's actual browser actions)
  if (session.capturedSteps) {
    for (const cs of session.capturedSteps) {
      const csText = `${cs.title || ''} ${cs.description || ''} ${cs.url || ''} ${cs.action || ''}`.toLowerCase();
      const matches = allWords.some(w => csText.includes(w));
      if (matches) {
        result.capturedStepRefs.push(`step:${cs.id || cs.url || 'unknown'}`);
        result.observations.push({
          type: 'captured_step',
          ref: cs.id || cs.url,
          title: cs.title || cs.description || '',
          url: cs.url || '',
        });
        actionEvidenceCount++;
      }
    }
  }

  // Match against findings (strong evidence of failure)
  if (session.findings) {
    for (const f of session.findings) {
      const fText = `${f.title || ''} ${f.description || ''} ${f.impact || ''}`.toLowerCase();
      const matches = allWords.some(w => fText.includes(w));
      if (matches) {
        result.relatedFindings.push({
          id: f.id,
          title: f.title,
          severity: f.severity,
        });
      }
    }
  }

  // Match against session activities (capability pipeline events)
  if (session.activities) {
    for (const act of session.activities) {
      const actText = `${act.label || ''} ${act.detail || ''} ${act.description || ''}`.toLowerCase();
      if (allWords.some(w => actText.includes(w))) {
        result.observations.push({
          type: 'activity',
          label: act.label || '',
          detail: act.detail || '',
        });
        observationEvidenceCount++;
      }
    }
  }

  // Match against session turns (agent's LLM observations — medium evidence)
  if (session.turns) {
    for (const turn of session.turns) {
      const turnText = `${turn.thought || ''} ${turn.observation || ''} ${turn.summary || ''}`.toLowerCase();
      if (allWords.some(w => turnText.includes(w))) {
        result.observations.push({
          type: 'turn',
          thought: (turn.thought || '').slice(0, 100),
        });
        observationEvidenceCount++;
      }
    }
  }

  // Phase 9.1: Determine if there is "strong" evidence.
  // Strong evidence = a captured browser action (not just text mention).
  // This is the ONLY evidence type that can support a PASS outcome.
  result.strongEvidence = actionEvidenceCount > 0;

  return result;
}

// ─── Outcome Classification (Step 5) ────────────────────────────────

/**
 * Classifies overall workflow outcome from step results.
 */
function classifyWorkflowOutcome(workflow, validatedSteps) {
  const total = validatedSteps.length;
  if (total === 0) return WORKFLOW_OUTCOME.NOT_APPLICABLE;

  const passed = validatedSteps.filter(s => s.outcome === STEP_OUTCOME.PASSED).length;
  const failed = validatedSteps.filter(s => s.outcome === STEP_OUTCOME.FAILED).length;
  const notTested = validatedSteps.filter(s => s.outcome === STEP_OUTCOME.NOT_TESTED).length;
  const blocked = validatedSteps.filter(s => s.outcome === STEP_OUTCOME.BLOCKED).length;

  // If any step failed, the workflow failed (even if later steps passed)
  if (failed > 0) {
    // If the first failed step is early and blocks subsequent steps
    const firstFailedIdx = validatedSteps.findIndex(s => s.outcome === STEP_OUTCOME.FAILED);
    const stepsAfterFailure = total - firstFailedIdx - 1;
    if (stepsAfterFailure > 0 && passed === 0) {
      return WORKFLOW_OUTCOME.BLOCKED;
    }
    return WORKFLOW_OUTCOME.FAILED;
  }

  // All steps tested and passed
  if (passed === total) {
    return WORKFLOW_OUTCOME.PASS;
  }

  // Some passed, some not tested
  if (passed > 0 && notTested > 0) {
    return WORKFLOW_OUTCOME.PARTIALLY_COMPLETED;
  }

  // All not tested
  if (notTested === total) {
    return WORKFLOW_OUTCOME.NOT_TESTED;
  }

  // Blocked
  if (blocked > 0) {
    return WORKFLOW_OUTCOME.BLOCKED;
  }

  return WORKFLOW_OUTCOME.UNKNOWN;
}

// ─── Expected vs Actual Integration (Step 6) ────────────────────────

/**
 * Maps workflow execution results to feature status changes.
 * When a workflow fails, the related features get downgraded.
 */
function connectWorkflowResultsToComparison(workflowResults = [], expectedVsObserved = {}) {
  const featureUpdates = [];
  const features = expectedVsObserved.features || [];

  for (const wfResult of workflowResults) {
    if (wfResult.outcome === WORKFLOW_OUTCOME.PASS) continue;

    // Find features related to this workflow
    const wfName = wfResult.workflow.name;
    const relatedFeatures = findFeaturesForWorkflow(wfName, features);

    for (const feature of relatedFeatures) {
      if (wfResult.outcome === WORKFLOW_OUTCOME.FAILED) {
        // If feature was 'implemented', downgrade to 'implemented_but_broken'
        if (feature.status === 'implemented') {
          featureUpdates.push({
            featureName: feature.name,
            oldStatus: feature.status,
            newStatus: 'implemented_but_broken',
            reason: `Workflow "${wfName}" failed at step: ${wfResult.firstFailedStep}`,
            workflowId: wfName,
          });
        }
      } else if (wfResult.outcome === WORKFLOW_OUTCOME.BLOCKED) {
        if (feature.status === 'implemented' || feature.status === 'not_tested') {
          featureUpdates.push({
            featureName: feature.name,
            oldStatus: feature.status,
            newStatus: 'implemented_but_broken',
            reason: `Workflow "${wfName}" blocked — could not complete critical step`,
            workflowId: wfName,
          });
        }
      }
    }
  }

  return featureUpdates;
}

function findFeaturesForWorkflow(workflowName, features) {
  const mapping = {
    'lead_to_deal': ['lead_management', 'pipeline', 'deal_tracking'],
    'contact_lifecycle': ['contact_management'],
    'browse_to_checkout': ['product_browsing', 'cart', 'checkout', 'order_placement'],
    'product_search': ['search', 'product_browsing'],
    'task_lifecycle': ['task_management', 'task_creation', 'task_assignment'],
    'sprint_planning': ['board_view', 'progress_tracking'],
    'view_metrics': ['dashboard_overview', 'data_visualization', 'data_tables', 'filtering'],
    'drill_down': ['data_visualization', 'data_tables'],
    'invite_user': ['user_management'],
    'configure_settings': ['settings_management', 'api_key_management'],
    'signup_flow': ['user_registration', 'user_authentication'],
    'navigate_sections': ['navigation', 'hero_section'],
    'user_login': ['user_authentication'],
  };
  const featureNames = mapping[workflowName] || [];
  return features.filter(f => featureNames.includes(f.name));
}

// ─── Workflow Finding Generation (Step 6) ───────────────────────────

/**
 * Generates actionable findings from failed workflow steps.
 * These are candidate findings — Phase 8 dedup will handle overlap.
 */
function generateWorkflowFindings(workflowResults = [], existingFindings = []) {
  const newFindings = [];

  for (const wfResult of workflowResults) {
    if (wfResult.outcome !== WORKFLOW_OUTCOME.FAILED &&
        wfResult.outcome !== WORKFLOW_OUTCOME.BLOCKED) continue;

    for (const step of wfResult.validatedSteps) {
      if (step.outcome !== STEP_OUTCOME.FAILED) continue;

      // Phase 9.1: Check if an existing finding already covers this using
      // multi-dimensional correlation (not just text matching).
      const stepText = step.name.replace(/_/g, ' ');
      const wfText = wfResult.workflow.name.replace(/_/g, ' ');

      // First check text coverage (existing behavior)
      const textCovered = existingFindings.some(f => {
        const fText = `${f.title || ''} ${f.description || ''}`.toLowerCase();
        return fText.includes(stepText) || (fText.includes(wfText) && fText.includes(stepText));
      });

      // Phase 9.1: Also check feature-level coverage.
      // Extract the feature this workflow tests and check if an existing finding
      // already addresses the same underlying problem.
      const wfFeature = extractWorkflowFeatureForFinding(wfResult.workflow.name);
      const featureCovered = wfFeature && existingFindings.some(f => {
        const fText = `${f.title || ''} ${f.description || ''}`.toLowerCase();
        return fText.includes(wfFeature.replace(/_/g, ' ')) ||
               f.category === 'functionality' && fText.includes(wfText.split(' ')[0]);
      });

      if (textCovered || featureCovered) continue;

      // Generate finding with Phase 9.1 enhanced provenance
      const severity = step.evidenceRequired && wfResult.workflow.criticality === CRITICALITY.CRITICAL
        ? 'critical'
        : wfResult.workflow.criticality === CRITICALITY.HIGH ? 'high' : 'medium';

      newFindings.push({
        id: `wf_${wfResult.workflow.id}_${step.id}`,
        title: `${wfText}: ${stepText} failed`,
        severity,
        category: 'workflow_failure',
        description: `In the ${wfText} workflow, the step "${stepText}" did not produce the expected result: ${step.expectedResult?.replace(/_/g, ' ') || 'unspecified'}.`,
        impact: `The ${wfText} workflow cannot complete successfully.`,
        recommendation: `Investigate why the ${stepText} step fails. Expected: ${step.expectedResult?.replace(/_/g, ' ') || 'unspecified'}.`,
        evidence: step.evidence,
        relatedFindings: step.relatedFindings,
        // Phase 9.1: Full provenance for traceability
        workflowId: wfResult.workflow.id,
        workflowName: wfResult.workflow.name,
        stepId: step.id,
        stepName: step.name,
        action: step.action,
        target: step.target,
        expectedResult: step.expectedResult,
        evidenceRefs: step.evidence,
        rootCause: wfFeature ? `${wfFeature} not functional` : `${wfText} blocked at ${stepText}`,
        reproducibility: step.relatedFindings?.length > 0 ? 'confirmed' : 'observed_once',
        correlationStatus: 'pending',
        confidence: step.evidenceStrength === 'strong' ? 0.85 : (step.evidenceStrength === 'medium' ? 0.65 : 0.4),
        isWorkflowGenerated: true,
      });
    }
  }

  return newFindings;
}

/**
 * Maps a workflow name to the primary feature it tests.
 * Used to avoid generating duplicate workflow findings when an existing
 * feature-level finding already covers the same root cause.
 */
function extractWorkflowFeatureForFinding(workflowName) {
  const text = (workflowName || '').toLowerCase();
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
  return null;
}

// ─── Re-validation (Step 8) ─────────────────────────────────────────

/**
 * Classifies a re-validation attempt for a previously failed workflow.
 */
function classifyRevalidation(previousResult, currentResult) {
  if (!previousResult || !currentResult) return REVALIDATION_RESULT.BLOCKED;

  const prevFailed = previousResult.outcome === WORKFLOW_OUTCOME.FAILED ||
                     previousResult.outcome === WORKFLOW_OUTCOME.BLOCKED;
  const currFailed = currentResult.outcome === WORKFLOW_OUTCOME.FAILED ||
                     currentResult.outcome === WORKFLOW_OUTCOME.BLOCKED;

  if (prevFailed && currFailed) {
    // Check if the same step failed both times
    const prevFailedSteps = new Set(
      previousResult.validatedSteps
        ?.filter(s => s.outcome === STEP_OUTCOME.FAILED)
        .map(s => s.id) || []
    );
    const currFailedSteps = new Set(
      currentResult.validatedSteps
        ?.filter(s => s.outcome === STEP_OUTCOME.FAILED)
        .map(s => s.id) || []
    );
    const sameSteps = [...prevFailedSteps].every(s => currFailedSteps.has(s));
    return sameSteps ? REVALIDATION_RESULT.CONFIRMED : REVALIDATION_RESULT.INTERMITTENT;
  }

  if (prevFailed && !currFailed) {
    return REVALIDATION_RESULT.NOT_REPRODUCED;
  }

  return REVALIDATION_RESULT.CONFIRMED;
}

// ─── Workflow Coverage Summary ──────────────────────────────────────

function computeWorkflowCoverage(workflowResults = []) {
  const total = workflowResults.length;
  if (total === 0) {
    return {
      total: 0, tested: 0, passed: 0, failed: 0,
      blocked: 0, notTested: 0, passRate: 0, coverageRate: 0,
    };
  }

  const tested = workflowResults.filter(r =>
    r.outcome !== WORKFLOW_OUTCOME.NOT_TESTED &&
    r.outcome !== WORKFLOW_OUTCOME.UNKNOWN
  ).length;
  const passed = workflowResults.filter(r => r.outcome === WORKFLOW_OUTCOME.PASS).length;
  const failed = workflowResults.filter(r => r.outcome === WORKFLOW_OUTCOME.FAILED).length;
  const blocked = workflowResults.filter(r => r.outcome === WORKFLOW_OUTCOME.BLOCKED).length;
  const notTested = workflowResults.filter(r =>
    r.outcome === WORKFLOW_OUTCOME.NOT_TESTED || r.outcome === WORKFLOW_OUTCOME.UNKNOWN
  ).length;

  return {
    total,
    tested,
    passed,
    failed,
    blocked,
    notTested,
    passRate: tested > 0 ? Math.round((passed / tested) * 100) : 0,
    coverageRate: Math.round((tested / total) * 100),
  };
}

// ─── Full Pipeline Runner ───────────────────────────────────────────

/**
 * Runs the complete workflow intelligence pipeline.
 * Called from finalizeMissionFromSession after Phase 8 analysis.
 *
 * Returns structured workflow results that can be stored and used
 * for evidence, findings, and re-validation.
 */
function runWorkflowPipeline(expectedWorkflows = [], session = {}, domain = {}, intent = {}, knowledge = {}, existingFindings = []) {
  // Step 1: Harden workflow model
  const hardened = hardenWorkflowModel(expectedWorkflows, domain.id || domain.domainId || (typeof domain === 'string' ? domain : null), intent);

  // Phase 9.1: Domain-aware workflow filtering
  // Filter out workflows that don't belong to the confirmed domain UNLESS
  // they are explicitly requested by the user or are universal (auth).
  const confirmedDomain = typeof domain === 'string' ? domain : (domain.id || domain.domainId);
  let filtered = hardened;
  if (confirmedDomain && confirmedDomain !== 'unknown') {
    filtered = filterWorkflowsByDomain(hardened, confirmedDomain);
  }

  // Step 2: Prioritize
  const prioritized = prioritizeWorkflows(filtered, intent, domain, knowledge);

  // Step 3-5: Validate steps and classify outcomes
  // Phase 9.1: Pass priorStepsFailed state so blocked steps cascade correctly
  const results = prioritized.map(wf => {
    const validatedSteps = validateWorkflowSteps(wf, session, false);
    const outcome = classifyWorkflowOutcome(wf, validatedSteps);
    const firstFailedStep = validatedSteps.find(s =>
      s.outcome === STEP_OUTCOME.FAILED || s.outcome === STEP_OUTCOME.BLOCKED
    );

    return {
      workflow: wf,
      validatedSteps,
      outcome,
      firstFailedStep: firstFailedStep?.name || null,
      stepSummary: {
        total: validatedSteps.length,
        passed: validatedSteps.filter(s => s.outcome === STEP_OUTCOME.PASSED).length,
        failed: validatedSteps.filter(s => s.outcome === STEP_OUTCOME.FAILED).length,
        notTested: validatedSteps.filter(s => s.outcome === STEP_OUTCOME.NOT_TESTED).length,
        unknown: validatedSteps.filter(s => s.outcome === STEP_OUTCOME.UNKNOWN).length,
      },
    };
  });

  // Step 6: Generate findings from failed workflows
  const workflowFindings = generateWorkflowFindings(results, existingFindings);

  // Coverage
  const coverage = computeWorkflowCoverage(results);

  return {
    workflows: results,
    findings: workflowFindings,
    coverage,
    prioritizedWorkflowNames: prioritized.map(w => w.name),
  };
}

// ─── Revalidation Prompt Builder (Step 8) ───────────────────────────

/**
 * Builds a prompt segment for re-validation that targets specific
 * failed workflows and steps.
 */
function buildRevalidationContext(workflowResults = [], gapReport = {}) {
  const lines = [];

  const failedWorkflows = workflowResults.filter(r =>
    r.outcome === WORKFLOW_OUTCOME.FAILED || r.outcome === WORKFLOW_OUTCOME.BLOCKED
  );

  if (failedWorkflows.length > 0) {
    lines.push('\n\nFAILED WORKFLOWS TO RE-VALIDATE:');
    for (const fw of failedWorkflows.slice(0, 5)) {
      const wfName = fw.workflow.name.replace(/_/g, ' ');
      lines.push(`\n  "${wfName}" — ${fw.outcome}`);
      if (fw.firstFailedStep) {
        lines.push(`    Failed at: ${fw.firstFailedStep.replace(/_/g, ' ')}`);
      }
      for (const step of fw.validatedSteps) {
        if (step.outcome === STEP_OUTCOME.FAILED) {
          lines.push(`    ✗ ${step.name.replace(/_/g, ' ')} — ${step.expectedResult.replace(/_/g, ' ')}`);
        } else if (step.outcome === STEP_OUTCOME.PASSED) {
          lines.push(`    ✓ ${step.name.replace(/_/g, ' ')}`);
        }
      }
    }
    lines.push('\n  RE-VALIDATION INSTRUCTIONS:');
    lines.push('  - Navigate to each failed workflow step and verify the failure persists.');
    lines.push('  - If the step now works, note it was intermittent.');
    lines.push('  - If it still fails, confirm the failure with fresh evidence.');
  }

  // Include gap report
  if (gapReport.brokenWorkflows?.length > 0) {
    lines.push('\n\nBROKEN WORKFLOW GAPS (from analysis):');
    for (const bw of gapReport.brokenWorkflows) {
      lines.push(`  ${bw.name.replace(/_/g, ' ')}: ${(bw.brokenSteps || []).map(s => s.replace(/_/g, ' ')).join(', ')}`);
    }
  }

  if (gapReport.incompleteWorkflows?.length > 0) {
    lines.push('\n\nUNTESTED WORKFLOW STEPS (please test these):');
    for (const iw of gapReport.incompleteWorkflows) {
      lines.push(`  ${iw.name.replace(/_/g, ' ')}: ${(iw.untestedSteps || []).map(s => s.replace(/_/g, ' ')).join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ─── Quality Scoring Integration (Step 11) ──────────────────────────

/**
 * Computes a workflow success rate factor for quality scoring.
 * Returns 0.0-1.0 where 1.0 means all tested workflows passed.
 */
function computeWorkflowSuccessFactor(workflowResults = []) {
  const coverage = computeWorkflowCoverage(workflowResults);
  if (coverage.tested === 0) return 0.5; // neutral if nothing tested
  return coverage.passed / coverage.tested;
}

// ─── Exports ────────────────────────────────────────────────────────

export { WORKFLOW_OUTCOME };
export { STEP_OUTCOME };
export { VALIDATION_METHOD };
export { REVALIDATION_RESULT };
export { CRITICALITY };
export { PRIORITY_WEIGHTS };
export { WORKFLOW_STEP_TEMPLATES };
export { DOMAIN_WORKFLOW_CATALOG };
export { filterWorkflowsByDomain };

export { hardenWorkflowModel };
export { prioritizeWorkflows };
export { buildWorkflowContextForPrompt };
export { validateWorkflowSteps };
export { classifyWorkflowOutcome };
export { connectWorkflowResultsToComparison };
export { generateWorkflowFindings };
export { classifyRevalidation };
export { computeWorkflowCoverage };
export { runWorkflowPipeline };
export { buildRevalidationContext };
export { computeWorkflowSuccessFactor };
