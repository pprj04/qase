import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useModelConfig } from '../state/configStore';
import { useToast } from '../state/toastStore';
import { useLiveSession } from '../state/liveSession';

/** GET /founder/catalog shape. */
interface FounderCatalog {
  schemaVersion: string;
  categories: unknown[];
  observationTypes?: unknown[];
  confidenceLevels?: unknown[];
  caveat?: string;
}

export function FounderLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { ready, problem, refresh } = useModelConfig();
  const { openSession } = useLiveSession();
  const [catalog, setCatalog] = useState<FounderCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [targetName, setTargetName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [targetRelease, setTargetRelease] = useState('');
  const [targetEnvironment, setTargetEnvironment] = useState('');
  const [primaryGoal, setPrimaryGoal] = useState('');
  const [constraints, setConstraints] = useState('');
  const [authorization, setAuthorization] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState('');
  const [deviceLandscape, setDeviceLandscape] = useState(false);
  const [devices, setDevices] = useState<{ id: string; label?: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setCatalog(null);
    setCatalogError('');
    (async () => {
      try {
        const next = await api<FounderCatalog>('/founder/catalog');
        if (!next || !next.schemaVersion || !Array.isArray(next.categories)) {
          throw new Error('The Founder review catalog response is invalid.');
        }
        setCatalog(next);
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : String(err));
      }
      try {
        const list = await api<{ default: string; devices: { id: string; label?: string }[] }>('/devices');
        setDevices(list.devices ?? []);
        setDevice((prev) => prev || list.default || list.devices?.[0]?.id || '');
      } catch {
        setDevices([]);
      }
    })();
  }, [open]);

  const submitDisabled = busy || !catalog || !authorization;

  const submit = async () => {
    setError('');
    const modelStatus = ready === true ? { ready: true, problem } : await refresh();
    if (modelStatus.ready !== true) {
      setError(`${modelStatus.problem ?? 'The model endpoint is not configured yet.'} Finish setup in Settings first.`);
      return;
    }
    let normalizedUrl: string;
    try {
      const parsed = new URL(targetUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError();
      normalizedUrl = parsed.href;
    } catch {
      setError('Enter a complete HTTP or HTTPS target URL.');
      return;
    }
    if (!targetName.trim()) {
      setError('Enter the product or project name.');
      return;
    }
    if (!authorization) {
      setError('Confirm review authorization and the non-destructive boundary first.');
      return;
    }
    const optional = (value: string) => {
      const text = value.trim();
      return text || undefined;
    };
    const productContext: Record<string, string> = {};
    if (optional(primaryGoal)) productContext.primaryGoal = primaryGoal.trim();
    if (optional(constraints)) productContext.constraints = constraints.trim();

    setBusy(true);
    try {
      const result = await api<Record<string, unknown>>('/founder/sessions', {
        method: 'POST',
        body: JSON.stringify({
          authorizationConfirmed: true,
          target: {
            name: targetName.trim(),
            url: normalizedUrl,
            ...(optional(targetRelease) ? { release: targetRelease.trim() } : {}),
            ...(optional(targetEnvironment) ? { environment: targetEnvironment.trim() } : {}),
          },
          device,
          deviceLandscape,
          ...(Object.keys(productContext).length ? { productContext } : {}),
        }),
      });
      const wrapped = result?.session as { id?: string } | undefined;
      const sessionId = wrapped?.id ?? (result?.id as string | undefined);
      if (!sessionId) throw new Error('The server did not return the new Founder review session.');
      onClose();
      openSession(sessionId);
      try {
        await api(`/sessions/${sessionId}/message`, { method: 'POST', body: JSON.stringify({ text: `Review ${normalizedUrl}` }) });
      } catch (startError) {
        // Legacy parity: the review scope exists; surface the failure via
        // toast (the dialog is closed) so the user knows to send it manually.
        toast(
          `The review scope was created, but evidence collection could not start: ${
            startError instanceof Error ? startError.message : String(startError)
          } Send "Review <url>" in the chat.`,
          'bad',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Start a Founder review" data-testid="founder-launcher">
        <header className="modal-head">
          <h2>Founder review</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">
          {catalogError && <p className="form-error" data-testid="founder-catalog-error">Review catalog unavailable. {catalogError}</p>}
          {!catalog && !catalogError && <p className="empty-hint">Loading review catalog…</p>}
          {catalog && (
            <>
              <p className="catalog-meta" data-testid="founder-catalog-meta">
                {catalog.schemaVersion} · {catalog.categories.length} review lenses · browser evidence required
              </p>
              {catalog.caveat && <p className="catalog-disclaimer">{catalog.caveat}</p>}

              <div className="form-grid">
                <label>
                  Product name
                  <input value={targetName} onChange={(e) => setTargetName(e.target.value)} data-testid="founder-target-name" />
                </label>
                <label>
                  Target URL
                  <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com" data-testid="founder-target-url" />
                </label>
                <label>
                  Release (optional)
                  <input value={targetRelease} onChange={(e) => setTargetRelease(e.target.value)} data-testid="founder-target-release" />
                </label>
                <label>
                  Environment (optional)
                  <input value={targetEnvironment} onChange={(e) => setTargetEnvironment(e.target.value)} data-testid="founder-target-environment" />
                </label>
                <label className="span-2">
                  Primary goal (optional)
                  <input value={primaryGoal} onChange={(e) => setPrimaryGoal(e.target.value)} placeholder="What matters most in this review?" data-testid="founder-primary-goal" />
                </label>
                <label className="span-2">
                  Constraints (optional)
                  <textarea value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={2} data-testid="founder-constraints" />
                </label>
                <label>
                  Device
                  <select value={device} onChange={(e) => setDevice(e.target.value)} data-testid="founder-device">
                    {devices.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.label ?? profile.id}</option>
                    ))}
                  </select>
                </label>
                <label className="check-inline">
                  <input type="checkbox" checked={deviceLandscape} onChange={(e) => setDeviceLandscape(e.target.checked)} data-testid="founder-landscape" />
                  Landscape
                </label>
              </div>

              <label className="check-block">
                <input
                  type="checkbox"
                  checked={authorization}
                  onChange={(e) => setAuthorization(e.target.checked)}
                  data-testid="founder-authorization"
                />
                <span>I confirm I am authorized to review this target non-destructively and it is an isolated environment.</span>
              </label>

              {error && <p className="form-error" data-testid="founder-form-error">{error}</p>}
            </>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitDisabled} data-testid="founder-submit">
            {busy ? 'Creating review…' : 'Start review'}
          </button>
        </footer>
      </div>
    </div>
  );
}
