// shared/types/generation-snapshots.ts
// 生图请求、历史行、Skill 执行各自需要同一批落盘快照；抽到叶子模块是为了让
// models / providers / skill-runtime 只单向依赖这里，而不是互相引用。
// V13-ENT-02：PromptParams 从 models 迁入（渲染层可安全引用的生成参数包）。

import type {
  ImageSize,
  ImageQuality,
  ImageBackground,
  ModerationLevel,
} from './enums';

export type PromptReferenceScope = 'full' | 'excerpt';

/** 生成参数包（前向兼容，带 schema_version） */
export interface PromptParams {
  schemaVersion: number;
  sampler?: string;
  steps?: number;
  cfg?: number;
  seed?: number;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  background?: ImageBackground;
  moderation?: ModerationLevel;
  [key: string]: unknown;
}

/** 制作工作台引用的提示词快照。历史记录以这份快照为准，不跟随源提示词后续编辑。 */
export interface PromptReference {
  promptId: string;
  title: string;
  text: string;
  scope: PromptReferenceScope;
}

/**
 * 唯一成本单位：用户可见积分（1 积分 = ¥0.1 = 50,000 服务端原始配额）。
 */
export type CostUnit = 'point';

export type SkillRuntimeExecutionMode = 'agent' | 'file-fallback' | 'direct-forward';

export interface SkillRuntimeTraceItem {
  id: string;
  kind: 'tool' | 'assistant' | 'system';
  title: string;
  detail?: string;
  output?: string;
  status: 'running' | 'success' | 'warning' | 'error';
  durationMs?: number;
}

/** Stored with a workbench turn so the Agent process remains conversation content. */
export interface SkillRuntimeSnapshot {
  label: string;
  repositoryUrl: string;
  executionMode: SkillRuntimeExecutionMode;
  trace: SkillRuntimeTraceItem[];
}
