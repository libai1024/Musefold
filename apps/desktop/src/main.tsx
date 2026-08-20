// src/main.tsx
// 渲染进程入口

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@musefold/ui/tokens.css';
import '@musefold/ui/primitives.css';
import './styles/globals.css';
import '@musefold/product-ui/styles.css';
import './styles/motion.css';
import { installTestHook } from './lib/test-hook';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { installGlobalErrorHandlers, reportError } from './stores/errors';
import { GlobalErrorDialog } from './components/ui/global-error-dialog';
import { GlobalErrorBoundary } from './components/layout/GlobalErrorBoundary';

document.documentElement.dataset.productHost = 'desktop';
installGlobalErrorHandlers();
const bootstrapErrors = window.__musefold_bootstrap_errors?.splice(0) ?? [];
window.__musefold_bootstrap_ready = true;
for (const bootstrapError of bootstrapErrors) {
  reportError(bootstrapError.error, {
    source: bootstrapError.kind,
    context: bootstrapError.context,
  });
}
try {
  api.diagnostics.onError((report) => reportError(report));
} catch (error) {
  // A missing preload bridge is reported when an API method is first used.
  reportError(error, { source: 'preload', operation: 'diagnostics.onError' });
}
installTestHook();

const container = document.getElementById('root')!;
createRoot(container).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
    <GlobalErrorDialog />
  </React.StrictMode>,
);
api.updater.notifyContentReady?.();
