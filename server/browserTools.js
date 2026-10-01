/** Bounded browser-only capabilities absent from the upstream SDK registry. */
import { SECURITY_CHECK_IDS } from './securityChecks.js';

export function createBrowserTools(getBridge) {
	return [
		{
			name: 'security_check',
			category: 'browser',
			description: `Runs deterministic, benign security checks against the CURRENT page: security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy), session cookie flags, reflected-XSS escaping (submits a harmless canary through the page's own search form), SQL-injection error signatures (benign quote payload only), and mixed content. Every failed check is reported through report_finding with category "security", the check's evidence and remediation. This is a surface scan, not a penetration test: report findings honestly, including "info" results. Optionally pass a subset of check ids: ${SECURITY_CHECK_IDS.join(', ')}.`,
			parametersSchema: {
				type: 'object', additionalProperties: false,
				properties: {
					checks: {
						type: 'array',
						items: { type: 'string', enum: SECURITY_CHECK_IDS },
						description: 'Optional subset of checks; omit to run all.'
					}
				}
			},
			async run(input) {
				if (input?.checks !== undefined
					&& (!Array.isArray(input.checks) || input.checks.some(id => !SECURITY_CHECK_IDS.includes(id)))) {
					return { success: false, error: `checks must be a subset of: ${SECURITY_CHECK_IDS.join(', ')}.` };
				}
				return getBridge().runSecurityChecks({ checks: input?.checks });
			}
		},
		{
			name: 'browser_media',
			category: 'browser',
			description: 'Tests microphone access with synthetic Chromium audio only. inspect reads app capture requests and track state; set_permission sets this page origin to granted, denied, or prompt; probe briefly checks capture and signal then releases its tracks. Exercise the app microphone controls separately and inspect their actual capture evidence. This never verifies physical hardware or remote meeting audio.',
			parametersSchema: {
				type: 'object', additionalProperties: false,
				properties: {
					action: { type: 'string', enum: ['inspect', 'set_permission', 'probe'] },
					permission: { type: 'string', enum: ['granted', 'denied', 'prompt'] },
					durationMs: { type: 'integer', minimum: 100, maximum: 3000 }
				},
				required: ['action']
			},
			async run(input) {
				if (!input || !['inspect', 'set_permission', 'probe'].includes(input.action)
					|| (input.action === 'set_permission' && !['granted', 'denied', 'prompt'].includes(input.permission))
					|| (input.durationMs !== undefined && (!Number.isInteger(input.durationMs) || input.durationMs < 100 || input.durationMs > 3000))) {
					return { success: false, error: 'Use inspect, set_permission with granted/denied/prompt, or probe with durationMs between 100 and 3000.' };
				}
				return getBridge().media(input);
			}
		},
		{
			name: 'browser_test_meeting_link',
			category: 'browser',
			description: 'Opens a meeting link actually present in the current page in a tracked tab and reports its landing/prejoin state. Supply the observed anchor selector or exact href. Supported external meeting links get a narrowly scoped navigation grant; unrelated origins remain blocked. Inspect the destination and report login, expired link, permission, native-app, or network blockers honestly. Never claims a participant joined or audio reached another attendee.',
			parametersSchema: {
				type: 'object', additionalProperties: false,
				properties: {
					selector: { type: 'string', description: 'Selector for the meeting anchor from a fresh snapshot.' },
					url: { type: 'string', description: 'Exact href of a meeting anchor observed on the current page.' }
				}
			},
			async run(input) {
				if (!input || !['selector', 'url'].some(key => typeof input[key] === 'string' && input[key].trim())
					|| ['selector', 'url'].some(key => input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 8192))) {
					return { success: false, error: 'Provide the selector or exact URL of an observed meeting link.' };
				}
				return getBridge().testMeetingLink(input);
			}
		}
	];
}
