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
