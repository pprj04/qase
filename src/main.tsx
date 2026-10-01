import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './theme/ThemeProvider';
import { App } from './App';
import './theme/tokens.css';
import './shell.css';
import './report-views.css';

const mount = document.getElementById('root');
if (!mount) throw new Error('React root element missing');

// Same inline SVG favicon as the legacy UI (public/index.html).
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.href = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230a84ff'/><path d='M11 8h10M13 8v7L9.5 22a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L19 15V8' stroke='%23fff' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>";
document.head.append(favicon);

createRoot(mount).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
