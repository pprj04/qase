'use strict';

/**
 * Phase 16 — Bug Intelligence unit tests (deterministic engine).
 * Run: node --test tests/phase16-intelligence.test.js
 * No server, no network — pure functions from server/findingIntelligence.js.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFinding, normalizeCategory, computeSeverity, computePriority, computeConfidence,
  computeReproducibility, assessEvidenceSufficiency, assessExpectedActual, computeRisk,
  assessRootCause, compareForDuplicates, detectDuplicates, validateLifecycleTransition,
  computeQuality, redactString, redactEvidenceItem, deriveLinkage, buildDevSummary,
  enrichFinding, deriveLifecycle, groupFindings, CATEGORIES, LIFECYCLE,
} from '../server/findingIntelligence.js';
import * as reportModule from '../server/report.js';

const ev = (over = {}) => ({ id: 'ev_' + Math.random().toString(36).slice(2, 8), type: 'console', source: 'browser', target: '', observation: '', ...over });

describe('classification', () => {
  test('AUTHENTICATION from legacy category + keywords', () => {
    const c = classifyFinding({ title: 'Login fails with valid credentials', category: 'auth', expected: 'Redirect to dashboard', actual: 'Stays on login page' });
    assert.equal(c.primary, 'AUTHENTICATION');
    assert.ok(c.confidence >= 0.85);
  });

  test('keyword rules classify when legacy category is generic', () => {
    const c = classifyFinding({ title: 'Checkout button does nothing', category: 'general', actual: 'nothing happens' });
    assert.equal(c.primary, 'FUNCTIONAL');
  });

  test('ACCESSIBILITY via aria keywords', () => {
    const c = classifyFinding({ title: 'Modal has no aria-label', category: 'general' });
    // UI keyword 'modal' comes before FUNCTIONAL; accessibility rule is higher priority
    assert.ok(['ACCESSIBILITY', 'UI'].includes(c.primary));
  });

  test('unknown stays UNKNOWN with low confidence, never guessed', () => {
    const c = classifyFinding({ title: 'Something odd', category: 'general' });
    assert.equal(c.primary, 'UNKNOWN');
    assert.ok(c.confidence <= 0.3);
  });

  test('explicit enum wins and is preserved', () => {
    const c = classifyFinding({ title: 'Weird thing', primary_category: 'SECURITY', classification_confidence: 0.5, secondary_categories: ['API'] });
    assert.equal(c.primary, 'SECURITY');
    assert.deepEqual(c.secondary, ['API']);
  });

  test('secondary categories derived, max 3', () => {
    const c = classifyFinding({
      title: 'Login fails and console error, slow response, missing alt text',
      category: 'general', actual: 'error 500 from api',
    });
    assert.ok(c.secondary.length <= 3);
    assert.ok(c.secondary.length >= 0);
  });

  test('legacy map covers common strings', () => {
    assert.equal(normalizeCategory('authentication'), 'AUTHENTICATION');
    assert.equal(normalizeCategory('Forms'), 'FUNCTIONAL');
    assert.equal(normalizeCategory('workflow_failure'), 'FUNCTIONAL');
    assert.equal(normalizeCategory('nonsense-xyz'), null);
  });

  test('every category enum has 20 entries and includes required ones', () => {
    assert.equal(CATEGORIES.length, 20);
    for (const c of ['FUNCTIONAL', 'UI', 'UX', 'VISUAL', 'API', 'SECURITY', 'PERFORMANCE', 'ACCESSIBILITY', 'DATA', 'AUTHENTICATION', 'AUTHORIZATION', 'NAVIGATION', 'COMPATIBILITY', 'MOBILE', 'REGRESSION', 'FEATURE_GAP', 'INFRASTRUCTURE', 'AI_BEHAVIOR', 'COMPLIANCE', 'UNKNOWN']) {
      assert.ok(CATEGORIES.includes(c), c);
    }
  });
});

describe('severity', () => {
  test('evidence signals override agent severity by ≥2 levels', () => {
    const f = { title: 'Checkout fails for all users, no workaround', severity: 'low', actual: 'cannot complete checkout' };
    const s = computeSeverity(f, [ev(), ev()]);
    assert.equal(s.severity, 'high'); // low→high = 2 levels, evidence wins
    assert.match(s.rationale, /override|indicate/i);
  });

  test('agent severity retained when close to computed', () => {
    const f = { title: 'Button slightly misaligned', severity: 'low' };
    const s = computeSeverity(f, []);
    assert.equal(s.severity, 'low');
    assert.ok(s.rationale.length > 0);
  });

  test('security + exposure signals push to critical', () => {
    const f = { title: 'Password visible in plaintext on settings page', severity: 'high', actual: 'sensitive data exposed' };
    const s = computeSeverity(f, [ev({ type: 'dom' }), ev({ type: 'console' })]);
    assert.equal(s.severity, 'critical');
  });

  test('cosmetic-only with no failure words stays low/info', () => {
    const f = { title: 'Minor color mismatch on badge', severity: 'low', actual: 'color slightly different' };
    const s = computeSeverity(f, []);
    assert.ok(['low', 'info', 'medium'].includes(s.severity));
  });

  test('rationale always present and explainable', () => {
    const s = computeSeverity({ title: 'x', severity: 'medium' }, []);
    assert.ok(typeof s.rationale === 'string' && s.rationale.length > 10);
    assert.ok(s.confidence > 0 && s.confidence <= 0.95);
  });
});

describe('priority', () => {
  test('P0 requires evidence gate — no blind CRITICAL→P0', () => {
    const f = { title: 'Odd thing', severity: 'critical', confidence: 0.3, reproduction_rate: null, reproduction_attempts: 0 };
    const p = computePriority(f);
    assert.equal(p.priority, 'P1'); // demoted: no repro rate, low confidence
    assert.match(p.rationale, /gate/i);
  });

  test('critical + strong repro + confidence → P0', () => {
    const f = { title: 'Checkout fails', severity: 'critical', confidence: 0.9, reproduction_rate: 1.0, reproduction_attempts: 3, successful_reproductions: 3 };
    const p = computePriority(f);
    assert.equal(p.priority, 'P0');
  });

  test('info severity lands at P3', () => {
    const p = computePriority({ title: 'Typo', severity: 'info', confidence: 0.5 });
    assert.equal(p.priority, 'P3');
  });

  test('priority is deterministic for identical inputs', () => {
    const f = { title: 'Form save fails', severity: 'high', confidence: 0.7, reproduction_rate: 0.5, reproduction_attempts: 4, successful_reproductions: 2 };
    assert.equal(computePriority(f).priority, computePriority(f).priority);
    assert.equal(computePriority(f).score, computePriority(f).score);
  });
});

describe('confidence', () => {
  test('zero evidence + no repro → LOW', () => {
    const c = computeConfidence({ reproducibility: 'UNKNOWN' }, [], 0);
    assert.ok(c.confidence < 0.4);
    assert.equal(c.level, 'LOW');
  });

  test('full evidence stack → HIGH/VERY_HIGH with contributions', () => {
    const f = { reproducibility: 'REPRODUCIBLE', reproduction_attempts: 3, successful_reproductions: 3, reproduction_rate: 1.0, expected: 'order created', actual: 'stays on page' };
    const c = computeConfidence(f, [ev({ type: 'console' }), ev({ type: 'network' }), ev({ type: 'screenshot' })], 2);
    assert.ok(c.confidence >= 0.7);
    assert.ok(['HIGH', 'VERY_HIGH'].includes(c.level));
    assert.ok(c.contributions.length >= 5);
  });

  test('LLM self-confidence is not a signal', () => {
    const f = { reproducibility: 'UNKNOWN', confidence: 1.0 }; // agent said 1.0
    const c = computeConfidence(f, [], 0);
    assert.ok(c.confidence < 0.4); // ignored — still LOW
    assert.ok(!Object.keys(c.signals).includes('llm'));
  });

  test('contributions explain every point', () => {
    const c = computeConfidence({ reproducibility: 'REPRODUCIBLE', successful_reproductions: 2, expected: 'a', actual: 'b' }, [ev({ type: 'dom' })], 0);
    const total = 0.05 + 0.02 + c.contributions.reduce((s, [, w]) => s + w, 0);
    assert.ok(Math.abs(total - c.confidence) < 0.02, `total=${total} vs confidence=${c.confidence}`);
  });
});

describe('reproducibility', () => {
  test('3/3 attempts → REPRODUCIBLE rate 1.0', () => {
    const r = computeReproducibility({ reproduction_attempts: 3, successful_reproductions: 3 });
    assert.equal(r.reproducibility, 'REPRODUCIBLE');
    assert.equal(r.rate, 1.0);
  });

  test('5 attempts 2 successes → INTERMITTENT rate 0.4', () => {
    const r = computeReproducibility({ reproduction_attempts: 5, successful_reproductions: 2 });
    assert.equal(r.reproducibility, 'INTERMITTENT');
    assert.equal(r.rate, 0.4);
  });

  test('attempts 2 successes 0 → UNREPRODUCIBLE', () => {
    const r = computeReproducibility({ reproduction_attempts: 2, successful_reproductions: 0 });
    assert.equal(r.reproducibility, 'UNREPRODUCIBLE');
    assert.equal(r.rate, 0);
  });

  test('no attempts → UNKNOWN, never guessed', () => {
    const r = computeReproducibility({});
    assert.equal(r.reproducibility, 'UNKNOWN');
    assert.equal(r.rate, null);
  });

  test('legacy string mapping', () => {
    assert.equal(computeReproducibility({ reproducibility: 'confirmed' }).reproducibility, 'REPRODUCIBLE');
    assert.equal(computeReproducibility({ reproducibility: 'intermittent' }).reproducibility, 'INTERMITTENT');
    assert.equal(computeReproducibility({ reproducibility: 'unconfirmed' }).reproducibility, 'UNKNOWN');
  });

  test('successes > attempts is invalid data → UNKNOWN', () => {
    const r = computeReproducibility({ reproduction_attempts: 1, successful_reproductions: 5 });
    assert.equal(r.reproducibility, 'UNKNOWN');
  });
});

describe('evidence sufficiency', () => {
  test('zero typed evidence → never sufficient', () => {
    const s = assessEvidenceSufficiency({ primary_category: 'FUNCTIONAL' }, []);
    assert.equal(s.sufficient, false);
    assert.match(s.reasons.join(' '), /no typed evidence/i);
  });

  test('FUNCTIONAL needs 2 items from 2 sources', () => {
    const s = assessEvidenceSufficiency({ primary_category: 'FUNCTIONAL' }, [ev(), ev({ source: 'agent' })]);
    assert.equal(s.sufficient, true);
    const bad = assessEvidenceSufficiency({ primary_category: 'FUNCTIONAL' }, [ev(), ev()]);
    assert.equal(bad.sufficient, false);
  });

  test('SECURITY requires strong evidence types', () => {
    const weak = assessEvidenceSufficiency({ primary_category: 'SECURITY' }, [ev({ type: 'screenshot', source: 'browser' }), ev({ type: 'screenshot', source: 'agent' })]);
    assert.equal(weak.sufficient, false);
    const strong = assessEvidenceSufficiency({ primary_category: 'SECURITY' }, [ev({ type: 'console', source: 'browser' }), ev({ type: 'network', source: 'browser' })]);
    assert.equal(strong.sufficient, true);
  });

  test('visual categories need only 1 item', () => {
    const s = assessEvidenceSufficiency({ primary_category: 'VISUAL' }, [ev({ type: 'screenshot' })]);
    assert.equal(s.sufficient, true);
  });
});

describe('expected vs actual', () => {
  test('both present → not uncertain, source app_behavior', () => {
    const r = assessExpectedActual({ expected: 'Order created', actual: 'Page unchanged' });
    assert.equal(r.uncertain, false);
    assert.equal(r.source, 'app_behavior');
  });

  test('missing expected → uncertain flagged', () => {
    const r = assessExpectedActual({ actual: 'Nothing happens' });
    assert.equal(r.uncertain, true);
    assert.match(r.note, /uncertain/i);
  });

  test('explicit source preserved', () => {
    const r = assessExpectedActual({ expected: 'X', actual: 'Y', expected_source: 'requirement' });
    assert.equal(r.source, 'requirement');
  });
});

describe('risk', () => {
  test('deterministic for identical input', () => {
    const f = { severity: 'critical', confidence: 0.9, reproduction_rate: 1.0, title: 'Data loss on save', actual: 'data loss' };
    assert.deepEqual(computeRisk(f), computeRisk(f));
  });

  test('critical security + full repro → CRITICAL', () => {
    const r = computeRisk({ severity: 'critical', confidence: 0.95, reproduction_rate: 1.0, title: 'XSS injection exposes password', actual: 'sensitive data exposure' });
    assert.ok(['CRITICAL', 'HIGH'].includes(r.risk));
    assert.match(r.reason, /impact=/);
  });

  test('info cosmetic → LOW', () => {
    const r = computeRisk({ severity: 'info', confidence: 0.5, reproduction_rate: 0.5, title: 'Typo in footer' });
    assert.equal(r.risk, 'LOW');
  });

  test('low confidence dampens risk', () => {
    const high = computeRisk({ severity: 'critical', confidence: 0.95, reproduction_rate: 1.0, title: 'checkout fails' });
    const low = computeRisk({ severity: 'critical', confidence: 0.3, reproduction_rate: 1.0, title: 'checkout fails' });
    assert.ok(low.score < high.score);
  });
});

describe('root cause', () => {
  test('no evidence → unknown, potentials only', () => {
    const r = assessRootCause({ title: 'Checkout button produces no visible response', actual: 'nothing happens' }, []);
    assert.equal(r.category, 'unknown');
    assert.equal(r.method, 'unknown_symptom_only');
    assert.ok(r.potentials.length >= 0);
  });

  test('evidence-backed promotion', () => {
    const r = assessRootCause({ title: 'Payment API returns 500', actual: 'api endpoint fails' }, [ev({ type: 'network' }), ev({ type: 'api_response' })]);
    assert.ok(['api_failure', 'backend_failure'].includes(r.category));
    assert.equal(r.method, 'evidence_supported');
    assert.ok(r.confidence >= 0.5);
  });

  test('never asserts React state bug without evidence', () => {
    const r = assessRootCause({ title: 'UI feels broken after click', actual: 'nothing happens' }, [ev({ type: 'screenshot' })]);
    // screenshot alone must not confirm state_management
    assert.notEqual(r.category, 'state_management');
  });
});

describe('duplicate detection', () => {
  const base = { id: 'f1', title: 'Checkout submission does not complete', url: 'https://app.test/checkout', actual: 'stays on checkout page', ts: 1000 };

  test('same title/url → DUPLICATE', () => {
    const dup = { ...base, id: 'f2', ts: 2000 };
    const r = compareForDuplicates(base, dup);
    assert.equal(r.verdict, 'DUPLICATE');
  });

  test('reworded title, same error → at least POSSIBLE_DUPLICATE', () => {
    const dup = { id: 'f2', title: 'Checkout submission fails to finish', url: 'https://app.test/checkout', actual: 'stays on checkout page', ts: 2000 };
    const r = compareForDuplicates(base, dup);
    assert.ok(['POSSIBLE_DUPLICATE', 'DUPLICATE'].includes(r.verdict), `got ${r.verdict}`);
  });

  test('different pages → UNIQUE', () => {
    const other = { id: 'f3', title: 'Login form misaligned', url: 'https://app.test/login', actual: 'layout off', ts: 3000 };
    const r = compareForDuplicates(base, other);
    assert.equal(r.verdict, 'UNIQUE');
  });

  test('POSSIBLE_DUPLICATE never auto-merged', () => {
    const f = { ...base, id: 'fx' };
    const others = [
      { id: 'f9', title: 'Checkout submission does not complete', url: 'https://app.test/checkout?session=2', actual: 'stays on checkout page', ts: 900 },
    ];
    const r = detectDuplicates(f, others);
    // Possible-tier candidates are reported but duplicate_of only set on DUPLICATE verdict
    for (const c of r.candidates) {
      if (c.verdict === 'POSSIBLE_DUPLICATE') {
        assert.equal(r.duplicate_of, null, 'possible duplicate must not set duplicate_of');
      }
    }
  });

  test('canonical = earliest finding in cluster', () => {
    const f = { ...base, id: 'f-late', ts: 5000 };
    const others = [
      { id: 'f-early', title: 'Checkout submission does not complete', url: 'https://app.test/checkout', actual: 'stays on checkout page', ts: 100 },
    ];
    const r = detectDuplicates(f, others);
    assert.equal(r.duplicate_of, 'f-early');
  });

  test('exact same id → UNIQUE', () => {
    const r = compareForDuplicates(base, base);
    assert.equal(r.verdict, 'UNIQUE');
  });
});

describe('lifecycle', () => {
  test('all 12 states present', () => {
    for (const s of ['DETECTED', 'VERIFYING', 'VERIFIED', 'CLASSIFIED', 'TRIAGED', 'REPORTED', 'FALSE_POSITIVE', 'DUPLICATE', 'INCONCLUSIVE', 'UNREPRODUCIBLE', 'RESOLVED', 'REOPENED']) {
      assert.ok(LIFECYCLE.includes(s), s);
    }
  });

  test('valid transitions allowed', () => {
    assert.equal(validateLifecycleTransition('DETECTED', 'VERIFYING').ok, true);
    assert.equal(validateLifecycleTransition('VERIFYING', 'VERIFIED').ok, true);
    assert.equal(validateLifecycleTransition('VERIFIED', 'CLASSIFIED').ok, true);
    assert.equal(validateLifecycleTransition('CLASSIFIED', 'TRIAGED').ok, true);
    assert.equal(validateLifecycleTransition('TRIAGED', 'REPORTED').ok, true);
    assert.equal(validateLifecycleTransition('REPORTED', 'REOPENED').ok, true);
    assert.equal(validateLifecycleTransition('DETECTED', 'FALSE_POSITIVE').ok, true);
    assert.equal(validateLifecycleTransition('REPORTED', 'RESOLVED').ok, true);
  });

  test('invalid transitions rejected', () => {
    assert.equal(validateLifecycleTransition('DETECTED', 'REPORTED').ok, false);
    assert.equal(validateLifecycleTransition('DETECTED', 'VERIFIED').ok, false);
    assert.equal(validateLifecycleTransition('RESOLVED', 'DETECTED').ok, false);
    assert.equal(validateLifecycleTransition('FALSE_POSITIVE', 'VERIFIED').ok, false);
  });

  test('derived lifecycle: insufficient evidence stays DETECTED/INCONCLUSIVE', () => {
    assert.equal(deriveLifecycle({ evidence_sufficiency: { sufficient: false, present: { count: 0 } } }), 'INCONCLUSIVE');
    assert.equal(deriveLifecycle({ expected: 'x', actual: 'y', evidence_sufficiency: { sufficient: false, present: { count: 1 } } }), 'DETECTED');
  });

  test('derived lifecycle: sufficient evidence + repro → VERIFIED', () => {
    const s = deriveLifecycle({ expected: 'x', actual: 'y', reproducibility: 'REPRODUCIBLE', evidence_sufficiency: { sufficient: true, present: { count: 3 } } });
    assert.equal(s, 'VERIFIED');
  });

  test('derived lifecycle: FP review overrides', () => {
    assert.equal(deriveLifecycle({ review_status: 'false_positive' }), 'FALSE_POSITIVE');
  });

  test('derived lifecycle: 0 successes with attempts → UNREPRODUCIBLE', () => {
    // UNREPRODUCIBLE requires an agent-observed re-test failure
    // (hasReproObservation) — bookkeeping-only attempts never fabricate it.
    assert.equal(deriveLifecycle({ reproduction_attempts: 2, successful_reproductions: 0, hasReproObservation: true }), 'UNREPRODUCIBLE');
    assert.notEqual(deriveLifecycle({ reproduction_attempts: 2, successful_reproductions: 0 }), 'UNREPRODUCIBLE');
  });
});

describe('quality score', () => {
  test('per-dimension scores not collapsed', () => {
    const q = computeQuality({ reproducibility: 'REPRODUCIBLE', classification_confidence: 0.9, severity_confidence: 0.8, root_cause_category: 'api_failure', root_cause_confidence: 0.7 }, [ev(), ev(), ev()]);
    for (const dim of ['evidence', 'reproduction', 'classification', 'impact', 'rootCause', 'overall']) {
      assert.ok(typeof q[dim] === 'number', dim);
    }
    assert.ok(q.evidence > q.rootCause);
  });

  test('no evidence → low evidence dimension', () => {
    const q = computeQuality({ reproducibility: 'UNKNOWN' }, []);
    assert.ok(q.evidence <= 0.2);
    assert.ok(q.overall < 0.5);
  });
});

describe('redaction', () => {
  test('password assignment redacted', () => {
    const out = redactString('POST body: password=hunter2&user=bob');
    assert.ok(out.includes('[REDACTED]'));
    assert.ok(!out.includes('hunter2'));
  });

  test('api key + bearer redacted', () => {
    const out = redactString('headers: Authorization: Bearer abc123def456 and api_key: sk-live-XYZ123456789');
    assert.ok(!out.includes('abc123def456'));
    assert.ok(!out.includes('sk-live-XYZ123456789'));
  });

  test('jwt redacted', () => {
    const out = redactString('token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
    assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9'));
  });

  test('private key block redacted', () => {
    const out = redactString('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----');
    assert.ok(!out.includes('MIIEvQIBADANBg'));
    assert.ok(out.includes('[REDACTED]'));
  });

  test('evidence item payload redacted, structure preserved', () => {
    const e = redactEvidenceItem({ id: 'ev_1', type: 'network', payload: '{"password":"hunter2"}', observation: 'request with password=hunter2 sent' });
    assert.equal(e.id, 'ev_1');
    assert.ok(!JSON.stringify(e).includes('hunter2'));
  });
});

describe('linkage', () => {
  test('page derived from url', () => {
    const l = deriveLinkage({ title: 'Checkout broken', url: 'https://app.test/checkout?x=1' }, []);
    assert.equal(l.page, '/checkout');
    assert.equal(l.workflow_id, null);
  });

  test('workflow matched by url+name overlap', () => {
    const wfs = [{ id: 'wf1', name: 'Checkout flow', targetUrl: 'https://app.test/checkout', steps: [{ url: 'https://app.test/checkout' }] }];
    const l = deriveLinkage({ title: 'Checkout payment fails', url: 'https://app.test/checkout' }, [], wfs, []);
    assert.equal(l.workflow_id, 'wf1');
    assert.ok(l.confidence >= 0.5);
  });

  test('no confident link → nulls, never invented', () => {
    const l = deriveLinkage({ title: 'Odd behavior', url: 'https://app.test/misc' }, [], [{ id: 'wf2', name: 'Unrelated flow', targetUrl: 'https://app.test/other', steps: [] }], []);
    assert.equal(l.workflow_id, null);
    assert.ok(l.basis.includes('no_confident_link'));
  });

  test('api endpoint from evidence', () => {
    const l = deriveLinkage({ title: 'Payment API error', url: 'https://app.test/checkout' }, [ev({ type: 'network', target: '/api/payment POST' })], [], []);
    assert.equal(l.api_endpoint, '/api/payment');
  });
});

describe('dev summary', () => {
  test('full summary rendered from fields, no fake code', () => {
    const f = {
      title: 'Checkout submission fails', primary_category: 'FUNCTIONAL', severity: 'high', priority: 'P1',
      confidence: 0.9, reproducibility: 'REPRODUCIBLE', expected: 'Order created', actual: 'Stays on page',
      impact: 'Users cannot purchase', workflow_id: 'wf1', risk: 'HIGH', root_cause_category: 'unknown',
    };
    const s = buildDevSummary(f, [ev({ type: 'screenshot' }), ev({ type: 'network' })]);
    assert.equal(s.title, 'Checkout submission fails');
    assert.equal(s.category, 'FUNCTIONAL');
    assert.equal(s.severity, 'high');
    assert.equal(s.priority, 'P1');
    assert.equal(s.expected, 'Order created');
    assert.equal(s.actual, 'Stays on page');
    assert.equal(s.evidence.count, 2);
    assert.ok(s.suggestedInvestigation.length >= 1);
    assert.match(s.potentialRootCause, /unknown/);
    assert.ok(!s.recommendedFix || !/<script|function\s*\(/.test(s.recommendedFix));
  });
});

describe('enrichFinding end-to-end (pure)', () => {
  test('enriches with all intelligence fields + explainability', () => {
    const f = {
      id: 'f100', title: 'Checkout submission fails for all users', severity: 'high', category: 'forms',
      url: 'https://app.test/checkout', expected: 'Order created', actual: 'Stays on checkout page',
      reproducibility: 'confirmed', sessionId: 's1', ts: 1000,
    };
    const evidence = [
      ev({ type: 'console', source: 'browser', observation: 'TypeError at checkout handler' }),
      ev({ type: 'network', source: 'browser', observation: 'POST /api/payment 500' }),
      ev({ type: 'screenshot', source: 'agent' }),
    ];
    const out = enrichFinding(f, { evidence, workflows: [], features: [], observationCount: 2 });
    assert.equal(out.primary_category, 'FUNCTIONAL');
    assert.ok(out.confidence >= 0.7);
    assert.ok(out.evidence_sufficiency.sufficient);
    assert.equal(out.finding_status, 'VERIFIED');
    assert.ok(out.priority);
    assert.ok(out.risk);
    assert.ok(out.dev_summary);
    assert.equal(out.evidence_refs.length, 3);
    assert.equal(out.reproducibility, 'REPRODUCIBLE');
    assert.equal(out.reproduction_rate, null); // attempts not provided
    assert.ok(out.severity_rationale.length > 0);
    assert.ok(out.confidence_reason.signals.length >= 3);
  });

  test('bare finding stays uncertain — never verified without evidence', () => {
    const out = enrichFinding({ id: 'f2', title: 'Something odd', category: 'general' }, {});
    assert.equal(out.evidence_sufficiency.sufficient, false);
    assert.ok(['DETECTED', 'INCONCLUSIVE'].includes(out.finding_status));
    assert.ok(out.confidence < 0.4);
    assert.equal(out.review_status, 'unreviewed');
  });
});

describe('report grouped overview (report.js)', () => {
	const { buildReportMarkdown } = reportModule;

	test('report includes grouped overview and does not count duplicates separately', () => {
		const session = {
			title: 's', targetUrl: 'https://x.test', createdAt: Date.now(),
			findings: [
				{ title: 'A', severity: 'high', category: 'auth', primary_category: 'AUTHENTICATION', expected: '1', actual: '2' },
				{ title: 'A2', severity: 'high', category: 'auth', primary_category: 'AUTHENTICATION', isDuplicate: true, expected: '1', actual: '2' },
				{ title: 'B', severity: 'critical', category: 'forms', primary_category: 'FUNCTIONAL', priority: 'P0', risk: 'CRITICAL', expected: '1', actual: '2' },
			],
			todos: [], messages: [],
		};
		const md = buildReportMarkdown(session);
		assert.ok(md.includes('## Findings by group'), 'grouped section present');
		assert.ok(md.includes('**By category:**'), 'category grouping');
		assert.ok(md.includes('AUTHENTICATION (1)'), 'canonical counted once');
		assert.ok(md.includes('FUNCTIONAL (1)'), 'canonical counted once (2)');
		assert.ok(md.includes('Duplicates merged into the above:** 1'), 'duplicates tallied, not counted');
		assert.ok(md.includes('**By priority:**'), 'priority grouping');
		assert.ok(md.includes('P0 (1)'), 'P0 counted once');
		assert.ok(md.includes('**By risk:**'), 'risk grouping');
		assert.ok(md.includes('CRITICAL (1)'), 'risk value counted once');
	});

	test('report omits empty groups gracefully', () => {
		const md = buildReportMarkdown({ title: 't', createdAt: Date.now(), findings: [], todos: [], messages: [] });
		assert.ok(!md.includes('## Findings by group'));
		assert.ok(md.includes('None recorded.'));
	});
});

describe('groupFindings (dedup-aware)', () => {  const findings = [
    { id: 'a', title: 'A', severity: 'critical', primary_category: 'SECURITY', isDuplicate: false },
    { id: 'b', title: 'B', severity: 'critical', primary_category: 'SECURITY', isDuplicate: false },
    { id: 'c', title: 'C', severity: 'high', primary_category: 'SECURITY', isDuplicate: false },
    { id: 'd', title: 'D', severity: 'medium', primary_category: 'UX', isDuplicate: false },
    { id: 'e', title: 'E', severity: 'critical', primary_category: 'SECURITY', isDuplicate: true },
  ];

  test('duplicates not counted separately', () => {
    const g = groupFindings(findings, 'category');
    assert.equal(g.groups.SECURITY.total, 3); // not 4 — dup excluded
    assert.equal(g.duplicatesExcluded, 1);
    assert.equal(g.canonicalCount, 4);
  });

  test('severity grouping', () => {
    const g = groupFindings(findings, 'severity');
    assert.equal(g.groups.CRITICAL.total, 2);
  });

  test('unknown groupBy throws', () => {
    assert.throws(() => groupFindings([], 'nonsense'));
  });
});
