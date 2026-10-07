#!/usr/bin/env node
/**
 * Independent backend-level WhatsApp send test — no UI, no QASE session.
 *
 * Loads the project environment (same file the server uses), constructs the
 * real notifier, and dispatches one TEST notification to a chosen recipient.
 * Prints the sanitized result including provider message ids; exits non-zero
 * on failure. Credentials are read from the environment only — never echoed.
 *
 * Usage:
 *   node scripts/test-whatsapp.mjs                # first configured recipient
 *   node scripts/test-whatsapp.mjs --to +9112345  # explicit recipient (must
 *                                                 # be in the configured list)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Minimal .env loader (dev convenience; production env comes from the
// container config which is already in process.env).
function loadEnvFile(file) {
	try {
		const raw = fs.readFileSync(file, 'utf8');
		for (const line of raw.split('\n')) {
			const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (!match) continue;
			const value = match[2].replace(/^["']|["']$/g, '');
			if (process.env[match[1]] === undefined) process.env[match[1]] = value;
		}
	} catch { /* no .env — rely on real environment */ }
}
loadEnvFile(path.join(root, '.env'));

const { createWhatsAppNotifier, notificationIdFor } = await import('../server/whatsappNotifier.js');

function fail(message) {
	console.error(`✗ ${message}`);
	process.exitCode = 1;
}

// ── Pre-flight: report configuration state (names only, never values) ──────
const flag = process.env.QASE_WHATSAPP_ENABLED;
const token = process.env.QASE_WHATSAPP_ACCESS_TOKEN;
const phoneId = process.env.QASE_WHATSAPP_PHONE_NUMBER_ID;
console.log('QASE_WHATSAPP_ENABLED =', flag === undefined ? '(unset)' : flag);
console.log('QASE_WHATSAPP_ACCESS_TOKEN =', token ? '(set)' : '(empty)');
console.log('QASE_WHATSAPP_PHONE_NUMBER_ID =', phoneId ? '(set)' : '(empty)');
console.log('QASE_WHATSAPP_RECIPIENTS =', process.env.QASE_WHATSAPP_RECIPIENTS ?? '(unset)');
console.log('QASE_WHATSAPP_TEMPLATE_NAME =', process.env.QASE_WHATSAPP_TEMPLATE_NAME || '(none — free-form text mode)');
console.log('QASE_PUBLIC_URL =', process.env.QASE_PUBLIC_URL || '(unset — no deep link in message)');

const notifier = createWhatsAppNotifier({ environment: process.env });
if (!notifier) {
	fail('Notifier is DISABLED or misconfigured — set QASE_WHATSAPP_ENABLED=true plus '
		+ 'QASE_WHATSAPP_ACCESS_TOKEN and QASE_WHATSAPP_PHONE_NUMBER_ID.');
}

if (notifier) {
	const argIndex = process.argv.indexOf('--to');
	const target = argIndex !== -1 ? process.argv[argIndex + 1] : undefined;
	const recipient = notifier.listNotifications; // noop reference for shape
	void recipient;

	// Determine the recipient list from config (normalized E.164 is internal
	// to the module; use a probe notification to read them back).
	const probeId = `test-${Date.now()}`;
	// Dispatch a real send — this IS the backend-to-provider test.
	const feedback = {
		id: probeId,
		runId: 'backend-smoke-test-run',
		rating: 5,
		category: 'other',
		comments: 'Backend smoke test from scripts/test-whatsapp.mjs — please ignore.'
	};
	const context = {
		mode: 'qa',
		title: 'WhatsApp backend smoke test',
		submittedByName: 'QASE backend test script',
		submittedAt: Date.now(),
		qaseUrl: process.env.QASE_PUBLIC_URL
	};

	if (target && !String(target).startsWith('+')) {
		fail('--to must be an E.164 number starting with +');
	}

	console.log('\nDispatching test notification', notificationIdFor(probeId), '…');
	await notifier.dispatchFeedbackNotification(feedback, context);

	const result = notifier.getNotification(probeId);
	if (!result) {
		fail('No notification record found after dispatch.');
	} else {
		console.log('\nResult (sanitized):');
		console.log(JSON.stringify(result, null, 2));
		if (result.status !== 'SENT') {
			fail(`Notification status ${result.status} — see recipient lastError fields above.`);
		} else {
			console.log('\n✓ Provider accepted the message for every recipient.');
			console.log('  (Acceptance ≠ device delivery; delivery advances via /webhooks/whatsapp.)');
			if (target) {
				const chosen = result.recipients.find(r => r.to === target);
				if (!chosen) fail(`--to ${target} is not in the configured recipient list.`);
			}
		}
	}
}
