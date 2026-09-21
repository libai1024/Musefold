import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

process.once('message', async (input: { directory: string; phase: string }) => {
  const original = fs.promises.rename;
  const pause = async () => {
    const keepAlive = setInterval(() => {}, 1000);
    process.send?.({ type: 'paused', pid: process.pid });
    await new Promise<void>(() => {});
    clearInterval(keepAlive);
  };
  fs.promises.rename = async (from, to) => {
    const rewrite = String(from).endsWith('automation-audit.pending.ndjson');
    const rotate = String(from).endsWith('automation-audit.ndjson');
    if (rewrite && input.phase === 'before-rewrite') await pause();
    await original(from, to);
    if ((rewrite && input.phase === 'after-rewrite') || (rotate && input.phase === 'after-rotate'))
      await pause();
  };
  syncBuiltinESMExports();
  try {
    const { createAutomationRequestLog } = await import('../../automation-request-log');
    const notices: string[] = [];
    const writer = createAutomationRequestLog({
      directory: () => input.directory,
      onProblem: (problem) => notices.push(problem),
    });
    const written = await writer.append({
      at: '2026-09-13T00:00:00.000Z',
      method: 'GET',
      path: '/v1/health',
      status: 200,
      durationMs: 7,
    });
    await writer.flush();
    process.send?.({ type: 'result', pid: process.pid, written, notices });
  } catch {
    process.send?.({ type: 'error' });
    process.exitCode = 1;
  } finally {
    process.disconnect();
  }
});
process.send?.({ type: 'ready' });
