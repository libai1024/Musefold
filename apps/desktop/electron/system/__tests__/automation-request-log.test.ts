import {
  appendFile,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_LOG_FILE,
  AUTOMATION_LOG_PREVIOUS,
  AUTOMATION_LOG_MAX_BYTES,
  AUTOMATION_LOG_MAX_PENDING,
  AUTOMATION_LOG_MAX_RECORD_BYTES,
  createAutomationRequestLog,
} from '../automation-request-log';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    appendFile: vi.fn(actual.appendFile),
    rename: vi.fn(actual.rename),
    lstat: vi.fn(actual.lstat),
  };
});

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const record = (durationMs = 0) => ({
  at: '2026-09-13T00:00:00.000Z',
  method: 'GET',
  path: '/v1/prompts/:id',
  status: 200,
  durationMs,
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'musefold-owned-audit-files-'));
  roots.push(root);
  const directory = join(root, 'logs');
  await mkdir(directory);
  const onProblem = vi.fn();
  return {
    root,
    directory,
    onProblem,
    file: join(directory, AUTOMATION_LOG_FILE),
    previous: join(directory, AUTOMATION_LOG_PREVIOUS),
    writer: createAutomationRequestLog({ directory: () => directory, onProblem }),
  };
}

function fullFile(bytes: number) {
  const line = `${JSON.stringify({ ...record(), path: '/legacy', padding: 'x'.repeat(1000) })}\n`;
  const count = Math.floor(bytes / Buffer.byteLength(line)) - 1;
  const prefix = line.repeat(count);
  const overhead = Buffer.byteLength(
    `${JSON.stringify({ ...record(), path: '/last-legacy', padding: '' })}\n`,
  );
  return (
    prefix +
    `${JSON.stringify({ ...record(), path: '/last-legacy', padding: 'x'.repeat(bytes - Buffer.byteLength(prefix) - overhead) })}\n`
  );
}
const rows = async (file: string) =>
  (await readFile(file, 'utf8'))
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

describe('bounded endpoint request diagnostics on real files', () => {
  it.each(['stat', 'rename', 'append'] as const)(
    'reports an injected %s I/O failure without leaking details, then recovers on real files',
    async (stage) => {
      const f = await fixture();
      const full = fullFile(AUTOMATION_LOG_MAX_BYTES);
      await writeFile(f.file, full);
      await writeFile(f.previous, `${JSON.stringify(record(-1))}\n`);
      const failure = new Error('synthetic private I/O details');
      if (stage === 'stat') vi.mocked(lstat).mockRejectedValueOnce(failure);
      if (stage === 'rename') vi.mocked(rename).mockRejectedValueOnce(failure);
      if (stage === 'append') vi.mocked(appendFile).mockRejectedValueOnce(failure);
      expect(await f.writer.append(record(2))).toBe(false);
      if (stage !== 'append') expect(await readFile(f.file, 'utf8')).toBe(full);
      else expect(await readFile(f.previous, 'utf8')).toBe(full);
      expect(f.onProblem.mock.calls).toEqual([['write_failed']]);
      expect(await f.writer.append(record(3))).toBe(true);
      expect(await rows(f.file)).toEqual([record(3)]);
      expect(await readFile(f.previous, 'utf8')).toBe(full);
      expect(f.onProblem.mock.calls).toEqual([['write_failed'], ['recovered']]);
    },
  );

  it('serializes concurrent writes, selects safe fields and drains all accepted records', async () => {
    const f = await fixture();
    const writes = Array.from({ length: 100 }, (_, i) =>
      f.writer.append({ ...record(i), caller: 'private-caller' }),
    );
    await f.writer.flush();
    expect(await Promise.all(writes)).toEqual(Array(100).fill(true));
    expect((await rows(f.file)).map((row) => row.durationMs)).toEqual(
      Array.from({ length: 100 }, (_, i) => i),
    );
    expect(await readFile(f.file, 'utf8')).not.toContain('private-caller');
    if (process.platform !== 'win32') expect((await stat(f.file)).mode & 0o777).toBe(0o600);
    expect(f.onProblem).not.toHaveBeenCalled();
  });

  it('rotates before appending beyond the exact capacity and keeps only the newest previous file', async () => {
    const f = await fixture();
    const full = fullFile(AUTOMATION_LOG_MAX_BYTES);
    await writeFile(f.file, full);
    await writeFile(f.previous, 'older previous\n');
    expect(await f.writer.append(record(7))).toBe(true);
    expect(await readFile(f.previous, 'utf8')).toBe(full);
    expect(await rows(f.file)).toEqual([record(7)]);
    await writeFile(f.file, full);
    expect(await f.writer.append(record(8))).toBe(true);
    expect(await rows(f.file)).toEqual([record(8)]);
    expect((await stat(f.previous)).size).toBe(AUTOMATION_LOG_MAX_BYTES);
    expect(await readdir(f.directory)).toEqual(
      expect.arrayContaining([AUTOMATION_LOG_FILE, AUTOMATION_LOG_PREVIOUS]),
    );
    expect(await readdir(f.directory)).toHaveLength(2);
  });

  it('compacts both legacy oversized files to complete recent lines and preserves their newest records', async () => {
    const f = await fixture();
    const legacy = fullFile(AUTOMATION_LOG_MAX_BYTES * 3);
    await writeFile(f.file, legacy);
    await writeFile(f.previous, legacy);
    expect(await f.writer.append(record(9))).toBe(true);
    for (const file of [f.file, f.previous]) {
      expect((await stat(file)).size).toBeLessThanOrEqual(AUTOMATION_LOG_MAX_BYTES);
      expect((await rows(file)).some((row) => row.path === '/last-legacy')).toBe(true);
    }
    expect((await rows(f.file)).at(-1)).toEqual(record(9));
    expect(await readdir(f.directory)).toHaveLength(2);
  });

  it('recovers a partial final line and a leftover bounded scratch file before the next append', async () => {
    const f = await fixture();
    await writeFile(f.file, `${JSON.stringify(record(1))}\n{"incomplete":`);
    await writeFile(join(f.directory, 'automation-audit.pending.ndjson'), 'abandoned rewrite');
    expect(await f.writer.append(record(2))).toBe(true);
    expect(await rows(f.file)).toEqual([record(1), record(2)]);
    expect(await readdir(f.directory)).toEqual([AUTOMATION_LOG_FILE]);
  });

  it('drops an oversized unterminated legacy record without exceeding the file budget', async () => {
    const f = await fixture();
    await writeFile(f.file, 'x'.repeat(AUTOMATION_LOG_MAX_BYTES * 2));
    expect(await f.writer.append(record(3))).toBe(true);
    expect(await rows(f.file)).toEqual([record(3)]);
  });

  it('rejects oversized new records and caps queued work, then accepts later work', async () => {
    const f = await fixture();
    expect(
      await f.writer.append({ ...record(), path: 'x'.repeat(AUTOMATION_LOG_MAX_RECORD_BYTES) }),
    ).toBe(false);
    const pending = Array.from({ length: AUTOMATION_LOG_MAX_PENDING + 1 }, (_, i) =>
      f.writer.append(record(i)),
    );
    expect((await Promise.all(pending)).filter(Boolean)).toHaveLength(AUTOMATION_LOG_MAX_PENDING);
    expect(await f.writer.append(record(999))).toBe(true);
    expect(await rows(f.file)).toHaveLength(AUTOMATION_LOG_MAX_PENDING + 1);
    expect(f.onProblem).toHaveBeenCalledWith('record_rejected');
    expect(f.onProblem).toHaveBeenCalledWith('queue_full');
    expect(f.onProblem).toHaveBeenCalledWith('recovered');
  });

  it.each([AUTOMATION_LOG_FILE, AUTOMATION_LOG_PREVIOUS, 'automation-audit.pending.ndjson'])(
    'refuses a linked %s without touching the target and resumes after correction',
    async (name) => {
      const f = await fixture();
      const target = join(f.root, 'private-synthetic-target');
      await writeFile(target, 'keep exactly');
      const linked = join(f.directory, name);
      await symlink(target, linked);
      expect(await f.writer.append(record())).toBe(false);
      expect(await f.writer.append(record())).toBe(false);
      expect(await readFile(target, 'utf8')).toBe('keep exactly');
      expect(f.onProblem.mock.calls).toEqual([['write_failed']]);
      await rm(linked);
      expect(await f.writer.append(record(5))).toBe(true);
      expect(await rows(f.file)).toEqual([record(5)]);
      expect(f.onProblem.mock.calls).toEqual([['write_failed'], ['recovered']]);
    },
  );

  it('does not swallow a rotation obstruction and append over capacity; recovery keeps valid NDJSON', async () => {
    const f = await fixture();
    const full = fullFile(AUTOMATION_LOG_MAX_BYTES);
    await writeFile(f.file, full);
    await mkdir(f.previous);
    expect(await f.writer.append(record(2))).toBe(false);
    expect(await readFile(f.file, 'utf8')).toBe(full);
    await rm(f.previous, { recursive: true });
    expect(await f.writer.append(record(3))).toBe(true);
    expect(await rows(f.file)).toEqual([record(3)]);
    expect(await readFile(f.previous, 'utf8')).toBe(full);
  });

  it('a new writer resumes existing files; a failed reporting callback cannot poison writes', async () => {
    const f = await fixture();
    await f.writer.append(record(1));
    await f.writer.flush();
    const restarted = createAutomationRequestLog({
      directory: () => f.directory,
      onProblem: () => {
        throw new Error('synthetic callback failure');
      },
    });
    await mkdir(f.previous);
    expect(await restarted.append(record(2))).toBe(false);
    await rm(f.previous, { recursive: true });
    expect(await restarted.append(record(3))).toBe(true);
    await restarted.flush();
    expect(await rows(f.file)).toEqual([record(1), record(3)]);
  });
});
