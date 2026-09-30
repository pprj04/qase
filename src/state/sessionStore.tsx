import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import {
  connectSessionStream,
  type ConnectionState,
  type SessionEvent,
  type SessionStreamHandle,
} from '../api/sse';

/* ── Types ──────────────────────────────────────────────── */

export interface RunSummary {
  id: string;
  title?: string;
  targetUrl?: string;
  status: string;
  mode?: 'qa' | 'sqa' | 'founder' | string;
  engine?: string;
  device?: string;
  deviceLandscape?: boolean;
  startedAt?: number;
  completedAt?: number;
  pausedAt?: number;
  cancelledAt?: number;
  durationSeconds?: number;
  pausedSeconds?: number;
  updatedAt?: number;
  findingCount?: number;
  todoCompleted?: number;
  todoTotal?: number;
  tokenUsage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number; estimated?: boolean };
  [key: string]: unknown;
}

interface SessionState {
  runs: RunSummary[];
  runsLoading: boolean;
  selectedId: string | undefined;
  connection: ConnectionState;
  skewMs: number;
}

type SessionAction =
  | { type: 'runs/loading'; loading: boolean }
  | { type: 'runs/loaded'; runs: RunSummary[] }
  | { type: 'runs/patched'; run: RunSummary }
  | { type: 'session/selected'; id: string | undefined }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'skew'; serverNow?: number };

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'runs/loading':
      return { ...state, runsLoading: action.loading };
    case 'runs/loaded':
      return { ...state, runs: action.runs, runsLoading: false };
    case 'runs/patched': {
      const index = state.runs.findIndex((run) => run.id === action.run.id);
      const runs = index === -1
        ? [action.run, ...state.runs]
        : state.runs.map((run, i) => (i === index ? { ...run, ...action.run } : run));
      return { ...state, runs };
    }
    case 'session/selected':
      return { ...state, selectedId: action.id };
    case 'connection':
      return { ...state, connection: action.state };
    case 'skew':
      return typeof action.serverNow === 'number' && action.serverNow > 0
        ? { ...state, skewMs: action.serverNow - Date.now() }
        : state;
    default:
      return state;
  }
}

/* ── Server-authoritative elapsed seconds (port of elapsedSecondsOf) ── */

export function elapsedSecondsOf(
  run: Pick<RunSummary, 'startedAt' | 'completedAt' | 'pausedAt' | 'pausedSeconds'> | undefined,
  now: number,
): number | undefined {
  if (!run || !Number.isFinite(run.startedAt)) return undefined;
  const pausedSeconds = Number.isFinite(run.pausedSeconds) ? (run.pausedSeconds as number) : 0;
  if (Number.isFinite(run.pausedAt)) {
    return Math.max(0, Math.floor(((run.pausedAt as number) - (run.startedAt as number)) / 1000 - pausedSeconds));
  }
  const end = Number.isFinite(run.completedAt) ? (run.completedAt as number) : now;
  return Math.max(0, Math.floor((end - (run.startedAt as number)) / 1000 - pausedSeconds));
}

/* ── Formatting helpers ─────────────────────────────────── */

export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  if (m > 0) return `${m}:${String(sec).padStart(2, '0')}`;
  return `0:${String(sec).padStart(2, '0')}`;
}

export function formatTokens(total: number): string {
  if (!Number.isFinite(total)) return String(total);
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 10_000) return `${Math.round(total / 1000)}k`;
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}

export function relativeTime(timestamp: number | undefined): string {
  if (!Number.isFinite(timestamp)) return '';
  const delta = Math.max(0, Date.now() - (timestamp as number));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/* ── Store ──────────────────────────────────────────────── */

interface SessionStoreValue extends SessionState {
  refreshRuns: () => Promise<void>;
  selectSession: (id: string | undefined) => void;
  deleteRun: (id: string) => Promise<void>;
  serverNow: () => number;
  applyEventToRuns: (event: SessionEvent) => void;
}

const SessionStoreContext = createContext<SessionStoreValue | null>(null);

export function SessionStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, {
    runs: [],
    runsLoading: true,
    selectedId: undefined,
    connection: 'connecting',
    skewMs: 0,
  });
  const streamRef = useRef<SessionStreamHandle | null>(null);
  const [, forceTick] = useState(0);

  // 1s tick so live run timers advance between server updates.
  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const serverNow = useCallback(() => Date.now() + state.skewMs, [state.skewMs]);

  const refreshRuns = useCallback(async () => {
    try {
      const runs = await api<RunSummary[]>('/sessions');
      dispatch({ type: 'runs/loaded', runs: runs ?? [] });
    } catch {
      dispatch({ type: 'runs/loaded', runs: [] });
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  const applyEventToRuns = useCallback((event: SessionEvent) => {
    if (event.type === 'status') {
      dispatch({ type: 'skew', serverNow: event.timing?.serverNow });
      // Terminal / status transitions refresh the list (authoritative fields
      // like findingCount and durationSeconds live there). A patch is cheaper
      // for the common running→running heartbeat.
      dispatch({
        type: 'runs/patched',
        run: {
          ...({} as RunSummary),
          id: (event as SessionEvent & { sessionId: string }).sessionId,
          status: event.status,
          ...(event.timing ?? {}),
        } as RunSummary,
      });
      if (event.status !== 'running') void refreshRuns();
    }
    if (event.type === 'usage') {
      dispatch({
        type: 'runs/patched',
        run: {
          ...({} as RunSummary),
          id: (event as SessionEvent & { sessionId: string }).sessionId,
          tokenUsage: event.usage,
        },
      });
    }
    if (event.type === 'finding') {
      void refreshRuns();
    }
  }, [refreshRuns]);

  const selectSession = useCallback((id: string | undefined) => {
    streamRef.current?.close();
    streamRef.current = null;
    dispatch({ type: 'session/selected', id });
  }, []);

  // SSE lifecycle follows the selected session.
  useEffect(() => {
    if (!state.selectedId) return;
    const id = state.selectedId;
    const handle = connectSessionStream(id, {
      onEvent: applyEventToRuns,
      onSnapshot: async (snapshot) => {
        // Phase 3+ renders the full session; here we keep the run list truthful.
        dispatch({ type: 'runs/patched', run: { ...({} as RunSummary), id, ...(snapshot as Partial<RunSummary>) } as RunSummary });
      },
      onConnectionChange: (connState) => dispatch({ type: 'connection', state: connState }),
    });
    streamRef.current = handle;
    return () => {
      handle.close();
      if (streamRef.current === handle) streamRef.current = null;
    };
  }, [state.selectedId, applyEventToRuns]);

  const deleteRun = useCallback(
    async (id: string) => {
      await api(`/sessions/${id}`, { method: 'DELETE' });
      localStorage.removeItem('qase.session');
      if (id === state.selectedId) {
        selectSession(undefined);
        await refreshRuns();
        // Follow the legacy behavior: fall back to the most recent run.
        const remaining = await api<RunSummary[]>('/sessions');
        if (remaining[0]) selectSession(remaining[0].id);
      } else {
        await refreshRuns();
      }
    },
    [state.selectedId, selectSession, refreshRuns],
  );

  const value = useMemo<SessionStoreValue>(
    () => ({
      ...state,
      refreshRuns,
      selectSession,
      deleteRun,
      serverNow,
      applyEventToRuns,
    }),
    [state, refreshRuns, selectSession, deleteRun, serverNow, applyEventToRuns],
  );

  return <SessionStoreContext.Provider value={value}>{children}</SessionStoreContext.Provider>;
}

export function useSessionStore(): SessionStoreValue {
  const store = useContext(SessionStoreContext);
  if (!store) throw new Error('useSessionStore must be used inside SessionStoreProvider');
  return store;
}
