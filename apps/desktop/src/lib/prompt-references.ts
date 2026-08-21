import type { PromptReference } from '@musefold/desktop-contracts/providers';

export const MAX_DRAFT_REFERENCES = 6;
export const MAX_REFERENCE_TEXT_LENGTH = 4000;

export function composePromptWithReferences(
  prompt: string,
  references: PromptReference[],
): string {
  const userPrompt = prompt.trim();
  if (references.length === 0) return userPrompt;

  const referenceBlocks = references.map((reference) => {
    const scopeLabel = reference.scope === 'full' ? '整条' : '选中片段';
    return `【${reference.title}｜${scopeLabel}】\n${reference.text.trim()}`;
  });
  return [userPrompt, '参考提示词：', ...referenceBlocks].filter(Boolean).join('\n\n');
}

export function isDuplicateReference(
  references: PromptReference[],
  candidate: PromptReference,
): boolean {
  return references.some(
    (reference) =>
      reference.promptId === candidate.promptId && reference.text.trim() === candidate.text.trim(),
  );
}

/** 从本应用固定合并格式中还原用户正文；旧记录或外部记录不匹配时原样返回。 */
export function extractUserPromptFromComposed(
  composedPrompt: string,
  references: PromptReference[],
): string {
  if (references.length === 0) return composedPrompt;
  const referenceBlock = composePromptWithReferences('', references);
  if (composedPrompt === referenceBlock) return '';
  const suffix = `\n\n${referenceBlock}`;
  return composedPrompt.endsWith(suffix)
    ? composedPrompt.slice(0, -suffix.length)
    : composedPrompt;
}
