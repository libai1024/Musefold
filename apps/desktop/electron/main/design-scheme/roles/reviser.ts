/**
 * Scheme Reviser：按用户的修改要求更新一份既有设计方案（UI 规范 §8.3）。
 * 输出与 Scheme Compiler 同构（完整方案 JSON），经 zod 校验后由 Runtime 落成新 revision。
 */
import { compilerOutputSchema, type CompilerOutput } from '@shared/design-scheme/agents';
import type { DesignSchemeRevisionDocument } from '@shared/design-scheme/schema';
import { completeStructured, type OpenAiCompatibleTextAdapter } from '../text-adapter';

export interface ReviserInput {
  /** 用户的修改要求（自然语言）。 */
  instruction: string;
  /** 当前方案文档（修改基线）。 */
  document: DesignSchemeRevisionDocument;
}

const REVISER_SYSTEM = `你是 Musefold 的方案修订器（Scheme Reviser）。
用户已有一份「设计方案」（可反复使用的视觉生产规则），现在提出修改要求。你要输出修改后的完整方案。

规则：
1. 只改用户要求的部分；其余 inputs / constraints / promptProgram 保持原样（原文照抄），不要顺手润色。
2. 保持结构合法：文本输入的 variable 与 promptProgram 模板中的 {{变量名}} 必须一一对应；
   至少保留一个 input-template 模块和一个 style-rule 模块。
3. 删除输入时同时清理引用它的模板变量；新增输入时补充对应模板引用。
4. fidelity 诚实声明：如果修改让方案偏离了原始来源，从 faithful 降为 adapted，并在 warnings 说明。
5. adopted 写本次保留的核心规则；omitted 写本次移除的内容；warnings 写使用注意。
6. creationSummary 用中文向用户简短说明这次改了什么（哪些规则/输入变了），并提醒需要重新试运行验证。不要列 JSON。
7. 只输出 JSON 对象，不要输出其他文字。

JSON 结构：
{
  "name": "方案名（≤20字，用户未要求改名则保持原名）",
  "summary": "一句话简介",
  "fidelity": "faithful|adapted|unsupported",
  "inputs": [{ "label": "…", "kind": "text|image|image-set|article|choice", "required": true, "variable": "topic", "imageRole": "…", "preserve": "high|medium|low", "description": "…" }],
  "constraints": [{ "domain": "…", "statement": "…", "mode": "required|preferred|avoid", "userOverridable": false, "evidencePaths": [] }],
  "promptProgram": [{ "kind": "system-rule|input-template|style-rule|negative-rule|quality-rule", "template": "…", "variables": ["topic"] }],
  "adopted": ["…"], "omitted": ["…"], "warnings": ["…"],
  "creationSummary": "…"
}`;

export async function runSchemeReviser(
  adapter: OpenAiCompatibleTextAdapter,
  input: ReviserInput,
  signal?: AbortSignal,
): Promise<{ output: CompilerOutput; model: string; retried: boolean }> {
  const { document } = input;
  const current = {
    name: document.name,
    summary: document.summary,
    fidelity: document.fidelity,
    inputs: document.inputs,
    constraints: document.constraints.map((constraint) => ({
      domain: constraint.domain,
      statement: constraint.statement,
      mode: constraint.mode,
      userOverridable: constraint.userOverridable,
    })),
    promptProgram: document.promptProgram.map((module) => ({
      kind: module.kind,
      template: module.template,
      variables: module.variables,
    })),
  };
  const result = await completeStructured({
    adapter,
    schema: compilerOutputSchema,
    system: REVISER_SYSTEM,
    user: [
      `## 当前方案\n${JSON.stringify(current, null, 2)}`,
      `## 用户的修改要求\n${input.instruction.trim()}`,
    ].join('\n\n'),
    signal,
    label: '方案修订',
  });
  return { output: result.value, model: result.model, retried: result.retried };
}
