import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Identifies the surface in the fallback UI. */
  label: string;
  /** Changing this key clears a caught error so the subtree re-renders fresh
   *  (e.g. pass the dialog's `open` flag so reopening retries the render). */
  resetKey?: string | number | boolean;
}

/**
 * App-level error boundary: a render error inside one panel or dialog shows a
 * recoverable message instead of unmounting the entire shell. A change to
 * `resetKey` clears the error, so a dialog that crashed once renders fresh
 * when reopened.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[qase] ${this.props.label} failed to render:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-hint" role="alert" data-testid="error-boundary">
          {this.props.label} could not be displayed ({this.state.error.message}). Reload the page to recover.
        </div>
      );
    }
    return this.props.children;
  }
}
