import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/authStore';

/**
 * Auth gate — login/register card with show-password toggle and the
 * pilot invite-code field (only when the server reports pilot mode).
 * Backdrop blocks the shell until signed in (matches legacy inert behavior).
 */
export function AuthGate() {
  const { status, pilotMode, signIn, register } = useAuth();
  const [registerMode, setRegisterMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'signed-out') emailRef.current?.focus();
  }, [status]);

  if (status !== 'signed-out') return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (registerMode) {
        await register(email, password, displayName.trim() || undefined, inviteCode.trim() || undefined);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-gate" data-testid="auth-gate" aria-modal="true" role="dialog" aria-label="Sign in to QASE">
      <div className="auth-card">
        <div className="auth-logo" aria-hidden="true">Q</div>
        <h1>QASE</h1>
        <p className="auth-copy">
          {registerMode
            ? 'Your runs, profile, and saved memory are isolated to this account.'
            : 'Your runs, profile, and saved memory stay isolated to your account.'}
        </p>
        <form onSubmit={submit} aria-busy={busy}>
          <label className="field">
            <span>Email</span>
            <input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              data-testid="auth-email"
            />
          </label>
          {registerMode && (
            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                data-testid="auth-display-name"
              />
            </label>
          )}
          {registerMode && pilotMode && (
            <label className="field">
              <span>Invite code</span>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                data-testid="auth-invite"
              />
            </label>
          )}
          <label className="field">
            <span>Password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={registerMode ? 'new-password' : 'current-password'}
              minLength={registerMode ? 12 : 1}
              required
              data-testid="auth-password"
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
              data-testid="auth-show-password"
            />
            <span>Show password</span>
          </label>
          {error && (
            <p className="auth-error" role="alert" data-testid="auth-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy} data-testid="auth-submit">
            {registerMode ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setRegisterMode((v) => !v);
            setError(null);
          }}
          data-testid="auth-switch"
        >
          {registerMode ? 'I already have an account' : 'Create an account'}
        </button>
      </div>
    </div>
  );
}
