import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostic details in the browser console without exposing them to visitors.
    console.error('Uncaught application render error:', error, info.componentStack);
  }

  private retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <main
          role="alert"
          className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10"
        >
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
            <h1 className="text-xl font-bold text-navy-900">Something went wrong</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              The page encountered an unexpected error. You can try loading it again or refresh the page.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <button type="button" className="btn-primary" onClick={this.retry}>
                Try again
              </button>
              <button
                type="button"
                className="btn-ghost border border-slate-200"
                onClick={() => window.location.reload()}
              >
                Refresh page
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
