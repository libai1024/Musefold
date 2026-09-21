import { MAX_DESIGN_SCHEME_HISTORY_PROMPTS } from '@musefold/contracts';
import { constraintDomainSchema, imageRoleSchema } from '@musefold/contracts/design-scheme';
import type {
  CompilerInput,
  DesignSchemeRolePrompt,
} from '@musefold/contracts/design-scheme-model';

const COMPILER_SYSTEM = `你是 Musefold 的方案编译器（Scheme Compiler）。
你要把输入编译成一份「设计方案」草稿：一套可反复使用的视觉生产规则。使用者之后只需提供方案声明的输入（如主体图片、文字主题），Musefold 就按方案约束生成图片。

规则：
1. inputs 声明使用者每次运行必须/可选提供的输入；图片输入要给 imageRole；至少一个输入。
   kind=text/article/choice 的输入必须带 variable 字段（小写英文加下划线），它是该输入在 promptProgram 模板中的变量名。
   文本输入不得带 imageRole；可选字段不适用时省略，不填空字符串或 null。图片输入必须指定合法 imageRole，且不得带 variable。
   图片输入只在来源能力确实消费使用者的图片时才声明（如编辑/变换用户照片、把用户主体重绘成某种风格）；
   纯生成类方案（从文字直接产出插画/海报等）不要声明图片输入，更不要设为必需——多余的必需图片会阻塞运行，
   随手上传的无关照片还会把纯生成变成图生图、破坏方案风格。确实可选参考时用 required=false 并说明用途。
2. constraints 是稳定的视觉约束（构图/色彩/排版/质感/主体/输出/安全），每条注明 mode 与 userOverridable；来自仓库证据的写进 evidencePaths。
   domain 使用下方 JSON 结构中的固定英文枚举，不要翻译成中文；没有来源证据时 evidencePaths 留空。
3. promptProgram 是提示词模块序列，运行时按 order 拼接成最终提示词：
   - 模板里用 {{变量名}} 引用文本输入，变量名必须与对应 input 的 variable 完全一致；
   - 图片输入不进模板（运行时作为参考图并按「图 1、图 2」编号），但模板文字可以引用「图 1」这类编号；
   - 至少包含一个 input-template 模块和一个 style-rule 模块。
   - 每个模块的 variables 只列该 template 中实际使用的变量；没有变量时使用 []，不要列入其他模块的变量。
4. fidelity 诚实声明：faithful=完整还原来源；adapted=有取舍（在 omitted/warnings 说明）；unsupported=核心能力无法还原。纯想法创建（无来源仓库）用 adapted。
5. adopted/omitted 各条用一句中文说明采用/舍弃了什么；warnings 写使用注意。
6. creationSummary 用中文对使用者说明：方案做什么、需要提供什么输入、建议先试运行验证。语气自然，不要列 JSON。
7. 只输出 JSON 对象，不要输出其他文字。

JSON 结构：
{
  "name": "方案名（≤20字）",
  "summary": "一句话简介",
  "fidelity": "faithful|adapted|unsupported",
  "inputs": [{ "label": "…", "kind": "text|image|image-set|article|choice", "required": true, "variable": "topic", "imageRole": "${imageRoleSchema.options.join('|')}", "preserve": "high|medium|low", "description": "…" }],
  "constraints": [{ "domain": "${constraintDomainSchema.options.join('|')}", "statement": "…", "mode": "required|preferred|avoid", "userOverridable": false, "evidencePaths": [] }],
  "promptProgram": [{ "kind": "system-rule|input-template|style-rule|negative-rule|quality-rule", "template": "…", "variables": ["topic"] }],
  "adopted": ["…"], "omitted": ["…"], "warnings": ["…"],
  "creationSummary": "…"
}`;

export function buildCompilerPrompt(input: CompilerInput): DesignSchemeRolePrompt {
  const sections: string[] = [];
  if (input.brief.trim()) {
    sections.push(`## 用户的想法\n${input.brief.trim()}`);
  } else {
    sections.push('## 用户的想法\n（用户未写说明，仅提供了来源仓库，请从仓库能力出发编译方案。）');
  }
  if (input.analystReport) {
    sections.push(
      `## 仓库分析报告（${input.repositoryLabel ?? '来源仓库'}）\n${JSON.stringify(input.analystReport, null, 2)}`,
    );
    for (const extra of input.additionalRepositories ?? []) {
      sections.push(
        `## 仓库分析报告（${extra.repositoryLabel}）\n${JSON.stringify(extra.analystReport, null, 2)}`,
      );
    }
    sections.push(
      '要求：constraints 优先来自分析报告的 rules 并保留 evidencePaths；报告 unsupported 中的能力不要假装支持，写进 omitted 或 warnings。',
    );
    if ((input.additionalRepositories?.length ?? 0) > 0) {
      sections.push(
        [
          '本次有多个来源仓库，请把它们合并为一个组合方案：',
          '- 能力互补时合并为统一的 promptProgram 与 constraints；',
          '- 规则冲突时按用户想法择优，舍弃的一方写进 omitted 并在 warnings 说明取舍；',
          '- 输入去重：语义相同的变量只保留一个；',
          '- creationSummary 说明方案由哪些来源合并、各自贡献了什么。',
        ].join('\n'),
      );
    }
  }
  if (input.historyContext) {
    const prompts = input.historyContext.prompts.slice(0, MAX_DESIGN_SCHEME_HISTORY_PROMPTS);
    sections.push(
      [
        `## 历史来源（用户挑选的 ${input.historyContext.imageCount} 张历史作品）`,
        prompts.length > 0
          ? `这些作品当时使用的生成提示词：\n${prompts.map((text, index) => `${index + 1}. ${input.historyContext?.evidencePaths?.[index] ? `[${input.historyContext.evidencePaths[index]}]\n` : ''}${text}`).join('\n')}`
          : '（用户未附带这些作品的提示词。）',
        '当前文本模型未接收历史图片像素，不得描述或声称理解图片中的内容。',
        '要求：从提示词与用户想法中提取可复用的视觉规则（风格、构图、色彩、材质方向）；',
        '不要把某张作品的具体主体、人物、品牌或原始文案当作固定规则——除非用户想法明确要求保留。',
        'fidelity 使用 adapted，并在 warnings 提醒方案由历史作品归纳、建议试运行校准。',
      ].join('\n'),
    );
  } else if (!input.analystReport) {
    sections.push(
      '本次创建没有来源仓库，fidelity 使用 adapted，并在 warnings 里提醒方案基于用户描述、建议试运行校准。',
    );
  }

  if (input.uploadedImageCount) {
    sections.push(
      `## 用户上传的参考素材\n已保存 ${input.uploadedImageCount} 张图片供方案预览与后续试运行选择。当前文本模型未接收图片像素，不能描述、归纳或声称理解图片中的风格/主体；只根据用户说明与仓库文字证据编译。不要仅因存在上传素材而增加必需图片输入，fidelity 使用 adapted（核心能力不支持时仍用 unsupported），warnings 明确未做视觉解析。`,
    );
  }
  return { system: COMPILER_SYSTEM, user: sections.join('\n\n') };
}
