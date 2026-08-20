/**
 * 设计方案 → 最终生图提示词的确定性编译（无 AI 参与，试运行与正式使用共用）。
 *
 * 组合次序（默认「方案主导」优先级，见 V03.2-DESIGN-SCHEME-SPEC §4.1）：
 *   1. promptProgram 模块按 order 拼接，{{variable}} 用输入槽位值代入；
 *   2. 用户自由补充按优先级策略放置（方案主导在后、用户主导在前并声明优先）；
 *   3. 多图编号说明与画面比例约束沿用全局既有措辞。
 *
 * 三档优先级都不改变安全/能力/必填输入的阻塞逻辑（开发规范 §9）。
 */
import {
  composePromptWithImageIndexHint,
  composePromptWithRatioConstraint,
} from '@musefold/domain/generation-prompt';
import type { SchemePriorityMode } from '../design-scheme';
import type { DesignSchemeRevisionDocument, InputSlot } from './schema';

export interface CompileSchemePromptInput {
  document: DesignSchemeRevisionDocument;
  /** 文本槽位值：slotId（即模板变量名）→ 用户填写内容。 */
  inputValues: Record<string, string>;
  /** 用户自由补充要求，可为空。 */
  brief: string;
  /** 本次实际携带的参考图数量（用户图在前）。 */
  imageCount: number;
  /** Composer 比例设置；'auto' 不追加约束。 */
  ratioId: string;
  /** 运行优先级；缺省 scheme_first（方案主导）。 */
  priorityMode?: SchemePriorityMode;
}

export interface CompiledSchemePrompt {
  prompt: string;
  /** 模板中出现但没有对应输入值的变量（已以空值代入并去除占位符）。 */
  unresolvedVariables: string[];
  /** 本次策略的非阻塞摘要（写入运行详情，用于审计与复现，设计规范 §4.3）。 */
  policySummary: string;
}

export const PRIORITY_MODE_LABEL: Record<SchemePriorityMode, string> = {
  user_first: '用户主导',
  scheme_first: '方案主导',
  agent_mediated: '智能协调',
};

/** 面向运行详情/设置页的策略说明（一句话，不含变量）。 */
export function describePriorityMode(mode: SchemePriorityMode): string {
  switch (mode) {
    case 'user_first':
      return '用户本次输入优先；方案核心规则只作为参考';
    case 'agent_mediated':
      return '按方案证据与用户目标自动取舍，结果写入摘要';
    default:
      return '方案核心规则优先；用户输入填充方案声明的变量';
  }
}

const TEXT_SLOT_KINDS: ReadonlySet<InputSlot['kind']> = new Set(['text', 'article', 'choice']);

/** 校验必填槽位；返回缺失的槽位（文本按值、图片按参考图数量）。 */
export function missingRequiredSlots(
  document: DesignSchemeRevisionDocument,
  inputValues: Record<string, string>,
  imageCount: number,
): InputSlot[] {
  const missing: InputSlot[] = [];
  let requiredImages = 0;
  for (const slot of document.inputs) {
    if (!slot.required) continue;
    if (TEXT_SLOT_KINDS.has(slot.kind)) {
      if (!inputValues[slot.id]?.trim()) missing.push(slot);
    } else {
      requiredImages += Math.max(1, slot.minItems ?? 1);
      if (imageCount < requiredImages) missing.push(slot);
    }
  }
  return missing;
}

export function compileSchemePrompt(input: CompileSchemePromptInput): CompiledSchemePrompt {
  const mode: SchemePriorityMode = input.priorityMode ?? 'scheme_first';
  const unresolved = new Set<string>();
  const modules = [...input.document.promptProgram].sort((left, right) => left.order - right.order);
  const moduleSections: string[] = [];
  for (const module of modules) {
    const text = module.template.replace(/\{\{\s*([a-zA-Z0-9_\-\u4e00-\u9fff]+)\s*\}\}/g, (_match, name: string) => {
      const value = input.inputValues[name]?.trim();
      if (value) return value;
      unresolved.add(name);
      return '';
    }).trim();
    if (text) moduleSections.push(text);
  }

  const brief = input.brief.trim();
  const sections: string[] = [];
  if (brief && mode === 'user_first') {
    // 用户主导：本次要求在方案文本之前，并显式声明冲突时以它为准。
    sections.push(`用户本次要求（优先；与后文方案规则冲突时，以本段为准）：\n${brief}`);
    sections.push(...moduleSections);
  } else {
    sections.push(...moduleSections);
    if (brief) {
      sections.push(mode === 'agent_mediated'
        ? `补充要求：\n${brief}\n（若与方案规则冲突，请以整体视觉质量为先自动协调取舍）`
        : `补充要求（不改变方案核心规则）：\n${brief}`);
    }
  }

  const combined = composePromptWithRatioConstraint(
    composePromptWithImageIndexHint(sections.join('\n\n'), input.imageCount),
    input.ratioId,
  );
  return {
    prompt: combined,
    unresolvedVariables: [...unresolved],
    policySummary: `${PRIORITY_MODE_LABEL[mode]} · ${describePriorityMode(mode)}`,
  };
}
