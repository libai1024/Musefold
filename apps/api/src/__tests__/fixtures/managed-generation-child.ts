import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function childMessage<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`Missing fixture ${type}`)), 10000);
    const exited = () => done(new Error('Fixture exited before message'));
    const received = (raw: unknown) => {
      const value = raw as { type: string; result: T };
      if (value.type === 'error') done(new Error(String(value.result)));
      else if (value.type === type) done(null, value.result);
    };
    function done(error: Error | null, result?: T) {
      clearTimeout(timer);
      child.off('message', received);
      child.off('exit', exited);
      if (error) reject(error);
      else resolve(result as T);
    }
    child.on('message', received);
    child.on('exit', exited);
  });
}

/** Cross-runtime test process, not a dependency from production API to the local core. */
export function startManagedGenerationChild(args: string[]) {
  const child = fork(
    fileURLToPath(
      new URL(
        '../../../../../packages/core/src/services/__tests__/fixtures/managed-generation-process.ts',
        import.meta.url,
      ),
    ),
    args,
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, closed };
}
