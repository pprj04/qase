import { classifyViewport } from './deviceClassify.js';

/**
 * Resolve the visual shell from execution evidence. A requested device is a
 * useful fallback before the first frame arrives, but it must never override
 * a frame's actual viewport: otherwise a desktop capture can be presented as
 * a phone.
 */
export function resolveLiveDevicePresentation({ device = null, capturedViewport = null } = {}) {
	const captured = validViewport(capturedViewport) ? capturedViewport : null;
	const viewport = captured ?? (validViewport(device?.viewport) ? device.viewport : null);
	const kind = captured
		? classifyViewport(captured)
		: (device?.deviceType ?? classifyViewport(viewport));
	if (!viewport || kind === 'desktop') {
		return { kind: 'desktop', viewport, frameAspect: null, captured: Boolean(captured) };
	}

	// The shell padding is part of the outer aspect ratio. This makes the
	// content area exactly match the captured viewport rather than squeezing it
	// into a guessed phone shape.
	const chrome = kind === 'phone'
		? { horizontal: 16, vertical: 28 }
		: { horizontal: 24, vertical: 30 };
	return {
		kind,
		viewport,
		frameAspect: `${viewport.width + chrome.horizontal} / ${viewport.height + chrome.vertical}`,
		captured: Boolean(captured)
	};
}

function validViewport(value) {
	return Number.isFinite(value?.width) && value.width > 0
		&& Number.isFinite(value?.height) && value.height > 0;
}
