import { Component, type ErrorInfo, type ReactNode } from 'react';
import './migrationFallback.css';

type ReactErrorBoundaryProps = {
  children: ReactNode;
};

type ReactErrorBoundaryState = {
  error: Error | null;
};

export default class ReactErrorBoundary extends Component<ReactErrorBoundaryProps, ReactErrorBoundaryState> {
  state: ReactErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ReactErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React render failed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="migration-fallback full-screen">
        <div className="migration-fallback-panel">
          <span className="migration-fallback-kicker">Soryq recovered from a UI error</span>
          <h1>Something in the workspace UI failed to render.</h1>
          <p>{this.state.error.message || 'An unexpected render error occurred.'}</p>
          <button onClick={() => window.location.reload()}>Reload app</button>
        </div>
      </div>
    );
  }
}
