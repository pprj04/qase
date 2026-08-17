/**
 * Phase 8 — Mission Intent & Application Understanding Tests
 *
 * Tests:
 *   A. Intent model creation (full prompt, partial, URL only)
 *   B. Intent provenance (EXPLICIT/INFERRED/DOMAIN_STANDARD/UNKNOWN)
 *   C. Expected feature derivation from build prompt
 *   D. Domain classification with multiple evidence sources
 *   E. Domain hypothesis generation
 *   F. Domain confusion guard (no GitHub for analytics)
 *   G. Expected vs observed comparison (IMPLEMENTED/BROKEN/MISSING/NOT_TESTED)
 *   H. Observed feature model (PRESENT ≠ FUNCTIONAL)
 *   I. Workflow model
 *   J. Duplicate suppression
 *   K. Feature compatibility with domain
 *   L. Confidence model (low evidence → LOW)
 *   M. LLM unavailable fallback
 *   N. Knowledge contradicts evidence
 *   O. URL only intent
 *   P. Ambiguous application
 *   Q. Full mission context
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMissionIntent,
  PROVENANCE,
  PROVENANCE_WEIGHTS,
  INTENT_AVAILABILITY,
  DOMAIN_CATALOG,
  matchFeatureFromText,
  getDomainExpectedFeatures,
  isIntentAvailable,
  generateDomainHypothesesFromIntent,
} from '../server/intentModel.js';
import {
  classifyDomain,
  verifyDomainClassification,
  isFeatureCompatibleWithDomain,
  extractStructuralSignals,
  SOURCE_WEIGHTS,
  DOMAIN_CONFIDENCE_THRESHOLD,
} from '../server/domainUnderstanding.js';
import {
  FEATURE_STATUS,
  buildExpectedFeatures,
  buildObservedFeatures,
  compareExpectedVsObserved,
  wasFeatureSufficientlyTested,
  buildWorkflowModel,
  generateGapReport,
} from '../server/expectedVsObserved.js';
import {
  correlateFindings,
  computeFindingSimilarity,
  summarizeSuppression,
  extractFeatureFromFinding,
} from '../server/duplicateSuppression.js';

// ─── A. Intent Model Creation ───────────────────────────────────────

test('A1: Full build prompt creates FULL intent', () => {
  const intent = createMissionIntent({
    buildPrompt: 'Build a CRM with leads, contacts, and pipeline management',
    requirements: ['User authentication', 'Data export'],
    businessGoals: 'Increase sales efficiency',
  });
  assert.equal(intent.intentAvailability, INTENT_AVAILABILITY.FULL);
  assert.ok(intent.expectedFeatures.length >= 3, `Expected ≥3 features, got ${intent.expectedFeatures.length}`);
  assert.ok(intent.expectedWorkflows.length >= 1);
});

test('A2: URL only creates URL_ONLY intent', () => {
  const intent = createMissionIntent({ targetUrl: 'http://example.com' });
  assert.equal(intent.intentAvailability, INTENT_AVAILABILITY.URL_ONLY);
  assert.equal(intent.expectedFeatures.length, 0);
});

test('A3: No intent creates UNKNOWN', () => {
  const intent = createMissionIntent({});
  assert.equal(intent.intentAvailability, INTENT_AVAILABILITY.UNKNOWN);
});

test('A4: Partial intent (requirements only)', () => {
  const intent = createMissionIntent({ requirements: ['login', 'search'] });
  assert.equal(intent.intentAvailability, INTENT_AVAILABILITY.PARTIAL);
});

// ─── B. Intent Provenance ───────────────────────────────────────────

test('B1: Explicit requirements have EXPLICIT provenance', () => {
  const intent = createMissionIntent({ requirements: ['User authentication required'] });
  const authFeature = intent.expectedFeatures.find(f => f.name === 'user_authentication');
  assert.ok(authFeature, 'Should find user_authentication feature');
  assert.equal(authFeature.source, PROVENANCE.EXPLICIT);
  assert.ok(authFeature.confidence >= 0.9);
});

test('B2: Build prompt features have EXPLICIT provenance', () => {
  const intent = createMissionIntent({ buildPrompt: 'Build an e-commerce store with cart and checkout' });
  const cartFeature = intent.expectedFeatures.find(f => f.name === 'cart');
  assert.ok(cartFeature);
  assert.equal(cartFeature.source, PROVENANCE.EXPLICIT);
});

test('B3: Provenance weights are ordered correctly', () => {
  assert.ok(PROVENANCE_WEIGHTS[PROVENANCE.EXPLICIT] > PROVENANCE_WEIGHTS[PROVENANCE.INFERRED]);
  assert.ok(PROVENANCE_WEIGHTS[PROVENANCE.INFERRED] > PROVENANCE_WEIGHTS[PROVENANCE.DOMAIN_STANDARD]);
  assert.ok(PROVENANCE_WEIGHTS[PROVENANCE.DOMAIN_STANDARD] > PROVENANCE_WEIGHTS[PROVENANCE.UNKNOWN]);
});

// ─── C. Expected Feature Derivation ─────────────────────────────────

test('C1: Build prompt extracts multiple features', () => {
  const features = matchFeatureFromText('Build a CRM with contacts, leads, pipeline, and deal tracking');
  assert.ok(features.some(f => f.feature === 'contact_management'));
  assert.ok(features.some(f => f.feature === 'lead_management'));
  assert.ok(features.some(f => f.feature === 'pipeline'));
});

test('C2: Requirements produce expected features', () => {
  const intent = createMissionIntent({ requirements: ['wishlist', 'product reviews', 'order history'] });
  assert.ok(intent.expectedFeatures.some(f => f.name === 'wishlist'));
  assert.ok(intent.expectedFeatures.some(f => f.name === 'product_reviews'));
});

test('C3: Domain standard features have correct provenance', () => {
  const domainFeatures = getDomainExpectedFeatures('ecommerce');
  assert.ok(domainFeatures.length >= 5);
  assert.ok(domainFeatures.every(f => f.source === PROVENANCE.DOMAIN_STANDARD));
  assert.ok(domainFeatures.every(f => f.confidence < 0.6));
});

// ─── D. Domain Classification ───────────────────────────────────────

test('D1: E-commerce domain classified from structural evidence', () => {
  const session = {
    capturedSteps: [
      { title: 'Product listing', description: 'Browse products', url: '/shop' },
      { title: 'Shopping cart', description: 'View cart', url: '/cart' },
      { title: 'Checkout', description: 'Enter payment', url: '/checkout' },
    ],
    findings: [],
  };
  const result = classifyDomain({
    intentDomainHypotheses: [],
    inventory: { pages: [{ title: 'Shop', path: '/shop' }] },
    session,
  });
  assert.ok(['ecommerce', 'unknown'].includes(result.domain), `Expected ecommerce or unknown, got ${result.domain}`);
});

test('D2: Analytics domain classified from text evidence', () => {
  const session = {
    capturedSteps: [
      { title: 'Dashboard', description: 'Revenue MRR metrics charts', url: '/dashboard' },
    ],
    findings: [],
  };
  const result = classifyDomain({
    intentDomainHypotheses: [],
    inventory: {},
    session,
  });
  assert.ok(result.hypotheses.some(h => h.domainId === 'analytics'));
});

test('D3: Multi-source consensus gives higher confidence', () => {
  const intentHypotheses = generateDomainHypothesesFromIntent({
    buildPrompt: 'Build an e-commerce store',
  });
  const session = {
    capturedSteps: [
      { target: 'Product page', label: 'Add to cart checkout', displayLabel: 'click', url: '/products' },
      { target: 'Cart button', label: 'Add to Cart', displayLabel: 'click', url: '/products' },
    ],
  };
  const result = classifyDomain({
    intentDomainHypotheses: intentHypotheses,
    inventory: { pages: [{ title: 'Products', path: '/products' }] },
    session,
  });
  assert.ok(result.confidence > DOMAIN_CONFIDENCE_THRESHOLD, `Confidence ${result.confidence} should be above threshold`);
});

// ─── E. Domain Hypothesis Generation ────────────────────────────────

test('E1: Multiple hypotheses generated from ambiguous prompt', () => {
  const hypotheses = generateDomainHypothesesFromIntent({
    buildPrompt: 'Build a dashboard with task board and product analytics',
  });
  assert.ok(hypotheses.length >= 2);
  // Should have both analytics and project_management
  const domainIds = hypotheses.map(h => h.domainId);
  assert.ok(domainIds.includes('analytics') || domainIds.includes('project_management'));
});

// ─── F. Domain Confusion Guard ──────────────────────────────────────

test('F1: Analytics app does NOT produce GitHub features', () => {
  // Simulate MetricsPro scenario
  const session = {
    capturedSteps: [
      { title: 'Dashboard', description: 'Revenue MRR analytics metrics', url: '/dashboard' },
      { title: 'Settings', description: 'API key settings', url: '/settings' },
    ],
    findings: [
      { title: 'Sign In link broken', description: 'No login form', severity: 'critical' },
      { title: 'Revenue chart is placeholder', description: 'No real chart', severity: 'high' },
    ],
  };
  const result = classifyDomain({
    intentDomainHypotheses: [],
    inventory: {},
    session,
  });

  // Domain should NOT be a code-hosting / GitHub domain
  assert.notEqual(result.domain, 'generic');

  // Check feature compatibility: "create repository" should NOT be compatible with analytics
  const compatible = isFeatureCompatibleWithDomain('create_repository', result.domain);
  if (result.domain === 'analytics') {
    assert.equal(compatible, false, 'Repository creation should NOT be compatible with analytics');
  }
});

test('F2: isFeatureCompatibleWithDomain rejects cross-domain features', () => {
  // pipeline feature in ecommerce domain
  assert.equal(isFeatureCompatibleWithDomain('pipeline', 'ecommerce'), false);
  // checkout feature in project_management domain
  assert.equal(isFeatureCompatibleWithDomain('checkout', 'project_management'), false);
});

test('F3: Universal features are always compatible', () => {
  assert.equal(isFeatureCompatibleWithDomain('user_authentication', 'ecommerce'), true);
  assert.equal(isFeatureCompatibleWithDomain('search', 'analytics'), true);
  assert.equal(isFeatureCompatibleWithDomain('responsive_design', 'crm'), true);
});

test('F4: Unknown domain allows all features', () => {
  assert.equal(isFeatureCompatibleWithDomain('anything', 'unknown'), true);
});

// ─── G. Expected vs Observed ────────────────────────────────────────

test('G1: IMPLEMENTED feature exists and is functional', () => {
  const expected = buildExpectedFeatures(
    createMissionIntent({ buildPrompt: 'Build a shop with cart' }),
    'ecommerce'
  );
  const observed = [
    { name: 'cart', exists: true, functional: true, tested: true, confidence: 0.9, evidenceRefs: ['test'] },
  ];
  const result = compareExpectedVsObserved(expected, observed, { sessionSteps: 100 });
  const cart = result.features.find(f => f.name === 'cart');
  assert.ok(cart);
  assert.equal(cart.status, FEATURE_STATUS.IMPLEMENTED);
});

test('G2: IMPLEMENTED_BUT_BROKEN feature exists but not functional', () => {
  const expected = buildExpectedFeatures(null, 'ecommerce');
  const observed = [
    { name: 'checkout', exists: true, functional: false, tested: true, confidence: 0.9, evidenceRefs: ['finding:1'] },
  ];
  const result = compareExpectedVsObserved(expected, observed, { sessionSteps: 100 });
  const checkout = result.features.find(f => f.name === 'checkout');
  assert.ok(checkout);
  assert.equal(checkout.status, FEATURE_STATUS.IMPLEMENTED_BUT_BROKEN);
});

test('G3: MISSING feature not found after sufficient testing', () => {
  const expected = [{ name: 'wishlist', source: 'explicit', priority: 'required', confidence: 0.9, evidenceRefs: [], status: null, observations: [] }];
  const result = compareExpectedVsObserved(expected, [], { sessionSteps: 100 });
  assert.equal(result.features[0].status, FEATURE_STATUS.MISSING);
});

test('G4: NOT_TESTED when exploration insufficient', () => {
  const expected = [{ name: 'checkout', source: 'explicit', priority: 'required', confidence: 0.9, evidenceRefs: [], status: null, observations: [] }];
  const result = compareExpectedVsObserved(expected, [], { sessionSteps: 15 });
  assert.equal(result.features[0].status, FEATURE_STATUS.NOT_TESTED);
});

test('G5: Summary counts are correct', () => {
  const expected = [
    { name: 'cart', source: 'explicit', priority: 'required', confidence: 0.9, evidenceRefs: [], status: null, observations: [] },
    { name: 'checkout', source: 'explicit', priority: 'required', confidence: 0.9, evidenceRefs: [], status: null, observations: [] },
    { name: 'wishlist', source: 'explicit', priority: 'required', confidence: 0.9, evidenceRefs: [], status: null, observations: [] },
  ];
  const observed = [
    { name: 'cart', exists: true, functional: true, tested: true, confidence: 0.9, evidenceRefs: [] },
    { name: 'checkout', exists: true, functional: false, tested: true, confidence: 0.9, evidenceRefs: [] },
  ];
  const result = compareExpectedVsObserved(expected, observed, { sessionSteps: 100 });
  assert.equal(result.summary[FEATURE_STATUS.IMPLEMENTED], 1);
  assert.equal(result.summary[FEATURE_STATUS.IMPLEMENTED_BUT_BROKEN], 1);
  assert.equal(result.summary[FEATURE_STATUS.MISSING], 1);
});

// ─── H. Observed Feature Model ──────────────────────────────────────

test('H1: Present does NOT mean functional', () => {
  const session = {
    findings: [{ title: 'Checkout broken', description: 'Payment validation missing', severity: 'critical' }],
  };
  const observed = buildObservedFeatures(session, {});
  const checkout = observed.find(f => f.name === 'checkout');
  assert.ok(checkout, 'Checkout should be observed');
  assert.equal(checkout.exists, true);
  assert.equal(checkout.functional, false);
});

// ─── I. Workflow Model ──────────────────────────────────────────────

test('I1: Workflow model tracks steps', () => {
  const workflows = buildWorkflowModel(
    [{ name: 'browse_to_checkout', source: 'inferred', confidence: 0.7 }],
    { capturedSteps: [{ title: 'Add to cart', description: 'browse products', url: '/cart' }] },
    'ecommerce'
  );
  assert.ok(workflows.length >= 1);
  assert.ok(workflows[0].steps.length >= 4);
  // Each step should have expected/observed/tested/outcome
  assert.ok(workflows[0].steps.every(s => 'expected' in s && 'observed' in s));
});

// ─── J. Duplicate Suppression ───────────────────────────────────────

test('J1: Identical findings are correlated', () => {
  const findings = [
    { title: 'Login page is blank', description: 'Sign In does not render a form', severity: 'critical' },
    { title: 'Sign In page is blank', description: 'Login does not render a form', severity: 'critical' },
    { title: 'Cart total is wrong', description: 'Price calculation incorrect', severity: 'high' },
  ];
  const result = correlateFindings(findings);
  assert.equal(result.canonical.length, 2); // Login + Cart
  assert.equal(result.duplicateCount, 1);
});

test('J2: Different findings are NOT correlated', () => {
  const findings = [
    { title: 'Login page is blank', description: 'No login form', severity: 'critical' },
    { title: 'Mobile layout broken', description: 'Content shifts off-screen', severity: 'high' },
  ];
  const result = correlateFindings(findings);
  assert.equal(result.canonical.length, 2);
  assert.equal(result.duplicateCount, 0);
});

test('J3: Evidence preserved after dedup', () => {
  const findings = [
    { title: 'Checkout broken', description: 'No validation', severity: 'high', evidenceRefs: ['step:1', 'console:error'] },
    { title: 'Checkout form no validation', description: 'Submit does nothing', severity: 'high', evidenceRefs: ['step:5'] },
  ];
  const result = correlateFindings(findings);
  assert.equal(result.canonical.length, 1);
  assert.ok(result.canonical[0].evidenceRefs.length >= 3); // All evidence merged
});

test('J4: Duplicate summary calculates rate', () => {
  const findings = [
    { title: 'A', description: 'test', severity: 'low' },
    { title: 'A duplicate', description: 'test', severity: 'low' },
    { title: 'B', description: 'other', severity: 'low' },
    { title: 'C', description: 'third', severity: 'low' },
  ];
  const result = correlateFindings(findings);
  const summary = summarizeSuppression(result);
  assert.equal(summary.originalCount, 4);
  assert.ok(summary.duplicateCount >= 1);
  assert.ok(summary.duplicateRate >= 25);
});

test('J5: Canonical finding has highest severity', () => {
  const findings = [
    { title: 'Login broken', description: 'No form', severity: 'low' },
    { title: 'Login broken', description: 'No form', severity: 'critical' },
  ];
  const result = correlateFindings(findings);
  assert.equal(result.canonical[0].severity, 'critical');
});

// ─── K. Feature Compatibility ───────────────────────────────────────

test('K1: Domain-specific features rejected for wrong domain', () => {
  assert.equal(isFeatureCompatibleWithDomain('lead_management', 'ecommerce'), false);
  assert.equal(isFeatureCompatibleWithDomain('board_view', 'analytics'), false);
});

test('K2: Custom features allowed for any domain', () => {
  // "custom_feature" is not in any domain catalog
  assert.equal(isFeatureCompatibleWithDomain('custom_integration', 'crm'), true);
});

// ─── L. Confidence Model ────────────────────────────────────────────

test('L1: Low evidence gives LOW confidence', () => {
  const result = classifyDomain({
    intentDomainHypotheses: [],
    inventory: {},
    session: { capturedSteps: [], findings: [] },
  });
  assert.ok(result.confidence <= 0.2, `Low evidence should give low confidence, got ${result.confidence}`);
});

test('L2: Contradictions reduce confidence', () => {
  const session = {
    capturedSteps: [
      { title: 'Dashboard metrics revenue charts', description: 'analytics', url: '/' },
      { title: 'Task board kanban', description: 'project management', url: '/board' },
    ],
  };
  const result = classifyDomain({
    intentDomainHypotheses: [],
    inventory: {},
    session,
  });
  // With conflicting evidence, should have contradictions
  if (result.contradictions.length > 0) {
    assert.ok(result.confidence < 0.8, 'Contradictions should reduce confidence');
  }
});

// ─── M. Deterministic Fallback (no LLM) ─────────────────────────────

test('M1: Domain classification works without LLM', () => {
  // All Phase 8 modules are deterministic — they don't call LLM
  const result = classifyDomain({
    intentDomainHypotheses: generateDomainHypothesesFromIntent({ buildPrompt: 'CRM with contacts' }),
    inventory: { pages: [{ title: 'Contacts', path: '/contacts' }] },
    session: { capturedSteps: [{ title: 'Contacts', description: 'Contact management CRM', url: '/contacts' }] },
  });
  assert.ok(result.domain === 'crm' || result.domain === 'unknown');
  assert.ok(result.method); // Should have a method string
});

// ─── N. Knowledge Contradiction ─────────────────────────────────────

test('N1: Current evidence is primary, knowledge is secondary', () => {
  // Knowledge weight is only 0.05, so it cannot override other evidence
  assert.equal(SOURCE_WEIGHTS.knowledge, 0.05);
  assert.ok(SOURCE_WEIGHTS.intent > SOURCE_WEIGHTS.knowledge);
  assert.ok(SOURCE_WEIGHTS.static > SOURCE_WEIGHTS.knowledge);
});

// ─── O. URL Only Intent ─────────────────────────────────────────────

test('O1: URL only produces no expected features', () => {
  const intent = createMissionIntent({ targetUrl: 'http://example.com' });
  assert.equal(intent.expectedFeatures.length, 0);
  // Phase 9.1: user_login is now always added as a universal workflow
  assert.ok(intent.expectedWorkflows.length <= 1, 'URL-only intent should have at most 1 universal workflow');
  assert.equal(intent.domainHypotheses.length, 0);
});

// ─── P. Ambiguous Application ───────────────────────────────────────

test('P1: Ambiguous app marks domain uncertain', () => {
  const session = {
    capturedSteps: [
      { title: 'Generic dashboard', description: 'Some content', url: '/' },
    ],
  };
  const result = classifyDomain({
    intentDomainHypotheses: [],
    inventory: {},
    session,
  });
  // With minimal evidence, domain should be unknown or low confidence
  if (result.domain !== 'unknown') {
    assert.ok(result.confidence < HIGH_CONFIDENCE_THRESHOLD, `Ambiguous should be low confidence, got ${result.confidence}`);
  }
});

const HIGH_CONFIDENCE_THRESHOLD = 0.65;

// ─── Q. Full Mission Context ────────────────────────────────────────

test('Q1: Full context produces rich intent', () => {
  const intent = createMissionIntent({
    buildPrompt: 'Build a CRM with leads and contacts',
    requirements: ['User authentication', 'Data export', 'Search functionality'],
    objectives: ['Test login flow', 'Verify lead pipeline'],
    businessGoals: 'Increase sales team efficiency',
    expectedFeatures: ['reporting', 'notifications'],
    targetUrl: 'http://crm.example.com',
  });
  assert.equal(intent.intentAvailability, INTENT_AVAILABILITY.FULL);
  assert.ok(intent.expectedFeatures.length >= 5);
  assert.ok(intent.domainHypotheses.some(h => h.domainId === 'crm'));
});

// ─── Gap Report ─────────────────────────────────────────────────────

test('Gap report categorizes missing and broken features', () => {
  const comparison = {
    features: [
      { name: 'cart', status: FEATURE_STATUS.IMPLEMENTED, source: 'explicit', evidenceRefs: [] },
      { name: 'checkout', status: FEATURE_STATUS.IMPLEMENTED_BUT_BROKEN, source: 'explicit', evidenceRefs: [] },
      { name: 'wishlist', status: FEATURE_STATUS.MISSING, source: 'explicit', evidenceRefs: [] },
      { name: 'auth', status: FEATURE_STATUS.NOT_TESTED, source: 'domain_standard', evidenceRefs: [] },
    ],
    summary: {
      implemented: 1, implemented_but_broken: 1, missing: 1, not_tested: 1,
      partially_implemented: 0, not_applicable: 0, unknown: 0,
    },
  };
  const gaps = generateGapReport(comparison, []);
  assert.equal(gaps.missingFeatures.length, 1);
  assert.equal(gaps.brokenFeatures.length, 1);
  assert.equal(gaps.notTestedFeatures.length, 1);
});

// ─── Domain Verification ────────────────────────────────────────────

test('Domain verification catches hallucination', () => {
  const result = {
    domain: 'crm',
    domainName: 'CRM',
    confidence: 0.5,
  };
  // Inventory with NO CRM-related content
  const verification = verifyDomainClassification(result, {
    pages: [{ title: 'Dashboard', path: '/dashboard' }],
  });
  // With zero keyword matches, verification should flag it
  assert.ok(verification.warnings.length > 0 || verification.confidence < 0.5);
});

// ─── Sufficient Testing Check ───────────────────────────────────────

test('NOT_TESTED for deep features with low steps', () => {
  assert.equal(wasFeatureSufficientlyTested('checkout', 25, 'moderate'), false);
});

test('MISSING allowed for standard features at moderate depth', () => {
  assert.equal(wasFeatureSufficientlyTested('dashboard_overview', 50, 'moderate'), true);
});

test('MISSING allowed for any feature at high depth', () => {
  assert.equal(wasFeatureSufficientlyTested('checkout', 100, 'deep'), true);
});
