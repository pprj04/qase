import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useModelConfig } from '../state/configStore';
import { useToast } from '../state/toastStore';
import { useLiveSession } from '../state/liveSession';

/** GET /sqa/catalog shape (profiles/sources are keyed objects, attributes is a string[]). */
interface SqaCatalog {
  catalogVersion: string;
  disclaimer?: string;
  /** keyed object: id -> {id, title, description} */
  profiles: Record<string, { id?: string; title?: string; description?: string }>;
  /** string ids */
  attributes: unknown[];
  /** keyed object: id -> source descriptor */
  sources: Record<string, unknown>;
  controls: { applicability?: { profiles?: string[] } }[];
}

interface CatalogEntry {
  id: string;
  title: string;
  description: string;
}

function humanizeSqaId(id: string): string {
  return id
    .split(/[-_]/)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

/** Normalizes a catalog list that may arrive as an array or a keyed object. */
function sqaValues(entries: unknown): CatalogEntry[] {
  const list = Array.isArray(entries) ? entries : Object.values(entries as Record<string, unknown>);
  return list.map((entry) =>
    typeof entry === 'string'
      ? { id: entry, title: humanizeSqaId(entry), description: '' }
      : {
          id: String((entry as { id?: string }).id ?? ''),
          title:
            String((entry as { title?: string }).title ?? '') ||
            humanizeSqaId(String((entry as { id?: string }).id ?? '')),
          description: String((entry as { description?: string }).description ?? ''),
        },
  );
}

export function SqaLauncher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const { ready, problem, refresh } = useModelConfig();
  const { openSession } = useLiveSession();
  const [catalog, setCatalog] = useState<SqaCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [profiles, setProfiles] = useState<Set<string>>(new Set(['core']));
  const [attributes, setAttributes] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState({ name: '', release: '', environment: '' });
  const [targetUrl, setTargetUrl] = useState('');
  const [scopeNotes, setScopeNotes] = useState('');
  const [authorization, setAuthorization] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState('');
  const [deviceLandscape, setDeviceLandscape] = useState(false);
  const [devices, setDevices] = useState<{ id: string; label?: string }[]>([]);

  // Load the catalog and device list once when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError('');
    setCatalog(null);
    setCatalogError('');
    (async () => {
      try {
        const next = await api<SqaCatalog>('/sqa/catalog');
        if (!next || !next.catalogVersion || !next.profiles || !next.attributes || !next.controls) {
          throw new Error('The SQA catalog response is invalid.');
        }
        setCatalog(next);
        setProfiles(new Set(['core']));
        setAttributes(new Set());
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

  const profileEntries = useMemo(() => sqaValues(catalog?.profiles ?? {}), [catalog]);
  const attributeEntries = useMemo(() => sqaValues(catalog?.attributes ?? []), [catalog]);
  const controlCountFor = (profileId: string) =>
    (catalog?.controls ?? []).filter((control) => control.applicability?.profiles?.includes(profileId)).length;

  const toggle = (set: Set<string>, apply: (next: Set<string>) => void, id: string, locked = false) => {
    if (locked) return;
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  const submitDisabled = busy || !catalog || !authorization;

  const submit = async () => {
    setError('');
    const modelStatus = ready === true ? { ready: true, problem } : await refresh();
    if (modelStatus.ready !== true) {
      const note = `${modelStatus.problem ?? 'The model endpoint is not configured yet.'} Finish setup in Settings first.`;
      setError(note);
      return;
    }
    const trimmedTarget = {
      name: target.name.trim(),
      release: target.release.trim(),
      environment: target.environment.trim(),
    };
    let normalizedUrl: string;
    try {
      const parsed = new URL(targetUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError();
      normalizedUrl = parsed.href;
    } catch {
      setError('Enter a complete HTTP or HTTPS target URL.');
      return;
    }
    if (!trimmedTarget.name || !trimmedTarget.release || !trimmedTarget.environment) {
      setError('Product, release, and environment must contain visible text.');
      return;
    }
    if (!authorization) {
      setError('Confirm testing authorization and the non-destructive boundary first.');
      return;
    }
    const chosenProfiles = [...profiles];
    if (!chosenProfiles.includes('core')) chosenProfiles.unshift('core');
    setBusy(true);
    try {
      const result = await api<Record<string, unknown>>('/sqa/sessions', {
        method: 'POST',
        body: JSON.stringify({
          profiles: chosenProfiles,
          attributes: [...attributes],
          target: trimmedTarget,
          scopeNotes: scopeNotes.trim(),
          authorizationConfirmed: true,
          device,
          deviceLandscape,
        }),
      });
      const wrapped = result?.session as { id?: string } | undefined;
      const sessionId = wrapped?.id ?? (result?.id as string | undefined);
      if (!sessionId) throw new Error('The server did not return the new assessment session.');
      onClose();
      openSession(sessionId);
      try {
        await api(`/sessions/${sessionId}/message`, { method: 'POST', body: JSON.stringify({ text: normalizedUrl }) });
      } catch (startError) {
        // Legacy parity: the assessment scope exists; surface the failure via
        // toast (the dialog is closed) so the user knows to send the URL manually.
        toast(
          `The assessment scope was created, but the test could not start: ${
            startError instanceof Error ? startError.message : String(startError)
          } Send the target URL in the chat.`,
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
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Start an SQA assessment" data-testid="sqa-launcher">
        <header className="modal-head">
          <h2>SQA assessment</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">
          {catalogError && <p className="form-error" data-testid="sqa-catalog-error">The assessment catalog could not be loaded. {catalogError}</p>}
          {!catalog && !catalogError && <p className="empty-hint">Loading assessment catalog…</p>}
          {catalog && (
            <>
              <p className="catalog-meta" data-testid="sqa-catalog-meta">
                catalog {catalog.catalogVersion} · {catalog.controls.length} controls · {Object.keys(catalog.sources).length} sources
              </p>
              <p className="catalog-disclaimer">{catalog.disclaimer ?? 'This is a scoped engineering assessment and does not represent regulatory approval, an audit opinion, or certification.'}</p>

              <fieldset className="launcher-fieldset" disabled={false}>
                <legend>Assurance profiles</legend>
                <div className="option-grid">
                  {profileEntries.map((profile) => {
                    const isCore = profile.id === 'core';
                    const count = controlCountFor(profile.id);
                    return (
                      <label key={profile.id} className={`sqa-option${isCore ? ' is-required' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isCore || profiles.has(profile.id)}
                          disabled={isCore}
                          onChange={() => toggle(profiles, setProfiles, profile.id, isCore)}
                          data-testid={`sqa-profile-${profile.id}`}
                        />
                        <span>
                          <strong>{profile.title}</strong>
                          {profile.description && <small>{profile.description}</small>}
                          <em>{count} mapped control{count === 1 ? '' : 's'}{isCore ? ' · required' : ''}</em>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="launcher-fieldset">
                <legend>Product attributes</legend>
                <div className="option-grid">
                  {attributeEntries.map((attribute) => (
                    <label key={attribute.id} className="sqa-option">
                      <input
                        type="checkbox"
                        checked={attributes.has(attribute.id)}
                        onChange={() => toggle(attributes, setAttributes, attribute.id)}
                        data-testid={`sqa-attribute-${attribute.id}`}
                      />
                      <span><strong>{attribute.title}</strong></span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="form-grid">
                <label>
                  Product name
                  <input value={target.name} onChange={(e) => setTarget((t) => ({ ...t, name: e.target.value }))} data-testid="sqa-target-name" />
                </label>
                <label>
                  Release
                  <input value={target.release} onChange={(e) => setTarget((t) => ({ ...t, release: e.target.value }))} data-testid="sqa-target-release" />
                </label>
                <label>
                  Environment
                  <input value={target.environment} onChange={(e) => setTarget((t) => ({ ...t, environment: e.target.value }))} data-testid="sqa-target-environment" />
                </label>
                <label className="span-2">
                  Target URL
                  <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com" data-testid="sqa-target-url" />
                </label>
                <label className="span-2">
                  Scope notes (optional)
                  <textarea value={scopeNotes} onChange={(e) => setScopeNotes(e.target.value)} rows={2} data-testid="sqa-scope-notes" />
                </label>
                <label>
                  Device
                  <select value={device} onChange={(e) => setDevice(e.target.value)} data-testid="sqa-device">
                    {devices.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.label ?? profile.id}</option>
                    ))}
                  </select>
                </label>
                <label className="check-inline">
                  <input type="checkbox" checked={deviceLandscape} onChange={(e) => setDeviceLandscape(e.target.checked)} data-testid="sqa-landscape" />
                  Landscape
                </label>
              </div>

              <label className="check-block">
                <input
                  type="checkbox"
                  checked={authorization}
                  onChange={(e) => setAuthorization(e.target.checked)}
                  data-testid="sqa-authorization"
                />
                <span>I confirm I am authorized to test this target non-destructively and it is an isolated environment.</span>
              </label>

              {error && <p className="form-error" data-testid="sqa-form-error">{error}</p>}
            </>
          )}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={submitDisabled} data-testid="sqa-submit">
            {busy ? 'Creating assessment…' : 'Start assessment'}
          </button>
        </footer>
      </div>
    </div>
  );
}
