import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Prevent an unexpected React render error from leaving the queue system blank.
 * Error details stay in the server/browser console and are not shown to visitors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] Unhandled interface error:', error, info.componentStack);
  }

  private reloadApplication = (): void => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main
          role="alert"
          aria-live="assertive"
          className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10"
        >
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700">
              <span aria-hidden="true" className="text-2xl font-bold">!</span>
            </div>
            <h1 className="text-xl font-bold text-navy-950">Something went wrong</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              The queue system could not display this screen. Your saved queue data has not been changed by this error.
              Reload the application to try again.
            </p>
            <button
              type="button"
              onClick={this.reloadApplication}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Reload application
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
