import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './theme/ThemeProvider';
import { App } from './App';
import './theme/tokens.css';
import './shell.css';
import './report-views.css';

const mount = document.getElementById('root');
if (!mount) throw new Error('React root element missing');

createRoot(mount).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
