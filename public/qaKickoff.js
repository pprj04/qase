/**
 * QA launcher scope builder. Pure — no DOM — so both the dashboard and the
 * unit tests can import it.
 */

/** Scope option catalogue: value -> instruction the agent receives. */
export const QA_SCOPE_OPTIONS = [
	{ value: 'desktop-layout', label: 'desktop layout and responsive behaviour across viewport widths' },
	{ value: 'mobile-layout', label: 'mobile layout using an emulated phone viewport' },
	{ value: 'forms', label: 'forms and input validation (required fields, invalid input handling, submission feedback)' },
	{ value: 'console-errors', label: 'console errors and failed network requests while browsing' },
	{ value: 'navigation', label: 'navigation and internal links (broken links, dead ends, back-navigation)' },
	{ value: 'accessibility', label: 'accessibility basics (labels, contrast, keyboard reachability, focus visibility)' },
	{ value: 'security', label: 'security basics (header presence, cookie flags, XSS reflection, SQL injection error signatures) using the security_check tool' }
];

/**
 * Builds the kickoff instruction from the checked scope options.
 * - full sweep (all options, or no selection given) → null, meaning the plain
 *   URL is the whole kickoff and the agent tests everything.
 * - empty selection → null as well; the launcher guards against it and asks
 *   the user to check at least one item.
 * - anything in between → "Test this website, focusing on: …"
 */
export function buildQaKickoffMessage(values) {
	const selected = new Set(values ?? QA_SCOPE_OPTIONS.map(option => option.value));
	const chosen = QA_SCOPE_OPTIONS.filter(option => selected.has(option.value));
	if (chosen.length === 0) return null;
	if (chosen.length === QA_SCOPE_OPTIONS.length) return null; // plain URL = full sweep
	const parts = chosen.map(option => option.label).join('; ');
	return `Test this website, focusing on: ${parts}.`;
}
