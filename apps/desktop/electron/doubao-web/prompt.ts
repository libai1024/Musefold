import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';

/** 组装最终填写到豆包网页输入框的文字。 */
export function composeDoubaoWebPrompt(req: GenerateImageRequest): string {
  const refinementInstruction = req.referenceImages?.length
    ? req.refinementInstruction?.trim()
    : '';
  if (refinementInstruction) return refinementInstruction;

  const parts = [req.prompt.trim()];
  if (req.negative?.trim()) parts.push(`避免出现：${req.negative.trim()}`);
  if (req.aspectRatio && req.aspectRatio !== 'auto') parts.push(`画幅比例：${req.aspectRatio}`);
  return parts.filter(Boolean).join('\n\n');
}
