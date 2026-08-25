import React, { StrictMode, Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught application render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-mono">
          <div className="max-w-lg w-full bg-zinc-900 border border-red-500/40 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-red-400 font-semibold text-sm">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-ping" />
              <span>Kraken Strategy Engine — Interface Interruption</span>
            </div>
            <p className="text-xs text-zinc-400">
              The front-end client encountered an unexpected view error. You can reload the interface or clear transient state below.
            </p>
            {this.state.error?.message && (
              <div className="bg-black/60 border border-zinc-800 p-3 rounded text-[11px] text-red-300 overflow-x-auto">
                {this.state.error.message}
              </div>
            )}
            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Reload Dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.clear();
                    sessionStorage.clear();
                  } catch {}
                  window.location.reload();
                }}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors border border-zinc-700"
              >
                Reset Cache &amp; Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
