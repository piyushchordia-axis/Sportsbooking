import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { logClientError } from './lib/telemetry';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles.css';

const queryClient = new QueryClient();

// Catch errors that escape React's render tree (async callbacks, native events)
// and unhandled promise rejections, forwarding them to server-side telemetry.
window.addEventListener('error', (e) => {
  logClientError(e.error ?? e.message, { kind: 'window.error' });
});
window.addEventListener('unhandledrejection', (e) => {
  logClientError(e.reason, { kind: 'unhandledrejection' });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </BrowserRouter>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
