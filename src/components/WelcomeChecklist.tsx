import { useState } from 'react';
import { useAuth } from '../state/authStore';
import { useModelConfig } from '../state/configStore';
import { api } from '../api/client';

interface WelcomeStep {
  done: boolean;
  label: string;
  action?: { label: string; run: () => void };
}

/**
 * First-run welcome checklist (React port of renderWelcomeChecklist).
 * Shown only when signed in, no run is open, and the user has not completed
 * onboarding. The onboarding flag is persisted through the profile API —
 * the same mechanism the legacy UI used (PUT /api/profile onboardingComplete).
 */
export function WelcomeChecklist({ onOpenSettings, onStartRun, onTryDemo }: {
  onOpenSettings: () => void;
  onStartRun: () => void;
  onTryDemo: () => void;
}) {
  const { status, user } = useAuth();
  const { ready } = useModelConfig();
  const [dismissed, setDismissed] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const onboardingComplete = user?.profile?.onboardingComplete === true;

  // Persist the onboarding flag once (best-effort; failures stay silent).
  const markOnboarded = () => {
    if (flagged) return;
    setFlagged(true);
    void api('/profile', { method: 'PUT', body: JSON.stringify({ profile: { onboardingComplete: true } }) })
      .catch(() => setFlagged(false));
  };

  if (status !== 'signed-in' || dismissed || onboardingComplete) return null;

  const steps: WelcomeStep[] = [
    {
      done: ready === true,
      label: ready ? 'Model endpoint configured' : 'Model endpoint — configure it in Settings',
      action: ready ? undefined : { label: 'Open Settings', run: onOpenSettings },
    },
    { done: false, label: 'Start your first run', action: { label: 'Start a QA run', run: onStartRun } },
    { done: false, label: '…or practice on the demo site', action: { label: 'Try demo', run: onTryDemo } },
  ];

  const startSomething = () => {
    markOnboarded();
    setDismissed(true);
  };

  return (
    <div className="welcome-checklist" data-testid="welcome-checklist" aria-label="Get started">
      <h3>Get started</h3>
      {steps.map((step) => (
        <div key={step.label} className="welcome-step">
          <span className={`welcome-mark${step.done ? ' is-done' : ''}`} aria-hidden="true">{step.done ? '✓' : '·'}</span>
          <span>{step.label}</span>
          {!step.done && step.action ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm welcome-action"
              onClick={() => {
                if (step.action?.label !== 'Open Settings') startSomething();
                step.action?.run();
              }}
            >
              {step.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
