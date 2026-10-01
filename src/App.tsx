import { useEffect, useState } from 'react';
import { ThemeToggle } from './theme/ThemeToggle';
import { RunList } from './components/RunList';
import { SessionStoreProvider, useSessionStore } from './state/sessionStore';
import { LiveSessionProvider, useLiveSession } from './state/liveSession';
import { ConfigProvider } from './state/configStore';
import { AuthProvider, useAuth } from './state/authStore';
import { ToastProvider, useToast } from './state/toastStore';
import { readRunFromUrl, consumeRunParam } from './lib/runDeepLink';
import { AuthGate } from './components/AuthGate';
import { SettingsDialog } from './components/SettingsDialog';
import { ProfileDialog } from './components/ProfileDialog';
import { Transcript } from './components/Transcript';
import { QaLauncher } from './components/QaLauncher';
import { SqaLauncher } from './components/SqaLauncher';
import { FounderLauncher } from './components/FounderLauncher';
import { ViewerPanel } from './components/ViewerPanel';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ConfigProvider>
          <SessionStoreProvider>
            <LiveSessionProvider>
              <AppShell />
            </LiveSessionProvider>
          </SessionStoreProvider>
        </ConfigProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [sqaOpen, setSqaOpen] = useState(false);
  const [founderOpen, setFounderOpen] = useState(false);
  const { connection, runs } = useSessionStore();
  const { session: liveSession, openSession } = useLiveSession();
  const { status, user, signOut } = useAuth();
  const { toast } = useToast();
  const authed = status === 'signed-in';
  const connLabel = connection === 'connected' ? 'connected'
    : connection === 'reconnecting' ? 'reconnecting…'
    : 'connecting…';
  const runningCount = runs.filter((run) => run.status === 'running').length;

  const initials = (user?.displayName || user?.email || '?').trim().slice(0, 1).toUpperCase();
  // Selecting a run in the list opens its live session stream.
  const activeSessionId = liveSession?.id;
  const [lastOpened, setLastOpened] = useState<string | undefined>(undefined);
  const openRun = (id: string) => {
    if (id !== lastOpened) {
      setLastOpened(id);
      openSession(id);
    }
  };

  // Deep link: open ?run=<uuid> once after auth resolves, then strip the param
  // whether or not the id was valid (legacy parity — stale handles are cleaned).
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  useEffect(() => {
    if (deepLinkDone || !authed) return;
    const requested = readRunFromUrl();
    if (requested) {
      openRun(requested);
    }
    consumeRunParam();
    setDeepLinkDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkDone, authed]);

  // Keyboard shortcuts (legacy parity): ⌘N/Ctrl+N new run, ⌘,/Ctrl+, settings.
  // Escape closes the topmost open dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!authed) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'n') {
        event.preventDefault();
        setLauncherOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
      if (event.key === 'Escape') {
        if (launcherOpen) setLauncherOpen(false);
        else if (sqaOpen) setSqaOpen(false);
        else if (founderOpen) setFounderOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (profileOpen) setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authed, launcherOpen, sqaOpen, founderOpen, settingsOpen, profileOpen]);

  return (
    <div className="app-shell" data-app="qase-react">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="icon-btn"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
            data-testid="sidebar-toggle"
          >
            <PanelLeftIcon />
          </button>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">Q</span>
            <span className="brand-name">QASE</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="env-pill" data-testid="env-pill">QA agent</span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            data-testid="open-settings"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="10" cy="10" r="2.5" />
              <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M15.3 4.7l-1.1 1.1M5.8 14.2l-1.1 1.1" />
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="shell-body">
        <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`} aria-label="Runs">
          <div className="sidebar-head">
            <span className="sidebar-title">Runs</span>
            <button type="button" className="btn btn-secondary btn-sm" data-testid="new-run" onClick={() => setLauncherOpen(true)}>
              New run
            </button>
          </div>
          <div className="sidebar-list" data-testid="run-list-container">
            <RunList onSelect={openRun} activeId={activeSessionId} />
          </div>
          <div className="sidebar-foot">
            {authed ? (
              <>
                <button
                  type="button"
                  className="avatar avatar-btn"
                  title="Open profile"
                  aria-label="Open profile"
                  onClick={() => setProfileOpen(true)}
                  data-testid="open-profile"
                >
                  {initials}
                </button>
                <div className="sidebar-foot-text">
                  <span className="sidebar-foot-name">{user?.displayName || user?.email}</span>
                  <button
                    type="button"
                    className="sign-out"
                    onClick={() => void signOut().catch((e) => toast(e.message, 'bad'))}
                    data-testid="sign-out"
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="avatar" title="Signed out">?</div>
                <div className="sidebar-foot-text">
                  <span className="sidebar-foot-name">Not signed in</span>
                </div>
              </>
            )}
          </div>
        </aside>

        <main className="conversation" id="main">
          <ErrorBoundary label="The transcript">
            <Transcript />
          </ErrorBoundary>
        </main>

        <ErrorBoundary label="The viewer panel">
          <ViewerPanel />
        </ErrorBoundary>

        <nav className="mode-rail" aria-label="Modes and tools">
          <button type="button" className="rail-btn is-active" aria-pressed="true" title="QA mode">
            <BeakerIcon />
            <span>QA</span>
          </button>
          <button
            type="button"
            className="rail-btn"
            title="SQA mode"
            aria-label="Start an SQA assessment"
            onClick={() => setSqaOpen(true)}
            data-testid="open-sqa"
          >
            <ClipboardIcon />
            <span>SQA</span>
          </button>
          <button
            type="button"
            className="rail-btn"
            title="Founder mode"
            aria-label="Start a Founder review"
            onClick={() => setFounderOpen(true)}
            data-testid="open-founder"
          >
            <RocketIcon />
            <span>Founder</span>
          </button>
          <button type="button" className="rail-btn" title="Bugs view" disabled>
            <BugIcon />
            <span>Bugs</span>
          </button>
          <div className="rail-sep" />
          <button type="button" className="rail-btn" title="Desktop viewport" disabled>
            <MonitorIcon />
            <span>Desktop</span>
          </button>
          <button type="button" className="rail-btn" title="Mobile viewport" disabled>
            <PhoneIcon />
            <span>Mobile</span>
          </button>
        </nav>
      </div>

      <footer className="status-bar" data-testid="status-bar">
        <span
          className={`conn-dot${connection === 'connected' ? '' : connection === 'reconnecting' ? ' is-warn' : ' is-idle'}`}
          data-testid="conn-dot"
        />
        <span className="status-text" data-testid="status-text">
          {runningCount > 0 ? `${runningCount} run${runningCount > 1 ? 's' : ''} in progress · ` : ''}{connLabel}
        </span>
      </footer>

      <AuthGate />
      <ErrorBoundary label="Settings">
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </ErrorBoundary>
      <ErrorBoundary label="Profile">
        <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
      </ErrorBoundary>
      <ErrorBoundary label="QA launcher">
        <QaLauncher open={launcherOpen} onClose={() => setLauncherOpen(false)} onRunCreated={openRun} />
      </ErrorBoundary>
      <ErrorBoundary label="SQA launcher">
        <SqaLauncher open={sqaOpen} onClose={() => setSqaOpen(false)} />
      </ErrorBoundary>
      <ErrorBoundary label="Founder launcher">
        <FounderLauncher open={founderOpen} onClose={() => setFounderOpen(false)} />
      </ErrorBoundary>
    </div>
  );
}

function PanelLeftIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M7.5 3.5v13" />
    </svg>
  );
}

function BeakerIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 2.5v5l-3.2 6.4A2 2 0 0 0 5.6 16.8h8.8a2 2 0 0 0 1.8-2.9L13 7.5v-5" />
      <path d="M6.5 2.5h7" />
      <path d="M5 12.5h10" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="10" height="13.5" rx="2" />
      <path d="M8 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M8 9h4M8 12.5h2.5" />
    </svg>
  );
}
function RocketIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 2.5c3 1.5 4.5 4 4.5 7.5L12 12.5H8L5.5 10C5.5 6.5 7 4 10 2.5Z" />
      <path d="M8 12.5 6.5 15l2-.5L10 16l1.5-1.5 2 .5-1.5-2.5" />
      <circle cx="10" cy="8" r="1.4" />
    </svg>
  );
}
function BugIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="7" width="6" height="9" rx="3" />
      <path d="M7 9H4.5M7 12H4M7 15l-2 1.5M13 9h2.5M13 12h3M13 15l2 1.5M8 7 6.5 4.5M12 7l1.5-2.5" />
    </svg>
  );
}
function MonitorIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="10" rx="1.5" />
      <path d="M7 17h6M10 14v3" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6.5" y="2.5" width="7" height="15" rx="1.5" />
      <path d="M9 15.5h2" />
    </svg>
  );
}
