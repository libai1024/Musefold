// packages/domain/src/generation-prompt.ts
// 生图提示词的通用组合规则 —— 渲染进程 Composer 与主进程 Skill Agent 共用，
// 保证「比例约束」「图 N 编号说明」在两条链路上措辞完全一致。

import type { ResolvedPromptReferenceSnapshot } from '@musefold/contracts';
import { generationAspectRatioSchema, MAX_PROMPT_REFERENCE_SELECTIONS } from '@musefold/contracts';
import { resolveRatioOptionById } from './constants';
import { appError, fail, ok, type AppResult } from './app-result';

export const RATIO_CONSTRAINT_PREFIX = '画面比例约束：';

export function ratioPromptConstraint(ratioId: string): string {
  const parsedRatio = generationAspectRatioSchema.safeParse(ratioId);
  const canonicalPlainRatio = parsedRatio.success ? parsedRatio.data : null;
  const option = canonicalPlainRatio
    ? { id: canonicalPlainRatio, ratio: canonicalPlainRatio }
    : resolveRatioOptionById(ratioId);
  if (option.id === 'auto') return '';
  return `${RATIO_CONSTRAINT_PREFIX}严格按照 ${option.ratio} 画幅构图；主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。`;
}

export function composePromptWithRatioConstraint(prompt: string, ratioId: string): string {
  const base = prompt.trim();
  const constraint = ratioPromptConstraint(ratioId);
  if (!base || !constraint || base.includes(RATIO_CONSTRAINT_PREFIX)) return base;
  return `${base}\n\n${constraint}`;
}

export const PROMPT_REFERENCE_HEADER = '参考提示词：';
export const MAX_COMPOSED_PROMPT_LENGTH = 8_000;
export const MAX_RESOLVED_PROMPT_REFERENCE_TEXT_LENGTH = 4_000;

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function splitsSurrogatePair(content: string, offset: number): boolean {
  return (
    offset > 0 &&
    offset < content.length &&
    isHighSurrogate(content.charCodeAt(offset - 1)) &&
    isLowSurrogate(content.charCodeAt(offset))
  );
}

/** Validate browser UTF-16 selection offsets without allowing a surrogate pair to be split. */
export function isValidUtf16SliceRange(
  content: string,
  range: Readonly<{ start: number; end: number }>,
): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end <= content.length &&
    range.start < range.end &&
    !splitsSurrogatePair(content, range.start) &&
    !splitsSurrogatePair(content, range.end)
  );
}

export interface PromptReferenceCompositionResult {
  finalPrompt: string;
  promptReferences: ResolvedPromptReferenceSnapshot[];
}

/**
 * Compose host-resolved prompt snapshots before image-index and ratio hint stages.
 * The snapshots are already authorized and resolved by the host; this function does not do IO.
 */
export function composePromptWithReferences(
  userPrompt: string,
  references: readonly ResolvedPromptReferenceSnapshot[],
): AppResult<PromptReferenceCompositionResult> {
  if (references.length > MAX_PROMPT_REFERENCE_SELECTIONS) {
    return fail(
      appError('TOO_MANY_ITEMS', `提示词引用不能超过 ${MAX_PROMPT_REFERENCE_SELECTIONS} 条`, {
        fieldPath: 'promptReferences',
        recoveryAction: 'edit-input',
        details: { max: MAX_PROMPT_REFERENCE_SELECTIONS, actual: references.length },
      }),
    );
  }

  const deduped: ResolvedPromptReferenceSnapshot[] = [];
  const seen = new Set<string>();
  for (const [index, reference] of references.entries()) {
    const text = reference.text.trim();
    if (text.length > MAX_RESOLVED_PROMPT_REFERENCE_TEXT_LENGTH) {
      return fail(
        appError('PROMPT_TOO_LONG', '引用提示词片段不能超过 4000 个字符', {
          fieldPath: `promptReferences.${index}.text`,
          recoveryAction: 'shorten-input',
          details: {
            max: MAX_RESOLVED_PROMPT_REFERENCE_TEXT_LENGTH,
            actual: text.length,
          },
        }),
      );
    }
    if (!text) continue;

    const key = JSON.stringify([reference.promptId, text]);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(text === reference.text ? reference : { ...reference, text });
  }

  const prompt = userPrompt.trim();
  if (!prompt && deduped.length === 0) {
    return fail(
      appError('REQUIRED', '请输入提示词或选择至少一条参考提示词', {
        fieldPath: 'prompt',
        recoveryAction: 'edit-input',
      }),
    );
  }

  const referenceBlocks = deduped.map(
    (reference) =>
      `【${reference.title}｜${reference.scope === 'full' ? '整条' : '选中片段'}】\n${reference.text}`,
  );
  const finalPrompt = referenceBlocks.length
    ? `${prompt ? `${prompt}\n\n` : ''}${PROMPT_REFERENCE_HEADER}\n${referenceBlocks.join('\n\n')}`
    : prompt;

  if (finalPrompt.length > MAX_COMPOSED_PROMPT_LENGTH) {
    return fail(
      appError('PROMPT_TOO_LONG', '组合后的提示词不能超过 8000 个字符', {
        fieldPath: 'prompt',
        recoveryAction: 'shorten-input',
        details: { max: MAX_COMPOSED_PROMPT_LENGTH, actual: finalPrompt.length },
      }),
    );
  }

  return ok({ finalPrompt, promptReferences: deduped });
}

export interface GenerationPromptCompositionInput {
  userPrompt: string;
  promptReferences: readonly ResolvedPromptReferenceSnapshot[];
  imageCount?: number;
  ratioId?: string;
}

/**
 * Complete host composition pipeline: user prompt, prompt references, image hint, then ratio hint.
 * Call this before handing the final prompt to a provider. It performs no record resolution or IO.
 */
export function composeGenerationPrompt(
  input: GenerationPromptCompositionInput,
): AppResult<PromptReferenceCompositionResult> {
  const referencesResult = composePromptWithReferences(input.userPrompt, input.promptReferences);
  if (!referencesResult.ok) return referencesResult;

  let finalPrompt = referencesResult.data.finalPrompt;
  if ((input.imageCount ?? 0) >= 2) {
    finalPrompt = `${finalPrompt}\n\n${MULTI_IMAGE_INDEX_HINT}`;
  }

  const ratioConstraint = ratioPromptConstraint(input.ratioId ?? 'auto');
  if (ratioConstraint) {
    finalPrompt = `${finalPrompt}\n\n${ratioConstraint}`;
  }

  if (finalPrompt.length > MAX_COMPOSED_PROMPT_LENGTH) {
    return fail(
      appError('PROMPT_TOO_LONG', '组合后的提示词不能超过 8000 个字符', {
        fieldPath: 'prompt',
        recoveryAction: 'shorten-input',
        details: { max: MAX_COMPOSED_PROMPT_LENGTH, actual: finalPrompt.length },
      }),
    );
  }

  return ok({
    finalPrompt,
    promptReferences: referencesResult.data.promptReferences,
  });
}

export const composePromptWithResolvedReferences = composePromptWithReferences;

export const MULTI_IMAGE_INDEX_HINT =
  '参考图按上传顺序编号为图 1、图 2……，请严格按照编号理解用户对各张图片的指代。';

export function composePromptWithImageIndexHint(prompt: string, imageCount: number): string {
  const text = prompt.trim();
  if (!text || imageCount < 2) return text;
  return `${MULTI_IMAGE_INDEX_HINT}\n\n${text}`;
}
