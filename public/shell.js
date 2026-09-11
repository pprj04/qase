/** QASE V1 shell controls. The shell owns navigation chrome, not auth state. */
import { $, state } from './shared.js';
import { navigate } from './router.js';

let initialized = false;

function focusable(container) {
  return [...container.querySelectorAll('a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(node => !node.hidden && node.offsetParent !== null);
}

function closeDrawer({ restore = true } = {}) {
  const drawer = $('shell-sidebar');
  if (!drawer) return;
  drawer.classList.remove('is-open');
  $('shell-drawer-backdrop').hidden = true;
  $('shell-nav-toggle')?.setAttribute('aria-expanded', 'false');
  if (restore) $('shell-nav-toggle')?.focus();
}

function openDrawer() {
  const drawer = $('shell-sidebar');
  if (!drawer) return;
  drawer.classList.add('is-open');
  $('shell-drawer-backdrop').hidden = false;
  $('shell-nav-toggle')?.setAttribute('aria-expanded', 'true');
  focusable(drawer)[0]?.focus();
}

function closeAccountMenu() {
  $('shell-account-menu').hidden = true;
  $('shell-account-toggle')?.setAttribute('aria-expanded', 'false');
}

function updateAccountMenu() {
  const who = state.auth;
  const isUser = who?.kind === 'user';
  const isAdmin = who?.role === 'admin' || who?.kind === 'master';
  const identity = $('shell-account-identity');
  if (identity) identity.textContent = isUser ? (who.name || who.email || 'Signed in user') : 'QASE session';
  if ($('shell-account-role')) $('shell-account-role').textContent = isUser ? (who.role || 'user') : 'authenticated';
  if ($('shell-account-settings')) $('shell-account-settings').hidden = !isAdmin;
  if ($('shell-nav-settings')) $('shell-nav-settings').hidden = !isAdmin;
  if ($('shell-account-toggle')) $('shell-account-toggle').hidden = !who;
  const settingsPlaceholder = $('settings-route-placeholder');
  if (settingsPlaceholder && !isAdmin && who) {
    settingsPlaceholder.innerHTML = '<p class="shell-eyebrow">QASE V1</p><h1>Settings unavailable</h1><p>Your role does not have access to Settings.</p>';
  }
}

export function initShell() {
  if (initialized) return;
  initialized = true;
  const drawer = $('shell-sidebar');
  const accountMenu = $('shell-account-menu');
  const accountToggle = $('shell-account-toggle');
  $('shell-nav-toggle')?.addEventListener('click', () => drawer?.classList.contains('is-open') ? closeDrawer() : openDrawer());
  $('shell-drawer-backdrop')?.addEventListener('click', () => closeDrawer());
  accountToggle?.addEventListener('click', event => {
    event.stopPropagation();
    const willOpen = accountMenu.hidden;
    accountMenu.hidden = !willOpen;
    accountToggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) accountMenu.querySelector('button, a')?.focus();
  });
  document.addEventListener('click', event => {
    if (!accountMenu?.hidden && !accountMenu.contains(event.target) && !accountToggle?.contains(event.target)) closeAccountMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (drawer?.classList.contains('is-open')) closeDrawer();
      else if (!accountMenu?.hidden) { closeAccountMenu(); accountToggle?.focus(); }
      return;
    }
    if (event.key !== 'Tab' || !drawer?.classList.contains('is-open')) return;
    const nodes = focusable(drawer);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.querySelectorAll('#shell-sidebar a[data-nav]').forEach(link => link.addEventListener('click', () => closeDrawer({ restore: false })));
  document.querySelectorAll('[data-shell-settings]').forEach(node => node.addEventListener('click', event => { event.preventDefault(); closeAccountMenu(); navigate('settings'); }));
  $('shell-account-theme')?.addEventListener('click', () => $('theme-toggle')?.click());
  $('shell-account-signout')?.addEventListener('click', async () => {
    try {
      const result = await fetch('/api/auth/logout', { method: 'POST' });
      if (!result.ok) throw new Error('Sign out failed');
      localStorage.removeItem('qase_token');
      state.stream?.close();
      location.replace('/login');
    } catch { $('shell-account-signout').textContent = 'Unable to sign out'; }
  });
  updateAccountMenu();
}

export function setShellAuth() { updateAccountMenu(); }
export function setProjectSwitching(isSwitching) {
  $('shell-content')?.classList.toggle('is-project-switching', Boolean(isSwitching));
  if ($('shell-project-status')) $('shell-project-status').hidden = !isSwitching;
}
