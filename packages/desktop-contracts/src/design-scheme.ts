/**
 * v0.3.2 设计方案 Runtime 的 IPC 契约（创建切片）。
 *
 * renderer 只通过这里的类型与主进程 RuntimeFacade 通信；
 * 事件是 UI 展示与恢复的事实源（开发规范 §11）。
 */
import type { AppResult } from '@musefold/domain/app-result';
import type {
  DesignSchemeRevisionDocument,
  Fidelity,
  SchemeStatus,
} from './design-scheme/schema';
import type { GenerateImageRequest, GenerateImageResult } from './providers';

/** 与 SkillRuntimeTraceItem 同构，便于复用对话轨迹渲染组件。 */
export interface DesignSchemeCreationTraceItem {
  id: string;
  kind: 'tool' | 'assistant' | 'system';
  title: string;
  detail?: string;
  output?: string;
  status: 'running' | 'success' | 'warning' | 'error';
  durationMs?: number;
}

/** 创建管线状态机（开发规范 §4.1 的创建子集）。 */
export type DesignSchemeCreationState =
  | 'created'
  | 'source_resolving'
  | 'awaiting_install_confirmation'
  | 'source_snapshotting'
  | 'analyzing'
  | 'compiling_scheme'
  | 'draft_ready'
  | 'blocked'
  | 'failed'
  | 'cancelled';

/** 安装确认层向用户展示的来源信息（UI 规范 §11.2：不得静默安装）。 */
export interface DesignSchemeSourceConfirmation {
  repositoryUrl: string;
  name: string;
  description: string;
  resolvedRef: string;
  commitHash: string | null;
  textFileCount: number;
  textNames: string[];
  imageFileCount: number;
  license: string | null;
}

/** 历史来源条目：由用户在历史选择层勾选（UI 规范 §10.1，不默认读取整段对话）。 */
export interface DesignSchemeHistorySourceItem {
  historyId: string;
  /** 历史作品图片的本机绝对路径；入库时会复制进快照目录固化。 */
  imagePath: string;
  /** 该图片的生成提示词；仅用户勾选「包含提示词」时携带。 */
  promptText?: string;
}

export interface StartDesignSchemeCreationRequest {
  /** renderer 生成；事件订阅、确认与取消都以它对账。 */
  executionId: string;
  /** 用户的一段话；允许为空（只给 Skill 地址时）。 */
  brief: string;
  /** 单一 GitHub 来源（兼容字段；有 githubUrls 时忽略）。 */
  githubUrl?: string;
  /** 多来源合并（P3）：多个 GitHub 地址编译为一个组合方案，逐个确认安装。 */
  githubUrls?: string[];
  /** 历史内容来源（图片 + 可选提示词）；本地内容无需安装确认。 */
  history?: { items: DesignSchemeHistorySourceItem[] };
}

export interface DesignSchemeSummary {
  id: string;
  name: string;
  summary: string;
  status: SchemeStatus;
  fidelity: Fidelity;
  sourcePresentation: 'skill' | 'musefold-created';
  /** 例如 "LiamGvchi/gc-minimal-zine-poster" 或 "Musefold 创建"。 */
  sourceLabel: string;
  currentRevisionId: string;
  /** 正式方案的待验证新版本（修改/上游更新产生）；null 表示没有（规范 §2.2）。 */
  workingDraftRevisionId: string | null;
  /** 需要提供的输入标签（含必填标记由 UI 处理）。 */
  inputLabels: string[];
  /** 当前封面资产与其本机图片路径（缩略图用）。 */
  coverAssetId: string | null;
  coverImagePath: string | null;
  /** 当前 revision 是否已有成功的本机试运行（转正前提之一）。 */
  hasSuccessfulTrial: boolean;
  /** 最近一次完成运行（试运行或正式使用）的时间；用于选择器「最近使用」。 */
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 方案相册资产（详情页折叠相册数据源，UI 规范 §5）。 */
export interface DesignSchemeAssetSummary {
  id: string;
  revisionId: string;
  /** 本机图片绝对路径。 */
  path: string;
  role: 'cover' | 'example';
  origin: 'repo-example' | 'local-run';
  createdAt: number;
}

export interface DesignSchemeCreationResult {
  scheme: DesignSchemeSummary;
  revisionId: string;
  /** Compiler 面向用户的创建说明；对话轮末以 assistant 文本呈现。 */
  creationSummary: string;
  trace: DesignSchemeCreationTraceItem[];
}

export type DesignSchemeCreationEvent =
  | { kind: 'state'; executionId: string; state: DesignSchemeCreationState }
  | { kind: 'trace'; executionId: string; item: DesignSchemeCreationTraceItem }
  | { kind: 'confirmation-required'; executionId: string; source: DesignSchemeSourceConfirmation }
  | { kind: 'draft-ready'; executionId: string; result: DesignSchemeCreationResult }
  | { kind: 'failed'; executionId: string; code: string; message: string }
  | { kind: 'cancelled'; executionId: string }
  | { kind: 'run-generation-start'; executionId: string; jobId: string; resultIndex: number }
  | { kind: 'run-generation-result'; executionId: string; outcome: DesignSchemeRunGeneration };

// ---------------------------------------------------------------------------
// 运行切片：草稿试运行 / 正式方案使用（确定性管线，无 Agent 参与）
// ---------------------------------------------------------------------------

export type DesignSchemeRunMode = 'trial' | 'formal';

/** 三档运行优先级（设计规范 §4.1）；默认「方案主导」。 */
export type SchemePriorityMode = 'user_first' | 'scheme_first' | 'agent_mediated';

/** 渲染进程预组装的生图执行计划，与 Skill 执行同构（比例/质量/会话归组固化在模板里）。 */
export interface DesignSchemeRunPlan {
  /** prompt 留空的完整请求模板；主进程填入编译后的提示词。 */
  requestTemplate: GenerateImageRequest;
  /** 每张结果的取消句柄；长度即本次张数。 */
  jobIds: string[];
  providerName: string;
  ratioId: string;
}

export interface StartDesignSchemeRunRequest {
  executionId: string;
  schemeId: string;
  revisionId: string;
  mode: DesignSchemeRunMode;
  /** 本次运行的优先级策略；缺省按「方案主导」执行并写入快照。 */
  priorityMode?: SchemePriorityMode;
  /** 用户自由补充要求，可为空。 */
  brief: string;
  /** 文本槽位值：slotId → 用户填写内容。 */
  inputValues: Record<string, string>;
  generation: DesignSchemeRunPlan;
  /**
   * 有限修复链（开发规范 §5.5）：按上一次质量门建议重跑一次。
   * 修复运行是新的 runId，保留原始输出；修复运行自身不再给修复建议（链长 1）。
   */
  repair?: { ofRunId: string; hint: string };
}

export interface DesignSchemeRunGeneration {
  jobId: string;
  resultIndex: number;
  result: GenerateImageResult;
  /** 试运行成功时写入草稿相册的资产 id（封面候选）。 */
  assetId?: string;
}

/** 质量门单项检查（开发规范 §5.5：先做确定性检查）。 */
export interface SchemeRunEvaluationCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
}

/** 一次运行的质量门结果；证据（逐张尺寸/字节数）持久化在 evaluations 表。 */
export interface SchemeRunEvaluation {
  evaluationId: string;
  runId: string;
  passed: boolean;
  checks: SchemeRunEvaluationCheck[];
  /**
   * 有限修复建议（确定性，来自未通过的检查项）；null 表示无需修复
   * 或本次已是修复运行（修复链长度固定为 1，规范 §12）。
   */
  repairHint: string | null;
  createdAt: number;
}

export interface DesignSchemeRunResult {
  runId: string;
  /** 实际提交给生图模型的完整提示词。 */
  compiledPrompt: string;
  generations: DesignSchemeRunGeneration[];
  trace: DesignSchemeCreationTraceItem[];
  /** 有成功输出时执行确定性质量门（§5.5）；失败/取消的运行没有评估。 */
  evaluation?: SchemeRunEvaluation;
}

/** 结构化编辑输入槽位的结果：新 revision 的文档与刷新后的摘要。 */
export interface DesignSchemeInputsUpdateResult {
  summary: DesignSchemeSummary;
  document: DesignSchemeRevisionDocument;
}

/** 修改方案（UI 规范 §8.3）：Agent 按用户要求更新草稿 / 为正式方案产出待验证新版本。 */
export interface StartDesignSchemeModifyRequest {
  executionId: string;
  schemeId: string;
  /** 修改基线：草稿为当前版本；正式方案可以是当前正式版或已有待验证草稿。 */
  baseRevisionId: string;
  /** 用户的修改要求（自然语言）。 */
  instruction: string;
}

/** 「检查更新」（UI 规范 §4.2）：对比上游 Skill commit，有变化时产出待验证草稿。 */
export interface DesignSchemeCheckUpdateResult {
  status: 'up-to-date' | 'draft-created' | 'no-source';
  detail: string;
  /** draft-created 时返回刷新后的方案摘要与新 revision。 */
  scheme?: DesignSchemeSummary;
  revisionId?: string;
}

/** 「查看来源」层：当前 revision 绑定的来源快照及其固化文件（UI 规范 §4.2）。 */
export interface DesignSchemeSourceSnapshotDetail {
  snapshotId: string;
  packageKind: 'github' | 'history' | 'user-brief';
  repositoryUrl: string | null;
  ref: string;
  commitHash: string | null;
  license: string | null;
  createdAt: number;
  files: Array<{
    path: string;
    kind: 'text' | 'image' | 'other';
    sizeBytes: number;
    /** 图片等落盘文件相对 userData 的存储键；文本内容直接内联。 */
    storeKey: string | null;
    /** 文本文件内容节选（≤2000 字符）。 */
    textExcerpt: string | null;
  }>;
}

/** 市场候选（Explorer 输出，UI 发现页展示；开发规范 §5.1）。 */
export interface MarketCandidate {
  candidateId: string;
  repositoryUrl: string;
  /** owner/repo 形式的全名。 */
  fullName: string;
  description: string | null;
  /** SPDX 许可证标识；无法确定时为 null。 */
  license: string | null;
  /** 默认分支名（作为安装时的 ref 提示）。 */
  ref: string;
  /** 仓库最近推送时间（毫秒时间戳）。 */
  updatedAt: number;
  stars: number;
  topics: string[];
  /** 与搜索词的匹配理由（确定性生成，不伪造）。 */
  matchReason: string;
  /** 风险摘要：许可证缺失、活跃度低等；无风险时为 null。 */
  riskSummary: string | null;
}

export interface MarketSearchResult {
  query: string;
  /** true 表示网络失败后回退到本地候选缓存。 */
  fromCache: boolean;
  fetchedAt: number;
  candidates: MarketCandidate[];
}

export interface DesignSchemeApi {
  /** 启动创建管线；Promise 在终态（草稿就绪/失败/取消）时结算，过程经事件推送。 */
  startCreation: (request: StartDesignSchemeCreationRequest) => Promise<AppResult<DesignSchemeCreationResult>>;
  /** 响应安装确认层；accept=false 时管线以 cancelled 收尾且不丢 Composer 内容。 */
  confirmInstall: (executionId: string, accept: boolean) => Promise<{ ok: true }>;
  cancelCreation: (executionId: string) => Promise<{ ok: true }>;
  list: () => Promise<AppResult<DesignSchemeSummary[]>>;
  getRevision: (revisionId: string) => Promise<AppResult<DesignSchemeRevisionDocument>>;
  /** 方案相册资产（详情页折叠相册），新结果在前。 */
  listAssets: (schemeId: string) => Promise<AppResult<DesignSchemeAssetSummary[]>>;
  /** 结构化编辑输入槽位（草稿限定）：改必需/可选、删除 → 生成新 revision。 */
  updateInputs: (
    schemeId: string,
    baseRevisionId: string,
    inputs: Array<{ id: string; required: boolean }>,
  ) => Promise<AppResult<DesignSchemeInputsUpdateResult>>;
  /** 试运行草稿 / 使用正式方案：确定性编译提示词并逐张生图，过程经事件推送。 */
  startRun: (request: StartDesignSchemeRunRequest) => Promise<AppResult<DesignSchemeRunResult>>;
  cancelRun: (executionId: string) => Promise<{ ok: true }>;
  /** 把某次本机试运行结果设为封面（转正前提之一）。 */
  selectCover: (schemeId: string, assetId: string) => Promise<AppResult<DesignSchemeSummary>>;
  /** 草稿转正式：要求成功试运行 + 有效封面；不满足时拒绝。 */
  formalize: (schemeId: string) => Promise<AppResult<DesignSchemeSummary>>;
  /** 重命名（只改展示名，编译文档不变）。 */
  rename: (schemeId: string, name: string) => Promise<AppResult<DesignSchemeSummary>>;
  /** 删除草稿 / 移除正式方案：软删除，运行历史与来源快照保留。 */
  remove: (schemeId: string) => Promise<AppResult<{ ok: true }>>;
  /** 「查看来源」：当前 revision 绑定的来源快照与固化文件清单。 */
  listSourceFiles: (schemeId: string) => Promise<AppResult<DesignSchemeSourceSnapshotDetail[]>>;
  /** 修改方案：Agent 更新草稿（新 revision）/ 为正式方案产出待验证草稿，过程经事件推送。 */
  startModify: (request: StartDesignSchemeModifyRequest) => Promise<AppResult<DesignSchemeCreationResult>>;
  cancelModify: (executionId: string) => Promise<{ ok: true }>;
  /** 正式方案：待验证草稿完成试运行后由用户确认替换当前正式版本。 */
  promoteWorkingDraft: (schemeId: string) => Promise<AppResult<DesignSchemeSummary>>;
  /** 检查上游 Skill 更新；有变化时自动编译为待验证草稿。 */
  checkUpdate: (schemeId: string) => Promise<AppResult<DesignSchemeCheckUpdateResult>>;
  /** 发现页市场搜索（Explorer）：只在用户显式发起时运行，结果写候选缓存。 */
  marketSearch: (query: string) => Promise<AppResult<MarketSearchResult>>;
  /** 导出正式方案为 .musefold.design 分享包；不传 targetPath 时弹系统保存框。 */
  exportScheme: (schemeId: string, targetPath?: string) => Promise<AppResult<DesignSchemeExportOutcome>>;
  /** 导入 .musefold.design 分享包为新草稿；不传 sourcePath 时弹系统选择框。 */
  importScheme: (sourcePath?: string) => Promise<AppResult<DesignSchemeImportOutcome>>;
  onEvent: (cb: (event: DesignSchemeCreationEvent) => void) => () => void;
}

/** 导出分享包结果；cancelled=true 表示用户在保存框里取消。 */
export interface DesignSchemeExportOutcome {
  cancelled: boolean;
  path?: string;
  fileName?: string;
  sizeBytes?: number;
}

/** 导入分享包结果；成功时返回新草稿摘要。 */
export interface DesignSchemeImportOutcome {
  cancelled: boolean;
  scheme?: DesignSchemeSummary;
}
