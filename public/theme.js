// Apply before styles load so a saved theme does not flash the system theme.
(() => {
	const key = 'qase.theme';
	const system = window.matchMedia('(prefers-color-scheme: dark)');
	const normalize = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
	let preference = 'system';
	try { preference = normalize(localStorage.getItem(key)); } catch { /* Storage can be disabled. */ }

	function apply() {
		const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
		document.documentElement.dataset.theme = theme;
		document.documentElement.style.colorScheme = theme;
		document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#101012' : '#ffffff';
		for (const control of document.querySelectorAll('[data-theme-control]')) control.value = preference;
	}

	apply();
	system.addEventListener('change', () => { if (preference === 'system') apply(); });
	window.addEventListener('storage', event => {
		if (event.key !== key && event.key !== null) return;
		try { if (event.storageArea !== localStorage) return; } catch { return; }
		preference = normalize(event.newValue);
		apply();
	});
	document.addEventListener('DOMContentLoaded', () => {
		for (const control of document.querySelectorAll('[data-theme-control]')) {
			control.addEventListener('change', () => {
				preference = normalize(control.value);
				try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
				apply();
			});
		}
		apply();
	});
})();
