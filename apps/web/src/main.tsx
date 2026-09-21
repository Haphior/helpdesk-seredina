import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { App } from './App';
import { initErrorTracking } from './lib/errorTracking';
import './i18n';
import './index.css';

initErrorTracking();

function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center font-sans">
      <div>
        <p className="mb-1 text-lg font-bold text-slate-900">Something went wrong.</p>
        <p className="text-sm text-slate-500">Reload the page — if this keeps happening, contact support.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
