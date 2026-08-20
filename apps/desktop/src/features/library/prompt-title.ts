export function titleFromPromptContent(content: string, fallback = '生成提示词'): string {
  const compact = content.trim().replace(/\s+/g, ' ');
  return Array.from(compact).slice(0, 40).join('') || fallback;
}
