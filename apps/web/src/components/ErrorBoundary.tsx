import { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from './ui/button';
import { logClientError } from '../lib/telemetry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level React error boundary. Catches render-time crashes anywhere below it,
 * reports them via logClientError (server-side telemetry, MOB-2 / BOOK-6), and
 * shows a minimal recovery UI instead of a blank white screen. A reload is the
 * safest recovery for a corrupted client state, so we offer exactly that.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Best-effort telemetry; logClientError never throws.
    logClientError(error, { componentStack: info.componentStack });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display font-bold text-2xl text-foreground">
          Something went wrong
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error interrupted the page. Reloading usually fixes it.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
