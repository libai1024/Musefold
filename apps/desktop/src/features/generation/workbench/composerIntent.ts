const DESIGN_PLAN_COMMAND = /^\/\s*(?:create\s+design\s+plan\b|创建设计方案)/i;
const GITHUB_SKILL_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+(?:\/(?:tree|blob)\/[^\s]+)?\/?/i;

/** 指令芯片上显示的名称（Codex 式「图标 + 指令名」）。 */
export const DESIGN_PLAN_COMMAND_LABEL = '创建设计方案';

/** Composer 里以 / 开头时给出的指令提示；两种写法等价。 */
export const DESIGN_PLAN_COMMAND_HINTS = [
  { command: '/create design plan', description: '用一段想法（可附 GitHub Skill 地址）创建设计方案' },
  { command: '/创建设计方案', description: '同上，中文指令' },
] as const;

export type CommandHint = (typeof DESIGN_PLAN_COMMAND_HINTS)[number];

/** 按已输入的 / 前缀实时筛选指令；输入命中完整指令后不再提示（转为指令芯片）。 */
export function filterCommandHints(value: string): CommandHint[] {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith('/') || DESIGN_PLAN_COMMAND.test(trimmed)) return [];
  const input = trimmed.toLowerCase();
  return DESIGN_PLAN_COMMAND_HINTS.filter((hint) => hint.command.toLowerCase().startsWith(input));
}

/** 输入是否应展示指令提示（存在按前缀匹配到的指令）。 */
export function shouldShowCommandHints(value: string): boolean {
  return filterCommandHints(value).length > 0;
}

/**
 * 输入是否以完整创建指令开头；命中时返回去掉指令后的剩余正文。
 * Composer 用它把指令文本收敛成指令芯片（Codex 式）。
 */
export function matchDesignPlanCommand(value: string): { rest: string } | null {
  const trimmed = value.trimStart();
  if (!DESIGN_PLAN_COMMAND.test(trimmed)) return null;
  return { rest: trimmed.replace(DESIGN_PLAN_COMMAND, '').replace(/^\s+/, '') };
}

export interface DesignPlanIntent {
  prompt: string;
  /** 第一个来源地址（兼容字段）。 */
  githubUrl?: string;
  /** 全部来源地址；多个时创建管线会合并为一个组合方案（P3）。 */
  githubUrls: string[];
}

/** 指令芯片已挂载时：正文即想法，其中的 GitHub 地址（可多个）提取为方案来源。 */
export function parseDesignPlanBody(value: string): DesignPlanIntent {
  const body = value.trim();
  const matches = body.match(new RegExp(GITHUB_SKILL_URL, 'gi')) ?? [];
  const githubUrls = [...new Set(matches)];
  let prompt = body;
  for (const url of githubUrls) prompt = prompt.split(url).join(' ');
  return {
    prompt: prompt.replace(/\s+/g, ' ').trim(),
    githubUrls,
    ...(githubUrls[0] ? { githubUrl: githubUrls[0] } : {}),
  };
}

export function parseDesignPlanIntent(value: string): DesignPlanIntent | null {
  const matched = matchDesignPlanCommand(value.trim());
  if (!matched) return null;
  return parseDesignPlanBody(matched.rest);
}

export function exactGithubSkillUrl(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(GITHUB_SKILL_URL)?.[0];
  return match === trimmed ? match : null;
}
