import type { ProviderType } from '@shared/types/enums';

export type SkillRuntimeProviderPolicy = 'agent-preferred' | 'direct-forward';

/** 豆包当前只接收用户粘贴的 Skill 文本，不经过 Musefold Agent。 */
export function skillRuntimePolicyForProvider(
  providerType: ProviderType | null | undefined,
): SkillRuntimeProviderPolicy {
  return providerType === 'doubao-web' ? 'direct-forward' : 'agent-preferred';
}
