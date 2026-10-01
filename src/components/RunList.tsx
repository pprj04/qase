import { useState } from 'react';
import {
  useSessionStore,
  formatDurationShort,
  formatTokens,
  hostOf,
  relativeTime,
  elapsedSecondsOf,
  type RunSummary,
} from '../state/sessionStore';

/**
 * Sidebar run list — live runs with status dot, elapsed/duration timer
 * (server-authoritative, frozen while paused), engine/mode/device pills,
 * finding count, token badge, mini plan-progress bar, and delete with confirm.
 */
export function RunList({ onSelect, activeId }: { onSelect?: (id: string) => void; activeId?: string }) {
  const { runs, runsLoading, selectedId, selectSession, deleteRun, serverNow } = useSessionStore();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (runsLoading) {
    return <div className="empty-hint" data-testid="run-list-loading">Loading runs…</div>;
  }
  if (runs.length === 0) {
    return <div className="empty-hint" data-testid="run-list-empty">No runs yet — start one from the composer.</div>;
  }

  const now = serverNow();
  return (
    <div role="list" data-testid="run-list">
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          active={run.id === (activeId ?? selectedId)}
          now={now}
          confirming={confirmingId === run.id}
          onSelect={() => {
            selectSession(run.id);
            onSelect?.(run.id);
          }}
          onDelete={() => setConfirmingId(run.id)}
          onCancelDelete={() => setConfirmingId(null)}
          onConfirmDelete={() => {
            setConfirmingId(null);
            void deleteRun(run.id);
          }}
        />
      ))}
    </div>
  );
}

function RunRow({
  run,
  active,
  now,
  confirming,
  onSelect,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  run: RunSummary;
  active: boolean;
  now: number;
  confirming: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const paused = Number.isFinite(run.pausedAt) && !Number.isFinite(run.completedAt);
  const elapsed = elapsedSecondsOf(run, now);
  const duration = Number.isFinite(run.completedAt) || paused
    ? run.durationSeconds ?? elapsed
    : elapsed;

  return (
    <div className={`run-row${active ? ' is-active' : ''}`} role="listitem" data-run-id={run.id}>
      <button
        type="button"
        className={`run${active ? ' is-active' : ''}`}
        aria-current={active ? 'true' : 'false'}
        onClick={onSelect}
      >
        <span className="run-title">
          {hostOf(run.targetUrl) || run.title || 'Untitled run'}
          {run.engine && run.engine !== 'chromium' && (
            <span className="run-engine-pill" title={`Run executed on ${run.engine}`}>{run.engine}</span>
          )}
        </span>
        <span className="run-meta">
          <span
            className={`dot${run.status === 'running' ? ' is-busy' : run.status === 'done' ? ' is-live' : ''}`}
            aria-hidden="true"
          />
          <span className="run-time">{relativeTime(run.updatedAt)}</span>
          {duration !== undefined && formatDurationShort(duration) && (
            <span
              className={`run-duration${run.status === 'running' && !paused ? ' run-duration--live' : ''}${paused ? ' run-duration--paused' : ''}`}
              title={paused ? 'Paused — resumes from this duration' : run.status === 'running' ? 'Elapsed time' : 'Total duration'}
            >
              {paused ? '⏸' : '⏱'} {formatDurationShort(duration)}
            </span>
          )}
          {run.mode === 'sqa' && <span className="run-mode-badge" title="Software quality assurance assessment">SQA</span>}
          {run.mode === 'founder' && <span className="run-mode-badge run-mode-badge--founder" title="Founder Mode review">Founder</span>}
          {typeof run.findingCount === 'number' && run.findingCount > 0 && (
            <span className="run-badge">{run.findingCount}</span>
          )}
          {run.tokenUsage && Number.isFinite(run.tokenUsage.totalTokens) && (run.tokenUsage.totalTokens ?? 0) > 0 && (
            <span
              className="run-badge run-badge--tokens"
              title={`${(run.tokenUsage.inputTokens ?? 0).toLocaleString()} prompt / ${(run.tokenUsage.outputTokens ?? 0).toLocaleString()} completion tokens`}
            >
              {formatTokens(run.tokenUsage.totalTokens as number)} tok
            </span>
          )}
          {run.device && run.device !== 'desktop' && (
            <span className="run-device-pill">{run.device}{run.deviceLandscape ? ' – L' : ''}</span>
          )}
        </span>
        {(run.todoTotal ?? 0) > 0 && (
          <span className="run-progress">
            <span className="run-progress-steps">{run.todoCompleted}/{run.todoTotal}</span>
            <span
              className="run-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(((run.todoCompleted ?? 0) / (run.todoTotal as number)) * 100)}
              aria-label={`Plan progress ${run.todoCompleted} of ${run.todoTotal} steps`}
            >
              <i style={{ width: `${Math.round(((run.todoCompleted ?? 0) / (run.todoTotal as number)) * 100)}%` }} />
            </span>
          </span>
        )}
      </button>
      {confirming ? (
        <span className="run-del-confirm">
          <span>Delete this run?</span>
          <button type="button" className="btn btn-sm btn-danger-ghost" onClick={onConfirmDelete}>Delete</button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onCancelDelete}>Keep</button>
        </span>
      ) : (
        <button
          type="button"
          className="run-del"
          aria-label={`Delete run ${hostOf(run.targetUrl) || run.title || run.id}`}
          title="Delete this run"
          onClick={onDelete}
        >
          ×
        </button>
      )}
    </div>
  );
}
