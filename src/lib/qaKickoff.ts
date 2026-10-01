/** QA launcher scope builder — pure. */

export interface ScopeOption {
  value: string;
  label: string;
}

/** Scope option catalogue: value -> instruction the agent receives. */
export const QA_SCOPE_OPTIONS: ScopeOption[] = [
  { value: 'desktop-layout', label: 'desktop layout and responsive behaviour across viewport widths' },
  { value: 'mobile-layout', label: 'mobile layout using an emulated phone viewport' },
  { value: 'forms', label: 'forms and input validation (required fields, invalid input handling, submission feedback)' },
  { value: 'console-errors', label: 'console errors and failed network requests while browsing' },
  { value: 'navigation', label: 'navigation and internal links (broken links, dead ends, back-navigation)' },
  { value: 'accessibility', label: 'accessibility basics (labels, contrast, keyboard reachability, focus visibility)' },
  { value: 'security', label: 'security basics (header presence, cookie flags, XSS reflection, SQL injection error signatures) using the security_check tool' },
];

/**
 * Builds the kickoff instruction from the checked scope options.
 * - full sweep (all options, or no selection given) → null (plain URL = test everything)
 * - empty selection → null; the launcher guards and asks for ≥1 item
 * - anything between → "Test this website, focusing on: …"
 */
export function buildQaKickoffMessage(values: string[] | undefined): string | null {
  const selected = new Set(values ?? QA_SCOPE_OPTIONS.map((option) => option.value));
  const chosen = QA_SCOPE_OPTIONS.filter((option) => selected.has(option.value));
  if (chosen.length === 0) return null;
  if (chosen.length === QA_SCOPE_OPTIONS.length) return null; // plain URL = full sweep
  const parts = chosen.map((option) => option.label).join('; ');
  return `Test this website, focusing on: ${parts}.`;
}
