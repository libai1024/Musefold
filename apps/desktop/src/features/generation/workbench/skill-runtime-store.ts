import { create } from 'zustand';
import type {
  SkillRuntimeAttachment,
  SkillRuntimeEvent,
  SkillRuntimeExecution,
  SkillRuntimeTraceItem,
} from '@musefold/desktop-contracts/skill-runtime';
import type { ProviderType } from '@musefold/desktop-contracts/enums';
import { MAX_REFERENCE_IMAGES, type LocalImageReference } from '@musefold/desktop-contracts/providers';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { parseGithubSkillUrl } from './githubSkillUrl';
import { buildImageRequest, type RefineParams } from '../params';
import { useGenerationWorkbenchStore } from './store';

export type SkillRuntimeStatus = 'idle' | 'detecting' | 'ready' | 'executing' | 'complete' | 'error';

export interface ExecuteSkillInput {
  userPrompt: string;
  userImages: LocalImageReference[];
  provider: { id: string; name: string; type: ProviderType };
  params: RefineParams;
}

interface SkillRuntimeState {
  status: SkillRuntimeStatus;
  sourceUrl: string | null;
  attachment: SkillRuntimeAttachment | null;
  error: string | null;
  trace: SkillRuntimeTraceItem[];
  submittedPrompt: string | null;
  conversationTurnId: string | null;
  /** 主进程执行对账 ID；事件订阅与取消都以它匹配。 */
  executionId: string | null;
  /** 本次计划生成的 jobId 列表；生图开始事件到达时据此补建结果占位卡片。 */
  plannedJobIds: string[] | null;
  attachGithub: (url: string) => Promise<void>;
  execute: (input: ExecuteSkillInput) => Promise<SkillRuntimeExecution | null>;
  cancelExecution: () => Promise<void>;
  remove: () => Promise<void>;
}

const initialState = {
  status: 'idle' as const,
  sourceUrl: null,
  attachment: null,
  error: null,
  trace: [] as SkillRuntimeTraceItem[],
  submittedPrompt: null,
  conversationTurnId: null,
  executionId: null,
  plannedJobIds: null,
};

function updateTrace(
  trace: SkillRuntimeTraceItem[],
  item: SkillRuntimeTraceItem,
): SkillRuntimeTraceItem[] {
  const index = trace.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...trace, item];
  return trace.map((candidate) => candidate.id === item.id ? item : candidate);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function executionUid(): string {
  return `skill-exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useSkillRuntimeStore = create<SkillRuntimeState>((set, get) => ({
  ...initialState,
  attachGithub: async (url) => {
    const parsed = parseGithubSkillUrl(url);
    if (!parsed.ok) {
      set({ ...initialState, status: 'error', sourceUrl: url, error: parsed.error });
      return;
    }
    const previousRuntimeId = get().attachment?.runtimeId;
    if (previousRuntimeId) void api.skillRuntime.release(previousRuntimeId).catch(() => undefined);
    const startedAt = Date.now();
    set({
      ...initialState,
      status: 'detecting',
      sourceUrl: url,
      trace: [{ id: 'github', kind: 'tool', title: '读取 GitHub 仓库', detail: url, status: 'running' }],
    });
    try {
      const result = await api.skillRuntime.prepareGithub(parsed.value);
      if (!result.ok) {
        set((state) => ({
          status: 'error',
          sourceUrl: url,
          attachment: null,
          error: result.error.message,
          trace: updateTrace(state.trace, { id: 'github', kind: 'tool', title: '读取 GitHub 仓库', detail: result.error.message, status: 'error', durationMs: Date.now() - startedAt }),
        }));
        return;
      }
      set((state) => ({
        status: 'ready',
        sourceUrl: url,
        attachment: result.data,
        error: null,
        trace: [
          ...updateTrace(state.trace, { id: 'github', kind: 'tool', title: '读取 GitHub 仓库', detail: `${result.data.resolvedRef}${result.data.commitHash ? ` · ${result.data.commitHash.slice(0, 7)}` : ''}`, status: 'success', durationMs: Date.now() - startedAt }),
          { id: 'scan', kind: 'tool', title: '识别图像 Skill', detail: `${result.data.name} · ${result.data.description}`, status: 'success' },
          { id: 'files', kind: 'tool', title: '准备 Skill 文件', detail: `${result.data.textFileCount} 个 Markdown/TXT：${result.data.textNames.join('、') || '无'}；${result.data.usableImageCount} 张可用参考图`, status: 'success' },
        ],
      }));
    } catch (error) {
      const message = messageOf(error, 'Skill 识别失败');
      set((state) => ({
        status: 'error', sourceUrl: url, attachment: null, error: message,
        trace: updateTrace(state.trace, { id: 'github', kind: 'tool', title: '读取 GitHub 仓库', detail: message, status: 'error', durationMs: Date.now() - startedAt }),
      }));
    }
  },
  execute: async ({ userPrompt, userImages, provider, params }) => {
    const attachment = get().attachment;
    if (!attachment || get().status !== 'ready') return null;
    // 取消后仍应能用同一 Skill 重发；保留本轮开始前的识别轨迹，避免把
    // 已取消的 Agent 步骤带进下一次对话。
    const readyTrace = get().trace.map((item) => ({ ...item }));
    const workbench = useGenerationWorkbenchStore.getState();
    const begin = workbench.beginSkillTurn({
      userPrompt,
      providerId: provider.id,
      params,
      referenceImages: userImages,
      source: {
        kind: 'skill',
        label: attachment.name,
        repositoryUrl: attachment.repositoryUrl,
        compiledPrompt: '',
        executionMode: provider.type === 'doubao-web' ? 'direct-forward' : 'agent',
        trace: readyTrace,
      },
    });
    if (!begin) return null;
    const executionId = executionUid();
    set({
      status: 'executing',
      error: null,
      submittedPrompt: userPrompt,
      conversationTurnId: begin.turnId,
      executionId,
      plannedJobIds: begin.jobIds,
    });
    // Composer 设置（比例/质量/张数/会话归组）固化成请求模板，主进程只补最终提示词。
    const requestTemplate = buildImageRequest({
      jobId: 'skill-template',
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
      const result = await api.skillRuntime.execute({
        runtimeId: attachment.runtimeId,
        executionId,
        userPrompt,
        userImages: userImages.map((image) => ({ ...image })),
        availableImageSlots: Math.max(0, MAX_REFERENCE_IMAGES - userImages.length),
        traceSeed: readyTrace,
        generation: {
          requestTemplate,
          jobIds: begin.jobIds,
          providerName: provider.name,
          ratioId: params.ratioId,
        },
      });
      if (!result.ok) {
        useGenerationWorkbenchStore.getState().failSkillTurn(begin.turnId, result.error.message, result.error.code);
        set({ status: 'error', error: result.error.message, executionId: null, plannedJobIds: null });
        return null;
      }
      const finalTrace = result.data.trace.map((item) => ({ ...item }));
      const finalSource = {
        kind: 'skill' as const,
        label: attachment.name,
        repositoryUrl: attachment.repositoryUrl,
        compiledPrompt: result.data.finalPrompt,
        executionMode: result.data.mode,
        trace: finalTrace,
      };
      useGenerationWorkbenchStore.getState().finishSkillTurn(begin.turnId, {
        prompt: result.data.finalPrompt,
        source: finalSource,
        referenceImages: [...userImages, ...result.data.imageReferences],
        generations: result.data.generations,
      });
      const wasCancelled = result.data.generations.some((generation) => generation.result.status === 'cancelled');
      if (wasCancelled) {
        set({
          status: 'ready',
          error: null,
          trace: readyTrace,
          submittedPrompt: null,
          conversationTurnId: null,
          executionId: null,
          plannedJobIds: null,
        });
        return result.data;
      }
      set({
        status: 'complete',
        error: null,
        trace: finalTrace,
        executionId: null,
        plannedJobIds: null,
      });
      void api.skillRuntime.release(attachment.runtimeId).catch(() => undefined);
      return result.data;
    } catch (error) {
      const message = messageOf(error, 'Skill 执行失败');
      useGenerationWorkbenchStore.getState().failSkillTurn(begin.turnId, message);
      set({ status: 'error', error: message, executionId: null, plannedJobIds: null });
      return null;
    }
  },
  cancelExecution: async () => {
    const executionId = get().executionId;
    if (executionId) await api.skillRuntime.cancel(executionId).catch(() => undefined);
  },
  remove: async () => {
    const runtimeId = get().attachment?.runtimeId;
    set(initialState);
    if (runtimeId) await api.skillRuntime.release(runtimeId).catch(() => undefined);
  },
}));

// 主进程 Skill 执行事件 → 实时更新对话轨迹（流式文本、真实工具调用、逐张生图结果）。
if (typeof api.skillRuntime?.onEvent === 'function') {
  api.skillRuntime.onEvent((event: SkillRuntimeEvent) => {
    const state = useSkillRuntimeStore.getState();
    if (!state.executionId || event.executionId !== state.executionId) return;
    const syncTurnTrace = (trace: SkillRuntimeTraceItem[]) => {
      if (state.conversationTurnId) {
        useGenerationWorkbenchStore.getState().setTurnSkillTrace(state.conversationTurnId, trace);
      }
    };
    switch (event.kind) {
      case 'trace': {
        const trace = updateTrace(state.trace, event.item);
        useSkillRuntimeStore.setState({ trace });
        syncTurnTrace(trace);
        break;
      }
      case 'assistant-delta': {
        const existing = state.trace.find((item) => item.id === event.itemId);
        const trace = existing
          ? state.trace.map((item) => item.id === event.itemId
            ? { ...item, output: `${item.output ?? ''}${event.text}` }
            : item)
          : [...state.trace, {
              id: event.itemId,
              kind: 'assistant' as const,
              title: 'Agent',
              output: event.text,
              status: 'running' as const,
            }];
        useSkillRuntimeStore.setState({ trace });
        syncTurnTrace(trace);
        break;
      }
      case 'generation-start': {
        // Agent 真正调用生图模型了：此刻才补建全部结果占位卡片。
        if (state.conversationTurnId) {
          useGenerationWorkbenchStore.getState().materializeSkillTurnResults(
            state.conversationTurnId,
            state.plannedJobIds ?? [event.jobId],
          );
          // 登记当前 jobId：该对话的停止按钮据此逐张取消（并行运行互不影响）。
          useGenerationWorkbenchStore.getState().setRunningTurnJob(state.conversationTurnId, event.jobId);
        } else {
          useGenerationWorkbenchStore.setState({ activeJobId: event.jobId });
        }
        break;
      }
      case 'generation-result': {
        if (state.conversationTurnId) {
          useGenerationWorkbenchStore.getState().materializeSkillTurnResults(
            state.conversationTurnId,
            state.plannedJobIds ?? [event.outcome.jobId],
          );
          useGenerationWorkbenchStore.getState().applySkillGenerationResult(state.conversationTurnId, event.outcome);
        }
        break;
      }
      default:
        break;
    }
  });
}
