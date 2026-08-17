// 服务面统一错误（V04-ARCHITECTURE §4.3）：
// 控制面把 CoreError 映射为错误信封 { error: { code, message, details } }，
// 沿用现有 IPC 错误码语义；服务内部的仓库错误在边界处归一。

export class CoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CoreError';
  }
}

export function notFound(subject: string, details: Record<string, unknown> = {}): CoreError {
  return new CoreError('NOT_FOUND', `${subject}不存在`, details);
}
