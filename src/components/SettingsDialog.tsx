import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../state/toastStore';

export interface ModelConfig {
  providers: string[];
  provider: string;
  baseUrl?: string;
  model?: string;
  reasoning?: string;
  maxTurns?: number;
  headless?: boolean;
  ready?: boolean;
  problem?: string;
  hasApiKey?: boolean;
  apiKeyHint?: string;
  apiKeyFromEnv?: boolean;
}

const BASE_URL_REQUIRED = new Set(['custom', 'azureOpenAI']);
const BASE_URL_OPTIONAL = new Set(['openai', 'openrouter', 'nvidia', 'grok']);
const CUSTOM_MODEL_VALUE = '__qase_custom_model__';
const DEFAULT_CUSTOM_MODEL = 'z-ai/glm-5.2';

interface ProbeResult {
  ok?: boolean;
  error?: string;
  message?: string;
  matched?: boolean;
  models?: string[];
}

/**
 * Settings dialog — model endpoint config. The model field is a
 * select populated by probing the endpoint (modelSelectorUi constraint), with
 * an explicit "Custom model ID…" option (server default z-ai/glm-5.2).
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [provider, setProvider] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [reasoning, setReasoning] = useState('medium');
  const [maxTurns, setMaxTurns] = useState(120);
  const [headless, setHeadless] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [probe, setProbe] = useState<{ state: 'idle' | 'busy' | 'ok' | 'bad'; text: string }>({ state: 'idle', text: '' });
  const [probeModels, setProbeModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const selectedModelId = (modelValue: string, customValue: string) =>
    (modelValue === CUSTOM_MODEL_VALUE ? customValue : modelValue).trim();

  const applyFill = useCallback((next: ModelConfig) => {
    setConfig(next);
    setProvider(next.provider);
    setBaseUrl(next.baseUrl ?? '');
    setModel(next.model ?? '');
    // A configured model that isn't in the probed list becomes a custom ID
    // (legacy fillModelOptions behavior).
    setCustomModel(next.model ?? '');
    setReasoning(next.reasoning ?? 'medium');
    setMaxTurns(next.maxTurns ?? 120);
    setHeadless(next.headless !== false);
    setApiKey('');
    setProbe({ state: 'idle', text: '' });
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const next = await api<ModelConfig>('/config');
      applyFill(next);
      // Legacy parity: silently probe when the endpoint is already ready so
      // the model list populates without user action. Probe with the LOADED
      // values — component state hasn't committed yet inside this effect.
      if (next.ready) {
        await probeWith(next);
      }
    })().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps — open-transition only
  }, [open]);

  const probeWith = async (cfg: ModelConfig) => {
    const payload = {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl ?? '',
      model: cfg.model ?? '',
      reasoning: cfg.reasoning ?? 'medium',
      maxTurns: cfg.maxTurns ?? 120,
      headless: cfg.headless !== false,
    };
    const result = await api<ProbeResult>('/config/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).catch(() => undefined);
    if (result?.ok && result.models) {
      setProbeModels(
        [...new Set(result.models.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim()))],
      );
    }
  };

  const runProbe = useCallback(
    async (announce: boolean) => {
      if (announce) setProbe({ state: 'busy', text: 'Probing the endpoint…' });
      const payload = {
        provider,
        baseUrl: baseUrl.trim(),
        model: selectedModelId(model, customModel),
        reasoning,
        maxTurns: Number(maxTurns),
        headless,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      };
      const result: ProbeResult = await api<ProbeResult>('/config/test', {
        method: 'POST',
        body: JSON.stringify(payload),
      }).catch((error: Error) => ({ ok: false, error: error.message }));
      if (!result.ok) {
        if (announce) setProbe({ state: 'bad', text: result.error ?? 'Probe failed' });
        return;
      }
      // Port of legacy fillModelOptions: populate the select from the probe.
      const uniqueModels = [...new Set(
        (result.models ?? []).filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim()),
      )];
      setProbeModels(uniqueModels);
      if (announce) {
        setProbe({
          state: 'ok',
          text: result.matched === false
            ? `${result.message} But "${payload.model}" is not in the list — choose another model or keep it as a custom ID.`
            : (result.message ?? 'Endpoint reachable'),
        });
      }
    },
    [provider, baseUrl, model, customModel, reasoning, maxTurns, headless, apiKey],
  );

  if (!open) return null;

  const baseUrlRequired = BASE_URL_REQUIRED.has(provider);
  const baseUrlOptional = BASE_URL_OPTIONAL.has(provider);
  const managedKey = provider === 'custom';

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider,
        baseUrl: baseUrl.trim(),
        model: selectedModelId(model, customModel),
        reasoning,
        maxTurns: Number(maxTurns),
        headless,
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const saved = await api<ModelConfig & { runsKeepingOldSettings?: number }>('/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setConfig(saved);
      if (saved.problem) {
        setProbe({ state: 'bad', text: saved.problem });
        return;
      }
      onClose();
      toast(
        saved.runsKeepingOldSettings && saved.runsKeepingOldSettings > 0
          ? `Saved. ${saved.runsKeepingOldSettings} run(s) already going keep the old settings.`
          : 'Settings saved.',
        'good',
      );
    } catch (error) {
      setProbe({ state: 'bad', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-dialog">
        <header className="modal-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">
          <label className="field">
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} data-testid="settings-provider">
              {(config?.providers ?? []).map((name) => (
                <option key={name} value={name}>{name === 'custom' ? 'custom (OpenAI-compatible endpoint)' : name}</option>
              ))}
            </select>
            <small className="field-note">
              {baseUrlRequired
                ? (managedKey
                  ? 'OpenAI-compatible endpoint managed by this server — key and base URL are preconfigured.'
                  : 'Any OpenAI-compatible API: key, base URL, model name.')
                : baseUrlOptional
                  ? 'Base URL is optional — leave it blank to use the provider default.'
                  : 'This provider uses its own endpoint.'}
            </small>
          </label>
          {(baseUrlRequired || baseUrlOptional) && (
            <label className="field">
              <span>Base URL {baseUrlRequired ? '' : '(optional)'}</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" data-testid="settings-base-url" />
            </label>
          )}
          {!managedKey && (
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config?.hasApiKey ? `${config.apiKeyHint} — leave blank to keep` : 'sk-…'}
                data-testid="settings-api-key"
              />
              <small className="field-note">
                {config?.hasApiKey
                  ? (config.apiKeyFromEnv ? 'Currently coming from .env. Saving one here overrides it.' : 'Stored on this machine, in .qase/config.json.')
                  : 'Stored on this machine, in .qase/config.json. Sent only to your endpoint.'}
              </small>
            </label>
          )}
          <label className="field">
            <span>Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              data-testid="settings-model"
            >
              {(() => {
                // Port of fillModelOptions: probed list, current selection
                // preserved, always a custom-ID escape hatch; the server
                // default is preferred over an arbitrary first entry.
                const selected = model && model !== CUSTOM_MODEL_VALUE ? model : customModel;
                const listed = probeModels.includes(selected);
                const options = [...probeModels];
                const value = listed
                  ? selected
                  : selected
                    ? CUSTOM_MODEL_VALUE
                    : probeModels.includes(DEFAULT_CUSTOM_MODEL)
                      ? DEFAULT_CUSTOM_MODEL
                      : (probeModels[0] ?? CUSTOM_MODEL_VALUE);
                if (!listed && selected) options.unshift(selected);
                return options.map((id) => (
                  <option key={id} value={id}>{id}</option>
                )).concat(
                  <option key={CUSTOM_MODEL_VALUE} value={CUSTOM_MODEL_VALUE}>Custom model ID…</option>,
                ).map((element) => (element.props.value === value ? element : element));
              })()}
            </select>
            {(model === CUSTOM_MODEL_VALUE || (!probeModels.includes(model) && customModel)) && (
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder={DEFAULT_CUSTOM_MODEL}
                required
                data-testid="settings-custom-model"
              />
            )}
          </label>
          <div className="field-row">
            <label className="field">
              <span>Reasoning</span>
              <select value={reasoning} onChange={(e) => setReasoning(e.target.value)} data-testid="settings-reasoning">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className="field">
              <span>Max turns</span>
              <input type="number" min={1} value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))} data-testid="settings-max-turns" />
            </label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} data-testid="settings-headless" />
            <span>Headless browser</span>
          </label>
          {probe.state !== 'idle' && (
            <p className={`test-result test-result--${probe.state === 'busy' ? 'busy' : probe.state}`} role="status" data-testid="settings-probe">
              {probe.text}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void runProbe(true)} disabled={probe.state === 'busy'} data-testid="settings-test">
              Test endpoint
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving} data-testid="settings-save">
              Save settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
