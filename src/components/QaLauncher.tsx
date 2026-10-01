import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useModelConfig } from '../state/configStore';
import { useToast } from '../state/toastStore';
import { QA_SCOPE_OPTIONS, buildQaKickoffMessage } from '../lib/qaKickoff';

interface QaCatalogTest {
  id: string;
  label: string;
  description?: string;
  category?: string;
}

interface QaCatalog {
  tests: QaCatalogTest[];
}

interface EngineInfo {
  id: string;
  available?: boolean;
  reason?: string;
}

interface DeviceProfile {
  id: string;
  label: string;
  kind: string;
}

export const DEFAULT_ENGINES = ['chromium', 'firefox', 'webkit'];

/**
 * QA launcher dialog — target URL, device, scope ("what to test"), standard +
 * security test catalog with select-all/category toggles, the security
 * authorization gate, and multi-engine run creation (per-engine loop, chromium
 * first). Port of the legacy qa-start dialog.
 */
export function QaLauncher({ open, onClose, onRunCreated }: { open: boolean; onClose: () => void; onRunCreated: (id: string) => void }) {
  const { toast } = useToast();
  const { ready, problem, refresh } = useModelConfig();
  const [targetUrl, setTargetUrl] = useState('');
  const [catalog, setCatalog] = useState<QaCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [chosenEngines, setChosenEngines] = useState<string[]>(['chromium']);
  const [devices, setDevices] = useState<DeviceProfile[]>([]);
  // Device + orientation persist across opens (legacy keys qase.device /
  // qase.deviceLandscape parity).
  const [device, setDevice] = useState(() => localStorage.getItem('qase.device') ?? 'desktop');
  const [deviceLandscape, setDeviceLandscape] = useState(() => localStorage.getItem('qase.deviceLandscape') === '1');
  const [scopeAll, setScopeAll] = useState(true);
  const [scopeValues, setScopeValues] = useState<string[]>(QA_SCOPE_OPTIONS.map((o) => o.value));
  const [securityAuthorized, setSecurityAuthorized] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setTargetUrl('');
    setSecurityAuthorized(false);
    // Restore the remembered device + orientation on each open.
    setDevice(localStorage.getItem('qase.device') ?? 'desktop');
    setDeviceLandscape(localStorage.getItem('qase.deviceLandscape') === '1');
    setSelectedTests(new Set());
    setCatalog(null);
    setCatalogError('');
    setChosenEngines(['chromium']);
    (async () => {
      try {
        const [cat, engineInfo, deviceList] = await Promise.all([
          api<QaCatalog>('/qa/catalog'),
          api<{ engines: EngineInfo[] }>('/engines').catch(() => ({ engines: [] as EngineInfo[] })),
          api<{ devices: DeviceProfile[] }>('/devices').catch(() => ({ devices: [{ id: 'desktop', label: 'Desktop', kind: 'desktop' }] as DeviceProfile[] })),
        ]);
        setCatalog(cat);
        setSelectedTests(new Set((cat.tests ?? []).map((t) => t.id)));
        setEngines(engineInfo.engines ?? []);
        const list = deviceList.devices ?? [];
        setDevices(list);
        // A remembered device id that no longer exists falls back to desktop
        // (legacy parity: pendingDeviceId validates against the catalog).
        setDevice((current) => (list.length > 0 && !list.some((d) => d.id === current) ? 'desktop' : current));
      } catch (err) {
        setCatalogError('The standard test catalog could not be loaded.');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [open]);

  const standardTests = useMemo(
    () => (catalog?.tests ?? []).filter((t) => !t.id.startsWith('security_')),
    [catalog],
  );
  const securityTests = useMemo(
    () => (catalog?.tests ?? []).filter((t) => t.id.startsWith('security_')),
    [catalog],
  );
  const securitySelected = useMemo(
    () => [...selectedTests].some((id) => id.startsWith('security_')),
    [selectedTests],
  );

  const engineAvailable = (id: string): boolean => {
    if (engines.length === 0) return true; // registry unreachable — static defaults
    const engine = engines.find((e) => e.id === id);
    return engine?.available !== false;
  };

  const toggleTest = (id: string, checked: boolean) => {
    setSelectedTests((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleCategory = (tests: QaCatalogTest[], checked: boolean) => {
    setSelectedTests((current) => {
      const next = new Set(current);
      for (const test of tests) {
        if (checked) next.add(test.id);
        else next.delete(test.id);
      }
      return next;
    });
  };

  const categoryState = (tests: QaCatalogTest[]): { checked: boolean; indeterminate: boolean } => {
    const selectable = tests.filter((t) => selectedTests.has(t.id)).length;
    return { checked: tests.length > 0 && selectable === tests.length, indeterminate: selectable > 0 && selectable < tests.length };
  };

  const submit = async () => {
    setError('');
    // Model-config gate (legacy ensureModelConfigured): a run without a usable
    // endpoint would stall immediately. Refresh first so a stale signed-out
    // fetch can't block a signed-in user.
    const modelStatus = ready === true ? { ready: true, problem } : await refresh();
    if (modelStatus.ready !== true) {
      const note = `${modelStatus.problem ?? 'The model endpoint is not configured yet.'} Finish setup in Settings first.`;
      setError(note);
      toast(note, 'bad');
      return;
    }
    // URL gate (http/https only)
    let parsed: URL;
    try {
      parsed = new URL(targetUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError();
    } catch {
      setError('Enter a valid http(s) URL.');
      return;
    }
    const selected = [...selectedTests];
    if (selected.length === 0) {
      setError('Select at least one test.');
      return;
    }
    if (securitySelected && !securityAuthorized) {
      setError('Confirm the target is an explicitly authorized, isolated test environment before running security tests.');
      return;
    }
    const scopeMessage = buildQaKickoffMessage(scopeAll ? undefined : scopeValues);
    if (scopeMessage === null && !scopeAll && scopeValues.length === 0) {
      setError('Check at least one item under "What to test".');
      return;
    }
    const engineList = chosenEngines.filter(engineAvailable);
    // Chromium first when chosen (legacy ordering).
    const ordered = engineList.includes('chromium')
      ? ['chromium', ...engineList.filter((id) => id !== 'chromium')]
      : engineList;
    if (ordered.length === 0) {
      setError('Check at least one browser engine.');
      return;
    }
    const kickoffText = scopeMessage ? `${parsed.toString()}\n${scopeMessage}` : parsed.toString();
    setBusy(true);
    try {
      for (const engine of ordered) {
        const session = await api<{ id: string }>('/sessions', {
          method: 'POST',
          body: JSON.stringify({
            device,
            deviceLandscape,
            engine,
            selectedTests: selected,
            ...(securitySelected && securityAuthorized ? { securityAuthorization: true } : {}),
          }),
        });
        await api(`/sessions/${session.id}/message`, {
          method: 'POST',
          body: JSON.stringify({
            text: ordered.length > 1 && engine !== 'chromium'
              ? `${kickoffText}\nFocus: core flows and cross-browser comparison on ${engine}; full sweep runs separately on Chromium.`
              : kickoffText,
          }),
        }).catch((err: unknown) => {
          // Session creation succeeded; a failed kickoff message shouldn't kill
          // the multi-engine loop, but the user must hear about it.
          toast(
            `Run ${session.id.slice(0, 8)} was created but the kickoff message failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
            'bad',
          );
        });
        onRunCreated(session.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const standardState = categoryState(standardTests);
  const securityState = categoryState(securityTests);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Start a QA run" data-testid="qa-launcher">
        <header className="modal-head">
          <h2>Start a QA run</h2>
          <button type="button" className="icon-btn" aria-label="Close launcher" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>Target URL</span>
            <div className="qa-url-row">
              <input
                type="url"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="https://example.com"
                autoFocus
                data-testid="qa-target-url"
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setTargetUrl(`${window.location.origin}/demo`);
                  setError('Demo site loaded — it plants real bugs on purpose (login demo@qase.dev / demo1234).');
                }}
                data-testid="qa-demo-fill"
              >
                Try demo
              </button>
            </div>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Device</span>
              <select value={device} onChange={(e) => { setDevice(e.target.value); localStorage.setItem('qase.device', e.target.value); }} data-testid="qa-device">
                {devices.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-row qa-landscape">
              <input type="checkbox" checked={deviceLandscape} onChange={(e) => { setDeviceLandscape(e.target.checked); localStorage.setItem('qase.deviceLandscape', e.target.checked ? '1' : '0'); }} data-testid="qa-landscape" />
              <span>Landscape</span>
            </label>
          </div>

          <fieldset className="qa-fieldset">
            <legend>What to test</legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={scopeAll}
                onChange={(e) => {
                  setScopeAll(e.target.checked);
                  setScopeValues(e.target.checked ? QA_SCOPE_OPTIONS.map((o) => o.value) : []);
                }}
                data-testid="qa-scope-all"
              />
              <span>Everything (full sweep)</span>
            </label>
            <div className="qa-scope-options">
              {QA_SCOPE_OPTIONS.map((option) => (
                <label key={option.value} className="checkbox-row checkbox-row--sub">
                  <input
                    type="checkbox"
                    disabled={scopeAll}
                    checked={scopeAll || scopeValues.includes(option.value)}
                    onChange={(e) => {
                      setScopeValues((current) =>
                        e.target.checked ? [...current, option.value] : current.filter((v) => v !== option.value),
                      );
                    }}
                  />
                  <span>{option.value.replace('-', ' ')}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="qa-fieldset" disabled={!catalog}>
            <legend>Standard tests</legend>
            {!catalog && <p className="muted" data-testid="qa-tests-state">{catalogError || 'Loading standard tests…'}</p>}
            {catalog && (
              <>
                <div className="qa-cat-row">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={standardState.checked}
                      ref={(node) => { if (node) node.indeterminate = standardState.indeterminate; }}
                      onChange={(e) => toggleCategory(standardTests, e.target.checked)}
                      aria-label="Select all standard tests"
                    />
                    <span>All standard tests</span>
                  </label>
                  <div className="qa-bulk">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleCategory([...standardTests, ...securityTests], true)} data-testid="qa-select-all">Select all</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedTests(new Set())} data-testid="qa-deselect-all">Deselect all</button>
                  </div>
                </div>
                <div className="qa-test-grid">
                  {standardTests.map((test) => (
                    <label key={test.id} className="checkbox-row checkbox-row--sub" title={test.description}>
                      <input
                        type="checkbox"
                        checked={selectedTests.has(test.id)}
                        onChange={(e) => toggleTest(test.id, e.target.checked)}
                      />
                      <span>{test.label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>

          {catalog && securityTests.length > 0 && (
            <fieldset className="qa-fieldset">
              <legend>Security tests</legend>
              <div className="qa-cat-row">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={securityState.checked}
                    ref={(node) => { if (node) node.indeterminate = securityState.indeterminate; }}
                    onChange={(e) => toggleCategory(securityTests, e.target.checked)}
                    aria-label="Select all security tests"
                  />
                  <span>All security tests</span>
                </label>
              </div>
              <div className="qa-test-grid">
                {securityTests.map((test) => (
                  <label key={test.id} className="checkbox-row checkbox-row--sub" title={test.description}>
                    <input
                      type="checkbox"
                      checked={selectedTests.has(test.id)}
                      onChange={(e) => toggleTest(test.id, e.target.checked)}
                    />
                    <span>{test.label}</span>
                  </label>
                ))}
              </div>
              {securitySelected && (
                <div className="qa-security-gate" data-testid="qa-security-gate">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={securityAuthorized}
                      onChange={(e) => setSecurityAuthorized(e.target.checked)}
                      data-testid="qa-security-authorized"
                    />
                    <span>
                      I confirm this target is an explicitly authorized, isolated test environment, and I am
                      permitted to run security tests against it.
                    </span>
                  </label>
                </div>
              )}
            </fieldset>
          )}

          <fieldset className="qa-fieldset">
            <legend>Browser engines</legend>
            <div className="qa-engine-row">
              {DEFAULT_ENGINES.map((id) => {
                const available = engineAvailable(id);
                const reason = engines.find((e) => e.id === id)?.reason;
                return (
                  <label
                    key={id}
                    className={`checkbox-row${available ? '' : ' is-disabled'}`}
                    title={available ? undefined : reason ?? 'Engine unavailable'}
                  >
                    <input
                      type="checkbox"
                      disabled={!available}
                      checked={chosenEngines.includes(id)}
                      onChange={(e) =>
                        setChosenEngines((current) =>
                          e.target.checked ? [...current, id] : current.filter((v) => v !== id),
                        )
                      }
                      data-testid={`qa-engine-${id}`}
                    />
                    <span>{id}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {error && (
            <p className="test-result test-result--bad" role="alert" data-testid="qa-form-error">{error}</p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} data-testid="qa-submit">
              {busy ? (chosenEngines.length > 1 ? `Starting ${chosenEngines.length} runs…` : 'Starting run…') : 'Start test'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
