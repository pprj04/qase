import { randomUUID } from 'node:crypto';
import { emit } from './store.js';
import { redact } from './secrets.js';
import { notifyReport } from './webhooks.js';
import { syncSessionFinding } from './findings.js';
import { runAutonomyPipeline } from './pipeline.js';
import { getConfig, VIEWPORT_PRESETS } from './config.js';
import { reassessRiskWithFindings } from './riskModel.js';

/**
 * The two tools the SDK's registry does not ship, because they are specific to
 * this surface: a structured way to file a defect, and a way to declare the run
 * finished with a verdict. Both are built per session so they can write
 * straight into the session the dashboard is rendering.
 */

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export function createQaTools(session) {
const reportFinding = {
			name: 'report_finding',
			description: 'Files one confirmed defect found while testing the site. Call once per distinct defect, as soon as you have confirmed it. Never include credentials or other secrets in any field.',
			category: 'qa',
			parametersSchema: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'One line naming the defect, written from the user\'s point of view.' },
					severity: { type: 'string', enum: SEVERITIES, description: 'User impact: critical blocks the core flow, high breaks an important flow, medium is a real but survivable defect, low is polish, info is an observation.' },
					category: { type: 'string', description: 'Area of the defect, e.g. authentication, forms, navigation, console, network, accessibility, layout, performance, content.' },
					url: { type: 'string', description: 'The page URL where the defect appears.' },
					steps: { type: 'array', items: { type: 'string' }, description: 'The exact steps to reproduce, in order.' },
					expected: { type: 'string', description: 'What should have happened.' },
					actual: { type: 'string', description: 'What actually happened.' },
					evidence: { type: 'string', description: 'Supporting detail: a console error, a status code, the text of an error message.' },

					// ── Evidence Engine fields ──
					observed: { type: 'string', description: 'The specific behavior you observed. What did the page do? Be precise: element IDs, text shown, response codes.' },
					impact: { type: 'string', description: 'The real-world consequence for a user. Who is affected and how? e.g. "Users cannot log in, blocking all access to the app."' },
					recommendation: { type: 'string', description: 'Your concrete suggestion for how a developer should fix this. Reference the likely cause if known.' },
					reproducibility: { type: 'string', enum: ['confirmed', 'unconfirmed', 'intermittent'], description: 'Whether you could reliably reproduce the issue. confirmed = reproduced consistently, intermittent = happens sometimes, unconfirmed = saw it once.' }
				},
				required: ['title', 'severity', 'expected', 'actual']
			},
			async run(input) {
				const severity = SEVERITIES.includes(input.severity) ? input.severity : 'medium';
				const finding = redact(session.id, {
					id: randomUUID(),
					ts: Date.now(),
					title: String(input.title ?? '').trim(),
					severity,
					category: String(input.category ?? 'general').trim(),
					url: input.url ?? session.targetUrl,
					steps: Array.isArray(input.steps) ? input.steps.map(String) : [],
					expected: String(input.expected ?? '').trim(),
					actual: String(input.actual ?? '').trim(),
					evidence: input.evidence ? String(input.evidence) : undefined,

					// Evidence Engine fields
					observed: input.observed ? String(input.observed).trim() : undefined,
					impact: input.impact ? String(input.impact).trim() : undefined,
					recommendation: input.recommendation ? String(input.recommendation).trim() : undefined,
					reproducibility: ['confirmed', 'unconfirmed', 'intermittent'].includes(input.reproducibility)
						? input.reproducibility
						: undefined
				});

			if (!finding.title) {
				return { success: false, error: 'report_finding requires a title.' };
			}

			session.findings.push(finding);
			emit(session, 'finding', { finding });
			// Phase 11: sync into global findings store (bugs hub).
			try {
				syncSessionFinding(session, finding);
			} catch { /* non-fatal */ }

			// Phase 14: Adaptive priority — update testContext when findings are reported.
			// The agent sees updated priorities in the next turn's context.
			if (session.testContext) {
				try {
					const newFindings = [{ title: finding.title, severity: finding.severity, category: finding.category }];
					const reassessment = reassessRiskWithFindings(
						session.testContext.riskAssessment,
						newFindings,
						session.findings
					);
					if (reassessment.updatedPriorities) {
						session.testContext.adaptiveGuidance = reassessment.updatedPriorities;
					}
					if (reassessment.urgencyNote) {
						session.testContext.urgencyNote = reassessment.urgencyNote;
					}
				} catch { /* non-fatal — adaptive priority is enhancement, not critical */ }
			}

			return {
				success: true,
				finding_id: finding.id,
				recorded: `${severity.toUpperCase()}: ${finding.title}`,
				total_findings: session.findings.length
			};
		}
	};

	const finishReport = {
		name: 'finish_qa_report',
		description: 'Ends the test run and publishes the report. Call exactly once, after every planned check is done and every defect has been filed with report_finding.',
		category: 'qa',
		parametersSchema: {
			type: 'object',
			properties: {
				verdict: { type: 'string', enum: ['pass', 'pass_with_issues', 'fail', 'blocked'], description: 'pass when nothing of substance broke, pass_with_issues when defects exist but the core flows work, fail when a core flow is broken, blocked when testing could not proceed.' },
				summary: { type: 'string', description: 'A short paragraph a product owner could read: what was tested, what state the site is in.' },
				covered: { type: 'array', items: { type: 'string' }, description: 'The areas and flows actually exercised.' },
				not_covered: { type: 'array', items: { type: 'string' }, description: 'Anything planned but skipped, and why.' },
				recommendations: { type: 'array', items: { type: 'string' }, description: 'What to fix or investigate first.' }
			},
			required: ['verdict', 'summary']
		},
		async run(input) {
			const report = redact(session.id, {
				ts: Date.now(),
				verdict: input.verdict ?? 'pass_with_issues',
				summary: String(input.summary ?? '').trim(),
				covered: Array.isArray(input.covered) ? input.covered.map(String) : [],
				notCovered: Array.isArray(input.not_covered) ? input.not_covered.map(String) : [],
				recommendations: Array.isArray(input.recommendations) ? input.recommendations.map(String) : [],
				targetUrl: session.targetUrl,
				findings: session.findings.length,
				bySeverity: SEVERITIES.reduce((counts, severity) => {
					counts[severity] = session.findings.filter(finding => finding.severity === severity).length;
					return counts;
				}, {})
			});

			session.report = report;
			emit(session, 'report', { report });
			notifyReport(session); // fire-and-forget webhook
			// Phase 12: trigger the autonomy pipeline (fire-and-forget).
			runAutonomyPipeline(session, {}).catch(() => {});
			return { success: true, published: true, verdict: report.verdict, findings: report.findings };
		}
	};

	const setViewport = {
		name: 'set_viewport',
		description: `Resizes the browser viewport to test responsive layouts. Pass one of: ${Object.keys(VIEWPORT_PRESETS).join(', ')}. Or pass explicit width/height. After resizing, take a browser_snapshot to see how the layout changed.`,
		category: 'qa',
		parametersSchema: {
			type: 'object',
			properties: {
				preset: { type: 'string', enum: Object.keys(VIEWPORT_PRESETS), description: 'Named viewport preset (desktop, tablet, mobile, mobile_small).' },
				width: { type: 'number', description: 'Custom viewport width in pixels (use with height instead of preset).' },
				height: { type: 'number', description: 'Custom viewport height in pixels (use with width instead of preset).' }
			}
		},
		async run(input) {
			const config = getConfig();
			if (config.exploreViewports === false) {
				return { success: false, error: 'Viewport exploration is disabled in settings.' };
			}

			let width, height, label;
			if (input.preset && VIEWPORT_PRESETS[input.preset]) {
				width = VIEWPORT_PRESETS[input.preset].width;
				height = VIEWPORT_PRESETS[input.preset].height;
				label = VIEWPORT_PRESETS[input.preset].label;
			} else if (input.width && input.height) {
				width = Number(input.width);
				height = Number(input.height);
				label = `${width}×${height}`;
			} else {
				return { success: false, error: `Pass preset (${Object.keys(VIEWPORT_PRESETS).join(', ')}) or width+height.` };
			}

			// Record the viewport on the session so the UI can show what was explored.
			session.viewportsExplored ??= [];
			if (!session.viewportsExplored.some(v => v.width === width && v.height === height)) {
				session.viewportsExplored.push({ width, height, label, ts: Date.now() });
				emit(session, 'viewport_explored', { width, height, label });
			}

			// The browser bridge monkey-patches the SDK service; its activePage is
			// the Playwright Page the agent is driving. Resize it in-place.
			const { liveFor } = await import('./store.js');
			const record = liveFor(session.id);
			const page = record?.bridge?.service?.activePage;
			if (page && !page.isClosed?.()) {
				await page.setViewportSize({ width, height });
				return { success: true, width, height, label, message: `Viewport resized to ${label} (${width}×${height}). Take a browser_snapshot to inspect the layout.` };
			}
			return { success: true, width, height, label, message: `Viewport will be set to ${label} (${width}×${height}) on next page open.` };
		}
	};

	return [reportFinding, finishReport, setViewport];
}
