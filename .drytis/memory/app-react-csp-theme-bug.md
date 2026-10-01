# React UI (/app-react/) — CSP blocks theme bootstrap (Phase 1, #14023)

Browser-tested 2026-09-30. Shell, toggles all PASS. One real bug found:

**Dark mode does not persist across reload.** Root cause: server CSP `script-src 'self'`
blocks the no-flash inline script in index-react.html line 6 (console error:
"Executing inline script violates the following Content Security Security Policy
directive 'script-src 'self''"). Observed: localStorage `qase-theme` = 'dark'
survives reload, but `documentElement.className` stays '' and body bg renders
light rgb(248,249,251) after reload. React's ThemeProvider also does not re-apply
the stored theme on mount (rendered light despite stored=dark). Fix options:
add the script's sha256 hash (`sha256-xJBZYPpnnJ/dI/1zquhrgAcyNhTatQFv2bjhiOpTCC0=`)
or a nonce to the CSP header, and/or have ThemeProvider apply stored theme in
its initial effect.

Also: favicon.ico 404 on /app-react/ (minor).

Everything else verified: landmarks (Runs sidebar, Browser panel, mode rail
QA/SQA/Founder/Bugs + Desktop/Mobile, status bar "Ready", "What should I test
today?" h1), theme toggle light↔dark (bg rgb(248,249,251) ↔ rgb(14,16,21),
aria-label flips), sidebar collapse (256px→0 width, button label flips),
viewer collapse (480px→44px slim strip, button label flips).
