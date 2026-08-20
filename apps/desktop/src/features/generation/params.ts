// src/features/generation/params.ts
// 精修面板的参数模型 → 生图请求的纯映射（无 store / 无 IPC，可单测）
//
// 为什么不直接让面板存 `size`：两类 Provider 的尺寸语义不同（docs/product/12 §1.3）——
// OpenAI 兼容站吃像素档 `size`，悟空创作台吃比例 `aspectRatio`。面板只让用户选「比例」，
// 由这里同时算出两者，请求里都带上，Provider 各取所需。

import type {
  GenerateImageRequest,
  LocalImageReference,
  PromptReference,
  WorkbenchRunContext,
} from '@shared/types/providers';
import type { ImageQuality, ImageBackground, ModerationLevel } from '@shared/types/enums';
import type { SkillRuntimeSnapshot } from '@shared/types/skill-runtime';
import { resolveRatioOptionById } from '@musefold/domain/constants';

/** 精修面板的参数（比例而非像素，见文件头） */
export interface RefineParams {
  ratioId: string;
  quality: ImageQuality;
  n: number;
  background?: ImageBackground;
  moderation?: ModerationLevel;
}

export const DEFAULT_REFINE_PARAMS: RefineParams = {
  ratioId: '1:1',
  quality: 'medium',
  n: 1,
  background: 'auto',
};

/** 允许的张数（与创作台一致） */
export const REFINE_COUNTS = [1, 2, 4, 6] as const;

/** 比例 id → 比例选项（含 `custom:W:H` 自定义）；未知 id 回落到第一项（方图），不抛错 */
export function resolveRatio(ratioId: string) {
  return resolveRatioOptionById(ratioId);
}

/** 生图来源（提示词库条目），用于显示来源 chip 与写历史。 */
export interface RefineSource {
  kind: 'prompt';
  /** 来源实体 id；写入 history.prompt_id。 */
  id?: string;
  /** 显示名（「电影感人像」） */
  label: string;
}

export interface BuildRequestInput {
  jobId: string;
  providerId: string;
  prompt: string;
  negative?: string;
  params: RefineParams;
  source?: RefineSource | null;
  parentHistoryId?: string;
  sourceAssetId?: string;
  refinementInstruction?: string;
  referenceImages?: LocalImageReference[];
  references?: PromptReference[];
  workbench?: WorkbenchRunContext;
  skillRuntime?: SkillRuntimeSnapshot;
}

/**
 * 组装单张生图请求（n 固定为 1）。
 *
 * 张数由调用方循环控制而不是透传 n —— 一张一个 jobId、一条历史、一份成本，
 * 这样取消只丢未开始的那几张，且每张都能单独重试（对齐创作台 runBatch 的语义）。
 */
export function buildImageRequest(input: BuildRequestInput): GenerateImageRequest {
  const { ratio, size } = resolveRatio(input.params.ratioId);
  const negative = input.negative?.trim();
  const source = input.source;
  return {
    jobId: input.jobId,
    providerId: input.providerId,
    prompt: input.prompt,
    negative: negative || undefined,
    size,
    aspectRatio: ratio,
    quality: input.params.quality,
    n: 1,
    background: input.params.background,
    moderation: input.params.moderation,
    referenceImages: input.referenceImages?.length ? input.referenceImages : undefined,
    promptId: source?.kind === 'prompt' ? source.id : undefined,
    parentHistoryId: input.parentHistoryId,
    sourceAssetId: input.sourceAssetId,
    refinementInstruction: input.refinementInstruction,
    promptReferences: input.references?.length ? input.references : undefined,
    workbench: input.workbench,
    skillRuntime: input.skillRuntime,
  };
}
