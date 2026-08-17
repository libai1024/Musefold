import type { AppResult } from '../app-result';
import type { GenerateImageRequest, GenerateImageResult, LocalImageReference } from './providers';

export type SkillRuntimeExecutionMode = 'agent' | 'file-fallback' | 'direct-forward';

export interface PrepareGithubSkillRuntimeRequest {
  repositoryUrl: string;
  requestedRef?: string;
  skillPath?: string;
}

export interface SkillRuntimeAttachment {
  runtimeId: string;
  repositoryUrl: string;
  requestedRef?: string;
  skillPath?: string;
  name: string;
  description: string;
  resolvedRef: string;
  commitHash: string | null;
  textFileCount: number;
  textNames: string[];
  imageFileCount: number;
  usableImageCount: number;
  imageNames: string[];
}

/**
 * 渲染进程预组装的生图执行计划。比例、质量、Provider、会话归组等 Composer
 * 设置全部固化在模板里；主进程 Agent 只负责决定最终提示词并逐张执行。
 */
export interface SkillRuntimeGenerationPlan {
  /** prompt 留空的完整请求模板；主进程填入最终提示词并追加 Skill 参考图。 */
  requestTemplate: GenerateImageRequest;
  /** 每张结果的取消句柄；长度即本次张数。 */
  jobIds: string[];
  providerName: string;
  /** 追加画面比例约束所需的 Composer 比例设置。 */
  ratioId: string;
}

export interface ExecuteSkillRuntimeRequest {
  runtimeId: string;
  /** 渲染进程生成；事件订阅与取消都以它对账。 */
  executionId: string;
  userPrompt: string;
  userImages: LocalImageReference[];
  availableImageSlots: number;
  /** 粘贴阶段已完成的轨迹（读取仓库/识别/准备文件），主进程续写在其后。 */
  traceSeed?: SkillRuntimeTraceItem[];
  generation: SkillRuntimeGenerationPlan;
}

export interface SkillRuntimeGenerationOutcome {
  jobId: string;
  resultIndex: number;
  result: GenerateImageResult;
}

export interface SkillRuntimeExecution {
  /** 实际提交给生图模型的完整提示词（含图片编号与比例约束）。 */
  finalPrompt: string;
  imageReferences: LocalImageReference[];
  mode: SkillRuntimeExecutionMode;
  model?: string;
  fallbackReason?: string;
  /** 主进程记录的完整执行轨迹（含 traceSeed），是对话消息的最终事实。 */
  trace: SkillRuntimeTraceItem[];
  generations: SkillRuntimeGenerationOutcome[];
}

export interface SkillRuntimeTraceItem {
  id: string;
  kind: 'tool' | 'assistant' | 'system';
  title: string;
  detail?: string;
  output?: string;
  status: 'running' | 'success' | 'warning' | 'error';
  durationMs?: number;
}

/** 主进程实时推送的 Skill 执行事件；渲染进程据此把 Agent 过程渲染为对话内容。 */
export type SkillRuntimeEvent =
  /** 新增或整体更新一条轨迹（真实工具调用、系统说明、assistant 段落状态）。 */
  | { kind: 'trace'; executionId: string; item: SkillRuntimeTraceItem }
  /** assistant 正文的流式增量，按 itemId 追加。 */
  | { kind: 'assistant-delta'; executionId: string; itemId: string; text: string }
  | { kind: 'generation-start'; executionId: string; jobId: string; resultIndex: number }
  | { kind: 'generation-result'; executionId: string; outcome: SkillRuntimeGenerationOutcome };

/** Stored with a workbench turn so the Agent process remains conversation content. */
export interface SkillRuntimeSnapshot {
  label: string;
  repositoryUrl: string;
  executionMode: SkillRuntimeExecutionMode;
  trace: SkillRuntimeTraceItem[];
}

export interface SkillRuntimeApi {
  prepareGithub: (request: PrepareGithubSkillRuntimeRequest) => Promise<AppResult<SkillRuntimeAttachment>>;
  execute: (request: ExecuteSkillRuntimeRequest) => Promise<AppResult<SkillRuntimeExecution>>;
  cancel: (executionId: string) => Promise<{ ok: true }>;
  release: (runtimeId: string) => Promise<{ ok: true }>;
  /** 订阅 Skill 执行事件，返回取消订阅函数。 */
  onEvent: (cb: (event: SkillRuntimeEvent) => void) => () => void;
}
