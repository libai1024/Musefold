/**
 * 方案运行（v0.3.2 运行切片）的 renderer 门面。
 *
 * 职责：把草稿「试运行」/ 正式方案「使用」接到工作台——
 * 挂载方案附件（含输入槽位）、发起确定性运行、转发事件为对话轨迹、
 * 承接试运行后的设为封面 / 设为正式。
 */
import { create } from 'zustand';
import api from '../../lib/ipc';
import type {
  DesignSchemeCreationEvent,
  DesignSchemeRunMode,
  DesignSchemeSummary,
} from '@musefold/desktop-contracts/design-scheme';
import type { LocalImageReference } from '@musefold/desktop-contracts/providers';
import { toast } from '../../stores/toast';
import { useAppStore } from '../../stores/app';
import { buildImageRequest, type RefineParams } from '../generation/params';
import { useGenerationWorkbenchStore } from '../generation/workbench/store';
import type { GenerationSource } from '../generation/workbench/types';

type SchemeDraftSource = Extract<GenerationSource, { kind: 'scheme' }>;

export interface ExecuteSchemeRunInput {
  userPrompt: string;
  userImages: LocalImageReference[];
  provider: { id: string; name: string };
  params: RefineParams;
  /** 有限修复链（规范 §5.5）：携带上次 runId 与质量门建议重跑一次。 */
  repair?: { ofRunId: string; hint: string };
}

/** 修复重跑需要复用的完整运行上下文（同输入、同 Provider、同参数）。 */
interface LastRunContext {
  turnId: string;
  source: SchemeDraftSource;
  input: ExecuteSchemeRunInput;
  inputValues: Record<string, string>;
}

interface SchemeRunState {
  running: boolean;
  executionId: string | null;
  turnId: string | null;
  plannedJobIds: string[] | null;
  /** 最近一次完成运行的上下文；质量门修复重跑据此复现请求。 */
  lastRun: LastRunContext | null;
  /** 把方案挂载为 Composer 附件（试运行草稿 / 使用正式方案），并切到工作台。 */
  attach: (scheme: DesignSchemeSummary, mode: DesignSchemeRunMode) => Promise<boolean>;
  /** 发起运行；对话轮与结果卡片由事件驱动。返回是否成功发起。 */
  execute: (source: SchemeDraftSource, input: ExecuteSchemeRunInput) => Promise<boolean>;
  /** 按质量门建议修复重跑一次（新 runId，保留原始输出；链长 1）。 */
  repairRun: (turnId: string) => Promise<void>;
  cancel: () => Promise<void>;
  /** 试运行结果 → 草稿封面；成功后回填对话轮上的封面状态。 */
  selectCover: (turnId: string, schemeId: string, assetId: string) => Promise<void>;
  /** 草稿 → 正式；主进程校验成功试运行 + 封面。 */
  formalize: (turnId: string, schemeId: string) => Promise<void>;
}

function executionUid(): string {
  return `dsrun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useSchemeRunStore = create<SchemeRunState>((set, get) => ({
  running: false,
  executionId: null,
  turnId: null,
  plannedJobIds: null,
  lastRun: null,

  attach: async (scheme, mode) => {
    // 结构化编辑会产生新 revision；创建卡片等旧入口拿着过期摘要，这里总是取最新。
    let latest = scheme;
    const summaries = await api.designScheme.list();
    if (summaries.ok) {
      latest = summaries.data.find((item) => item.id === scheme.id) ?? scheme;
    }
    // 正式方案存在待验证新版本时，「试运行」针对的是新版本（规范 §2.2）。
    const revisionId = mode === 'trial' && latest.workingDraftRevisionId
      ? latest.workingDraftRevisionId
      : latest.currentRevisionId;
    const revision = await api.designScheme.getRevision(revisionId);
    if (!revision.ok) {
      toast.error('无法打开方案', revision.error.message);
      return false;
    }
    const workbench = useGenerationWorkbenchStore.getState();
    workbench.setDraftSource({
      kind: 'scheme',
      schemeId: latest.id,
      revisionId,
      label: revision.data.name,
      summary: revision.data.summary,
      mode,
      fidelity: latest.fidelity,
      sourceLabel: latest.sourceLabel,
      inputs: revision.data.inputs.map((slot) => ({ ...slot })),
      coverAssetId: latest.coverAssetId,
      hasSuccessfulTrial: latest.hasSuccessfulTrial,
    });
    useGenerationWorkbenchStore.setState({ schemeInputValues: {} });
    useAppStore.getState().setView('generate');
    return true;
  },

  execute: async (source, input) => {
    const { userPrompt, userImages, provider, params, repair } = input;
    if (get().running || source.mode === 'modify') return false;
    const runSource = { ...source, mode: source.mode };
    const workbench = useGenerationWorkbenchStore.getState();
    // beginSchemeRunTurn 会连同 Composer 一起重置槽位值，必须先快照再建轮。
    // 修复重跑不经过 Composer，直接复用上次快照。
    const inputValues = repair && get().lastRun
      ? { ...get().lastRun!.inputValues }
      : { ...workbench.schemeInputValues };
    const executionId = executionUid();
    const begin = workbench.beginSchemeRunTurn({
      userPrompt,
      executionId,
      providerId: provider.id,
      params,
      referenceImages: userImages,
      source: runSource,
      ...(repair ? { isRepairRun: true } : {}),
    });
    if (!begin) return false;
    set({ running: true, executionId, turnId: begin.turnId, plannedJobIds: begin.jobIds });

    // Composer 设置（比例/质量/张数/会话归组）固化成请求模板，主进程只补编译后的提示词。
    const requestTemplate = buildImageRequest({
      jobId: 'scheme-template',
      providerId: provider.id,
      prompt: '',
      params,
      referenceImages: userImages,
      workbench: {
        sessionId: begin.sessionId,
        sessionTitle: begin.sessionTitle,
        turnId: begin.turnId,
        turnIndex: begin.turnIndex,
        resultIndex: 0,
        userPrompt,
      },
    });
    try {
      const result = await api.designScheme.startRun({
        executionId,
        schemeId: source.schemeId,
        revisionId: source.revisionId,
        mode: source.mode,
        // 每次运行携带当时的优先级设置，由主进程写入策略快照（设计规范 §4.3）。
        priorityMode: useAppStore.getState().schemePriorityMode,
        brief: userPrompt,
        inputValues,
        generation: {
          requestTemplate,
          jobIds: begin.jobIds,
          providerName: provider.name,
          ratioId: params.ratioId,
        },
        ...(repair ? { repair } : {}),
      });
      const state = useGenerationWorkbenchStore.getState();
      if (!result.ok) {
        state.failSchemeRunTurn(begin.turnId, result.error.message, result.error.code === 'CANCELLED');
        return false;
      }
      state.finishSchemeRunTurn(begin.turnId, {
        compiledPrompt: result.data.compiledPrompt,
        generations: result.data.generations,
        trace: result.data.trace,
        runId: result.data.runId,
        repairHint: result.data.evaluation?.repairHint ?? null,
      });
      // 修复重跑需要完整复现上下文（同输入、同参数、同图片）。
      set({
        lastRun: {
          turnId: begin.turnId,
          source: runSource,
          input: { userPrompt, userImages, provider, params },
          inputValues,
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '方案运行失败';
      useGenerationWorkbenchStore.getState().failSchemeRunTurn(begin.turnId, message);
      return false;
    } finally {
      set({ running: false, executionId: null, turnId: null, plannedJobIds: null });
    }
  },

  repairRun: async (turnId) => {
    const last = get().lastRun;
    if (!last || last.turnId !== turnId || get().running) return;
    const workbench = useGenerationWorkbenchStore.getState();
    const turn = workbench.turns.find((item) => item.id === turnId);
    if (!turn || turn.source.kind !== 'scheme-run') return;
    const { runId, repairHint } = turn.source;
    if (!runId || !repairHint) return;
    // 链长 1：建议一经使用即从原轮摘除，修复运行自身不会再给建议。
    workbench.patchSchemeRunSource(turnId, { repairHint: null });
    const ok = await get().execute(last.source, {
      ...last.input,
      repair: { ofRunId: runId, hint: repairHint },
    });
    if (!ok) {
      // 发起失败（如并发运行）时还原建议，用户可稍后再试。
      useGenerationWorkbenchStore.getState().patchSchemeRunSource(turnId, { repairHint });
    }
  },

  cancel: async () => {
    const executionId = get().executionId;
    if (executionId) await api.designScheme.cancelRun(executionId).catch(() => undefined);
  },

  selectCover: async (turnId, schemeId, assetId) => {
    const result = await api.designScheme.selectCover(schemeId, assetId);
    if (!result.ok) {
      toast.error('设置封面失败', result.error.message);
      return;
    }
    useGenerationWorkbenchStore.getState().patchSchemeRunSource(turnId, {
      coverAssetId: result.data.coverAssetId,
    });
    toast.show({ title: '已设为封面', description: '现在可以把方案设为正式。' });
  },

  formalize: async (turnId, schemeId) => {
    // 正式方案的待验证新版本试运行成功后，「设为正式」意味着替换正式版本（规范 §2.2）。
    const summaries = await api.designScheme.list();
    const summary = summaries.ok ? summaries.data.find((item) => item.id === schemeId) : undefined;
    const isPromotion = summary?.status === 'formal' && Boolean(summary.workingDraftRevisionId);
    const result = isPromotion
      ? await api.designScheme.promoteWorkingDraft(schemeId)
      : await api.designScheme.formalize(schemeId);
    if (!result.ok) {
      toast.error(isPromotion ? '更新正式版本失败' : '转为正式失败', result.error.message);
      return;
    }
    useGenerationWorkbenchStore.getState().patchSchemeRunSource(turnId, { formalized: true });
    toast.show({
      title: isPromotion ? `「${result.data.name}」正式版本已更新` : `「${result.data.name}」已设为正式`,
      description: '正式方案可以在方案中心直接使用。',
    });
  },
}));

// 主进程运行事件 → 对话轮轨迹与逐张结果（编译步骤、生图开始/完成）。
if (typeof api.designScheme?.onEvent === 'function') {
  api.designScheme.onEvent((event: DesignSchemeCreationEvent) => {
    const state = useSchemeRunStore.getState();
    if (!state.executionId || event.executionId !== state.executionId || !state.turnId) return;
    const workbench = useGenerationWorkbenchStore.getState();
    switch (event.kind) {
      case 'trace':
        workbench.upsertSchemeRunTrace(state.turnId, event.item);
        break;
      case 'run-generation-start':
        // 编译阶段不显示骨架；生图真正开始时才补建全部结果占位卡片。
        workbench.materializeSkillTurnResults(state.turnId, state.plannedJobIds ?? [event.jobId]);
        // 登记当前 jobId：本对话的停止按钮据此逐张取消（并行运行互不影响）。
        workbench.setRunningTurnJob(state.turnId, event.jobId);
        break;
      case 'run-generation-result':
        workbench.materializeSkillTurnResults(state.turnId, state.plannedJobIds ?? [event.outcome.jobId]);
        workbench.applySkillGenerationResult(state.turnId, event.outcome);
        break;
      default:
        break;
    }
  });
}
