/**
 * Builds the explicit mission request made from the composer intent controls.
 * Kept DOM-free so the UI contract can be regression tested.
 */
export function buildIntentMissionPayload({ targetUrl, buildPrompt = '', requirementsText = '', device = '' } = {}) {
	const url = String(targetUrl ?? '').trim();
	const prompt = String(buildPrompt ?? '').trim();
	const requirements = String(requirementsText ?? '').split(',').map(value => value.trim()).filter(Boolean);
	const requestedDevice = String(device ?? '').trim();
	const requested = Boolean(prompt || requirements.length || requestedDevice);
	if (!requested) return { requested: false, payload: null, error: null };
	if (!/^https?:\/\//.test(url)) {
		return { requested: true, payload: null, error: 'Enter the target URL in the message box to start this device/intent mission.' };
	}
	return {
		requested: true,
		error: null,
		payload: {
			name: (prompt || `Device mission: ${url}`).slice(0, 80),
			type: 'full_audit',
			targetUrl: url,
			...(prompt ? { buildPrompt: prompt } : {}),
			...(requirements.length ? { requirements } : {}),
			...(requestedDevice ? { constraints: { device: requestedDevice } } : {})
		}
	};
}

/**
 * UI-3 New Run contract. This deliberately contains only fields accepted by
 * POST /api/v1/missions. Server-side URL and SSRF validation remains
 * authoritative.
 */
export function buildNewRunMissionPayload({ targetUrl, objective = '', requirementsText = '', device = '', projectId } = {}) {
	const url = String(targetUrl ?? '').trim();
	const requestedObjective = String(objective ?? '').trim();
	const requirements = String(requirementsText ?? '').split(',').map(value => value.trim()).filter(Boolean);
	const requestedDevice = String(device ?? '').trim();
	if (!url) return { payload: null, error: 'Enter a target URL.' };
	let parsed;
	try { parsed = new URL(url); } catch { return { payload: null, error: 'Enter a valid http or https URL.' }; }
	if (!['http:', 'https:'].includes(parsed.protocol)) return { payload: null, error: 'Use an http or https target URL.' };
	if (parsed.username || parsed.password) return { payload: null, error: 'Use a target URL without embedded credentials.' };
	return {
		payload: {
			...(projectId ? { projectId } : {}),
			targetUrl: url,
			type: 'full_audit',
			...(requestedObjective ? { objectives: [requestedObjective] } : {}),
			...(requirements.length ? { requirements } : {}),
			...(requestedDevice ? { constraints: { device: requestedDevice } } : {})
		},
		error: null
	};
}
