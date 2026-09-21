import { constants } from 'node:fs';
import { appendFile, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditRecord } from '@musefold/automation-server';

// Endpoint diagnostics only. Durable spend/approval records remain in SQLite.
export const AUTOMATION_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const AUTOMATION_LOG_MAX_RECORD_BYTES = 4096;
export const AUTOMATION_LOG_MAX_PENDING = 200;
export const AUTOMATION_LOG_FILE = 'automation-audit.ndjson';
export const AUTOMATION_LOG_PREVIOUS = 'automation-audit.1.ndjson';
const PENDING_FILE = 'automation-audit.pending.ndjson';

type LogProblem = 'record_rejected' | 'queue_full' | 'write_failed' | 'recovered';

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function assertRegularFile(file: string): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe diagnostic file');
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

/** Keep only complete recent lines, reading at most the file budget plus one byte. */
async function normalizeFile(file: string, pending: string): Promise<number> {
  if (!(await assertRegularFile(file))) return 0;
  const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW);
  let replacement: Buffer | undefined;
  let size: number;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe diagnostic file');
    await handle.chmod(0o600);
    size = info.size;
    if (size === 0) return 0;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    if (size <= AUTOMATION_LOG_MAX_BYTES && last[0] === 10) return size;
    const start = Math.max(0, size - AUTOMATION_LOG_MAX_BYTES - 1);
    const bytes = Buffer.alloc(size - start);
    let read = 0;
    while (read < bytes.length) {
      const part = await handle.read(bytes, read, bytes.length - read, start + read);
      if (part.bytesRead === 0) throw new Error('Diagnostic file changed during read');
      read += part.bytesRead;
    }
    const first = size > AUTOMATION_LOG_MAX_BYTES ? bytes.indexOf(10) + 1 : 0;
    const end = bytes.lastIndexOf(10) + 1;
    replacement =
      first > 0 || size <= AUTOMATION_LOG_MAX_BYTES
        ? bytes.subarray(first, Math.max(first, end))
        : Buffer.alloc(0);
  } finally {
    await handle.close();
  }
  await assertRegularFile(pending);
  const output = await open(
    pending,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await output.chmod(0o600);
    await output.writeFile(replacement);
    await output.sync();
  } finally {
    await output.close();
  }
  await rename(pending, file);
  return replacement.length;
}

export function createAutomationRequestLog(options: {
  directory: () => string;
  onProblem: (problem: LogProblem) => void;
}) {
  let chain = Promise.resolve();
  let pendingCount = 0;
  let lastProblem: LogProblem | null = null;
  const report = (problem: LogProblem) => {
    if (problem === lastProblem) return;
    lastProblem = problem === 'recovered' ? null : problem;
    try {
      options.onProblem(problem);
    } catch {
      // A diagnostic callback must not reject an HTTP request or poison the queue.
    }
  };

  const write = async (line: string) => {
    const directory = options.directory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) throw new Error('Unsafe diagnostic directory');
    const file = join(directory, AUTOMATION_LOG_FILE);
    const previous = join(directory, AUTOMATION_LOG_PREVIOUS);
    const pending = join(directory, PENDING_FILE);
    // The fixed scratch file bounds crash residue to one additional 2 MiB file.
    // It has no committed records; the authoritative files are current/previous.
    if (await assertRegularFile(pending)) await rm(pending);
    await normalizeFile(previous, pending);
    const size = await normalizeFile(file, pending);
    if (size + Buffer.byteLength(line) > AUTOMATION_LOG_MAX_BYTES) {
      await rename(file, previous);
    }
    await appendFile(file, line, {
      encoding: 'utf8',
      mode: 0o600,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
    });
  };

  return {
    append(record: AuditRecord): Promise<boolean> {
      // Select fields explicitly: callers, bodies and headers never enter this file.
      const line = `${JSON.stringify({
        at: record.at,
        method: record.method,
        path: record.path,
        status: record.status,
        durationMs: record.durationMs,
        ...(record.errorCode ? { errorCode: record.errorCode } : {}),
      })}\n`;
      if (Buffer.byteLength(line) > AUTOMATION_LOG_MAX_RECORD_BYTES) {
        report('record_rejected');
        return Promise.resolve(false);
      }
      if (pendingCount >= AUTOMATION_LOG_MAX_PENDING) {
        report('queue_full');
        return Promise.resolve(false);
      }
      pendingCount++;
      let written = false;
      chain = chain.then(async () => {
        try {
          await write(line);
          written = true;
          if (lastProblem) report('recovered');
        } catch {
          report('write_failed');
        } finally {
          pendingCount--;
        }
      });
      return chain.then(() => written);
    },
    /** Stop accepting requests before draining, so the caller has a stable queue. */
    flush: () => chain,
  };
}
