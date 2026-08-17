/**
 * Viewport → device-kind classification for the live view.
 *
 * Shared by the live browser panel. Pure function — no DOM — so it can be
 * unit-tested in Node and imported by app.js as an ES module.
 */

export function classifyViewport(viewport) {
	if (!viewport?.width || !viewport?.height) return 'desktop';
	const { width, height } = viewport;
	const portrait = height >= width;
	if (portrait && width <= 500) return 'phone';
	if (portrait && width <= 1100 && height >= 700) return 'tablet';
	// Landscape tablet: must be tablet-proportioned, not a squashed desktop
	// window (e.g. 1440×600 stays desktop).
	if (!portrait && height >= 600 && height <= 900 && width <= 1300) return 'tablet';
	return 'desktop';
}
