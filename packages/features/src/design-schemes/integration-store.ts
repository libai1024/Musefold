import type {
  DesignSchemeRunMode,
  DesignSchemeSummary,
  GenerationQuality,
  GenerationReferenceImage,
  InputSlot,
  PromptReferenceSelection,
} from '@musefold/contracts';
import type { DesignSchemesGateway } from '@musefold/platform';
import { create } from 'zustand';
import type { SchemeCreateKind, SchemeHistorySourceSelection } from './types';

/**
 * 设计方案跨屏集成 store(宿主中立):
 * 方案中心/提示词库/历史等入口把「一次性意图」写进这里,宿主回调负责切屏,
 * 工作台屏 mount/观察到时消费一次即清(与 useActiveSession.pendingDraft、
 * shell screen-intent-store 同机制,features 内共享 zustand,双宿主自动获得)。
 *
 * 关键纪律:
 * - 意图只描述「用户要干什么 + 来源上下文」,不携带任何运行时结果;
 * - 方案运行/创建/修改的实际执行是宿主运行管线(主进程/云端)的职责,
 *   接缝缺失时提交侧禁用并解释,绝不回落成普通生成假装跑过方案。
 */

/** Composer 方案模式:试运行/使用承契约 runMode;modify 是纯 UI 态(修改走 gateway.modify,不进 run)。 */
export type SchemeComposerMode = DesignSchemeRunMode | 'modify';

/** Composer 可发起的创建类型(import 由宿主文件对话框承接,不进 Composer)。 */
export type SchemeComposerCreateKind = Exclude<SchemeCreateKind, 'import'>;

/**
 * 方案附件(承旧 draftSource kind:'scheme',v0.3.2 run-store.attach 语义):
 * 挂载到工作台 Composer 的方案上下文 —— 试运行(draft)/使用(formal)/修改(modify)。
 * inputs 来自挂载时刻的 revision 文档快照;源方案后续编辑不回写已挂载的附件。
 */
export interface SchemeComposerAttachment {
  schemeId: string;
  /** 挂载的 revision；formal 固定 current，trial/modify 可锁定 exact working draft。 */
  revisionId: string;
  name: string;
  summary: string;
  mode: SchemeComposerMode;
  fidelity: DesignSchemeSummary['fidelity'];
  sourceLabel: string;
  inputs: InputSlot[];
  coverAssetId: string | null;
  hasSuccessfulTrial: boolean;
}

/**
 * 创建管线的来源上下文(保留 prompt/history 出处,承旧):
 * prompt = 提示词库「创建方案」;history = HistorySourcePicker 确认的选择集。
 * 提交创建时原样交给宿主管线,集成层不拆解不丢字段。
 */
export type SchemeCreationSource =
  | { kind: 'prompt'; promptId: string; title: string }
  | { kind: 'history'; selection: SchemeHistorySourceSelection };

/** Composer 创建上下文(design-plan 态):提交路由到方案创建管线而非普通生成。 */
export interface SchemeCreationContext {
  createKind: SchemeComposerCreateKind;
  source: SchemeCreationSource | null;
}

/** 跨屏一次性意图:attach = 挂载附件到 Composer;create = 进入 design-plan 创建态。 */
export type SchemeWorkbenchIntent =
  | { kind: 'attach'; attachment: SchemeComposerAttachment }
  | {
      kind: 'create';
      createKind: SchemeComposerCreateKind;
      /** 进入 Composer 正文的种子文本(可为空;空则不覆盖现有正文)。 */
      seed: string;
      source: SchemeCreationSource | null;
    };

interface SchemeIntegrationState {
  workbenchIntent: SchemeWorkbenchIntent | null;
  setWorkbenchIntent(intent: SchemeWorkbenchIntent): void;
  /** 读取并清空(一次性);无意图返回 null。 */
  consumeWorkbenchIntent(): SchemeWorkbenchIntent | null;
}

export const useSchemeIntegration = create<SchemeIntegrationState>((set, get) => ({
  workbenchIntent: null,
  setWorkbenchIntent: (intent) => set({ workbenchIntent: intent }),
  consumeWorkbenchIntent: () => {
    const current = get().workbenchIntent;
    if (current) set({ workbenchIntent: null });
    return current;
  },
}));

/**
 * 提示词 → 创建种子(逐字承 v2.1 PromptDetailView.createScheme):
 * 指令行 + 正文 + 可选「避免:反向词」。
 */
export function buildSchemeCreateSeedFromPrompt(prompt: {
  content: string;
  negative?: string | null;
}): string {
  return [
    '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。',
    '',
    prompt.content,
    prompt.negative ? `\n避免：${prompt.negative}` : '',
  ]
    .join('\n')
    .trim();
}

/** 历史来源 → 创建种子:进入 Composer 正文的就是用户在选取层编辑的提取说明。 */
export function buildSchemeHistorySeed(selection: SchemeHistorySourceSelection): string {
  return selection.note.trim();
}

/** 附件可提交性(承旧 schemeCanSubmit):必需文本槽位非空 + 必需图片槽位按声明顺序被就绪参考图覆盖。 */
export interface SchemeAttachmentReadiness {
  ready: boolean;
  /** 未满足的必需槽位 label(展示与断言用,稳定顺序 = 文档声明顺序)。 */
  missing: string[];
}

export function schemeAttachmentReadiness(
  attachment: Pick<SchemeComposerAttachment, 'inputs' | 'mode'>,
  inputValues: Record<string, string>,
  readyImageCount: number,
): SchemeAttachmentReadiness {
  // 修改模式不收集运行输入(规范 §8.3),只需修改描述(由 Composer 正文把关)。
  if (attachment.mode === 'modify') return { ready: true, missing: [] };
  const missing: string[] = [];
  // 图片槽位按声明顺序依次占用就绪参考图(承旧 assignedImages 分配语义);可选槽位不挡提交。
  let assignedImages = 0;
  for (const slot of attachment.inputs) {
    const isImage = slot.kind === 'image' || slot.kind === 'image-set';
    if (!slot.required) continue;
    if (isImage) {
      const need = Math.max(1, slot.minItems ?? 1);
      if (readyImageCount < assignedImages + need) missing.push(slot.label);
      assignedImages += need;
    } else if (!(inputValues[slot.id] ?? '').trim()) {
      missing.push(slot.label);
    }
  }
  return { ready: missing.length === 0, missing };
}

/**
 * 挂载前先显式读取 current，以最新 summary 解析用户意图对应的 revision。
 * formal 始终锁 current；trial/modify 在存在 working draft 时锁定其 exact id。
 */
export async function resolveSchemeAttachment(
  designSchemes: Pick<DesignSchemesGateway, 'get'>,
  scheme: DesignSchemeSummary,
  mode: SchemeComposerMode,
): Promise<SchemeComposerAttachment> {
  const currentDetail = await designSchemes.get(scheme.id, { kind: 'current' });
  const workingDraftRevisionId = currentDetail.summary.workingDraftRevisionId;
  const detail =
    mode !== 'formal' && workingDraftRevisionId
      ? await designSchemes.get(scheme.id, {
          kind: 'working-draft',
          revisionId: workingDraftRevisionId,
        })
      : currentDetail;
  const { summary, document } = detail;
  return {
    schemeId: summary.id,
    revisionId: document.revisionId,
    name: document.name,
    summary: document.summary,
    mode,
    fidelity: summary.fidelity,
    sourceLabel: summary.sourceLabel,
    inputs: document.inputs.map((slot) => ({ ...slot })),
    coverAssetId: summary.coverAssetId,
    hasSuccessfulTrial: summary.hasSuccessfulTrial,
  };
}

/**
 * Composer 方案提交载荷(交给宿主运行管线;不在 features 内执行):
 * - run:试运行/使用,携带收集齐的槽位值、就绪参考图与 Composer 参数快照
 *   (比例/质量/反向词,承旧 requestTemplate 语义,由宿主管线组装正式 run plan);
 * - create:design-plan 创建,brief = 正文,source 保留 prompt/history 出处;
 * - modify:修改要求,brief = 正文,Agent 更新草稿/产出待验证新版本。
 */
export type SchemeComposerSubmission =
  | {
      kind: 'run';
      attachment: SchemeComposerAttachment;
      brief: string;
      inputValues: Record<string, string>;
      referenceImages: GenerationReferenceImage[];
      /** 托盘里的提示词引用意图原样随行(不丢弃用户上下文,是否折入由宿主管线决定)。 */
      promptReferenceSelections: PromptReferenceSelection[];
      params: { aspectRatio?: string; quality: GenerationQuality; negative?: string };
      providerId?: string;
    }
  | {
      kind: 'create';
      createKind: SchemeComposerCreateKind;
      brief: string;
      source: SchemeCreationSource | null;
    }
  | { kind: 'modify'; attachment: SchemeComposerAttachment; brief: string };
