import type { LocalImageReference, PromptReference } from '@musefold/desktop-contracts/providers';
import type { StoreApi } from 'zustand';
import type { RefineParams } from '../../../lib/generation-params';
import type {
  DesignSchemeCreationTraceItem,
  DesignSchemeHistorySourceItem,
  DesignSchemeRunGeneration,
  DesignSchemeRunMode,
} from '@musefold/desktop-contracts/design-scheme';
import type {
  SkillRuntimeGenerationOutcome,
  SkillRuntimeTraceItem,
} from '@musefold/desktop-contracts/skill-runtime';
import type { GenerationSource, RefinementContext, SchemeCreationDraftCard } from './types';
import type { WorkbenchDraftControllerState } from './draftController';
import type { WorkbenchGenerationSyncState } from './generationSyncController';

export interface WorkbenchState extends WorkbenchDraftControllerState, WorkbenchGenerationSyncState {
  /** Composer 指令芯片（Codex 式）：输入完整 / 指令后收敛为图标+指令名。 */
  draftCommand: 'design-plan' | null;
  /** 「从历史内容创建」挑选的来源（UI 规范 §10）；随 design-plan 指令一起提交。 */
  draftHistorySource: { items: DesignSchemeHistorySourceItem[] } | null;
  /** 方案运行事件回填当前 jobId（供该对话的停止按钮取消）。 */
  setRunningTurnJob: (turnId: string, jobId: string | null) => void;
  sessionId: string;
  activeSessionId: string | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  refinementContext: RefinementContext | null;

  setDraftPrompt: (value: string) => void;
  setDraftCommand: (command: 'design-plan' | null) => void;
  setDraftHistorySource: (source: { items: DesignSchemeHistorySourceItem[] } | null) => void;
  setDraftNegativePrompt: (value: string) => void;
  addDraftReference: (reference: PromptReference) => void;
  removeDraftReference: (index: number) => void;
  clearDraftReferences: () => void;
  addDraftImages: (images: LocalImageReference[]) => void;
  removeDraftImage: (index: number) => void;
  clearDraftImages: () => void;
  setDraftSource: (source: GenerationSource) => void;
  setTurnSkillTrace: (turnId: string, trace: SkillRuntimeTraceItem[]) => void;
  /** Skill 执行开始：立即建立对话轮与待生成卡片，生成本身由主进程 Agent 驱动。 */
  beginSkillTurn: (input: {
    userPrompt: string;
    providerId: string;
    params: RefineParams;
    referenceImages: LocalImageReference[];
    source: Extract<GenerationSource, { kind: 'skill' }>;
  }) => {
    turnId: string;
    turnIndex: number;
    jobIds: string[];
    sessionId: string;
    sessionTitle: string;
  } | null;
  /** 生图真正开始时才补建结果占位卡片（Agent 阅读/编排阶段不显示骨架）。幂等。 */
  materializeSkillTurnResults: (turnId: string, jobIds: string[]) => void;
  /** 主进程逐张推送的生图结果回填到对应卡片。 */
  applySkillGenerationResult: (turnId: string, outcome: SkillRuntimeGenerationOutcome) => void;
  /** Skill 执行收尾：写入最终提示词与轨迹，补齐漏掉的结果并结束生成态。 */
  finishSkillTurn: (
    turnId: string,
    patch: {
      prompt: string;
      source: Extract<GenerationSource, { kind: 'skill' }>;
      referenceImages: LocalImageReference[];
      generations: SkillRuntimeGenerationOutcome[];
    },
  ) => void;
  /** Skill 执行整体失败（Agent 报错 / IPC 异常）：所有未完成卡片标记失败。 */
  failSkillTurn: (turnId: string, message: string, code?: string) => void;
  /** 创建设计方案：立即建立对话轮，过程由主进程创建管线事件驱动。 */
  beginSchemeCreationTurn: (input: {
    brief: string;
    executionId: string;
    label: string;
    githubUrl?: string;
  }) => { turnId: string } | null;
  /** 方案文本槽位值：slotId → 用户填写内容（挂载方案附件时使用）。 */
  schemeInputValues: Record<string, string>;
  setSchemeInputValue: (slotId: string, value: string) => void;
  /** 方案运行（试运行/正式使用）：立即建立对话轮，生成由主进程确定性管线驱动。 */
  beginSchemeRunTurn: (input: {
    userPrompt: string;
    executionId: string;
    providerId: string;
    params: RefineParams;
    referenceImages: LocalImageReference[];
    source: Extract<GenerationSource, { kind: 'scheme' }> & { mode: DesignSchemeRunMode };
    /** 质量门修复重跑（有限修复链，规范 §5.5）。 */
    isRepairRun?: boolean;
  }) => {
    turnId: string;
    turnIndex: number;
    jobIds: string[];
    sessionId: string;
    sessionTitle: string;
  } | null;
  patchSchemeRunSource: (
    turnId: string,
    patch: Partial<Omit<Extract<GenerationSource, { kind: 'scheme-run' }>, 'kind'>>,
  ) => void;
  upsertSchemeRunTrace: (turnId: string, item: DesignSchemeCreationTraceItem) => void;
  finishSchemeRunTurn: (
    turnId: string,
    patch: {
      compiledPrompt: string;
      generations: DesignSchemeRunGeneration[];
      trace: DesignSchemeCreationTraceItem[];
      /** 本轮 runId 与质量门修复建议（有限修复链，规范 §5.5）。 */
      runId?: string;
      repairHint?: string | null;
    },
  ) => void;
  failSchemeRunTurn: (turnId: string, message: string, cancelled?: boolean) => void;
  patchSchemeCreationSource: (
    turnId: string,
    patch: Partial<Omit<Extract<GenerationSource, { kind: 'scheme-creation' }>, 'kind'>>,
  ) => void;
  upsertSchemeCreationTrace: (turnId: string, item: DesignSchemeCreationTraceItem) => void;
  completeSchemeCreationTurn: (
    turnId: string,
    draft: SchemeCreationDraftCard,
    trace: DesignSchemeCreationTraceItem[],
  ) => void;
  failSchemeCreationTurn: (turnId: string, message: string, cancelled?: boolean) => void;
  clearDraftSource: () => void;
  setParams: (patch: Partial<RefineParams>) => void;
  submitDraft: () => Promise<void>;
  cancel: () => Promise<void>;
  retryResult: (turnId: string, resultId: string) => Promise<void>;
  submitRefinement: (
    turnId: string,
    resultId: string,
    instruction: string,
    images?: LocalImageReference[],
  ) => Promise<void>;
  reuseResult: (turnId: string, resultId: string) => void;
  editTurn: (turnId: string) => void;
  openDraft: (input: {
    prompt: string;
    negative?: string;
    source?: GenerationSource;
    params?: Partial<RefineParams>;
    references?: PromptReference[];
  }) => void;
  newSession: () => void;
  loadSessions: (archived?: boolean) => Promise<void>;
  openSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  archiveSession: (id: string, archived?: boolean) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  startRefinement: (turnId: string, resultId: string) => void;
  startRefinementFromResults: (turnId: string, resultIds: string[]) => void;
  clearRefinement: () => void;
}

export type WorkbenchSet = StoreApi<WorkbenchState>['setState'];
export type WorkbenchGet = StoreApi<WorkbenchState>['getState'];

export type WorkbenchSkillActions = Pick<
  WorkbenchState,
  | 'setTurnSkillTrace'
  | 'beginSkillTurn'
  | 'materializeSkillTurnResults'
  | 'applySkillGenerationResult'
  | 'finishSkillTurn'
  | 'failSkillTurn'
>;

export type WorkbenchSchemeActions = Pick<
  WorkbenchState,
  | 'beginSchemeCreationTurn'
  | 'patchSchemeCreationSource'
  | 'schemeInputValues'
  | 'setSchemeInputValue'
  | 'beginSchemeRunTurn'
  | 'patchSchemeRunSource'
  | 'upsertSchemeRunTrace'
  | 'finishSchemeRunTurn'
  | 'failSchemeRunTurn'
  | 'upsertSchemeCreationTrace'
  | 'completeSchemeCreationTurn'
  | 'failSchemeCreationTurn'
>;

export type WorkbenchGenerationActions = Pick<
  WorkbenchState,
  'submitDraft' | 'cancel' | 'retryResult' | 'submitRefinement'
>;

export type WorkbenchSessionActions = Pick<
  WorkbenchState,
  | 'reuseResult'
  | 'editTurn'
  | 'openDraft'
  | 'newSession'
  | 'startRefinement'
  | 'startRefinementFromResults'
  | 'clearRefinement'
  | 'loadSessions'
  | 'openSession'
  | 'renameSession'
  | 'archiveSession'
  | 'deleteSession'
>;

