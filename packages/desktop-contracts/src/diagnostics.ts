export type DiagnosticProcess = 'renderer' | 'preload' | 'main';

export type DiagnosticSource =
  | 'react'
  | 'window-error'
  | 'unhandled-rejection'
  | 'ipc'
  | 'preload'
  | 'main-process'
  | 'renderer-crash'
  | 'page-load'
  | 'manual';

export interface SerializedDiagnosticError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: SerializedDiagnosticError;
  details?: unknown;
}

export interface DiagnosticReport {
  id: string;
  timestamp: string;
  process: DiagnosticProcess;
  source: DiagnosticSource;
  operation?: string;
  route?: string;
  appVersion?: string;
  platform?: string;
  error: SerializedDiagnosticError;
  context?: Record<string, unknown>;
}

export interface CreateDiagnosticReportInput {
  process: DiagnosticProcess;
  source: DiagnosticSource;
  operation?: string;
  route?: string;
  appVersion?: string;
  platform?: string;
  context?: Record<string, unknown>;
}

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 80;
const MAX_STRING_LENGTH = 12_000;
const SECRET_KEY =
  /(?:api[-_]?key|authorization|bearer|password|passwd|secret|credential|access[-_]?token|refresh[-_]?token)/i;

function redactString(input: string): string {
  let value = input;
  value = value.replace(/\b(sk-[A-Za-z0-9_-]{2})[A-Za-z0-9_-]{4,}\b/g, '$1***');
  value = value.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1***');
  value = value.replace(
    /((?:authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*["']?)[^\s"',}\]]+/gi,
    '$1***',
  );
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}\n...[truncated ${value.length - MAX_STRING_LENGTH} characters]`;
}

function sanitizeValue(
  input: unknown,
  depth: number,
  seen: WeakSet<object>,
  key?: string,
): unknown {
  if (key && SECRET_KEY.test(key)) return '[REDACTED]';
  if (input == null || typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input === 'bigint') return input.toString();
  if (typeof input === 'string') return redactString(input);
  if (typeof input === 'symbol') return input.toString();
  if (typeof input === 'function') return `[Function ${input.name || 'anonymous'}]`;
  if (depth >= MAX_DEPTH) return '[Max depth reached]';
  if (typeof input !== 'object') return redactString(String(input));
  if (seen.has(input)) return '[Circular]';

  seen.add(input);
  if (input instanceof Error) {
    const serialized = serializeError(input, depth + 1, seen);
    seen.delete(input);
    return serialized;
  }

  if (Array.isArray(input)) {
    const output = input
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1, seen));
    if (input.length > MAX_ARRAY_ITEMS) output.push(`[${input.length - MAX_ARRAY_ITEMS} more items]`);
    seen.delete(input);
    return output;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(input as Record<string, unknown>);
  for (const [entryKey, value] of entries.slice(0, MAX_OBJECT_KEYS)) {
    output[entryKey] = sanitizeValue(value, depth + 1, seen, entryKey);
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    output.__truncated__ = `${entries.length - MAX_OBJECT_KEYS} more keys`;
  }
  seen.delete(input);
  return output;
}

function errorProperty(error: object, key: string): unknown {
  try {
    return (error as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function serializeError(
  input: Error | Record<string, unknown>,
  depth = 0,
  seen = new WeakSet<object>(),
): SerializedDiagnosticError {
  const rawName = errorProperty(input, 'name');
  const rawMessage = errorProperty(input, 'message');
  const rawStack = errorProperty(input, 'stack');
  const rawCode = errorProperty(input, 'code');
  const rawDetails = errorProperty(input, 'details');
  const rawCause = errorProperty(input, 'cause');

  const serialized: SerializedDiagnosticError = {
    name: redactString(typeof rawName === 'string' && rawName ? rawName : 'Error'),
    message: redactString(
      typeof rawMessage === 'string' && rawMessage ? rawMessage : String(input),
    ),
  };
  if (typeof rawStack === 'string' && rawStack) serialized.stack = redactString(rawStack);
  if (rawCode != null) serialized.code = redactString(String(rawCode));
  if (rawDetails !== undefined) serialized.details = sanitizeValue(rawDetails, depth + 1, seen, 'details');
  if (rawCause && depth < MAX_DEPTH) {
    serialized.cause = serializeUnknownError(rawCause, depth + 1, seen);
  }
  return serialized;
}

function serializeUnknownError(
  input: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): SerializedDiagnosticError {
  if (input instanceof Error) return serializeError(input, depth, seen);
  if (input && typeof input === 'object') {
    const message = errorProperty(input, 'message');
    if (typeof message === 'string') {
      return serializeError(input as Record<string, unknown>, depth, seen);
    }
  }
  return {
    name: 'NonErrorThrow',
    message: redactString(typeof input === 'string' ? input : safeJson(input)),
    details: sanitizeValue(input, depth + 1, seen),
  };
}

function safeJson(input: unknown): string {
  try {
    const sanitized = sanitizeValue(input, 0, new WeakSet<object>());
    const json = JSON.stringify(sanitized);
    return json === undefined ? String(input) : json;
  } catch {
    return String(input);
  }
}

function createReportId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `MUSEFOLD-${randomUuid.slice(0, 8).toUpperCase()}`;
  return `MUSEFOLD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export function createDiagnosticReport(
  error: unknown,
  input: CreateDiagnosticReportInput,
): DiagnosticReport {
  const context = input.context
    ? sanitizeValue(input.context, 0, new WeakSet<object>()) as Record<string, unknown>
    : undefined;
  return {
    id: createReportId(),
    timestamp: new Date().toISOString(),
    process: input.process,
    source: input.source,
    ...(input.operation ? { operation: redactString(input.operation) } : {}),
    ...(input.route ? { route: redactString(input.route) } : {}),
    ...(input.appVersion ? { appVersion: redactString(input.appVersion) } : {}),
    ...(input.platform ? { platform: redactString(input.platform) } : {}),
    error: serializeUnknownError(error),
    ...(context ? { context } : {}),
  };
}

export function sanitizeDiagnosticReport(report: DiagnosticReport): DiagnosticReport {
  return sanitizeValue(report, 0, new WeakSet<object>()) as DiagnosticReport;
}

export function formatDiagnosticReport(report: DiagnosticReport, occurrences = 1): string {
  const safe = sanitizeDiagnosticReport(report);
  const lines = [
    'Musefold Error Report',
    `ID: ${safe.id}`,
    `Time: ${safe.timestamp}`,
    `Process: ${safe.process}`,
    `Source: ${safe.source}`,
  ];
  if (safe.operation) lines.push(`Operation: ${safe.operation}`);
  if (safe.route) lines.push(`Route: ${safe.route}`);
  if (safe.appVersion) lines.push(`App Version: ${safe.appVersion}`);
  if (safe.platform) lines.push(`Platform: ${safe.platform}`);
  if (occurrences > 1) lines.push(`Occurrences: ${occurrences}`);
  lines.push(`Error: ${safe.error.name}${safe.error.code ? ` [${safe.error.code}]` : ''}`);
  lines.push(`Message: ${safe.error.message}`);
  if (safe.error.stack) lines.push('', 'Stack:', safe.error.stack);
  if (safe.error.cause) lines.push('', 'Cause:', JSON.stringify(safe.error.cause, null, 2));
  if (safe.error.details !== undefined) lines.push('', 'Details:', JSON.stringify(safe.error.details, null, 2));
  if (safe.context) lines.push('', 'Context:', JSON.stringify(safe.context, null, 2));
  return lines.join('\n');
}

export function diagnosticFingerprint(report: DiagnosticReport): string {
  // The same rejection can be observed by preload, the renderer Promise
  // listener, and React. Process + code + message keeps those observations as
  // one item while still separating the same message from another process.
  return [report.process, report.error.code ?? '', report.error.message].join('|');
}
