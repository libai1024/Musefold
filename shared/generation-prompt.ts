// shared/generation-prompt.ts
// 生图提示词的通用组合规则 —— 渲染进程 Composer 与主进程 Skill Agent 共用，
// 保证「比例约束」「图 N 编号说明」在两条链路上措辞完全一致。

import { RATIO_OPTIONS } from './constants';

export const RATIO_CONSTRAINT_PREFIX = '画面比例约束：';

export function ratioPromptConstraint(ratioId: string): string {
  const option = RATIO_OPTIONS.find((item) => item.id === ratioId) ?? RATIO_OPTIONS[0];
  if (option.id === 'auto') return '';
  return `${RATIO_CONSTRAINT_PREFIX}严格按照 ${option.ratio} 画幅构图；主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。`;
}

export function composePromptWithRatioConstraint(prompt: string, ratioId: string): string {
  const base = prompt.trim();
  const constraint = ratioPromptConstraint(ratioId);
  if (!base || !constraint || base.includes(RATIO_CONSTRAINT_PREFIX)) return base;
  return `${base}\n\n${constraint}`;
}

export const MULTI_IMAGE_INDEX_HINT =
  '参考图按上传顺序编号为图 1、图 2……，请严格按照编号理解用户对各张图片的指代。';

export function composePromptWithImageIndexHint(prompt: string, imageCount: number): string {
  const text = prompt.trim();
  if (!text || imageCount < 2) return text;
  return `${MULTI_IMAGE_INDEX_HINT}\n\n${text}`;
}
