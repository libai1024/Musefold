import type { AiProviderTestResult } from '@musefold/contracts';

export type ConnectionStatusKind = 'missing-key' | 'tested-ok' | 'untested';

/** 行首状态点:缺 Key 优先,其余看会话内最近一次测试。 */
export function connectionStatusKind(
  hasKey: boolean,
  lastTest: AiProviderTestResult | undefined,
): ConnectionStatusKind {
  if (!hasKey) return 'missing-key';
  if (lastTest?.ok) return 'tested-ok';
  return 'untested';
}

export function connectionStatusLabel(kind: ConnectionStatusKind): string {
  if (kind === 'missing-key') return '未配置密钥';
  if (kind === 'tested-ok') return '最近测试通过';
  return '尚未测试';
}

export function connectionStatusClass(kind: ConnectionStatusKind): string {
  if (kind === 'missing-key') return 'bg-warning';
  if (kind === 'tested-ok') return 'bg-success';
  return 'bg-muted-foreground/40';
}
