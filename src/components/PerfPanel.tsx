import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useLiveSession } from '../state/liveSession';

interface DurationsAggregate {
  runCount?: number;
  avgDurationSeconds?: number;
  medianDurationSeconds?: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  avgSecondsPerItem?: number;
}

interface TargetDuration {
  id: string;
  durationSeconds: number;
}

function formatDurationShort(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Performance panel (React port): workspace duration analytics plus a
 * same-target run comparison for the selected run. Closing only hides the
 * panel — metrics and run results are never touched.
 */
export function PerfPanel() {
  const { session } = useLiveSession();
  const [aggregate, setAggregate] = useState<DurationsAggregate | null>(null);
  const [history, setHistory] = useState<TargetDuration[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const refresh = useCallback(async () => {
    const next = await api<DurationsAggregate>('/analytics/durations').catch(() => undefined);
    setAggregate(next && next.runCount ? next : null);
    if (session?.targetUrl && typeof session.targetUrl === 'string') {
      const targetHistory = await api<TargetDuration[]>(
        `/analytics/targets/durations?targetUrl=${encodeURIComponent(session.targetUrl)}`,
      ).catch(() => []);
      setHistory(Array.isArray(targetHistory) && targetHistory.length >= 2 ? targetHistory : null);
    } else {
      setHistory(null);
    }
  }, [session?.targetUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!aggregate) return null;

  const rows: [string, string][] = [
    ['Completed runs', String(aggregate.runCount)],
    ['Average execution', formatDurationShort(aggregate.avgDurationSeconds)],
    ['Median execution', formatDurationShort(aggregate.medianDurationSeconds)],
    ['Fastest run', formatDurationShort(aggregate.minDurationSeconds)],
    ['Slowest run', formatDurationShort(aggregate.maxDurationSeconds)],
    ...(aggregate.avgSecondsPerItem !== undefined
      ? [['Avg / test item', `${aggregate.avgSecondsPerItem.toFixed(1)}s`] as [string, string]]
      : []),
  ];

  return (
    <>
      {closed ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm perf-restore"
          onClick={() => setClosed(false)}
          data-testid="perf-restore"
        >
          Show performance
        </button>
      ) : (
        <section className="perf-panel" aria-label="Performance" data-testid="perf-panel">
          <header className="perf-panel-head">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={!minimized}
              onClick={() => setMinimized((m) => !m)}
              data-testid="perf-minimize"
            >
              {minimized ? '▸' : '▾'} Performance
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setClosed(true)}
              data-testid="perf-close"
            >
              ×
            </button>
          </header>
          {!minimized && (
            <div className="perf-panel-body">
              <dl className="perf-grid">
                {rows.map(([label, value]) => (
                  <div key={label} className="perf-row">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {history && (
                <div className="perf-compare" data-testid="perf-compare">
                  <h4>{(() => {
                    try {
                      return new URL(session!.targetUrl as string).host;
                    } catch {
                      return String(session?.targetUrl);
                    }
                  })()} — run comparison</h4>
                  <ul>
                    {history.map((entry, index) => {
                      const trend =
                        index === 0 ? '' :
                        entry.durationSeconds < history[index - 1].durationSeconds ? ' ▼ faster' :
                        entry.durationSeconds > history[index - 1].durationSeconds ? ' ▲ slower' : ' → stable';
                      return (
                        <li key={entry.id} className={entry.id === session?.id ? 'is-current' : undefined}>
                          Run #{index + 1} · {formatDurationShort(entry.durationSeconds)}{trend}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
