export type AiAccessSource = 'account' | 'byok';
export type AiAccessMode = 'account' | 'relay';
export type AccountImageSource = 'doubao' | 'official';

interface AccessEntry {
  managedBy: 'account' | null;
}

interface AccessProviderEntry extends AccessEntry {
  type: string;
}

interface RecentAccessEntry extends AccessEntry {
  hasKey: boolean;
  updatedAt: number;
}

export interface AiAccessConnectivityCheck {
  label: string;
  run: () => Promise<{ ok: boolean; message?: string }>;
}

export function accessSourceOf(entry: AccessEntry | null | undefined): AiAccessSource | null {
  if (!entry) return null;
  return entry.managedBy === 'account' ? 'account' : 'byok';
}

/** 豆包和 Musefold 托管 Provider 都属于账号模式；其余 Provider 属于中转站模式。 */
export function accessModeOfProvider(entry: AccessProviderEntry | null | undefined): AiAccessMode | null {
  if (!entry) return null;
  return entry.type === 'doubao-web' || entry.managedBy === 'account' ? 'account' : 'relay';
}

export function accountImageSourceOfProvider(
  entry: AccessProviderEntry | null | undefined,
): AccountImageSource | null {
  if (!entry) return null;
  if (entry.type === 'doubao-web') return 'doubao';
  return entry.managedBy === 'account' ? 'official' : null;
}

/** 最近使用且已配置密钥的自备服务优先；没有可用密钥时仍返回最近条目供用户修复。 */
export function preferredByokEntry<T extends RecentAccessEntry>(entries: T[]): T | null {
  return entries
    .filter((entry) => entry.managedBy !== 'account')
    .sort((left, right) => Number(right.hasKey) - Number(left.hasKey) || right.updatedAt - left.updatedAt)[0] ?? null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '连接失败';
}

/** 所有目标通道并行验证；任一失败时汇总原因，调用方不得提交切换。 */
export async function verifyAiAccessConnectivity(checks: AiAccessConnectivityCheck[]): Promise<void> {
  const results = await Promise.allSettled(checks.map((check) => check.run()));
  const failures = results.flatMap((result, index) => {
    const check = checks[index];
    if (result.status === 'rejected') return [`${check.label}：${errorMessage(result.reason)}`];
    if (!result.value.ok) return [`${check.label}：${result.value.message || '连接失败'}`];
    return [];
  });
  if (failures.length > 0) throw new Error(failures.join('；'));
}
