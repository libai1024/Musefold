export const WORKBENCH_SESSION_RESTART_REQUIRED =
  '对话服务尚未加载。请完全重启 Musefold 后再试。';

export function isWorkbenchSessionRuntimeMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /No handler registered for ['"]workbenchSession:/i.test(message);
}

export function workbenchSessionErrorMessage(error: unknown, fallback: string): string {
  if (isWorkbenchSessionRuntimeMismatch(error)) return WORKBENCH_SESSION_RESTART_REQUIRED;
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
