/**
 * Phase 9 — Workflow Intelligence & Evidence-Driven Validation Tests
 *
 * Tests:
 *   A. Workflow Model Hardening
 *   B. Workflow Prioritization
 *   C. Workflow Context for Prompt
 *   D. Step Validation
 *   E. Outcome Classification
 *   F. Expected vs Actual Integration
 *   G. Workflow Finding Generation
 *   H. Re-validation Classification
 *   I. Workflow Coverage
 *   J. Quality Scoring (v2 model)
 *   K. Duplicate Suppression (Phase 9 improvements)
 *   L. Revalidation Prompt with Workflow Gaps
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hardenWorkflowModel,
  prioritizeWorkflows,
  buildWorkflowContextForPrompt,
  validateWorkflowSteps,
  classifyWorkflowOutcome,
  connectWorkflowResultsToComparison,
  generateWorkflowFindings,
  classifyRevalidation,
  computeWorkflowCoverage,
  runWorkflowPipeline,
  buildRevalidationContext,
  computeWorkflowSuccessFactor,
  WORKFLOW_OUTCOME,
  STEP_OUTCOME,
  CRITICALITY,
  WORKFLOW_STEP_TEMPLATES,
  REVALIDATION_RESULT,
} from '../server/workflowEngine.js';

import { calculateMissionQuality } from '../server/devIntelligence.js';
import { correlateFindings, SIMILARITY_THRESHOLD } from '../server/duplicateSuppression.js';

// ─── A. Workflow Model Hardening ────────────────────────────────────

describe('Workflow Model Hardening', () => {
  test('enriches raw workflows with canonical step structure', () => {
    const raw = [{
      name: 'browse_to_checkout',
      source: 'explicit',
      confidence: 1.0,
      evidenceRefs: ['req:checkout'],
    }];
    const hardened = hardenWorkflowModel(raw, 'ecommerce', {});
    assert.equal(hardened.length, 1);
    assert.equal(hardened[0].name, 'browse_to_checkout');
    assert.ok(hardened[0].purpose, 'should have purpose');
    assert.ok(hardened[0].expectedOutcome, 'should have expectedOutcome');
    assert.ok(hardened[0].criticality, 'should have criticality');
    assert.ok(hardened[0].preconditions?.length > 0, 'should have preconditions');
    assert.ok(hardened[0].steps.length >= 4, 'checkout should have at least 4 steps');
  });

  test('each step has required fields', () => {
    const raw = [{ name: 'task_lifecycle', source: 'explicit', confidence: 1.0 }];
    const hardened = hardenWorkflowModel(raw, 'project_management', {});
    for (const step of hardened[0].steps) {
      assert.ok(step.id, `step should have id: ${step.name}`);
      assert.ok(step.action, `step should have action: ${step.name}`);
      assert.ok(step.target, `step should have target: ${step.name}`);
      assert.ok(step.expectedResult, `step should have expectedResult: ${step.name}`);
      assert.ok(step.validationMethod, `step should have validationMethod: ${step.name}`);
      assert.equal(step.evidenceRequired, true, `step should require evidence: ${step.name}`);
    }
  });

  test('provenance is preserved from source', () => {
    for (const source of ['explicit', 'inferred', 'domain_standard', 'unknown']) {
      const raw = [{ name: 'signup_flow', source, confidence: 0.5 }];
      const hardened = hardenWorkflowModel(raw, 'marketing', {});
      assert.equal(hardened[0].provenance, source);
    }
  });

  test('checkout workflow is critical', () => {
    const raw = [{ name: 'browse_to_checkout', source: 'explicit', confidence: 1.0 }];
    const hardened = hardenWorkflowModel(raw, 'ecommerce', {});
    assert.equal(hardened[0].criticality, CRITICALITY.CRITICAL);
  });

  test('login workflow is critical', () => {
    const raw = [{ name: 'user_login', source: 'explicit', confidence: 1.0 }];
    const hardened = hardenWorkflowModel(raw, 'crm', {});
    assert.equal(hardened[0].criticality, CRITICALITY.CRITICAL);
  });

  test('handles unknown workflows with fallback steps', () => {
    const raw = [{ name: 'custom_workflow', source: 'inferred', confidence: 0.5, steps: ['step1', 'step2'] }];
    const hardened = hardenWorkflowModel(raw, null, {});
    assert.equal(hardened[0].steps.length, 2);
    assert.equal(hardened[0].steps[0].name, 'step1');
  });
});

// ─── B. Workflow Prioritization ─────────────────────────────────────

describe('Workflow Prioritization', () => {
  test('explicit workflows rank higher than domain standard', () => {
    const workflows = [
      { name: 'contact_lifecycle', provenance: 'domain_standard', confidence: 0.5, preconditions: [], criticality: 'high' },
      { name: 'browse_to_checkout', provenance: 'explicit', confidence: 1.0, preconditions: [], criticality: 'critical' },
    ];
    const prioritized = prioritizeWorkflows(workflows, {}, {}, {});
    assert.ok(prioritized[0].priority > prioritized[1].priority, 'explicit should rank higher');
    assert.equal(prioritized[0].name, 'browse_to_checkout');
  });

  test('auth-dependent workflows get priority boost', () => {
    const workflows = [
      { name: 'navigate_sections', provenance: 'domain_standard', confidence: 0.5, preconditions: ['app_loaded'], criticality: 'low' },
      { name: 'task_lifecycle', provenance: 'domain_standard', confidence: 0.5, preconditions: ['app_loaded', 'authenticated_or_accessible'], criticality: 'high' },
    ];
    const prioritized = prioritizeWorkflows(workflows, {}, {}, {});
    assert.ok(prioritized[0].priority >= prioritized[1].priority, 'auth-dependent should rank at least as high');
  });

  test('sorted by priority descending', () => {
    const workflows = [
      { name: 'a', provenance: 'unknown', confidence: 0.1, preconditions: [], criticality: 'low' },
      { name: 'b', provenance: 'explicit', confidence: 1.0, preconditions: ['authenticated_or_accessible'], criticality: 'critical' },
      { name: 'c', provenance: 'domain_standard', confidence: 0.5, preconditions: [], criticality: 'medium' },
    ];
    const prioritized = prioritizeWorkflows(workflows, {}, {}, {});
    for (let i = 1; i < prioritized.length; i++) {
      assert.ok(prioritized[i - 1].priority >= prioritized[i].priority, 'should be sorted descending');
    }
  });

  test('previously failed workflows get boost from knowledge', () => {
    const workflows = [
      { name: 'task_lifecycle', provenance: 'explicit', confidence: 1.0, preconditions: [], criticality: 'high', id: 'task_lifecycle' },
    ];
    const knowledge = {
      patterns: [{ type: 'failure_pattern', workflowId: 'task_lifecycle' }],
    };
    const prioritized = prioritizeWorkflows(workflows, {}, {}, knowledge);
    assert.ok(prioritized[0].priorityReasons.includes('previously_failed'));
  });
});

// ─── C. Workflow Context for Prompt ─────────────────────────────────

describe('Workflow Context for Prompt', () => {
  test('generates text block for agent prompt', () => {
    const workflows = [
      { name: 'browse_to_checkout', priority: 100, criticality: 'critical', purpose: 'Browse and checkout', steps: [{ name: 'browse_products', expectedResult: 'products_visible' }], expectedOutcome: 'Products can be browsed' },
    ];
    const ctx = buildWorkflowContextForPrompt(workflows);
    assert.ok(ctx.includes('EXPECTED WORKFLOWS'));
    assert.ok(ctx.includes('browse to checkout'));
    assert.ok(ctx.includes('browse products'));
    assert.ok(ctx.includes('[CRITICAL]'));
  });

  test('returns empty string for no workflows', () => {
    assert.equal(buildWorkflowContextForPrompt([]), '');
  });

  test('respects maxWorkflows limit', () => {
    const workflows = Array.from({ length: 15 }, (_, i) => ({
      name: `wf_${i}`, priority: 100 - i, criticality: 'low', purpose: 'test', steps: [{ name: 'step', expectedResult: 'result' }], expectedOutcome: 'done'
    }));
    const ctx = buildWorkflowContextForPrompt(workflows, 5);
    // Count workflow entries (not the header line)
    const wfCount = (ctx.match(/^\s+\d+\./gm) || []).length;
    assert.equal(wfCount, 5);
  });
});

// ─── D. Step Validation ─────────────────────────────────────────────

describe('Step Validation', () => {
  test('detects observed steps from captured steps', () => {
    const workflow = {
      name: 'contact_lifecycle',
      criticality: 'high',
      steps: [
        { id: 's1', name: 'create_contact', action: 'interact', target: 'contact_form', expectedResult: 'contact_created', validationMethod: 'content_changed', evidenceRequired: true, expected: true },
      ],
    };
    const session = {
      capturedSteps: [
        { id: 'cs1', title: 'Created new contact', url: '/contacts/new', description: 'Filled contact form' },
      ],
      findings: [],
      activities: [],
    };
    const validated = validateWorkflowSteps(workflow, session);
    assert.equal(validated[0].observed, true);
    assert.equal(validated[0].tested, true);
    assert.equal(validated[0].outcome, STEP_OUTCOME.PASSED);
  });

  test('detects failed steps from findings', () => {
    const workflow = {
      name: 'contact_lifecycle',
      criticality: 'high',
      steps: [
        { id: 's1', name: 'create_contact', action: 'interact', target: 'contact_form', expectedResult: 'contact_created', validationMethod: 'content_changed', evidenceRequired: true, expected: true },
      ],
    };
    const session = {
      capturedSteps: [{ id: 'cs1', title: 'Tried to create contact', description: 'Contact creation failed' }],
      findings: [{ id: 'f1', title: 'Contact creation fails with error', severity: 'high' }],
      activities: [],
    };
    const validated = validateWorkflowSteps(workflow, session);
    assert.equal(validated[0].outcome, STEP_OUTCOME.FAILED);
    assert.ok(validated[0].relatedFindings.length > 0);
  });

  test('marks untested when no evidence', () => {
    const workflow = {
      name: 'configure_settings',
      criticality: 'medium',
      steps: [
        { id: 's1', name: 'save_settings', action: 'interact', target: 'save_button', expectedResult: 'saved', validationMethod: 'content_changed', evidenceRequired: true, expected: true },
      ],
    };
    const session = { capturedSteps: [], findings: [], activities: [] };
    const validated = validateWorkflowSteps(workflow, session);
    assert.equal(validated[0].outcome, STEP_OUTCOME.NOT_TESTED);
  });
});

// ─── E. Outcome Classification ──────────────────────────────────────

describe('Outcome Classification', () => {
  test('all steps pass → PASS', () => {
    const steps = [
      { outcome: STEP_OUTCOME.PASSED },
      { outcome: STEP_OUTCOME.PASSED },
    ];
    assert.equal(classifyWorkflowOutcome({}, steps), WORKFLOW_OUTCOME.PASS);
  });

  test('any step fails → FAILED', () => {
    const steps = [
      { outcome: STEP_OUTCOME.PASSED },
      { outcome: STEP_OUTCOME.FAILED },
      { outcome: STEP_OUTCOME.PASSED },
    ];
    assert.equal(classifyWorkflowOutcome({}, steps), WORKFLOW_OUTCOME.FAILED);
  });

  test('first step fails, rest untested → BLOCKED', () => {
    const steps = [
      { outcome: STEP_OUTCOME.FAILED },
      { outcome: STEP_OUTCOME.NOT_TESTED },
      { outcome: STEP_OUTCOME.NOT_TESTED },
    ];
    assert.equal(classifyWorkflowOutcome({}, steps), WORKFLOW_OUTCOME.BLOCKED);
  });

  test('some passed, some not tested → PARTIALLY_COMPLETED', () => {
    const steps = [
      { outcome: STEP_OUTCOME.PASSED },
      { outcome: STEP_OUTCOME.NOT_TESTED },
    ];
    assert.equal(classifyWorkflowOutcome({}, steps), WORKFLOW_OUTCOME.PARTIALLY_COMPLETED);
  });

  test('all not tested → NOT_TESTED', () => {
    const steps = [
      { outcome: STEP_OUTCOME.NOT_TESTED },
      { outcome: STEP_OUTCOME.NOT_TESTED },
    ];
    assert.equal(classifyWorkflowOutcome({}, steps), WORKFLOW_OUTCOME.NOT_TESTED);
  });

  test('empty steps → NOT_APPLICABLE', () => {
    assert.equal(classifyWorkflowOutcome({}, []), WORKFLOW_OUTCOME.NOT_APPLICABLE);
  });
});

// ─── F. Expected vs Actual Integration ──────────────────────────────

describe('Expected vs Actual Integration', () => {
  test('downgrades implemented to broken when workflow fails', () => {
    const workflowResults = [{
      workflow: { name: 'browse_to_checkout' },
      outcome: WORKFLOW_OUTCOME.FAILED,
      firstFailedStep: 'checkout',
      validatedSteps: [],
    }];
    const evo = {
      features: [
        { name: 'checkout', status: 'implemented' },
        { name: 'product_browsing', status: 'implemented' },
      ],
    };
    const updates = connectWorkflowResultsToComparison(workflowResults, evo);
    assert.ok(updates.length > 0);
    assert.equal(updates[0].featureName, 'checkout');
    assert.equal(updates[0].newStatus, 'implemented_but_broken');
  });

  test('does not downgrade when workflow passes', () => {
    const workflowResults = [{
      workflow: { name: 'browse_to_checkout' },
      outcome: WORKFLOW_OUTCOME.PASS,
      validatedSteps: [],
    }];
    const evo = { features: [{ name: 'checkout', status: 'implemented' }] };
    const updates = connectWorkflowResultsToComparison(workflowResults, evo);
    assert.equal(updates.length, 0);
  });
});

// ─── G. Workflow Finding Generation ─────────────────────────────────

describe('Workflow Finding Generation', () => {
  test('generates findings for failed steps', () => {
    const results = [{
      workflow: { id: 'browse_to_checkout', name: 'browse_to_checkout', criticality: 'critical' },
      outcome: WORKFLOW_OUTCOME.FAILED,
      validatedSteps: [
        { id: 'step_1', name: 'checkout', outcome: STEP_OUTCOME.FAILED, expectedResult: 'checkout_form_visible', evidenceRequired: true, evidence: ['step:1'], relatedFindings: [] },
      ],
    }];
    const findings = generateWorkflowFindings(results, []);
    assert.equal(findings.length, 1);
    assert.ok(findings[0].title.includes('checkout'));
    assert.ok(findings[0].title.includes('failed'));
    assert.equal(findings[0].severity, 'critical');
    assert.equal(findings[0].isWorkflowGenerated, true);
  });

  test('does not duplicate existing findings', () => {
    const results = [{
      workflow: { id: 'browse_to_checkout', name: 'browse_to_checkout', criticality: 'high' },
      outcome: WORKFLOW_OUTCOME.FAILED,
      validatedSteps: [
        { id: 'step_1', name: 'checkout', outcome: STEP_OUTCOME.FAILED, expectedResult: 'checkout_form', evidenceRequired: true, evidence: [], relatedFindings: [] },
      ],
    }];
    const existing = [{ title: 'Checkout button does nothing', description: 'browse to checkout checkout fails' }];
    const findings = generateWorkflowFindings(results, existing);
    assert.equal(findings.length, 0);
  });

  test('skips passing workflows', () => {
    const results = [{
      workflow: { id: 'wf1', name: 'test_wf', criticality: 'high' },
      outcome: WORKFLOW_OUTCOME.PASS,
      validatedSteps: [],
    }];
    assert.equal(generateWorkflowFindings(results, []).length, 0);
  });
});

// ─── H. Re-validation Classification ────────────────────────────────

describe('Re-validation Classification', () => {
  test('same failure → CONFIRMED', () => {
    const prev = { outcome: WORKFLOW_OUTCOME.FAILED, validatedSteps: [{ id: 's1', outcome: STEP_OUTCOME.FAILED }] };
    const curr = { outcome: WORKFLOW_OUTCOME.FAILED, validatedSteps: [{ id: 's1', outcome: STEP_OUTCOME.FAILED }] };
    assert.equal(classifyRevalidation(prev, curr), REVALIDATION_RESULT.CONFIRMED);
  });

  test('was failing, now passes → NOT_REPRODUCED', () => {
    const prev = { outcome: WORKFLOW_OUTCOME.FAILED, validatedSteps: [{ id: 's1', outcome: STEP_OUTCOME.FAILED }] };
    const curr = { outcome: WORKFLOW_OUTCOME.PASS, validatedSteps: [{ id: 's1', outcome: STEP_OUTCOME.PASSED }] };
    assert.equal(classifyRevalidation(prev, curr), REVALIDATION_RESULT.NOT_REPRODUCED);
  });

  test('different steps fail → INTERMITTENT', () => {
    const prev = { outcome: WORKFLOW_OUTCOME.FAILED, validatedSteps: [{ id: 's1', outcome: STEP_OUTCOME.FAILED }, { id: 's2', outcome: STEP_OUTCOME.PASSED }] };
    const curr = { outcome: WORKFLOW_OUTCOME.FAILED, validatedSteps: [{ id: 's1', outcome: STEP_OUTCOME.PASSED }, { id: 's2', outcome: STEP_OUTCOME.FAILED }] };
    assert.equal(classifyRevalidation(prev, curr), REVALIDATION_RESULT.INTERMITTENT);
  });
});

// ─── I. Workflow Coverage ───────────────────────────────────────────

describe('Workflow Coverage', () => {
  test('computes coverage from results', () => {
    const results = [
      { outcome: WORKFLOW_OUTCOME.PASS },
      { outcome: WORKFLOW_OUTCOME.FAILED },
      { outcome: WORKFLOW_OUTCOME.NOT_TESTED },
    ];
    const cov = computeWorkflowCoverage(results);
    assert.equal(cov.total, 3);
    assert.equal(cov.tested, 2);
    assert.equal(cov.passed, 1);
    assert.equal(cov.failed, 1);
    assert.equal(cov.notTested, 1);
    assert.equal(cov.passRate, 50);
    assert.equal(cov.coverageRate, 67);
  });

  test('empty results → zeros', () => {
    const cov = computeWorkflowCoverage([]);
    assert.equal(cov.total, 0);
    assert.equal(cov.passRate, 0);
  });
});

// ─── J. Quality Scoring v2 ──────────────────────────────────────────

describe('Quality Scoring v2', () => {
  test('does not collapse to 0 for many high findings', () => {
    const findings = Array.from({ length: 15 }, (_, i) => ({
      id: `f${i}`,
      severity: 'high',
      confidence: 0.8,
      title: `Finding ${i}`,
    }));
    const quality = calculateMissionQuality(findings);
    assert.ok(quality.score > 0, `score should be > 0, got ${quality.score}`);
    // Logarithmic model: 15 high-severity findings (weight 15 each, confidence 0.8) = 180 weighted
    // Deduction = 92 * (1 - e^(-0.035 * 180)) ≈ 92 * (1 - e^-6.3) ≈ 92 * 0.998 ≈ 91.8 → score ≈ 8
    // With critical floor not triggered (no criticals), this is correct behavior
    assert.ok(quality.score >= 5, `score should be at least 5, got ${quality.score}`);
    assert.equal(quality.scoringModel, 'v2');
  });

  test('single critical finding floors at critical floor', () => {
    const findings = [{ id: 'f1', severity: 'critical', confidence: 1.0, title: 'Critical bug' }];
    const quality = calculateMissionQuality(findings);
    assert.ok(quality.score <= 15, `critical should floor at 15 or below, got ${quality.score}`);
    assert.ok(quality.score >= 0);
  });

  test('workflow success factor provides boost', () => {
    const findings = [{ id: 'f1', severity: 'high', confidence: 0.8, title: 'Bug' }];
    const q1 = calculateMissionQuality(findings);
    const q2 = calculateMissionQuality(findings, { workflowSuccessFactor: 1.0 });
    assert.ok(q2.score >= q1.score, `workflow boost should increase score: ${q2.score} >= ${q1.score}`);
  });

  test('no findings → 100', () => {
    const quality = calculateMissionQuality([]);
    assert.equal(quality.score, 100);
    assert.equal(quality.verdict, 'pass');
  });

  test('few low findings → high score', () => {
    const findings = [{ id: 'f1', severity: 'low', confidence: 0.5, title: 'Minor issue' }];
    const quality = calculateMissionQuality(findings);
    assert.ok(quality.score >= 85, `few low findings should score high, got ${quality.score}`);
  });
});

// ─── K. Duplicate Suppression (Phase 9) ─────────────────────────────

describe('Duplicate Suppression (Phase 9)', () => {
  test('threshold lowered to 0.38', () => {
    assert.equal(SIMILARITY_THRESHOLD, 0.38);
  });

  test('groups same root cause findings', () => {
    const findings = [
      { id: 'f1', severity: 'high', title: 'Sign In link broken — no login form', description: 'Login page blank', url: '/login' },
      { id: 'f2', severity: 'medium', title: 'Login form missing on sign in page', description: 'No authentication form', url: '/login' },
      { id: 'f3', severity: 'high', title: 'Authentication completely non-functional', description: 'Cannot log in', url: '/signin' },
    ];
    const result = correlateFindings(findings);
    // Should collapse some of these
    assert.ok(result.canonical.length < findings.length, `should have fewer canonical (${result.canonical.length}) than original (${findings.length})`);
    assert.ok(result.duplicateCount > 0, 'should detect duplicates');
  });

  test('does not group unrelated findings', () => {
    const findings = [
      { id: 'f1', severity: 'high', title: 'Checkout button does nothing', description: 'Cart checkout broken', url: '/cart' },
      { id: 'f2', severity: 'medium', title: 'Mobile layout overflow on dashboard', description: 'Horizontal scroll on mobile', url: '/dashboard' },
      { id: 'f3', severity: 'low', title: 'Footer copyright year outdated', description: 'Shows 2023 instead of 2025', url: '/' },
    ];
    const result = correlateFindings(findings);
    assert.equal(result.canonical.length, 3, 'unrelated findings should not be grouped');
    assert.equal(result.duplicateCount, 0);
  });

  test('workflow context improves correlation', () => {
    const findings = [
      { id: 'f1', severity: 'high', title: 'Add to cart button unresponsive', description: 'Product page cart button', url: '/products/1', workflowId: 'browse_to_checkout' },
      { id: 'f2', severity: 'medium', title: 'Cannot add items to shopping cart', description: 'Cart button fails', url: '/products/2', workflowId: 'browse_to_checkout' },
    ];
    const result = correlateFindings(findings);
    assert.ok(result.canonical.length <= 1, 'same workflow findings should be grouped');
  });
});

// ─── L. Revalidation Prompt with Workflow Gaps ──────────────────────

describe('Revalidation Context', () => {
  test('includes failed workflows', () => {
    const results = [{
      workflow: { name: 'browse_to_checkout' },
      outcome: WORKFLOW_OUTCOME.FAILED,
      firstFailedStep: 'checkout',
      validatedSteps: [
        { name: 'browse_products', outcome: STEP_OUTCOME.PASSED },
        { name: 'checkout', outcome: STEP_OUTCOME.FAILED, expectedResult: 'checkout_form' },
      ],
    }];
    const ctx = buildRevalidationContext(results, {});
    assert.ok(ctx.includes('FAILED WORKFLOWS'));
    assert.ok(ctx.includes('browse to checkout'));
    assert.ok(ctx.includes('checkout'));
  });

  test('includes incomplete workflows from gap report', () => {
    const gapReport = {
      incompleteWorkflows: [{ name: 'task_lifecycle', untestedSteps: ['create_task', 'assign_task'] }],
    };
    const ctx = buildRevalidationContext([], gapReport);
    assert.ok(ctx.includes('UNTESTED WORKFLOW STEPS'));
    assert.ok(ctx.includes('task lifecycle'), 'should include workflow name');
    assert.ok(ctx.includes('create task'), 'should include untested step name');
  });
});

// ─── M. Full Pipeline ───────────────────────────────────────────────

describe('Full Workflow Pipeline', () => {
  test('runs complete pipeline and returns structured results', () => {
    const expectedWorkflows = [
      { name: 'contact_lifecycle', source: 'explicit', confidence: 1.0 },
      { name: 'configure_settings', source: 'domain_standard', confidence: 0.5 },
    ];
    const session = {
      capturedSteps: [
        { id: 'cs1', title: 'Created new contact', description: 'Add contact form', url: '/contacts/new' },
        { id: 'cs2', title: 'Viewed contact details', url: '/contacts/1' },
      ],
      findings: [
        { id: 'f1', title: 'Contact delete fails', severity: 'high' },
      ],
      activities: [],
    };
    const result = runWorkflowPipeline(expectedWorkflows, session, { id: 'crm' }, {}, {}, []);

    assert.ok(result.workflows.length === 2);
    assert.ok(result.coverage.total === 2);
    assert.ok(result.prioritizedWorkflowNames.includes('contact_lifecycle'));
    assert.ok(result.prioritizedWorkflowNames.includes('configure_settings'));
    // contact_lifecycle should rank higher (explicit vs domain_standard)
    assert.equal(result.prioritizedWorkflowNames[0], 'contact_lifecycle');
  });

  test('computes workflow success factor', () => {
    const results = [
      { outcome: WORKFLOW_OUTCOME.PASS },
      { outcome: WORKFLOW_OUTCOME.PASS },
      { outcome: WORKFLOW_OUTCOME.FAILED },
    ];
    const factor = computeWorkflowSuccessFactor(results);
    assert.ok(factor > 0 && factor <= 1);
    assert.equal(factor, 2 / 3);
  });
});
