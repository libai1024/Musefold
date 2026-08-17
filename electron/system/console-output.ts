type ConsoleMethod = 'log' | 'warn' | 'error';
interface ConsoleOutputStream {
  destroyed?: boolean;
  writableEnded?: boolean;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

const guardedStreams = new WeakSet<object>();
const unavailableStreams = new WeakSet<object>();

export function isBrokenPipeError(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'EPIPE',
  );
}

export function installConsoleOutputGuards(
  streams: readonly (ConsoleOutputStream | null | undefined)[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) {
    if (!stream) continue;
    if (guardedStreams.has(stream)) continue;
    guardedStreams.add(stream);
    stream.on('error', (error: Error) => {
      if (!isBrokenPipeError(error)) throw error;
      unavailableStreams.add(stream);
    });
  }
}

export function writeConsoleLine<Method extends ConsoleMethod>(
  method: Method,
  line: string,
  stream: ConsoleOutputStream | null | undefined = method === 'log' ? process.stdout : process.stderr,
  target: Pick<Console, Method> = console,
): void {
  if (!stream || unavailableStreams.has(stream) || stream.destroyed || stream.writableEnded) return;

  try {
    target[method](line);
  } catch (error) {
    if (!isBrokenPipeError(error)) throw error;
    unavailableStreams.add(stream);
  }
}
