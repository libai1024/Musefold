import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTOMATION_LOG_FILE,
  AUTOMATION_LOG_PREVIOUS,
  AUTOMATION_LOG_MAX_BYTES,
} from '../automation-request-log';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function message(child: ChildProcess, type: string) {
  return new Promise<{ type: string; pid: number; written?: boolean; notices?: string[] }>(
    (resolve, reject) => {
      const timer = setTimeout(() => done(new Error(`Missing owned writer ${type}`)), 10000);
      const exited = () => done(new Error('Owned writer exited before response'));
      const receive = (value: { type: string; pid: number }) => {
        if (value.type === 'error') done(new Error('Owned writer failed'));
        else if (value.type === type) {
          done();
          resolve(value);
        }
      };
      function done(error?: Error) {
        clearTimeout(timer);
        child.off('message', receive);
        child.off('exit', exited);
        if (error) reject(error);
      }
      child.on('message', receive);
      child.on('exit', exited);
    },
  );
}

async function start() {
  const child = fork(
    fileURLToPath(new URL('./fixtures/automation-request-log-process.ts', import.meta.url)),
    [],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  await message(child, 'ready');
  return { child, closed };
}

describe('endpoint diagnostic recovery after an actual owned process is killed', () => {
  it.each(['before-rewrite', 'after-rewrite', 'after-rotate'])(
    'recovers complete bounded files in a new PID after %s',
    async (phase) => {
      const directory = await mkdtemp(join(tmpdir(), 'musefold-owned-log-crash-'));
      cleanup.push(() => rm(directory, { recursive: true, force: true }));
      const current = join(directory, AUTOMATION_LOG_FILE);
      const previous = join(directory, AUTOMATION_LOG_PREVIOUS);
      const pending = join(directory, 'automation-audit.pending.ndjson');
      const line = `${JSON.stringify({ source: 'owned legacy record' })}\n`;
      const legacy = line.repeat(Math.ceil((3 * 1024 * 1024) / Buffer.byteLength(line)));
      const exact = `${JSON.stringify({ padding: 'x'.repeat(AUTOMATION_LOG_MAX_BYTES - 15) })}\n`;
      expect(Buffer.byteLength(exact)).toBe(AUTOMATION_LOG_MAX_BYTES);
      await writeFile(current, phase === 'after-rotate' ? exact : legacy);
      await writeFile(previous, phase === 'after-rotate' ? line : legacy);
      const original = await start();
      const paused = message(original.child, 'paused');
      original.child.send({ directory, phase });
      expect((await paused).pid).toBe(original.child.pid);
      if (phase === 'before-rewrite') {
        expect((await stat(pending)).size).toBeLessThanOrEqual(AUTOMATION_LOG_MAX_BYTES);
        expect(await readFile(current, 'utf8')).toBe(legacy);
        expect(await readFile(previous, 'utf8')).toBe(legacy);
      } else if (phase === 'after-rewrite') {
        expect((await stat(previous)).size).toBeLessThanOrEqual(AUTOMATION_LOG_MAX_BYTES);
        expect(await readFile(current, 'utf8')).toBe(legacy);
      } else {
        await expect(stat(current)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(previous, 'utf8')).toBe(exact);
      }
      expect(original.child.kill('SIGKILL')).toBe(true);
      expect(await original.closed).toEqual({ code: null, signal: 'SIGKILL' });

      const replacement = await start();
      const result = message(replacement.child, 'result');
      replacement.child.send({ directory, phase: 'recover' });
      expect(await result).toMatchObject({
        pid: replacement.child.pid,
        written: true,
        notices: [],
      });
      expect(replacement.child.pid).not.toBe(original.child.pid);
      expect(await replacement.closed).toEqual({ code: 0, signal: null });
      for (const file of [current, previous]) {
        expect((await stat(file)).size).toBeLessThanOrEqual(AUTOMATION_LOG_MAX_BYTES);
        const bytes = await readFile(file, 'utf8');
        expect(bytes.endsWith('\n')).toBe(true);
        for (const row of bytes.trimEnd().split('\n')) expect(() => JSON.parse(row)).not.toThrow();
      }
      const last = JSON.parse((await readFile(current, 'utf8')).trimEnd().split('\n').at(-1)!);
      expect(last).toMatchObject({ path: '/v1/health', durationMs: 7 });
      expect((await readdir(directory)).sort()).toEqual(
        [AUTOMATION_LOG_FILE, AUTOMATION_LOG_PREVIOUS].sort(),
      );
      if (phase === 'after-rotate') expect(await readFile(previous, 'utf8')).toBe(exact);
    },
    30000,
  );
});
