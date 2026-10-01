import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../state/toastStore';

export const BUG_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  fixed: 'Fixed',
  wont_fix: "Won't fix",
};

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

interface BugRow {
  id: string;
  runId: string;
  runTitle?: string;
  title: string;
  severity: string;
  status: string;
  category?: string;
  url?: string;
  ts?: number;
  expected?: string;
  actual?: string;
  evidence?: string;
  steps?: string[];
  statusNote?: string;
  statusTs?: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Bug tracker view — the cross-run backlog (React port of bugsView.js).
 * Exclusive region replacing the workspace while open. Status changes are
 * optimistic and roll back with a toast if the server rejects.
 */
export function BugsView({ open, onClose, onOpenRun }: { open: boolean; onClose: () => void; onOpenRun: (runId: string) => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<BugRow[]>([]);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [runId, setRunId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | undefined>(undefined);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (severity) params.set('severity', severity);
      if (runId) params.set('run', runId);
      if (search) params.set('q', search);
      const query = params.toString();
      const payload = await api<{ findings?: BugRow[] }>(`/findings${query ? `?${query}` : ''}`);
      setRows(payload.findings ?? []);
    } finally {
      setLoading(false);
    }
  }, [status, severity, runId, search]);

  // Initial + filter-change loads.
  useEffect(() => {
    if (!open) return;
    void load().catch(() => undefined);
  }, [open, load]);

  // Slow live refresh while open (per-run SSE can't see other runs' findings).
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void load().catch(() => undefined), 10_000);
    return () => clearInterval(timer);
  }, [open, load]);

  const onSearchInput = (value: string) => {
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setSearch(value.trim()), 300);
  };

  const changeStatus = async (row: BugRow, next: string) => {
    const previous = row.status;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
    try {
      const payload = await api<{ finding?: { statusTs?: number; statusNote?: string } }>(
        `/sessions/${row.runId}/findings/${row.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) },
      );
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, statusTs: payload.finding?.statusTs ?? Date.now(), statusNote: payload.finding?.statusNote ?? r.statusNote }
            : r,
        ),
      );
      toast(`Marked "${row.title}" as ${(BUG_STATUS_LABELS[next] ?? next).toLowerCase()}.`);
    } catch (error) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: previous } : r)));
      toast(error instanceof Error ? error.message : String(error), 'bad');
    }
  };

  const runOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      if (!seen.has(row.runId)) seen.set(row.runId, row.runTitle ?? row.runId);
    }
    return [...seen.entries()];
  }, [rows]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { open: 0, in_progress: 0, fixed: 0, wont_fix: 0 };
    for (const row of rows) {
      if (counts[row.status] !== undefined) counts[row.status] += 1;
    }
    return counts;
  }, [rows]);

  if (!open) return null;

  return (
    <div className="bugs-view" role="region" aria-label="Bug tracker" data-testid="bugs-view">
      <header className="bugs-head">
        <h2>Bugs</h2>
        <button type="button" className="icon-btn" aria-label="Close bug tracker" onClick={onClose} data-testid="bugs-close">×</button>
      </header>

      <div className="bugs-toolbar">
        <div className="chip-row" role="group" aria-label="Filter by status" data-testid="bugs-status-filter">
          <button type="button" className={`chip${status === '' ? ' is-active' : ''}`} aria-pressed={status === ''} onClick={() => setStatus('')}>
            All
          </button>
          {Object.entries(BUG_STATUS_LABELS).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`chip${status === value ? ' is-active' : ''}`}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
              data-status={value}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="chip-row" role="group" aria-label="Filter by severity" data-testid="bugs-severity-filter">
          <button type="button" className={`chip${severity === '' ? ' is-active' : ''}`} aria-pressed={severity === ''} onClick={() => setSeverity('')}>
            All severities
          </button>
          {SEVERITIES.map((value) => (
            <button
              key={value}
              type="button"
              className={`chip sev-chip sev--${value}${severity === value ? ' is-active' : ''}`}
              aria-pressed={severity === value}
              onClick={() => setSeverity(value)}
              data-severity={value}
            >
              {value}
            </button>
          ))}
        </div>
        <select
          className="bugs-run-filter"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
          aria-label="Filter by run"
          data-testid="bugs-run-filter"
        >
          <option value="">All runs</option>
          {runOptions.map(([id, title]) => (
            <option key={id} value={id}>{title}</option>
          ))}
        </select>
        <input
          className="bugs-search"
          placeholder="Search bugs…"
          onChange={(e) => onSearchInput(e.target.value)}
          aria-label="Search bugs"
          data-testid="bugs-search"
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load().catch(() => undefined)} data-testid="bugs-refresh">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {rows.length > 0 && (
        <div className="bugs-summary" data-testid="bugs-summary">
          <span className="bugs-summary-count">{rows.length} {rows.length === 1 ? 'bug' : 'bugs'}</span>
          {Object.entries(BUG_STATUS_LABELS).map(([value, label]) => (
            <span key={value} className="bugs-summary-chip" data-status={value}>
              {statusCounts[value]} {label.toLowerCase()}
            </span>
          ))}
        </div>
      )}

      <div className={`bugs-table-wrap${rows.length === 0 ? ' is-empty' : ''}`}>
        {rows.length === 0 ? (
          <div className="empty-hint" data-testid="bugs-empty">No bugs match the current filters.</div>
        ) : (
          <table className="bugs-table">
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col">Title</th>
                <th scope="col">Run</th>
                <th scope="col">Page</th>
                <th scope="col">Found</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <BugTableRow
                  key={row.id}
                  row={row}
                  expanded={expandedId === row.id}
                  onToggle={() => setExpandedId(expandedId === row.id ? undefined : row.id)}
                  onStatus={(next) => void changeStatus(row, next)}
                  onOpenRun={() => {
                    onClose();
                    onOpenRun(row.runId);
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BugTableRow({
  row,
  expanded,
  onToggle,
  onStatus,
  onOpenRun,
}: {
  row: BugRow;
  expanded: boolean;
  onToggle: () => void;
  onStatus: (next: string) => void;
  onOpenRun: () => void;
}) {
  return (
    <>
      <tr className="bugs-row" data-sev={row.severity}>
        <td className="bugs-col-sev"><span className={`sev sev--${row.severity}`}>{row.severity}</span></td>
        <td className="bugs-col-status">
          <select
            className="bugs-status-select"
            value={row.status}
            onChange={(e) => onStatus(e.target.value)}
            aria-label={`Status of "${row.title}"`}
          >
            {Object.entries(BUG_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </td>
        <td className="bugs-col-title">
          <button type="button" className="bugs-title" aria-expanded={expanded} onClick={onToggle}>
            {row.title}
          </button>
          {row.category && <span className="bugs-category">{row.category}</span>}
        </td>
        <td className="bugs-col-run">
          <button type="button" className="bugs-run-link" title={row.runTitle ?? row.runId} onClick={onOpenRun}>
            {row.runTitle ?? row.runId}
          </button>
        </td>
        <td className="bugs-col-page">
          {typeof row.url === 'string' && /^https?:\/\//i.test(row.url) ? (
            <a href={row.url} target="_blank" rel="noreferrer noopener" title={row.url}>{hostOf(row.url)}</a>
          ) : (
            row.url && String(row.url).slice(0, 60)
          )}
        </td>
        <td className="bugs-col-found">
          {row.ts ? <time dateTime={new Date(row.ts).toISOString()}>{relativeTime(row.ts)}</time> : null}
        </td>
      </tr>
      {expanded && (
        <tr className="bugs-detail-row">
          <td colSpan={6}>
            <div className="bugs-detail" data-sev={row.severity}>
              <header>
                <h3>{row.title}</h3>
                <p className="bugs-detail-meta">
                  {[
                    row.runTitle,
                    row.url,
                    row.statusNote ? `note: ${row.statusNote}` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </header>
              <dl className="bugs-detail-grid">
                {([
                  ['Expected', row.expected],
                  ['Actual', row.actual],
                  ['Category', row.category],
                  ['Evidence', row.evidence],
                ] as [string, string | undefined][])
                  .filter(([, value]) => value !== undefined && value !== null && value !== '')
                  .map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                {Array.isArray(row.steps) && row.steps.length > 0 && (
                  <div>
                    <dt>Steps</dt>
                    <dd>
                      <ol>{row.steps.map((step, index) => <li key={index}>{String(step)}</li>)}</ol>
                    </dd>
                  </div>
                )}
              </dl>
              <footer>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenRun}>Open in run</button>
              </footer>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
