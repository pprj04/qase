// No-flash theme bootstrap — applied before first paint.
// Loaded synchronously (defer intentionally absent) from the built index.html so
// the correct palette is on <html> before React mounts. External file (not
// inline) so the app's CSP (`script-src 'self'`) permits it.
(function () {
  try {
    var t = localStorage.getItem('qase-theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var root = document.documentElement;
    root.classList.toggle('dark', t === 'dark');
    root.style.colorScheme = t;
  } catch (e) {}
})();
