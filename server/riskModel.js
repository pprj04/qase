/**
 * Risk Model — Explainable risk assessment for autonomous test planning.
 *
 * Every risk is traceable to evidence. No arbitrary math — each risk
 * has a level (HIGH/MEDIUM/LOW) and concrete reasons.
 *
 * This is NOT a scoring engine. It's an evidence-to-risk mapping that
 * produces explainable, prioritized guidance for the agent.
 *
 * Security: all inputs are treated as data, never executed.
 */

import { PURPOSE_CATALOG } from './featureGap.js';

/**
 * Risk level constants.
 */
export const RISK_LEVELS = {
	HIGH: 'HIGH',
	MEDIUM: 'MEDIUM',
	LOW: 'LOW',
};

/**
 * Maps purpose catalog severity to risk level.
 */
function severityToRisk(severity) {
	switch (severity) {
		case 'critical': return RISK_LEVELS.HIGH;
		case 'high': return RISK_LEVELS.HIGH;
		case 'medium': return RISK_LEVELS.MEDIUM;
		case 'low': return RISK_LEVELS.LOW;
		default: return RISK_LEVELS.MEDIUM;
	}
}

/**
 * Builds an explainable risk assessment from available evidence.
 *
 * Inputs (all optional — works with whatever is available):
 *   - purpose: { id, name, source, confidence }
 *   - expectedFeatures: [{ name, severity, category }]
 *   - authDetected: boolean
 *   - hasCredentials: boolean
 *   - knowledgePatterns: [{ pattern, type, confidence, occurrences }]
 *   - currentFindings: [{ severity, category }]
 *   - buildPrompt: string
 *   - requirements: string[]
 *
 * @param {Object} input
 * @returns {{ risks: Array, summary: string }}
 */
export function assessRisk(input = {}) {
	const {
		purpose = null,
		expectedFeatures = [],
		authDetected = false,
		hasCredentials = false,
		knowledgePatterns = [],
		currentFindings = [],
		buildPrompt = '',
		requirements = [],
	} = input;

	const risks = [];
	const evidenceList = [];

	// ── 1. Authentication risk ──
	if (authDetected) {
		const reasons = ['Authentication flow detected in the application'];
		if (!hasCredentials) {
			reasons.push('No test credentials provided — auth flow cannot be fully verified');
		}
		// Check historical knowledge for auth issues
		const authPatterns = knowledgePatterns.filter(p =>
			p.type === 'auth_flow' || (p.pattern && /login|auth|sign.?in|password/i.test(p.pattern))
		);
		if (authPatterns.length > 0) {
			const totalOcc = authPatterns.reduce((s, p) => s + (p.occurrences || 1), 0);
			reasons.push(`${authPatterns.length} historical auth-related pattern(s) with ${totalOcc} total occurrence(s) from previous missions`);
		}
		// Check current findings for auth issues
		const authFindings = currentFindings.filter(f =>
			f.category === 'auth' || (f.title && /login|auth|sign.?in|password/i.test(f.title))
		);
		if (authFindings.length > 0) {
			reasons.push(`${authFindings.length} authentication finding(s) in current mission`);
		}

		risks.push({
			area: 'Authentication',
			level: RISK_LEVELS.HIGH,
			reasons,
			testGuidance: 'Test login with valid/invalid/empty credentials. Check session handling and logout.',
		});
		evidenceList.push({ area: 'Authentication', source: authDetected ? 'observed' : 'inferred', detail: 'Auth flow detected' });
	}

	// ── 2. Purpose-driven feature risks ──
	if (purpose && purpose.id) {
		const catalogEntry = PURPOSE_CATALOG.find(p => p.id === purpose.id);
		if (catalogEntry && catalogEntry.expectedFeatures) {
			for (const feat of catalogEntry.expectedFeatures) {
				const risk = severityToRisk(feat.severity);
				// Only report HIGH and MEDIUM risks (LOW is noise)
				if (risk === RISK_LEVELS.LOW) continue;

				const reasons = [`Expected ${feat.severity} feature for ${purpose.name}: ${feat.feature}`];

				// Check knowledge for related patterns
				const relatedPatterns = knowledgePatterns.filter(p =>
					p.pattern && feat.feature.split(/[\s/]+/).some(word =>
						word.length > 4 && p.pattern.toLowerCase().includes(word.toLowerCase())
					)
				);
				if (relatedPatterns.length > 0) {
					reasons.push(`${relatedPatterns.length} historical pattern(s) related to this feature`);
				}

				// Check current findings
				const relatedFindings = currentFindings.filter(f =>
					f.title && feat.feature.split(/[\s/]+/).some(word =>
						word.length > 4 && f.title.toLowerCase().includes(word.toLowerCase())
					)
				);
				if (relatedFindings.length > 0) {
					reasons.push(`${relatedFindings.length} finding(s) already reported in this area`);
				}

				risks.push({
					area: feat.feature,
					level: risk,
					reasons,
					testGuidance: `Verify "${feat.feature}" works correctly: present, functional, and handles edge cases.`,
				});
			}
		}
	}

	// ── 3. Data modification / transaction risk ──
	const transactionKeywords = ['checkout', 'payment', 'cart', 'order', 'purchase', 'submit', 'create', 'edit', 'delete', 'save', 'update'];
	const contextText = [buildPrompt, ...(requirements || [])].join(' ').toLowerCase();
	const hasTransactional = transactionKeywords.some(kw => contextText.includes(kw));
	if (hasTransactional) {
		const matchedKeywords = transactionKeywords.filter(kw => contextText.includes(kw));
		risks.push({
			area: 'Data Modification / Transactions',
			level: RISK_LEVELS.HIGH,
			reasons: [
				`Transactional operations detected in context: ${matchedKeywords.join(', ')}`,
				'These operations can modify data and are high-impact if broken',
			],
			testGuidance: 'Test forms with valid and invalid input. Verify data persistence. Check error handling on failed submissions.',
		});
	}

	// ── 4. Form validation risk ──
	const formKeywords = ['form', 'input', 'field', 'validate', 'submit', 'email', 'password', 'required'];
	const hasForms = formKeywords.some(kw => contextText.includes(kw));
	if (hasForms) {
		risks.push({
			area: 'Form Validation',
			level: RISK_LEVELS.MEDIUM,
			reasons: [
				'Forms detected in application context',
				'Input validation is a common source of defects',
				...knowledgePatterns.filter(p => p.pattern && /form|valid|input|field/i.test(p.pattern))
					.slice(0, 1)
					.map(p => `Historical pattern: "${p.pattern.slice(0, 80)}"`),
			].filter(Boolean),
			testGuidance: 'Submit forms with empty, invalid, and boundary inputs. Check error messages and field validation.',
		});
	}

	// ── 5. Historical knowledge risk ──
	if (knowledgePatterns.length > 0) {
		const highConfidencePatterns = knowledgePatterns.filter(p =>
			(p.confidence || 0) >= 0.5 && (p.occurrences || 1) >= 2
		);
		if (highConfidencePatterns.length > 0) {
			const areas = new Set();
			for (const p of highConfidencePatterns) {
				if (/login|auth|sign/i.test(p.pattern)) areas.add('Authentication');
				else if (/checkout|cart|payment|order/i.test(p.pattern)) areas.add('Checkout/Payment');
				else if (/nav|link|menu|page/i.test(p.pattern)) areas.add('Navigation');
				else if (/form|input|valid/i.test(p.pattern)) areas.add('Form Validation');
				else areas.add('Other');
			}
			risks.push({
				area: 'Historical Risk Signals',
				level: RISK_LEVELS.MEDIUM,
				reasons: [
					`${highConfidencePatterns.length} high-confidence historical pattern(s) from previous missions`,
					`Affected areas: ${[...areas].join(', ')}`,
					'These patterns have recurred across multiple missions',
				],
				testGuidance: 'Prioritize testing areas where historical defects have recurred. Current evidence should confirm or deny whether these issues persist.',
			});
		}
	}

	// ── 6. Navigation risk (always present) ──
	risks.push({
		area: 'Navigation',
		level: RISK_LEVELS.LOW,
		reasons: [
			'All applications need working navigation',
			'Dead links and broken routes are common defects',
		],
		testGuidance: 'Click all navigation links. Verify each leads to the expected destination.',
	});

	// Deduplicate by area (keep highest risk)
	const seen = new Map();
	for (const risk of risks) {
		const existing = seen.get(risk.area);
		if (!existing || levelRank(risk.level) > levelRank(existing.level)) {
			seen.set(risk.area, risk);
		}
	}

	const finalRisks = [...seen.values()].sort((a, b) => levelRank(b.level) - levelRank(a.level));

	// Build summary
	const highCount = finalRisks.filter(r => r.level === RISK_LEVELS.HIGH).length;
	const medCount = finalRisks.filter(r => r.level === RISK_LEVELS.MEDIUM).length;
	const summary = `${highCount} HIGH, ${medCount} MEDIUM, ${finalRisks.length - highCount - medCount} LOW risk area(s) identified`;

	return { risks: finalRisks, summary, evidenceCount: evidenceList.length };
}

/**
 * Converts risk assessment into a text block for the agent prompt.
 * Concise, prioritized, evidence-backed.
 *
 * @param {{ risks: Array }} assessment
 * @returns {string}
 */
export function formatRiskForPrompt(assessment) {
	if (!assessment?.risks?.length) return '';

	const lines = ['', '# RISK-BASED TEST PRIORITIES', ''];

	const highRisks = assessment.risks.filter(r => r.level === RISK_LEVELS.HIGH);
	const medRisks = assessment.risks.filter(r => r.level === RISK_LEVELS.MEDIUM);

	let priority = 1;
	for (const risk of highRisks) {
		lines.push(`## Priority ${priority++} — ${risk.area} [${risk.level} RISK]`);
		for (const reason of risk.reasons.slice(0, 3)) {
			lines.push(`- ${reason}`);
		}
		lines.push(`- Test guidance: ${risk.testGuidance}`);
		lines.push('');
	}

	for (const risk of medRisks) {
		lines.push(`## Priority ${priority++} — ${risk.area} [${risk.level} RISK]`);
		for (const reason of risk.reasons.slice(0, 2)) {
			lines.push(`- ${reason}`);
		}
		lines.push(`- Test guidance: ${risk.testGuidance}`);
		lines.push('');
	}

	lines.push('Lower priority: navigation, visual/content pages, responsive layout.');
	lines.push('');
	lines.push('IMPORTANT: These priorities guide WHERE to start, not what to skip. Still explore');
	lines.push('the full application. If you find a critical issue in a high-priority area, investigate');
	lines.push('related areas before moving on.');

	return lines.join('\n');
}

/**
 * Reassesses risk after findings are reported during execution.
 * Produces updated guidance that can override initial priorities.
 *
 * @param {Object} initialAssessment - the initial risk assessment
 * @param {Array} newFindings - findings reported since last update
 * @param {Array} allFindings - all findings so far
 * @returns {{ updatedPriorities: string, urgencyNote: string|null }}
 */
export function reassessRiskWithFindings(initialAssessment, newFindings = [], allFindings = []) {
	if (!newFindings.length) return { updatedPriorities: '', urgencyNote: null };

	const criticalNew = newFindings.filter(f => f.severity === 'critical');
	const highNew = newFindings.filter(f => f.severity === 'high');

	let urgencyNote = null;
	const lines = [];

	if (criticalNew.length > 0) {
		urgencyNote = `⚠️ ${criticalNew.length} CRITICAL finding(s) reported. Focus on related areas before moving on.`;
		lines.push('', '# UPDATED PRIORITIES (based on findings so far)', '');
		lines.push(`You reported ${criticalNew.length} critical issue(s). Before testing other areas:`);
		for (const f of criticalNew.slice(0, 3)) {
			lines.push(`- "${f.title || 'Critical issue'}": investigate related flows (auth, session, data integrity)`);
		}
		lines.push('');
	} else if (highNew.length > 0) {
		urgencyNote = `${highNew.length} HIGH finding(s) reported. Consider testing related areas next.`;
	}

	// Identify untested high-risk areas
	if (initialAssessment?.risks) {
		const highRiskAreas = initialAssessment.risks.filter(r => r.level === RISK_LEVELS.HIGH);
		const testedAreas = new Set(
			allFindings.map(f => (f.title || '').toLowerCase())
		);

		const untestedHigh = highRiskAreas.filter(r =>
			!testedAreas.has(r.area.toLowerCase())
		);

		if (untestedHigh.length > 0 && allFindings.length >= 2) {
			if (!lines.length) lines.push('', '# REMAINING HIGH-RISK AREAS', '');
			lines.push('High-risk areas not yet investigated:');
			for (const r of untestedHigh.slice(0, 3)) {
				lines.push(`- ${r.area}: ${r.testGuidance}`);
			}
		}
	}

	return {
		updatedPriorities: lines.join('\n'),
		urgencyNote,
	};
}

function levelRank(level) {
	switch (level) {
		case RISK_LEVELS.HIGH: return 3;
		case RISK_LEVELS.MEDIUM: return 2;
		case RISK_LEVELS.LOW: return 1;
		default: return 0;
	}
}

/**
 * Builds a coverage/gap report at the end of a mission.
 *
 * Uses existing session structures (capturedSteps, activities, findings)
 * to identify what was tested vs what remains untested. Does NOT build
 * a massive coverage platform — it's a concise summary.
 *
 * @param {Object} session - the completed session
 * @param {Object|null} testContext - the pre-understanding testContext (has expectedFeatures, riskAssessment)
 * @returns {{ testedAreas: string[], untestedHighRisk: string[], coverageNotes: string[] }}
 */
export function buildCoverageReport(session, testContext = null) {
	const steps = session.capturedSteps || [];
	const activities = session.activities || [];
	const findings = session.findings || [];
	const report = session.report || {};

	// Collect all URLs/pages visited
	const visitedUrls = new Set();
	for (const step of steps) {
		if (step.url) visitedUrls.add(step.url);
		if (step.urlAfter) visitedUrls.add(step.urlAfter);
	}

	// Collect all areas the agent reported as covered
	const coveredAreas = new Set();
	if (Array.isArray(report.covered)) {
		for (const c of report.covered) coveredAreas.add(c.toLowerCase());
	}

	// Collect areas mentioned in findings (these were definitely tested)
	const testedFromFindings = new Set();
	for (const f of findings) {
		if (f.category) testedFromFindings.add(f.category.toLowerCase());
		if (f.title) {
			// Extract area keywords from finding titles
			const keywords = f.title.toLowerCase().match(/login|auth|form|nav|checkout|cart|search|dashboard|settings|contact|register|payment|product|chart|export|table|filter|sort/g);
			if (keywords) keywords.forEach(k => testedFromFindings.add(k));
		}
	}

	// Collect activity types to understand what was done
	const activityTypes = new Set();
	for (const a of activities) {
		if (a.type) activityTypes.add(a.type);
		if (a.label) activityTypes.add(a.label.toLowerCase());
	}

	// Build tested areas list
	const testedAreas = [...new Set([...coveredAreas, ...testedFromFindings])].sort();

	// Identify untested high-risk areas (compare against initial risk assessment)
	const untestedHighRisk = [];
	if (testContext?.riskAssessment?.risks) {
		const highRisks = testContext.riskAssessment.risks.filter(r => r.level === RISK_LEVELS.HIGH);
		for (const risk of highRisks) {
			const areaLower = risk.area.toLowerCase();
			// Check if this area was tested
			const wasTested = testedAreas.some(t =>
				t.includes(areaLower) || areaLower.includes(t) ||
				risk.area.toLowerCase().split(/[\s/]+/).some(word =>
					word.length > 4 && t.includes(word)
				)
			);
			if (!wasTested) {
				untestedHighRisk.push(risk.area);
			}
		}
	}

	// Build coverage notes
	const coverageNotes = [];
	coverageNotes.push(`Explored ${visitedUrls.size} unique page(s), performed ${activities.length} action(s), reported ${findings.length} finding(s).`);
	if (testedAreas.length > 0) {
		coverageNotes.push(`Areas tested: ${testedAreas.join(', ')}.`);
	}
	if (untestedHighRisk.length > 0) {
		coverageNotes.push(`High-risk areas not fully tested: ${untestedHighRisk.join(', ')}.`);
	}
	if (Array.isArray(report.notCovered) && report.notCovered.length > 0) {
		coverageNotes.push(`Agent reported not covered: ${report.notCovered.join(', ')}.`);
	}

	return {
		testedAreas,
		untestedHighRisk,
		coverageNotes,
		metrics: {
			pagesVisited: visitedUrls.size,
			actionsPerformed: activities.length,
			findingsReported: findings.length,
			activityTypes: [...activityTypes].slice(0, 10),
		},
	};
}
