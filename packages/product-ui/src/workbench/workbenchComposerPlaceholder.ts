export interface WorkbenchComposerPlaceholderOptions {
  hasTurns?: boolean;
  hasPromptReference?: boolean;
}

/** Keep the common generation composer copy identical across hosts. */
export function workbenchComposerPlaceholder({
  hasTurns = false,
  hasPromptReference = false,
}: WorkbenchComposerPlaceholderOptions = {}): string {
  if (hasPromptReference) return "已引用提示词，可补充本次要求（可选）…";
  if (hasTurns) return "描述下一步调整…";
  return "描述你想生成的图片…";
}
