import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import { useAuth } from './authStore';

export interface ModelConfigStatus {
  /** null = unknown (still loading); true = endpoint usable */
  ready: boolean | null;
  problem?: string;
}

interface ConfigContextValue extends ModelConfigStatus {
  /** Re-fetch /config — call after settings are saved. Returns the fresh status. */
  refresh: () => Promise<ModelConfigStatus>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

/**
 * App-wide model-config status. The launcher gates run creation on
 * `ready` (React port of the legacy ensureModelConfigured).
 *
 * /config requires auth: the initial mount fetch can 401 while signed out
 * (cached as not-ready), so the status is re-fetched when auth resolves to
 * signed-in — otherwise a signed-in user would be wrongly blocked.
 */
export function ConfigProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ModelConfigStatus>({ ready: null });
  const { status: authStatus } = useAuth();

  const refresh = useCallback(async (): Promise<ModelConfigStatus> => {
    let next: ModelConfigStatus;
    try {
      const config = await api<{ ready?: boolean; problem?: string }>('/config');
      next = { ready: config.ready === true, problem: config.problem };
    } catch {
      next = { ready: false, problem: 'The model endpoint is not configured yet.' };
    }
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-check as soon as the user is authenticated.
  useEffect(() => {
    if (authStatus === 'signed-in') void refresh();
  }, [authStatus, refresh]);

  const value = useMemo<ConfigContextValue>(
    () => ({ ...status, refresh }),
    [status, refresh],
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useModelConfig(): ConfigContextValue {
  const context = useContext(ConfigContext);
  if (!context) throw new Error('useModelConfig must be used inside ConfigProvider');
  return context;
}
