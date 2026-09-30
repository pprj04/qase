import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../state/authStore';
import { useToast } from '../state/toastStore';

interface MemoryEntry {
  id: number;
  key: string;
  value: string;
}

/**
 * Profile dialog — display name, timezone, saved memory list (add/delete),
 * password change. Port of the legacy profile-dialog flows.
 */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [email, setEmail] = useState('');
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [memoryKey, setMemoryKey] = useState('');
  const [memoryValue, setMemoryValue] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    (async () => {
      try {
        const profile = await api<{ displayName?: string; email: string; profile?: { timezone?: string } }>('/profile');
        setName(profile.displayName ?? '');
        setTimezone(profile.profile?.timezone ?? '');
        setEmail(profile.email);
        const entries = await api<MemoryEntry[]>('/memory');
        setMemory(entries ?? []);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'bad');
      }
    })();
  }, [open, toast]);

  if (!open) return null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = () =>
    run(async () => {
      await api('/profile', {
        method: 'PUT',
        body: JSON.stringify({ displayName: name, profile: { timezone } }),
      });
      await refreshUser();
      setMessage('Profile saved.');
    });

  const saveMemory = () =>
    run(async () => {
      await api('/memory', { method: 'PUT', body: JSON.stringify({ key: memoryKey, value: memoryValue }) });
      setMemoryKey('');
      setMemoryValue('');
      setMemory((await api<MemoryEntry[]>('/memory')) ?? []);
      setMessage('Memory saved.');
    });

  const deleteMemory = (id: number) =>
    run(async () => {
      await api(`/memory/${id}`, { method: 'DELETE' });
      setMemory((await api<MemoryEntry[]>('/memory')) ?? []);
    });

  const changePassword = () =>
    run(async () => {
      await api('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, password: newPassword }),
      });
      window.location.reload();
    });

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Profile" data-testid="profile-dialog">
        <header className="modal-head">
          <h2>Profile</h2>
          <button type="button" className="icon-btn" aria-label="Close profile" onClick={onClose}>×</button>
        </header>
        <div className="modal-body">
          <p className="profile-email" data-testid="profile-email">{email || user?.email}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <label className="field">
              <span>Display name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name" />
            </label>
            <label className="field">
              <span>Timezone</span>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} data-testid="profile-timezone" />
            </label>
            <button className="btn btn-primary" disabled={busy} type="submit">Save profile</button>
          </form>

          <h3>Saved memory</h3>
          <ul className="memory-list" data-testid="profile-memory">
            {memory.length === 0 && <li className="muted">No saved memory yet.</li>}
            {memory.map((entry) => (
              <li key={entry.id}>
                <span>{entry.key}: {entry.value}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-danger-ghost"
                  aria-label={`Delete memory ${entry.key}`}
                  disabled={busy}
                  onClick={() => void deleteMemory(entry.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveMemory();
            }}
          >
            <div className="memory-form-row">
              <input placeholder="Key" value={memoryKey} onChange={(e) => setMemoryKey(e.target.value)} required />
              <input placeholder="Value" value={memoryValue} onChange={(e) => setMemoryValue(e.target.value)} required />
              <button className="btn btn-secondary" disabled={busy} type="submit">Save</button>
            </div>
          </form>

          <h3>Change password</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void changePassword();
            }}
          >
            <label className="field">
              <span>Current password</span>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
            </label>
            <label className="field">
              <span>New password</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} autoComplete="new-password" />
            </label>
            <button className="btn btn-secondary" disabled={busy} type="submit">Change password</button>
          </form>
          {message && <p className="profile-message" role="status" data-testid="profile-message">{message}</p>}
        </div>
      </div>
    </div>
  );
}
