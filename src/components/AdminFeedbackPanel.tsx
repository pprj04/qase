import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../state/toastStore';

export const FEEDBACK_CATEGORIES = [
  { value: 'test_accuracy', label: 'Test Accuracy' },
  { value: 'test_coverage', label: 'Test Coverage' },
  { value: 'execution_speed', label: 'Test Execution Speed' },
  { value: 'results', label: 'Test Results' },
  { value: 'ui_ux', label: 'UI/UX Experience' },
  { value: 'automation_quality', label: 'Automation Quality' },
  { value: 'error_handling', label: 'Error Handling' },
  { value: 'ease_of_use', label: 'Ease of Use' },
  { value: 'overall', label: 'Overall Experience' },
  { value: 'other', label: 'Other' },
];

const FEEDBACK_REVIEW_STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

interface FeedbackStats {
  total?: number;
  averageRating?: number;
  byRating?: Record<string, number>;
}

interface FeedbackRecord {
  id: string;
  runId?: string;
  targetUrl?: string;
  runStatus?: string;
  durationSeconds?: number;
  rating: number;
  category?: string;
  status: string;
  comments?: string;
  improvement?: string;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Admin feedback review panel (React port of the legacy collapsible panel).
 * Non-admin users never see it — a 403 from /feedback/stats hides the panel.
 */
export function AdminFeedbackPanel({ open }: { open: boolean }) {
  const { toast } = useToast();
  const [allowed, setAllowed] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [rating, setRating] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (rating) params.set('rating', rating);
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    try {
      const [statsPage, feedbackPage] = await Promise.all([
        api<FeedbackStats>('/feedback/stats'),
        api<FeedbackRecord[] | { records?: FeedbackRecord[] }>(`/feedback?${params.toString()}`),
      ]);
      setStats(statsPage);
      // The endpoint returns a bare array (legacy contract).
      setRecords(Array.isArray(feedbackPage) ? feedbackPage : feedbackPage.records ?? []);
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 403) setAllowed(false);
    }
  }, [rating, category, status, search]);

  useEffect(() => {
    if (!open || !allowed) return;
    void load();
  }, [open, allowed, load]);

  const changeRecordStatus = async (record: FeedbackRecord, next: string) => {
    const previous = record.status;
    setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, status: next } : r)));
    try {
      await api(`/feedback/${record.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) });
      toast('Feedback status updated.', 'good');
      void load();
    } catch (error) {
      setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, status: previous } : r)));
      toast(error instanceof Error ? error.message : String(error), 'bad');
    }
  };

  const avgLabel = useMemo(
    () => (Number.isFinite(stats?.averageRating) ? (stats?.averageRating as number).toFixed(1) : '—'),
    [stats],
  );

  if (!open || !allowed) return null;

  return (
    <section className="feedback-panel" aria-label="Feedback review" data-testid="feedback-panel">
      <header className="feedback-panel-head">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={!minimized}
          onClick={() => setMinimized((m) => !m)}
          data-testid="feedback-minimize"
        >
          {minimized ? '▸' : '▾'} Feedback review
        </button>
      </header>
      {!minimized && (
        <div className="feedback-panel-body">
          {stats && (
            <div className="feedback-stats" data-testid="feedback-stats">
              <div><b>{stats.total ?? 0}</b><span>submissions</span></div>
              <div><b>{avgLabel}★</b><span>average</span></div>
              <div className="feedback-rating-dist">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = Number(stats.byRating?.[star] ?? 0);
                  const total = Math.max(1, Number(stats.total ?? 0));
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={star} className="feedback-rating-row" title={`${count} × ${star}-star feedback`}>
                      <span className="feedback-rating-row-stars">{star}★</span>
                      <span className="feedback-rating-bar"><i style={{ width: `${pct}%` }} /></span>
                      <span>{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="feedback-filters">
            <select aria-label="Filter by rating" value={rating} onChange={(e) => setRating(e.target.value)} data-testid="feedback-filter-rating">
              <option value="">All ratings</option>
              {[5, 4, 3, 2, 1].map((star) => <option key={star} value={String(star)}>{star}★</option>)}
            </select>
            <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="feedback-filter-category">
              <option value="">All categories</option>
              {FEEDBACK_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select aria-label="Filter by review status" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="feedback-filter-status">
              <option value="">All statuses</option>
              {FEEDBACK_REVIEW_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input
              placeholder="Search feedback…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search feedback"
              data-testid="feedback-search"
            />
          </div>

          <ul className="feedback-list" data-testid="feedback-list">
            {records.length === 0 && <li className="feedback-empty">No feedback matches the current filters.</li>}
            {records.map((record) => (
              <li key={record.id} className="feedback-row">
                <div className="feedback-row-head">
                  <span className="feedback-row-stars" title={`${record.rating} of 5`}>
                    {'★'.repeat(record.rating)}{'☆'.repeat(5 - record.rating)}
                  </span>
                  <span className="feedback-row-cat">
                    {FEEDBACK_CATEGORIES.find((c) => c.value === record.category)?.label ?? record.category}
                  </span>
                  <select
                    className="feedback-row-status"
                    aria-label={`Review status for run ${record.runId?.slice(0, 8)}`}
                    value={record.status}
                    onChange={(e) => void changeRecordStatus(record, e.target.value)}
                  >
                    {FEEDBACK_REVIEW_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                {record.comments && <p className="feedback-row-comments">{record.comments}</p>}
                <div className="feedback-row-meta">
                  {[
                    record.runId ? `Run ${record.runId.slice(0, 8)}` : undefined,
                    record.targetUrl,
                    record.runStatus ? (record.runStatus === 'done' ? 'completed' : 'failed') : undefined,
                    Number.isFinite(record.durationSeconds) ? formatClock(record.durationSeconds as number) : undefined,
                    record.improvement ? `improve: ${record.improvement}` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
