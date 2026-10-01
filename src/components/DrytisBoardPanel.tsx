import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../state/toastStore';
import type { LiveSession } from '../state/liveSession';

interface DrytisTickets {
  status: 'requested' | 'delivering' | 'delivered' | 'failed';
  ticketCount?: number;
  deliveredAt?: string;
}

interface DrytisIntegration {
  tickets?: DrytisTickets;
  [key: string]: unknown;
}

/**
 * Findings → Drytis board push panel (legacy renderDrytisBoard parity).
 * Renders only when the session carries a drytisIntegration attachment;
 * per-finding accept checkboxes default to checked, with accept-all master
 * and POST /sessions/:id/drytis/push { acceptedFindingIds }.
 */
export function DrytisBoardPanel({ session }: { session: LiveSession }) {
  const integration = session.drytisIntegration as DrytisIntegration | undefined;
  const { toast } = useToast();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushedVersion, setPushedVersion] = useState(0);

  const findings = session.findings ?? [];
  const pushState = integration?.tickets?.status;

  // Reset selection whenever the finding set or push outcome changes.
  useEffect(() => {
    setAccepted(new Set(findings.map((f) => f.id)));
  }, [session.id, findings.map((f) => f.id).join(','), pushedVersion]);

  // A session without the integration attachment shows nothing (legacy
  // drytisBoardAvailable gate).
  if (!integration) return null;

  if (pushState === 'delivered') {
    const t = integration.tickets!;
    return (
      <section className="drytis-board" data-testid="drytis-board">
        <h3 className="drytis-board-title">Push findings to the Drytis board</h3>
        <p className="drytis-board-done">
          {t.ticketCount} ticket{t.ticketCount === 1 ? '' : 's'} delivered to the board
          {t.deliveredAt ? ` · ${new Date(t.deliveredAt).toLocaleString()}` : ''}.
        </p>
      </section>
    );
  }
  if (pushState === 'delivering' || pushState === 'requested') {
    return (
      <section className="drytis-board" data-testid="drytis-board">
        <h3 className="drytis-board-title">Push findings to the Drytis board</h3>
        <p className="drytis-board-busy">Delivering tickets to the Drytis board…</p>
      </section>
    );
  }
  if (findings.length === 0) {
    return (
      <section className="drytis-board" data-testid="drytis-board">
        <h3 className="drytis-board-title">Push findings to the Drytis board</h3>
        <p className="drytis-board-empty">No findings to push yet — the board panel fills in once findings are filed.</p>
      </section>
    );
  }

  const allChecked = findings.every((f) => accepted.has(f.id));

  const toggleAll = (checked: boolean) => {
    setAccepted(checked ? new Set(findings.map((f) => f.id)) : new Set());
  };

  const push = async () => {
    const ids = findings.filter((f) => accepted.has(f.id)).map((f) => f.id);
    if (ids.length === 0) {
      setError('Check at least one finding to push.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<{ tickets: { ticketCount: number } }>(
        `/sessions/${session.id}/drytis/push`,
        { method: 'POST', body: JSON.stringify({ acceptedFindingIds: ids }) },
      );
      toast(`Pushed ${result.tickets.ticketCount} ticket${result.tickets.ticketCount === 1 ? '' : 's'} to the Drytis board.`, 'good');
      setPushedVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="drytis-board" data-testid="drytis-board">
      <h3 className="drytis-board-title">Push findings to the Drytis board</h3>
      {pushState === 'failed' && <p className="drytis-board-failed">The last push did not complete. You can retry below.</p>}
      <div className="drytis-board-rows" role="group" aria-label="Findings to push">
        {findings.map((finding) => (
          <label key={finding.id} className="drytis-board-row check">
            <input
              type="checkbox"
              checked={accepted.has(finding.id)}
              onChange={(e) => {
                const next = new Set(accepted);
                if (e.target.checked) next.add(finding.id);
                else next.delete(finding.id);
                setAccepted(next);
              }}
              data-drytis-finding={finding.id}
            />
            <span>{finding.title}</span>
            <em>{finding.severity}</em>
          </label>
        ))}
      </div>
      <label className="drytis-board-acceptall check">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={(e) => toggleAll(e.target.checked)}
          aria-label={`Accept all (${findings.length})`}
        />
        <span>Accept all ({findings.length})</span>
      </label>
      {error && (
        <p className="drytis-board-error test-result-bad" role="alert">{error}</p>
      )}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void push()} data-testid="drytis-push">
        {busy ? 'Pushing…' : 'Push accepted findings to Drytis'}
      </button>
    </section>
  );
}
