import { AppError } from '../../lib/errors.js';

export const GITHUB_SOURCE_LIMITS = {
  timeoutMs: 60_000,
  jsonBytes: 1024 * 1024,
  archiveBytes: 32 * 1024 * 1024,
  archiveEntries: 5_000,
  files: 500,
  fileBytes: 16 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  textFiles: 100,
  textFileBytes: 1024 * 1024,
  textBytes: 8 * 1024 * 1024,
  compressionRatio: 100,
  concurrentReads: 2,
} as const;

export type GithubSourceLimits = { [K in keyof typeof GITHUB_SOURCE_LIMITS]: number };

export function sourceError(
  sourceError: string,
  message: string,
  status = 400,
  retryable = false,
): AppError {
  return new AppError(
    status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
    message,
    status,
    retryable,
    { operation: 'readGithubSource', sourceError },
  );
}

export function invalidArchive(): AppError {
  return sourceError('GITHUB_SOURCE_INVALID_ARCHIVE', '来源归档无效、文件不安全或超过读取限制');
}

export async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The operation may already have started before this helper receives its promise.
    void promise.catch(() => undefined);
    throw signal.reason;
  }
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
