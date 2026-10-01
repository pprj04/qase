import { useEffect, useMemo, useRef, useState } from 'react';
import { apiText } from '../api/client';
import { useLiveSession } from '../state/liveSession';
import type { LiveSession, LiveCursor, SessionActivity } from '../state/liveSession';
import { renderMarkdown } from '../lib/markdown';
import type { Finding } from '../api/sse';
import { SqaView } from './SqaView';
import { FounderView } from './FounderView';
import { QaReportView } from './QaReportView';
const STAGE_COLLAPSE_STATUSES = new Set(['done', 'error', 'interrupted', 'idle']);

export type StageCollapseState = { collapsed: boolean; manualExpand: boolean };

/**
 * Pure transition for the live-view auto-collapse (React port of the legacy
 * stage-collapse behavior, ticket #13998):
 * - expanded while running / awaiting input
 * - collapses on transition into a terminal status, unless the user manually expanded
 * - new run restores the live layout and clears the manual override
 */
export function nextStageCollapse(
  previous: StageCollapseState,
  prevStatus: string | undefined,
  status: string,
): StageCollapseState {
  if (prevStatus === status) return previous;
  const wasRunning = prevStatus === 'running' || prevStatus === 'awaiting_input';
  if (status === 'running' || status === 'awaiting_input') {
    return { collapsed: false, manualExpand: false };
  }
  if (wasRunning && STAGE_COLLAPSE_STATUSES.has(status) && !previous.manualExpand) {
    return { collapsed: true, manualExpand: false };
  }
  return previous;
}

type Tab = 'browser' | 'activity' | 'plan' | 'findings' | 'report';

/**
 * Browser viewer panel — live screenshot frame (base64 data URL), URL bar,
 * and Activity/Findings/Report tabs. The live view auto-collapses when a run
 * reaches a terminal status (port of the legacy stage-collapse behavior from
 * ticket #13998) and restores on a new run. Manual expand persists per session.
 */
export function ViewerPanel() {
  const { session } = useLiveSession();
  const [tab, setTab] = useState<Tab>('browser');
  // At ≤900px the viewer becomes an overlay; this dismisses it so it can't
  // opaquely cover the transcript (restored by clicking any tab in the rail
  // or re-selecting a run).
  const [overlayHidden, setOverlayHidden] = useState(false);
  const sessionId = session?.id;
  // Manual overrides are per-session (legacy state.stageExpanded parity):
  // keying by id means expanding run A never suppresses auto-collapse on run B.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [statusSeen, setStatusSeen] = useState<{ id: string; status: string } | undefined>(undefined);
  const [stage, setStage] = useState<StageCollapseState>({ collapsed: false, manualExpand: false });

  const status = session?.status ?? 'idle';
  const hasContent = Boolean(session && (session.messages.length > 0 || session.findings.length > 0 || session.frame));
  const manualExpand = sessionId !== undefined && overrides[sessionId] === true;

  // Track per-session status; reset when switching to a different run so its
  // snapshot status doesn't fire a spurious running→terminal transition.
  useEffect(() => {
    if (!sessionId) {
      setStatusSeen(undefined);
      setStage({ collapsed: false, manualExpand: false });
      return;
    }
    if (statusSeen?.id !== sessionId) {
      setStatusSeen({ id: sessionId, status });
      // Loading a terminal-status session: start collapsed unless the user
      // previously expanded this session.
      setStage(
        STAGE_COLLAPSE_STATUSES.has(status)
          ? { collapsed: !manualExpand, manualExpand }
          : { collapsed: false, manualExpand: false },
      );
      return;
    }
    if (statusSeen.status === status) return;
    setStage((prev) => nextStageCollapse({ ...prev, manualExpand }, statusSeen.status, status));
    setStatusSeen({ id: sessionId, status });
  }, [sessionId, status, statusSeen, manualExpand]);

  const toggleStage = (collapsed: boolean) => {
    setStage({
      collapsed,
      // Expanding during a terminal status is a manual override (per-session);
      // collapsing again clears it so the next run's completion auto-collapses.
      manualExpand: collapsed ? false : STAGE_COLLAPSE_STATUSES.has(status),
    });
    if (sessionId && !collapsed) setOverrides((prev) => ({ ...prev, [sessionId]: true }));
    if (sessionId && collapsed) setOverrides((prev) => ({ ...prev, [sessionId]: false }));
  };

  const frameSrc = useMemo(() => {
    if (!session?.frame?.base64) return undefined;
    const mime = session.frame.mimeType || 'image/png';
    return `data:${mime};base64,${session.frame.base64}`;
  }, [session?.frame]);

  const todos = (session?.todos as PlanTodo[] | undefined) ?? [];
  const planDone = todos.length > 0
    ? todos.filter((t) => t.status === 'completed').length
    : null;
  const frameRef = useRef<HTMLImageElement>(null);
  // Cursor overlay geometry recomputes when the image (re)loads or the cursor
  // event updates; positioning is relative to the drawn frame.
  const [, forceReposition] = useState(0);
  const repositionOverlay = () => forceReposition((n) => n + 1);

  return (
    <div className={`viewer-pane${overlayHidden ? ' is-overlay-hidden' : ''}`} data-testid={overlayHidden ? undefined : 'viewer-pane'}>
      <div className="viewer-tabs" role="tablist" aria-label="Viewer panels">
        {(['browser', 'activity', 'plan', 'findings', 'report'] as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={`viewer-tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
            data-testid={`viewer-tab-${id}`}
          >
            {id === 'browser'
              ? 'Browser'
              : id === 'activity'
                ? 'Activity'
                : id === 'plan'
                  ? `Plan${planDone !== null ? ` (${planDone}/${(session?.todos as PlanTodo[] | undefined)?.length ?? 0})` : ''}`
                  : id === 'findings'
                    ? `Findings${session?.findings.length ? ` (${session.findings.length})` : ''}`
                    : 'Report'}
          </button>
        ))}
        <button
          type="button"
          className="icon-btn viewer-overlay-close"
          aria-label="Hide browser panel"
          onClick={() => setOverlayHidden(true)}
          data-testid="viewer-overlay-close"
        >
          ×
        </button>
      </div>

      <div
        role="tabpanel"
        id="panel-browser"
        aria-labelledby="tab-browser"
        hidden={tab !== 'browser'}
        className="viewer-stage-wrap"
      >
        <div className={`viewer-stage${stage.collapsed ? ' is-collapsed' : ''}`} data-testid="viewer-stage">
          <div className="stage-url">
            <span className="stage-url-text" data-testid="browser-url">{session?.browserUrl ?? 'about:blank'}</span>
            {stage.collapsed && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => toggleStage(false)}
                aria-expanded="false"
                data-testid="stage-expand"
              >
                Expand
              </button>
            )}
          </div>
          <div className="stage-frame" data-testid="stage-frame">
            {frameSrc ? (
              <>
                <img src={frameSrc} alt="Live browser view" ref={frameRef} onLoad={repositionOverlay} />
                <CursorOverlay session={session} frameRef={frameRef} />
              </>
            ) : (
              <div className="empty-hint">
                {session ? 'The browser view appears when the run drives a page.' : 'Select a run to see its live browser view.'}
              </div>
            )}
          </div>
          {stage.collapsed && (
            <div className="stage-note" data-testid="stage-note">Run complete — live view collapsed</div>
          )}
        </div>
        {!stage.collapsed && hasContent && STAGE_COLLAPSE_STATUSES.has(status) && (
          <button
            type="button"
            className="btn btn-ghost btn-sm stage-collapse-btn"
            onClick={() => toggleStage(true)}
            data-testid="stage-collapse"
          >
            Collapse live view
          </button>
        )}
      </div>

      <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" hidden={tab !== 'activity'} className="viewer-tabpanel">
        <ActivityFeed activities={session?.activities ?? []} />
      </div>

      <div role="tabpanel" id="panel-plan" aria-labelledby="tab-plan" hidden={tab !== 'plan'} className="viewer-tabpanel">
        <PlanList todos={(session?.todos as PlanTodo[] | undefined) ?? []} />
      </div>

      <div role="tabpanel" id="panel-findings" aria-labelledby="tab-findings" hidden={tab !== 'findings'} className="viewer-tabpanel">
        <FindingsList findings={session?.findings ?? []} />
      </div>

      <div role="tabpanel" id="panel-report" aria-labelledby="tab-report" hidden={tab !== 'report'} className="viewer-tabpanel">
        <ModeReportView />
      </div>
    </div>
  );
}

/**
 * Mode-aware report surface: SQA sessions render the assessment view,
 * Founder sessions the founder brief, everything else the enriched QA report
 * (which still falls back to the raw markdown when no structured report
 * payload exists yet).
 */
function ModeReportView() {
  const { session } = useLiveSession();
  if (!session) {
    return <div className="empty-hint">Select a run to see its report.</div>;
  }
  if (session.mode === 'sqa') {
    return <SqaView session={session as never} />;
  }
  if (session.mode === 'founder') {
    return <FounderView session={session as never} />;
  }
  // Structured report payload present → enriched QA report; otherwise the
  // markdown fallback.
  return session.report
    ? <QaReportView session={session as never} />
    : <ReportView />;
}

/**
 * Pointer overlay (legacy applyCursor parity): the agent's cursor, an
 * optional target box, and a label, scaled from the page's viewport space
 * onto the drawn frame. Fades ~1.5s after a *:done verb completes an action.
 */
function CursorOverlay({ session, frameRef }: { session: LiveSession | undefined; frameRef: React.RefObject<HTMLImageElement | null> }) {
  const cursor = session?.cursor as LiveCursor | undefined;
  const viewport = cursor?.viewport ?? session?.frame?.viewport;
  const [visible, setVisible] = useState(false);

  const geometry = useMemo(() => {
    if (!cursor || cursor.x === undefined || !viewport) return null;
    const img = frameRef.current;
    const width = img?.getBoundingClientRect().width;
    if (!width) return null;
    const scale = width / viewport.width;
    const pos = { left: cursor.x * scale, top: cursor.y * scale };
    const box = cursor.box
      ? { left: cursor.box.x * scale, top: cursor.box.y * scale, width: cursor.box.width * scale, height: cursor.box.height * scale }
      : undefined;
    return { pos, box };
  }, [cursor, viewport, frameRef, visible]);

  // A completed pointer action flashes, then everything fades out (legacy
  // cursorTimer 1500ms behavior).
  useEffect(() => {
    if (!cursor) return;
    setVisible(true);
    if (cursor.verb?.endsWith(':done')) {
      const t = setTimeout(() => setVisible(false), 1500);
      return () => clearTimeout(t);
    }
  }, [cursor]);

  if (!geometry || !visible) return null;
  return (
    <div className="cursor-overlay" aria-hidden="true" data-testid="cursor-overlay">
      {geometry.box && <div className="target-box" style={geometry.box} />}
      <div className="cursor-pointer" style={geometry.pos}>
        <svg viewBox="0 0 24 24" width="24" height="24">
          <path d="M5 2.5 19 12.2l-6.1.55 3.2 6.6-2.6 1.25-3.2-6.6L5 18.6Z"
                fill="#fff" stroke="#0b0d12" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
        {cursor?.label ? <span className="cursor-label">{cursor.label}</span> : null}
      </div>
    </div>
  );
}

/**
 * Activity feed (legacy renderActivity parity): status icon, label, detail
 * (error > summary > detail), and a wall-clock timestamp.
 */
function ActivityFeed({ activities }: { activities: SessionActivity[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  // New entries keep the feed pinned to the bottom (legacy scrollFeed).
  useEffect(() => {
    const pane = feedRef.current?.parentElement;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [activities]);

  if (activities.length === 0) {
    return <div className="empty-hint" data-testid="activity-empty">Nothing yet</div>;
  }
  return (
    <div className="activity-feed" role="list" data-testid="activity-feed" ref={feedRef}>
      {activities.map((a) => {
        const detail = (a.error ?? a.summary ?? a.detail) as string | undefined;
        const ts = typeof a.ts === 'string' || typeof a.ts === 'number' ? new Date(a.ts) : undefined;
        return (
          <div key={a.id} className={`act ${a.status ?? ''}`} role="listitem" data-activity-id={a.id}>
            <span className="act-icon" aria-hidden="true">
              {a.status === 'running' ? '◉' : a.status === 'failed' ? '✕' : '●'}
            </span>
            <div className="act-main">
              <div className="act-label">{a.label}</div>
              {detail ? <div className="act-detail" title={detail}>{detail}</div> : null}
            </div>
            {ts && !Number.isNaN(ts.getTime()) ? (
              <span className="act-time">{ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface PlanTodo {
  id?: string;
  text: string;
  status: string;
}

/** Test plan checklist (legacy renderTodos parity). */
function PlanList({ todos }: { todos: PlanTodo[] }) {
  if (todos.length === 0) {
    return <div className="empty-hint" data-testid="plan-empty">The agent has not written a test plan yet</div>;
  }
  return (
    <div className="plan-list" role="list" data-testid="plan-list">
      {todos.map((t, i) => (
        <div key={t.id ?? i} className={`todo ${t.status}`} role="listitem">
          <span className="todo-mark" aria-hidden="true">
            {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◉' : '○'}
          </span>
          <span className="todo-text">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {  if (findings.length === 0) {
    return <div className="empty-hint" data-testid="findings-empty">No findings recorded yet.</div>;
  }
  return (
    <div className="findings-list" data-testid="findings-list">
      {findings.map((finding) => {
        const severity = String(finding.severity);
        const evidence = finding.evidence as string | undefined;
        const detail = finding.detail as string | undefined;
        return (
          <div key={finding.id} className={`finding-card finding--${severity.toLowerCase()}`} data-finding-id={finding.id}>
            <div className="finding-head">
              <span className="finding-severity">{severity}</span>
              {evidence && <span className="finding-evidence-tag">evidence</span>}
            </div>
            <p className="finding-title">{finding.title}</p>
            {detail && <p className="finding-detail">{detail}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Markdown fallback: rendered when no structured report payload exists yet
 * (e.g. a run that finished before the structured report event arrived).
 * Uses apiText so CSRF/auth handling matches every other surface.
 */
function ReportView() {
  const { session } = useLiveSession();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setMarkdown(null);
    setError('');
    apiText(`/sessions/${session.id}/report.md`)
      .then((text) => { if (!cancelled) setMarkdown(text); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [session?.id, session?.report]);

  if (!session) {
    return <div className="empty-hint">Select a run to see its report.</div>;
  }
  if (error) {
    return <div className="empty-hint" data-testid="report-error">{error}</div>;
  }
  if (markdown === null) {
    return <div className="empty-hint">Loading report…</div>;
  }
  return (
    <div className="report-view md" data-testid="report-view" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
  );
}
