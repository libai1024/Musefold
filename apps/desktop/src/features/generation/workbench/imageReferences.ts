import { MAX_REFERENCE_IMAGES, type LocalImageReference } from '@shared/types/providers';
// 图 N 编号说明移到 shared/generation-prompt.ts，主进程 Skill Agent 复用同一份措辞。
import { MULTI_IMAGE_INDEX_HINT } from '@musefold/domain/generation-prompt';

export { MAX_REFERENCE_IMAGES };
export { MULTI_IMAGE_INDEX_HINT, composePromptWithImageIndexHint } from '@musefold/domain/generation-prompt';

export const REFINEMENT_TARGET_IMAGE_HINT = '图 1 为本次微调目标。';
export const REFINEMENT_SUPPORTING_IMAGES_HINT =
  '图 2 及后续图片仅按用户说明用于参考、风格学习或融合。';

export function composePromptWithRefinementImageHint(prompt: string, imageCount: number): string {
  let text = prompt.trim();
  const knownHints = [
    `${REFINEMENT_TARGET_IMAGE_HINT}${REFINEMENT_SUPPORTING_IMAGES_HINT}`,
    REFINEMENT_TARGET_IMAGE_HINT,
    MULTI_IMAGE_INDEX_HINT,
  ];
  let removedHint = true;
  while (removedHint) {
    removedHint = false;
    for (const knownHint of knownHints) {
      if (text === knownHint || text.startsWith(`${knownHint}\n\n`)) {
        text = text.slice(knownHint.length).trimStart();
        removedHint = true;
        break;
      }
    }
  }
  if (!text || imageCount < 1) return text;
  const hint = imageCount > 1
    ? `${REFINEMENT_TARGET_IMAGE_HINT}${REFINEMENT_SUPPORTING_IMAGES_HINT}`
    : REFINEMENT_TARGET_IMAGE_HINT;
  return `${hint}\n\n${text}`;
}

export function uniqueReferenceImages(images: LocalImageReference[]): LocalImageReference[] {
  const seen = new Set<string>();
  const result: LocalImageReference[] = [];
  for (const image of images) {
    const key = image.source === 'history' && image.historyId
      ? `history:${image.historyId}`
      : `${image.source}:${image.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...image });
    if (result.length === MAX_REFERENCE_IMAGES) break;
  }
  return result;
}
