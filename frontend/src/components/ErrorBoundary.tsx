import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-[24px] font-semibold text-ink-strong">Something went wrong</h1>
        <p className="max-w-[480px] text-[15px] text-ink-muted">{this.state.error.message}</p>
        <Button variant="outline" onClick={() => window.location.assign('/scheduled')} className="h-10 rounded-full px-6">
          Back to Scheduled
        </Button>
      </div>
    );
  }
}
