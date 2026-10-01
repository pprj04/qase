import { api } from './client';

/**
 * SSE session stream — port of the legacy connect()/handleEvent wiring.
 * EventSource with snapshot resync on (re)open, revision guard so a snapshot
 * in flight never overwrites events that arrived meanwhile, and a dispatcher
 * covering every event type the server emits.
 */

export type SessionEvent =
  | { type: 'frame'; frame: unknown; sessionId?: string }
  | { type: 'cursor'; cursor: unknown; sessionId?: string }
  | { type: 'message'; message: SessionMessage; sessionId?: string }
  | { type: 'message_delta'; id: string; content: string; role?: string; sessionId?: string }
  | { type: 'message_done'; message?: SessionMessage; sessionId?: string }
  | { type: 'activity'; activity: SessionActivity; sessionId?: string }
  | { type: 'todos'; todos: unknown[]; sessionId?: string }
  | { type: 'context'; context: unknown; sessionId?: string }
  | { type: 'usage'; usage: TokenUsage; sessionId?: string }
  | { type: 'finding'; finding: Finding; sessionId?: string }
  | { type: 'report'; report: unknown; sessionId?: string }
  | { type: 'sqa'; assessment: unknown; final?: boolean; ts?: number; sessionId?: string }
  | { type: 'founder.created'; schemaVersion?: number; categories?: string[]; sessionId?: string }
  | { type: 'founder.target_bound'; targetUrl: string; authorizedTargetUrl?: string; title?: string; sessionId?: string }
  | { type: 'founder.observation'; observation?: { id: string } & Record<string, unknown>; sessionId?: string }
  | { type: 'founder.finalized'; report?: { generatedAt?: string } & Record<string, unknown>; ts?: number; sessionId?: string }
  | { type: 'question'; question: unknown; sessionId?: string }
  | { type: 'status'; status: string; detail?: string; ts?: number; timing?: StatusTiming; sessionId?: string }
  | { type: 'browser'; browser?: { url?: string }; sessionId?: string }
  | { type: 'session'; targetUrl?: string; title?: string; sessionId?: string };

export interface SessionMessage {
  id: string;
  role: string;
  /** Legacy snapshot stores message bodies as `text`; SSE deltas use `content`. */
  text?: string;
  content?: string;
  [key: string]: unknown;
}
export interface SessionActivity {
  id: string;
  label?: string;
  detail?: string;
  status?: string;
  [key: string]: unknown;
}
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimated?: boolean;
}
export interface Finding {
  id: string;
  title: string;
  severity: string;
  [key: string]: unknown;
}
export interface StatusTiming {
  serverNow?: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  pausedAt?: number;
  pausedSeconds?: number;
  failureReason?: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

export interface SessionStreamHandle {
  ready: Promise<void>;
  close: () => void;
}

export function connectSessionStream(
  sessionId: string,
  handlers: {
    onEvent: (event: SessionEvent) => void;
    onSnapshot: (snapshot: Record<string, unknown>) => void | Promise<void>;
    onConnectionChange?: (state: ConnectionState) => void;
  },
  fetchSnapshot: (id: string) => Promise<Record<string, unknown>> = (id) =>
    api<Record<string, unknown>>(`/sessions/${id}`),
): SessionStreamHandle {
  const stream = new EventSource(`/api/sessions/${sessionId}/events`);
  let closed = false;
  let finishReady: () => void;
  const ready = new Promise<void>((resolve) => {
    finishReady = resolve;
  });
  // An unavailable stream must not lock the workspace; EventSource keeps
  // reconnecting. Healthy launchers wait for subscription before starting work.
  const timer = setTimeout(() => finishReady(), 5000);
  const connected = () => {
    clearTimeout(timer);
    finishReady();
  };
  let eventRevision = 0;
  let resyncTimer: ReturnType<typeof setTimeout> | undefined;

  const resync = async () => {
    if (closed) return;
    const revision = eventRevision;
    try {
      const snapshot = await fetchSnapshot(sessionId);
      if (closed) return;
      // Never overwrite events that arrived while the snapshot was in flight.
      // Retry after a quiet interval; EventSource keeps applying live updates.
      if (revision !== eventRevision) {
        resyncTimer = setTimeout(resync, 250);
        return;
      }
      await handlers.onSnapshot(snapshot);
    } catch {
      if (!closed) resyncTimer = setTimeout(resync, 1000);
    } finally {
      connected();
    }
  };

  stream.onopen = () => {
    if (closed) return;
    handlers.onConnectionChange?.('connected');
    clearTimeout(resyncTimer);
    void resync();
  };
  stream.onerror = () => {
    connected();
    clearTimeout(resyncTimer);
    if (closed) return;
    handlers.onConnectionChange?.('reconnecting');
  };
  stream.onmessage = (event: MessageEvent<string>) => {
    if (closed) return;
    const data = JSON.parse(event.data) as SessionEvent;
    if (data.sessionId === undefined || data.sessionId === sessionId) {
      eventRevision += 1;
      handlers.onEvent(data);
    }
  };

  handlers.onConnectionChange?.('connecting');
  return {
    ready,
    close: () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(resyncTimer);
      stream.close();
    },
  };
}
