import { useState } from 'react';
import { ThemeToggle } from './theme/ThemeToggle';
import { RunList } from './components/RunList';
import { SessionStoreProvider, useSessionStore } from './state/sessionStore';

export function App() {
  return (
    <SessionStoreProvider>
      <AppShell />
    </SessionStoreProvider>
  );
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(true);
  const { connection, runs } = useSessionStore();
  const connLabel = connection === 'connected' ? 'connected'
    : connection === 'reconnecting' ? 'reconnecting…'
    : 'connecting…';
  const runningCount = runs.filter((run) => run.status === 'running').length;

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
          <ThemeToggle />
        </div>
      </header>

      <div className="shell-body">
        <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`} aria-label="Runs">
          <div className="sidebar-head">
            <span className="sidebar-title">Runs</span>
            <button type="button" className="btn btn-secondary btn-sm" data-testid="new-run" disabled>
              New run
            </button>
          </div>
          <div className="sidebar-list" data-testid="run-list-container">
            <RunList />
          </div>
          <div className="sidebar-foot">
            <div className="avatar" title="Signed out">?</div>
            <div className="sidebar-foot-text">
              <span className="sidebar-foot-name">Not signed in</span>
            </div>
          </div>
        </aside>

        <main className="conversation" id="main">
          <div className="conversation-empty" data-testid="conversation-empty">
            <div className="conversation-empty-logo" aria-hidden="true">Q</div>
            <h1>What should I test today?</h1>
            <p>Describe a site or a flow and QASE will drive a real browser, watch for
              bugs, and report back with evidence.</p>
          </div>
        </main>

        <aside className={`viewer ${viewerOpen ? '' : 'collapsed'}`} aria-label="Browser preview">
          <div className="viewer-head">
            <span className="viewer-title">Browser</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={viewerOpen ? 'Collapse browser panel' : 'Expand browser panel'}
              aria-expanded={viewerOpen}
              onClick={() => setViewerOpen((v) => !v)}
              data-testid="viewer-toggle"
            >
              {viewerOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
            </button>
          </div>
          <div className="viewer-body" data-testid="viewer-body">
            <div className="empty-hint">The live browser appears here while a run is in progress.</div>
          </div>
        </aside>

        <nav className="mode-rail" aria-label="Modes and tools">
          <button type="button" className="rail-btn is-active" aria-pressed="true" title="QA mode">
            <BeakerIcon />
            <span>QA</span>
          </button>
          <button type="button" className="rail-btn" title="SQA mode" disabled>
            <ClipboardIcon />
            <span>SQA</span>
          </button>
          <button type="button" className="rail-btn" title="Founder mode" disabled>
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
function PanelRightCloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M12.5 3.5v13" />
      <path d="M15 7l-1.5 3L15 13" />
    </svg>
  );
}
function PanelRightOpenIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M12.5 3.5v13" />
      <path d="M14 7l1.5 3L14 13" />
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
