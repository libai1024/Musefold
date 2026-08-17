// CLI 输出契约（V04-CLI-SPEC §1.3）：
// 人类模式紧凑键值；--json 模式 stdout 只放稳定 JSON；错误双通道。

export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

/** 退出码（V04-CLI-SPEC §1.2） */
export const EXIT = {
  OK: 0,
  GENERAL: 1,
  ARGS: 2,
  NOT_CONNECTED: 3,
  REFUSED: 4,
  BUDGET: 5,
  PROVIDER: 6,
  INTERRUPTED: 130,
} as const;

export function printJson(io: CliIo, value: unknown): void {
  io.stdout(JSON.stringify(value));
}

export function printError(io: CliIo, json: boolean, code: string, message: string): void {
  io.stderr(`musefold: ${message}`);
  if (json) io.stdout(JSON.stringify({ type: 'error', code, message }));
}

/** 简单两列对齐（全角字符按 2 宽度计） */
export function table(rows: Array<[string, string]>): string[] {
  const width = Math.max(...rows.map(([key]) => displayWidth(key)), 0);
  return rows.map(([key, value]) => `${key}${' '.repeat(Math.max(1, width - displayWidth(key) + 2))}${value}`);
}

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += /[\u1100-\uFFFD]/.test(char) && char.charCodeAt(0) > 0x2e7f ? 2 : 1;
  return width;
}
