import { useEffect, useMemo, useState } from 'react';
import { useLiveSession } from '../state/liveSession';
import { renderMarkdown } from '../lib/markdown';
import type { Finding } from '../api/sse';
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

type Tab = 'browser' | 'findings' | 'report';

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

  return (
    <div className={`viewer-pane${overlayHidden ? ' is-overlay-hidden' : ''}`} data-testid={overlayHidden ? undefined : 'viewer-pane'}>
      <div className="viewer-tabs" role="tablist" aria-label="Viewer panels">
        {(['browser', 'findings', 'report'] as Tab[]).map((id) => (
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
            {id === 'browser' ? 'Browser' : id === 'findings' ? `Findings${session?.findings.length ? ` (${session.findings.length})` : ''}` : 'Report'}
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
              <img src={frameSrc} alt="Live browser view" />
            ) : (
              <div className="empty-hint">
                {session ? 'The browser view appears when the run drives a page.' : 'Select a run to see its live browser view.'}
              </div>
            )}
          </div>
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

      <div role="tabpanel" id="panel-findings" aria-labelledby="tab-findings" hidden={tab !== 'findings'} className="viewer-tabpanel">
        <FindingsList findings={session?.findings ?? []} />
      </div>

      <div role="tabpanel" id="panel-report" aria-labelledby="tab-report" hidden={tab !== 'report'} className="viewer-tabpanel">
        <ReportView />
      </div>
    </div>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
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

function ReportView() {
  const { session } = useLiveSession();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setMarkdown(null);
    setError('');
    fetch(`/api/sessions/${session.id}/report.md`, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Report not available (${response.status})`);
        return response.text();
      })
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
