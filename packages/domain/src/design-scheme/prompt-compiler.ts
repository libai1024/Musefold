import type { InputSlot, PromptModule, SchemePriorityMode } from '@musefold/contracts';
import {
  composePromptWithImageIndexHint,
  composePromptWithRatioConstraint,
} from '../generation-prompt';

export type { SchemePriorityMode } from '@musefold/contracts';

export type DesignSchemePromptInputSlot = Pick<InputSlot, 'id' | 'kind' | 'required' | 'minItems'>;

export type DesignSchemePromptModule = Pick<PromptModule, 'order' | 'template'>;

export interface DesignSchemePromptDocument {
  inputs: readonly DesignSchemePromptInputSlot[];
  promptProgram: readonly DesignSchemePromptModule[];
}

export interface CompileSchemePromptInput {
  document: DesignSchemePromptDocument;
  inputValues: Readonly<Record<string, string>>;
  brief: string;
  imageCount: number;
  ratioId: string;
  priorityMode?: SchemePriorityMode;
}

export interface CompiledSchemePrompt {
  prompt: string;
  unresolvedVariables: string[];
  policySummary: string;
}

export const PRIORITY_MODE_LABEL: Record<SchemePriorityMode, string> = {
  user_first: '用户主导',
  scheme_first: '方案主导',
  agent_mediated: '智能协调',
};

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

export function missingRequiredSlots<TSlot extends DesignSchemePromptInputSlot>(
  document: { inputs: readonly TSlot[] },
  inputValues: Readonly<Record<string, string>>,
  imageCount: number,
): TSlot[] {
  const missing: TSlot[] = [];
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
    const text = module.template
      .replace(/\{\{\s*([a-zA-Z0-9_\-\u4e00-\u9fff]+)\s*\}\}/g, (_match, name: string) => {
        const value = input.inputValues[name]?.trim();
        if (value) return value;
        unresolved.add(name);
        return '';
      })
      .trim();
    if (text) moduleSections.push(text);
  }

  const brief = input.brief.trim();
  const sections: string[] = [];
  if (brief && mode === 'user_first') {
    sections.push(`用户本次要求（优先；与后文方案规则冲突时，以本段为准）：\n${brief}`);
    sections.push(...moduleSections);
  } else {
    sections.push(...moduleSections);
    if (brief) {
      sections.push(
        mode === 'agent_mediated'
          ? `补充要求：\n${brief}\n（若与方案规则冲突，请以整体视觉质量为先自动协调取舍）`
          : `补充要求（不改变方案核心规则）：\n${brief}`,
      );
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
