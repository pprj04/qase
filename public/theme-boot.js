/* No-flicker theme restore — loaded synchronously in <head> so it runs
 * before first paint. Dark is the default; only light needs applying.
 * External file (not inline) so it passes the CSP script-src 'self' policy. */
(function () {
	try {
		if (localStorage.getItem('qase.theme') === 'light') {
			document.documentElement.setAttribute('data-theme', 'light');
			var meta = document.querySelector('meta[name="theme-color"]');
			if (meta) meta.setAttribute('content', '#ffffff');
			var scheme = document.querySelector('meta[name="color-scheme"]');
			if (scheme) scheme.setAttribute('content', 'light');
		}
	} catch (error) { /* storage unavailable — stay dark */ }
})();
