import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import {
  connectSessionStream,
  type ConnectionState,
  type Finding,
  type SessionEvent,
  type SessionMessage,
  type SessionStreamHandle,
} from '../api/sse';
import { useAuth } from './authStore';
import type { RunSummary } from './sessionStore';

export interface LiveSession {
  id: string;
  status: string;
  mode?: string;
  title?: string;
  targetUrl?: string;
  messages: SessionMessage[];
  deltas: Record<string, string>;
  thinkingText: string;
  thinkingAction: string;
  pendingQuestion: PendingQuestion | undefined;
  findings: Finding[];
  report?: unknown;
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
  browserUrl?: string;
  frame?: { base64: string; mimeType: string } | undefined;
  cursor?: { x: number; y: number } | undefined;
  startedAt?: number;
  completedAt?: number;
  pausedAt?: number;
  pausedSeconds?: number;
  failureReason?: string;
}

export interface PendingQuestion {
  question: string;
  summary?: string;
  options?: { label: string; description?: string }[];
  allowCustom?: boolean;
  customPlaceholder?: string;
  customLabel?: string;
  credential?: boolean;
  usernameLabel?: string;
  passwordLabel?: string;
  otpLabel?: string;
  [key: string]: unknown;
}

interface LiveState {
  session: LiveSession | undefined;
  connection: ConnectionState;
  skewMs: number;
}

type LiveAction =
  | { type: 'session/snapshot'; session: Partial<LiveSession> & { id: string } }
  | { type: 'session/clear' }
  | { type: 'message'; message: SessionMessage }
  | { type: 'delta'; id: string; content: string }
  | { type: 'thinking'; text?: string; action?: string; reset?: boolean }
  | { type: 'question'; question: PendingQuestion | undefined }
  | { type: 'finding'; finding: Finding }
  | { type: 'report'; report: unknown }
  | { type: 'usage'; usage: NonNullable<LiveSession['usage']> }
  | { type: 'browser'; url?: string }
  | { type: 'frame'; frame: { base64: string; mimeType: string } }
  | { type: 'cursor'; cursor: { x: number; y: number } }
  | { type: 'status'; status: string }
  | { type: 'connection'; state: ConnectionState };

function liveReducer(state: LiveState, action: LiveAction): LiveState {
  const withSession = (patch: Partial<LiveSession>): LiveState =>
    state.session ? { ...state, session: { ...state.session, ...patch } } : state;

  switch (action.type) {
    case 'session/snapshot':
      return {
        ...state,
        session: {
          ...(({ id: action.session.id, status: 'idle', messages: [], deltas: {}, thinkingText: '', thinkingAction: '', findings: [], pendingQuestion: undefined }) as unknown as LiveSession),
          ...action.session,
          messages: action.session.messages ?? state.session?.messages ?? [],
          deltas: state.session?.deltas ?? {},
          thinkingText: state.session?.thinkingText ?? '',
          thinkingAction: state.session?.thinkingAction ?? '',
          findings: action.session.findings ?? state.session?.findings ?? [],
          pendingQuestion: action.session.pendingQuestion ?? state.session?.pendingQuestion,
        },
      };
    case 'session/clear':
      return { session: undefined, connection: 'connecting', skewMs: state.skewMs };
    case 'message': {
      if (!state.session) return state;
      if (action.message.role === 'thinking') return state;
      const messages = state.session.messages.some((m) => m.id === action.message.id)
        ? state.session.messages
        : [...state.session.messages, action.message];
      // A real message supersedes its streamed delta.
      const deltas = { ...state.session.deltas };
      delete deltas[action.message.id];
      return { ...state, session: { ...state.session, messages, deltas, thinkingText: '', thinkingAction: '' } };
    }
    case 'delta': {
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          deltas: { ...state.session.deltas, [action.id]: (state.session.deltas[action.id] ?? '') + action.content },
        },
      };
    }
    case 'thinking':
      return withSession({
        thinkingText: action.reset ? '' : (action.text ?? state.session?.thinkingText ?? ''),
        thinkingAction: action.reset ? '' : (action.action ?? state.session?.thinkingAction ?? ''),
      });
    case 'question':
      return withSession({ pendingQuestion: action.question });
    case 'finding': {
      if (!state.session) return state;
      const findings = state.session.findings.some((f) => f.id === action.finding.id)
        ? state.session.findings
        : [...state.session.findings, action.finding];
      return { ...state, session: { ...state.session, findings } };
    }
    case 'report':
      return withSession({ report: action.report });
    case 'usage':
      return withSession({ usage: action.usage });
    case 'browser':
      return action.url ? withSession({ browserUrl: action.url }) : state;
    case 'frame':
      return withSession({ frame: action.frame });
    case 'cursor':
      return withSession({ cursor: action.cursor });
    case 'status':
      return withSession({ status: action.status });
    case 'connection':
      return { ...state, connection: action.state };
    default:
      return state;
  }
}

interface LiveContextValue extends LiveState {
  openSession: (id: string) => void;
  closeSession: () => void;
  sendMessage: (text: string) => Promise<void>;
  sendAnswer: (answer: string) => Promise<void>;
  storeCredentials: (fields: Record<string, string>) => Promise<void>;
  stopRun: () => Promise<void>;
}

const LiveContext = createContext<LiveContextValue | null>(null);

function isCredentialQuestion(question: PendingQuestion | undefined): boolean {
  if (!question) return false;
  if (question.credential) return true;
  if ((question as { kind?: string }).kind === 'credential') return true;
  return /password|credential|login|sign in|otp/i.test(question.question);
}

export function LiveSessionProvider({ children, onRunEvent }: { children: ReactNode; onRunEvent?: (event: SessionEvent) => void }) {
  const [state, dispatch] = useReducer(liveReducer, { session: undefined, connection: 'connecting', skewMs: 0 });
  const streamRef = useRef<SessionStreamHandle | null>(null);
  const { status: authStatus } = useAuth();

  const handleEvent = useCallback(
    (event: SessionEvent) => {
      onRunEvent?.(event);
      switch (event.type) {
        case 'message':
          dispatch({ type: 'message', message: event.message });
          break;
        case 'message_delta':
          if (event.role === 'thinking') {
            dispatch({ type: 'thinking', text: (event.content ?? '') });
          } else {
            dispatch({ type: 'delta', id: event.id, content: event.content });
            dispatch({ type: 'thinking', reset: true });
          }
          break;
        case 'message_done':
          if (event.message) dispatch({ type: 'message', message: event.message });
          break;
        case 'activity':
          if (event.activity.status === 'running') {
            dispatch({ type: 'thinking', action: `${event.activity.label ?? ''}${event.activity.detail ? ` — ${event.activity.detail}` : ''}` });
          }
          break;
        case 'todos':
        case 'context':
        case 'sqa':
        case 'founder.created':
        case 'founder.target_bound':
        case 'founder.observation':
        case 'founder.finalized':
          // Rendered in later phases; run-list side effects handled by caller.
          break;
        case 'usage':
          dispatch({ type: 'usage', usage: event.usage });
          break;
        case 'finding':
          dispatch({ type: 'finding', finding: event.finding });
          break;
        case 'report':
          dispatch({ type: 'report', report: event.report });
          break;
        case 'question':
          dispatch({ type: 'question', question: event.question as PendingQuestion });
          break;
        case 'status':
          dispatch({ type: 'status', status: event.status });
          if (event.timing?.serverNow) {
            // skew handled via onRunEvent consumer
          }
          break;
        case 'browser':
          dispatch({ type: 'browser', url: event.browser?.url });
          break;
        case 'session':
          if (event.targetUrl && state.session) {
            // Patch the CURRENT session — never dispatch a synthetic id.
            dispatch({ type: 'session/snapshot', session: { id: state.session.id, targetUrl: event.targetUrl, title: event.title } });
          }
          break;
        case 'frame':
          if (event.frame && typeof event.frame === 'object' && 'base64' in (event.frame as Record<string, unknown>)) {
            const f = event.frame as { base64: string; mimeType: string };
            dispatch({ type: 'frame', frame: f });
          }
          break;
        case 'cursor':
          dispatch({ type: 'cursor', cursor: event.cursor as { x: number; y: number } });
          break;
        default:
          break;
      }
    },
    [onRunEvent],
  );

  const openSession = useCallback((id: string) => {
    streamRef.current?.close();
    dispatch({ type: 'session/clear' });
    const handle = connectSessionStream(
      id,
      {
        onEvent: handleEvent,
        onSnapshot: async (snapshot) => {
          dispatch({ type: 'session/snapshot', session: { id, ...(snapshot as Partial<LiveSession>) } });
        },
        onConnectionChange: (conn) => dispatch({ type: 'connection', state: conn }),
      },
      async (sessionId) => {
        const snap = await api<Record<string, unknown>>(`/sessions/${sessionId}`);
        return { ...snap, sessionId: undefined } as Record<string, unknown>;
      },
    );
    streamRef.current = handle;
  }, [handleEvent]);

  const closeSession = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    dispatch({ type: 'session/clear' });
  }, []);

  useEffect(() => () => streamRef.current?.close(), []);

  // Don't hold a stream across sign-out.
  useEffect(() => {
    if (authStatus !== 'signed-in') closeSession();
  }, [authStatus, closeSession]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!state.session || !text.trim()) return;
      dispatch({
        type: 'message',
        message: { id: `local-${Date.now()}`, role: 'user', text },
      });
      await api(`/sessions/${state.session.id}/message`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
    },
    [state.session],
  );

  const sendAnswer = useCallback(
    async (answer: string) => {
      if (!state.session) return;
      dispatch({ type: 'question', question: undefined });
      await api(`/sessions/${state.session.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      }).catch(() => undefined);
    },
    [state.session],
  );

  /**
   * Store credentials in the run vault (POST /sessions/:id/credentials).
   * Values are encrypted per-run and swapped in at the keyboard — the model
   * only ever sees {{QA_USERNAME}}-style placeholders. Exact legacy parity.
   */
  const storeCredentials = useCallback(
    async (fields: Record<string, string>) => {
      if (!state.session || Object.keys(fields).length === 0) {
        throw new Error('No credentials supplied.');
      }
      dispatch({ type: 'question', question: undefined });
      await api(`/sessions/${state.session.id}/credentials`, {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });
    },
    [state.session],
  );

  const stopRun = useCallback(async () => {
    if (!state.session) return;
    await api(`/sessions/${state.session.id}/stop`, { method: 'POST' }).catch(() => undefined);
  }, [state.session]);

  const value = useMemo<LiveContextValue>(
    () => ({ ...state, openSession, closeSession, sendMessage, sendAnswer, storeCredentials, stopRun }),
    [state, openSession, closeSession, sendMessage, sendAnswer, storeCredentials, stopRun],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveSession(): LiveContextValue {
  const live = useContext(LiveContext);
  if (!live) throw new Error('useLiveSession must be used inside LiveSessionProvider');
  return live;
}

export { isCredentialQuestion };
export type { RunSummary };
