interface BootstrapError {
  kind: 'window-error' | 'unhandled-rejection';
  error: unknown;
  context?: Record<string, unknown>;
}

declare global {
  interface Window {
    __musefold_bootstrap_errors?: BootstrapError[];
    __musefold_bootstrap_ready?: boolean;
  }
}

const pending = (window.__musefold_bootstrap_errors ??= []);

window.addEventListener('error', (event) => {
  if (window.__musefold_bootstrap_ready) return;
  if (!event.error && event.target && event.target !== window) return;
  pending.push({
    kind: 'window-error',
    error: event.error ?? event.message ?? '未知启动异常',
    context: {
      filename: event.filename || undefined,
      line: event.lineno || undefined,
      column: event.colno || undefined,
    },
  });
});

window.addEventListener('unhandledrejection', (event) => {
  if (window.__musefold_bootstrap_ready) return;
  pending.push({ kind: 'unhandled-rejection', error: event.reason });
});

export {};
