import { create } from 'zustand';
import {
  createDiagnosticReport,
  diagnosticFingerprint,
  formatDiagnosticReport,
  type CreateDiagnosticReportInput,
  type DiagnosticReport,
  type DiagnosticSource,
} from '@musefold/desktop-contracts/diagnostics';

export interface DiagnosticItem {
  report: DiagnosticReport;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
}

interface ErrorState {
  items: DiagnosticItem[];
  push: (report: DiagnosticReport) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_ITEMS = 20;
const DEDUPE_WINDOW_MS = 5000;

export const useErrorStore = create<ErrorState>((set) => ({
  items: [],
  push: (report) => {
    const now = Date.now();
    const fingerprint = diagnosticFingerprint(report);
    set((state) => {
      const duplicateIndex = state.items.findIndex(
        (item) =>
          diagnosticFingerprint(item.report) === fingerprint
          && now - item.lastSeen <= DEDUPE_WINDOW_MS,
      );
      if (duplicateIndex >= 0) {
        const duplicate = state.items[duplicateIndex];
        const next = [...state.items];
        next[duplicateIndex] = {
          ...duplicate,
          occurrences: duplicate.occurrences + 1,
          lastSeen: now,
          report: { ...duplicate.report, timestamp: report.timestamp },
        };
        return { items: next };
      }
      return {
        items: [
          ...state.items,
          { report, occurrences: 1, firstSeen: now, lastSeen: now },
        ].slice(-MAX_ITEMS),
      };
    });
  },
  dismiss: (id) => set((state) => ({
    items: state.items.filter((item) => item.report.id !== id),
  })),
  clear: () => set({ items: [] }),
}));

function appContext(): Pick<CreateDiagnosticReportInput, 'appVersion' | 'platform' | 'route'> {
  const title = typeof document !== 'undefined' ? document.title : undefined;
  const version = title?.match(/v([^\s]+)/i)?.[1];
  return {
    ...(version ? { appVersion: version } : {}),
    ...(typeof navigator !== 'undefined' ? { platform: navigator.platform || navigator.userAgent } : {}),
    ...(typeof location !== 'undefined' ? { route: location.pathname } : {}),
  };
}

export interface ReportErrorOptions {
  source?: DiagnosticSource;
  process?: 'renderer' | 'preload' | 'main';
  operation?: string;
  context?: Record<string, unknown>;
}

export function reportError(error: unknown, options: ReportErrorOptions = {}): DiagnosticReport {
  const report = isDiagnosticReport(error)
    ? error
    : createDiagnosticReport(error, {
        process: options.process ?? 'renderer',
        source: options.source ?? 'manual',
        operation: options.operation,
        context: options.context,
        ...appContext(),
      });
  useErrorStore.getState().push(report);
  try {
    console.error('[Musefold] Unhandled error', report);
  } catch {
    // Logging must never create another application error.
  }
  return report;
}

export function isDiagnosticReport(value: unknown): value is DiagnosticReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DiagnosticReport>;
  return Boolean(
    typeof candidate.id === 'string'
      && typeof candidate.timestamp === 'string'
      && typeof candidate.process === 'string'
      && typeof candidate.source === 'string'
      && candidate.error
      && typeof candidate.error === 'object'
      && typeof candidate.error.message === 'string',
  );
}

export function diagnosticText(item: DiagnosticItem): string {
  return formatDiagnosticReport(item.report, item.occurrences);
}

export function installGlobalErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onError = (event: ErrorEvent) => {
    // `error` also fires for failed images/stylesheets. They are resource
    // failures rather than JavaScript exceptions and would otherwise create a
    // modal for every missing thumbnail.
    if (!event.error && event.target && event.target !== window) return;
    reportError((event.error ?? event.message) || '未知窗口异常', {
      source: 'window-error',
      context: {
        filename: event.filename || undefined,
        line: event.lineno || undefined,
        column: event.colno || undefined,
      },
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, {
      source: 'unhandled-rejection',
      context: { promise: 'unhandled' },
    });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}
