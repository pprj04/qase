const form = document.getElementById('auth-form');
const message = document.getElementById('message');
const submit = document.getElementById('submit');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirm-password');
let signup = new URLSearchParams(location.search).get('signup') === '1';
let bootstrap = false;
submit.disabled = true;
try {
  const response = await fetch('/api/auth/bootstrap', { cache: 'no-store' });
  if (!response.ok) throw new Error();
  const status = await response.json();
  if (status.needsAdmin) {
    if (!status.canBootstrap) throw new Error();
    signup = true; bootstrap = true;
  }
  submit.disabled = false;
} catch { message.textContent = 'Account storage is unavailable. Contact your administrator.'; }
if (signup) {
  document.getElementById('heading').textContent = bootstrap ? 'Initialize QASE administrator' : 'Create your QASE account';
  document.getElementById('confirmation').hidden = false;
  confirmPassword.required = true;
  password.minLength = 10;
  password.autocomplete = 'new-password';
  submit.textContent = 'Create Account';
  document.getElementById('switch').textContent = 'Back to Login';
  document.getElementById('switch').href = '/login';
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = '';
  if (signup && password.value !== confirmPassword.value) {
    message.textContent = 'Passwords must match.';
    return;
  }
  submit.disabled = true;
  try {
    const response = await fetch(`/api/auth/${bootstrap ? 'register-admin' : signup ? 'signup' : 'login'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value.trim(), password: password.value, ...(signup ? { confirmPassword: confirmPassword.value } : {}) })
    });
    const body = await response.json();
    if (!response.ok) { message.textContent = body.error || 'Unable to sign in.'; return; }
    password.value = ''; confirmPassword.value = '';
    location.replace(signup && !bootstrap ? '/login?created=1' : '/runs');
  } catch { message.textContent = 'Unable to reach QASE. Please try again.'; }
  finally { submit.disabled = false; }
});
if (new URLSearchParams(location.search).has('created')) message.textContent = 'Account created. Sign in to continue.';
