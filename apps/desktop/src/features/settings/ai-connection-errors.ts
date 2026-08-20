export const AI_CONNECTION_RESTART_REQUIRED =
  'Agent 模型服务尚未加载。请完全重启 Musefold 后再试。';

export function isAiConnectionRuntimeMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /No handler registered for ['"]aiConnection:/i.test(message);
}

export function aiConnectionErrorMessage(error: unknown, fallback: string): string {
  if (isAiConnectionRuntimeMismatch(error)) return AI_CONNECTION_RESTART_REQUIRED;
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
