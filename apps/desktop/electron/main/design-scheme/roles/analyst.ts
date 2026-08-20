/**
 * Repository Analyst：只做分析，不做转换（开发规范 §6）。
 * 输入固定 commit 快照的文本与图片清单，输出结构化分析报告。
 */
import { analystReportSchema, type AnalystReport } from '@musefold/desktop-contracts/design-scheme/agents';
import { completeStructured, type OpenAiCompatibleTextAdapter } from '../text-adapter';

const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 120_000;

export interface AnalystInput {
  brief: string;
  repositoryLabel: string;
  textFiles: Array<{ path: string; text: string }>;
  imagePaths: string[];
  license: string | null;
}

const ANALYST_SYSTEM = `你是 Musefold 的仓库分析师（Repository Analyst）。
你的唯一职责是分析一个 GitHub 仓库快照能提供哪些「视觉生产能力」，为后续编译设计方案提供事实依据。

规则：
1. 只依据给出的文件内容下结论，每条规则必须在 evidencePaths 里给出证据文件路径；没有证据的规则不要输出。
2. 诚实列出仓库中 Musefold 无法还原的部分（如需要执行脚本、依赖外部服务、需要特定字体文件），放进 unsupported。
3. rules 用中文陈述句描述视觉规则（构图/色彩/排版/质感/主体处理/输出规格/安全边界之一），mode 用 required/preferred/avoid。
4. variables 是使用者每次运行时需要提供的输入（文字主题、主体图片等），不要把固定风格规则当成 variables。
5. referenceImages 从图片清单中挑选对风格有代表性的，标注建议角色。
6. 只输出 JSON 对象，不要输出其他文字。

JSON 结构：
{
  "repoKind": "agent-skill | prompt-repo | readme-examples | workflow-config | code-dependent | asset-only",
  "capabilitySummary": "一句话能力概括",
  "rules": [{ "domain": "composition|color|typography|texture|subject|output|safety", "statement": "…", "mode": "required|preferred|avoid", "evidencePaths": ["path"] }],
  "variables": [{ "label": "…", "kind": "text|image|image-set|article|choice", "required": true, "imageRole": "edit-target|subject-reference|style-reference|layout-reference|content-reference", "description": "…" }],
  "referenceImages": [{ "path": "…", "role": "style-reference" }],
  "unsupported": ["…"],
  "license": "许可证名称（如可识别）"
}`;

function fileSections(files: AnalystInput['textFiles']): string {
  const sections: string[] = [];
  let used = 0;
  for (const file of files) {
    if (used >= MAX_TOTAL_CHARS) {
      sections.push(`（其余 ${files.length - sections.length} 个文件因篇幅限制省略）`);
      break;
    }
    const slice = file.text.slice(0, Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - used));
    used += slice.length;
    const truncated = slice.length < file.text.length ? '\n…（已截断）' : '';
    sections.push(`### ${file.path}\n\n${slice}${truncated}`);
  }
  return sections.join('\n\n');
}

export async function runRepositoryAnalyst(
  adapter: OpenAiCompatibleTextAdapter,
  input: AnalystInput,
  signal?: AbortSignal,
): Promise<{ report: AnalystReport; model: string; retried: boolean }> {
  const user = [
    `仓库：${input.repositoryLabel}`,
    input.license ? `许可证行：${input.license}` : '许可证：未识别',
    input.brief.trim() ? `用户创建方案时的说明：${input.brief.trim()}` : '用户未提供额外说明。',
    '',
    `## 图片清单（${input.imagePaths.length} 张）`,
    input.imagePaths.length > 0 ? input.imagePaths.map((path) => `- ${path}`).join('\n') : '（无图片）',
    '',
    '## 文本文件',
    fileSections(input.textFiles),
  ].join('\n');

  const result = await completeStructured({
    adapter,
    schema: analystReportSchema,
    system: ANALYST_SYSTEM,
    user,
    signal,
    label: '仓库分析',
  });
  return { report: result.value, model: result.model, retried: result.retried };
}
