import type {
  GenerateImageResult,
  ImageProviderResponseSummary,
  LocalImageReference,
  PromptReference,
} from '@shared/types/providers';
import type { RefineParams } from '../params';
import type { SkillRuntimeExecutionMode, SkillRuntimeTraceItem } from '@shared/types/skill-runtime';
import type {
  DesignSchemeCreationState,
  DesignSchemeCreationTraceItem,
  DesignSchemeRunGeneration,
  DesignSchemeRunMode,
  DesignSchemeSourceConfirmation,
  DesignSchemeSummary,
} from '@shared/types/design-scheme';
import type { InputSlot } from '@shared/design-scheme/schema';

export interface SchemeCreationDraftCard extends DesignSchemeSummary {
  creationSummary: string;
}

export type GenerationSource =
  | { kind: 'manual'; label?: string }
  | { kind: 'prompt'; id?: string; label: string }
  | {
      kind: 'skill';
      label: string;
      repositoryUrl: string;
      compiledPrompt: string;
      executionMode: SkillRuntimeExecutionMode;
      trace: SkillRuntimeTraceItem[];
    }
  | {
      kind: 'scheme-creation';
      label: string;
      executionId: string;
      state: DesignSchemeCreationState;
      githubUrl?: string;
      trace: DesignSchemeCreationTraceItem[];
      /** 等待安装确认时由事件填充；确认或取消后清空。 */
      confirmation?: DesignSchemeSourceConfirmation;
      /** 草稿就绪后填充，对话轮末渲染草稿卡片。 */
      draft?: SchemeCreationDraftCard;
      error?: string;
    }
  /** Composer 附件态：已挂载的方案（试运行草稿 / 使用正式方案 / 修改方案）。 */
  | {
      kind: 'scheme';
      schemeId: string;
      revisionId: string;
      label: string;
      /** 方案一句话说明（附件浮层展示）。 */
      summary: string;
      /** modify：输入不再是运行变量，而是发给 Agent 的修改要求（UI 规范 §8.3）。 */
      mode: DesignSchemeRunMode | 'modify';
      fidelity: DesignSchemeSummary['fidelity'];
      sourceLabel: string;
      /** 方案声明的输入槽位；文本槽位渲染为具名字段，图片槽位提示附件。 */
      inputs: InputSlot[];
      /** 转正条件展示（试运行态）。 */
      coverAssetId: string | null;
      hasSuccessfulTrial: boolean;
    }
  /** 对话轮态：方案运行（确定性管线，事件驱动轨迹与逐张结果）。 */
  | {
      kind: 'scheme-run';
      schemeId: string;
      revisionId: string;
      label: string;
      mode: DesignSchemeRunMode;
      executionId: string;
      state: 'running' | 'succeeded' | 'failed' | 'cancelled';
      trace: DesignSchemeCreationTraceItem[];
      /** 完成后回填：本轮逐张产出（试运行成功项带 assetId，供设为封面）。 */
      generations: DesignSchemeRunGeneration[];
      /** 当前封面（选择后回填，驱动「设为正式」可用态）。 */
      coverAssetId: string | null;
      formalized?: boolean;
      /** 本轮 runId（质量门修复重跑引用原始运行）。 */
      runId?: string;
      /** 质量门修复建议（开发规范 §5.5）；null/undefined 表示无需修复或已用掉。 */
      repairHint?: string | null;
      /** 本轮是否为修复重跑（轨迹徽标）。 */
      isRepairRun?: boolean;
      error?: string;
    }
  | { kind: 'history'; id: string; label: string; promptId?: string };

export type GenerationTurnStatus =
  | 'pending'
  | 'running'
  | 'partial'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface GenerationResultItem {
  id: string;
  jobId: string;
  historyId?: string;
  assetId?: string;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  imagePath?: string;
  cost?: number;
  durationMs?: number;
  error?: string;
  errorCode?: string;
  retrying?: boolean;
  retryAttempt?: number;
  retryMax?: number;
  retryDelayMs?: number;
}

export interface GenerationTurn {
  id: string;
  /** 实际发送给 Provider 的完整提示词（含引用块）。 */
  prompt: string;
  /** 用户在输入框中编辑的正文，不包含引用块。 */
  userPrompt: string;
  references: PromptReference[];
  negativePrompt: string;
  source: GenerationSource;
  providerId: string | null;
  params: RefineParams;
  status: GenerationTurnStatus;
  results: GenerationResultItem[];
  /** 网页 Provider 的原始回复摘要；与本轮图片一起展示和恢复。 */
  providerResponse?: ImageProviderResponseSummary;
  /** 这一轮实际发送的有序参考图，用于图 1 / 图 2 指代、消息展示与编辑恢复。 */
  referenceImages: LocalImageReference[];
  parentHistoryId?: string;
  createdAt: number;
  completedAt?: number;
}

export interface WorkbenchDraft {
  prompt: string;
  negativePrompt: string;
  source: GenerationSource;
  references: PromptReference[];
}

export interface RefinementContext {
  turnId: string;
  resultId: string;
  historyId: string;
  assetId?: string;
  imagePath: string;
  label: string;
  images: LocalImageReference[];
}

export type WorkbenchResult = GenerateImageResult;
