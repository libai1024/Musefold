import type { LocalImageReference } from '@musefold/desktop-contracts/providers';
import { useAppStore } from '../../../stores/app';
import { useGenerationStore } from '../store';
import {
  notifyWorkbenchDoubaoUsageChanged,
  notifyWorkbenchHistoryChanged,
} from '../../../runtime/workbench-side-effects';
import { getWorkbenchIO } from './io';
import { buildImageRequest } from '../params';
import type { GenerationResultItem, GenerationTurn } from './types';
import { composePromptWithReferences } from './references';
import { workbenchSessionErrorMessage } from './sessionErrors';
import { composePromptWithRatioConstraint } from './promptConstraints';
import {
  composePromptWithImageIndexHint,
  composePromptWithRefinementImageHint,
  uniqueReferenceImages,
} from './imageReferences';
import { WORKBENCH_PROMPT_LIMIT } from './draftController';
import {
  applyImageResult,
  applyTransportError,
  sessionHasRunningTurn,
  updateGenerationResult,
  withRunRegistered,
  withRunReleased,
} from './generationSyncController';
import {
  SKILL_RUNTIME_PROMPT_LIMIT,
  composeRefinementPrompt,
  markSessionUnreadAfterTurn,
  rememberRunningSession,
  sourceParentHistoryId,
  sourceToRefineSource,
  turnIndexForTurn,
  uid,
  mapTurnsEverywhere,
} from './store-shared';
import { findDesktopWorkbenchSession } from './workbench-session-query';
import type { WorkbenchGenerationActions, WorkbenchGet, WorkbenchSet } from './store-types';

export function createWorkbenchGenerationActions(set: WorkbenchSet, get: WorkbenchGet): WorkbenchGenerationActions {
  return {
  submitDraft: async () => {
    const state = get();
    // 单飞锁按对话粒度：其他对话的运行不阻塞本对话提交。
    if (sessionHasRunningTurn(state, state.sessionId)) return;

    const generation = useGenerationStore.getState();
    const defaultProviderId = useAppStore.getState().defaultProviderId;
    const provider =
      generation.providers.find((item) => item.id === generation.activeProviderId) ??
      generation.providers.find((item) => item.id === defaultProviderId) ??
      generation.providers.find((item) => item.isActive) ??
      generation.providers[0] ??
      null;
    const userPrompt = state.draftPrompt.trim();
    const negativePrompt = state.draftNegativePrompt.trim();
    const basePrompt =
      state.draftSource.kind === 'skill' ? state.draftSource.compiledPrompt : userPrompt;
    const references = state.draftReferences.map((reference) => ({ ...reference }));
    const params = {
      ...state.params,
      ...(provider?.type === 'doubao-web' ? { n: 1 } : {}),
    };
    const prompt = composePromptWithRatioConstraint(
      composePromptWithImageIndexHint(
        composePromptWithReferences(basePrompt, references),
        state.draftImages.length,
      ),
      params.ratioId,
    );
    if (!prompt) return;
    const promptLimit =
      state.draftSource.kind === 'skill' ? SKILL_RUNTIME_PROMPT_LIMIT : WORKBENCH_PROMPT_LIMIT;
    if (prompt.length > promptLimit) {
      set({
        lastError: {
          code: 'PROMPT_TOO_LONG',
          message: `提示词与引用合计 ${prompt.length} 字，不能超过 ${promptLimit} 字`,
        },
      });
      return;
    }
    const turnId = uid('turn');
    const turnIndex = state.turns.length;
    const proposedSessionTitle =
      (userPrompt || basePrompt || references[0]?.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || '新设计';
    const existingSession = findDesktopWorkbenchSession(state.sessionId);
    const sessionTitle = existingSession?.title ?? proposedSessionTitle;
    const conversationKind =
      state.draftSource.kind === 'prompt' ||
      state.draftSource.kind === 'skill' ||
      (state.draftSource.kind === 'history' && Boolean(state.draftSource.promptId)) ||
      references.length > 0
        ? 'prompt'
        : 'chat';
    const submittedAt = Date.now();
    const results: GenerationResultItem[] = Array.from({ length: params.n }, () => ({
      id: uid('result'),
      jobId: '',
      status: 'pending',
    }));
    const turn: GenerationTurn = {
      id: turnId,
      prompt,
      userPrompt,
      references,
      negativePrompt,
      source: state.draftSource,
      providerId: provider?.id ?? null,
      params,
      status: provider?.hasKey ? 'running' : 'failed',
      results,
      referenceImages: state.draftImages.map((image) => ({ ...image })),
      parentHistoryId: sourceParentHistoryId(state.draftSource),
      createdAt: Date.now(),
    };

    set((current) => ({
      turns: [...current.turns, turn],
      activeSessionId: state.sessionId,
      ...(provider?.hasKey
        ? withRunRegistered(current, turnId, {
            sessionId: state.sessionId,
            jobId: null,
            cancelRequested: false,
            kind: 'image',
          })
        : {}),
      cancelRequested: false,
      lastError: provider?.hasKey
        ? null
        : {
            code: provider ? 'NO_KEY' : 'NO_PROVIDER',
            message: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
          },
      ...(provider?.hasKey
        ? {
            draftPrompt: '',
            draftImages: [],
            draftNegativePrompt: '',
            draftSource: { kind: 'manual' as const },
          }
        : {}),
    }));
    rememberRunningSession({
      sessionId: state.sessionId,
      title: sessionTitle,
      existing: existingSession,
      submittedAt,
      conversationKind,
      latestStatus: provider?.hasKey ? 'running' : null,
    });

    try {
      await getWorkbenchIO().ensureWorkbenchSession({
        id: state.sessionId,
        title: sessionTitle,
        createdAt: submittedAt,
      });
    } catch (error) {
      set({ sessionsError: workbenchSessionErrorMessage(error, '创建对话失败') });
    }

    if (!provider?.hasKey) {
      for (const result of results) {
        set((current) => ({
          turns: updateGenerationResult(current.turns, turnId, result.id, {
            status: 'failed',
            errorCode: provider ? 'NO_KEY' : 'NO_PROVIDER',
            error: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
          }),
        }));
      }
      return;
    }

    for (const result of results) {
      // 取消只作用于本轮（并行运行互不影响）。
      if (get().runningTurns[turnId]?.cancelRequested) {
        set((current) => ({
          turns: updateGenerationResult(current.turns, turnId, result.id, {
            status: 'cancelled',
            errorCode: 'CANCELLED',
            error: '已取消生成',
          }),
        }));
        continue;
      }
      const jobId = uid('job');
      set((current) => ({
        turns: updateGenerationResult(current.turns, turnId, result.id, {
          jobId,
          status: 'pending',
        }),
      }));
      get().setRunningTurnJob(turnId, jobId);
      try {
        const refineSource = sourceToRefineSource(state.draftSource);
        const request = buildImageRequest({
          jobId,
          providerId: provider.id,
          prompt,
          negative: negativePrompt,
          params,
          source: refineSource,
          parentHistoryId: sourceParentHistoryId(state.draftSource),
          references,
          referenceImages: state.draftImages,
          workbench: {
            sessionId: state.sessionId,
            sessionTitle,
            turnId,
            turnIndex,
            resultIndex: results.indexOf(result),
            userPrompt,
          },
          skillRuntime:
            state.draftSource.kind === 'skill'
              ? {
                  label: state.draftSource.label,
                  repositoryUrl: state.draftSource.repositoryUrl,
                  executionMode: state.draftSource.executionMode,
                  trace: state.draftSource.trace,
                }
              : undefined,
        });
        const response = await getWorkbenchIO().generateImage(request);
        set((current) => ({
          turns: applyImageResult(current.turns, turnId, result.id, response),
        }));
      } catch (error) {
        set((current) => ({
          turns: applyTransportError(current.turns, turnId, result.id, error),
        }));
      } finally {
        if (get().activeJobId === jobId) set({ activeJobId: null });
        if (provider.type === 'doubao-web') {
          notifyWorkbenchDoubaoUsageChanged();
        }
      }
    }

    set((current) => ({
      ...withRunReleased(current, turnId),
      turns: mapTurnsEverywhere(current.turns, (item) =>
        item.id === turnId ? { ...item, completedAt: Date.now() } : item,
      ),
    }));
    markSessionUnreadAfterTurn(turnId, get);
    notifyWorkbenchHistoryChanged();
    void get().loadSessions();
  },

  cancel: async () => {
    // 取消当前对话的运行（并行时不影响其他对话）。
    const state = get();
    const running = Object.entries(state.runningTurns).find(
      ([, entry]) => entry.sessionId === state.sessionId && !entry.cancelRequested,
    );
    if (!running) return;
    const [turnId] = running;
    set((current) => ({
      cancelRequested: true,
      runningTurns: current.runningTurns[turnId]
        ? {
            ...current.runningTurns,
            [turnId]: { ...current.runningTurns[turnId], cancelRequested: true },
          }
        : current.runningTurns,
    }));
    const jobId = get().runningTurns[turnId]?.jobId;
    if (!jobId) return;
    try {
      await getWorkbenchIO().cancelImage(jobId);
    } catch {
      // 主进程任务最终会以 cancelled/failed 返回，取消 IPC 失败不阻塞状态收尾。
    }
  },

  retryResult: async (turnId, resultId) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return;
    const turn = state.turns.find((item) => item.id === turnId);
    const target = turn?.results.find((item) => item.id === resultId);
    if (!turn || !target || !turn.providerId) return;

    set((current) => ({
      turns: updateGenerationResult(current.turns, turnId, resultId, {
        status: 'pending',
        error: undefined,
        errorCode: undefined,
        imagePath: undefined,
        cost: undefined,
        durationMs: undefined,
      }),
    }));
    const jobId = uid('job');
    set((current) => ({
      ...withRunRegistered(current, turnId, {
        sessionId: state.sessionId,
        jobId,
        cancelRequested: false,
        kind: 'retry',
      }),
      lastError: null,
    }));
    set((current) => ({
      turns: updateGenerationResult(current.turns, turnId, resultId, { jobId }),
    }));
    set({ activeJobId: jobId });
    const freshRequest = () =>
      buildImageRequest({
        jobId,
        providerId: turn.providerId!,
        prompt: turn.prompt,
        negative: turn.negativePrompt,
        params: turn.params,
        source: sourceToRefineSource(turn.source),
        parentHistoryId: turn.parentHistoryId,
        references: turn.references,
        referenceImages: turn.referenceImages,
        workbench: {
          sessionId: state.sessionId,
          sessionTitle: turn.userPrompt.slice(0, 80) || '新设计',
          turnId: turn.id,
          turnIndex: turnIndexForTurn(state.turns, turn.id),
          resultIndex: turn.results.findIndex((item) => item.id === resultId),
          userPrompt: turn.userPrompt,
        },
      });
    try {
      let response = target.historyId
        ? await getWorkbenchIO().retryImage(target.historyId, jobId)
        : await getWorkbenchIO().generateImage(freshRequest());
      // 崩溃恢复后的重试：中断的那张只有运行账本、没有 history 记录
      // （history 在完成时才落库）。此时按本轮快照重发一次，而不是把用户
      // 堵在「历史记录已不存在」的死路上。
      if (response.status !== 'success' && response.error?.code === 'NO_HISTORY') {
        response = await getWorkbenchIO().generateImage(freshRequest());
      }
      set((current) => ({
        turns: applyImageResult(current.turns, turnId, resultId, response),
      }));
    } catch (error) {
      set((current) => ({
        turns: applyTransportError(current.turns, turnId, resultId, error),
      }));
    } finally {
      set((current) => withRunReleased(current, turnId));
      const retryProvider = useGenerationStore
        .getState()
        .providers.find((item) => item.id === turn.providerId);
      if (retryProvider?.type === 'doubao-web') {
        notifyWorkbenchDoubaoUsageChanged();
      }
      markSessionUnreadAfterTurn(turnId, get);
      notifyWorkbenchHistoryChanged();
    }
  },

  submitRefinement: async (turnId, resultId, instruction, images = []) => {
    const state = get();
    if (sessionHasRunningTurn(state, state.sessionId)) return;
    const turn = state.turns.find((item) => item.id === turnId);
    const target = turn?.results.find((item) => item.id === resultId);
    const text = instruction.trim();
    if (
      !turn ||
      !target ||
      target.status !== 'success' ||
      !target.imagePath ||
      !target.historyId ||
      !turn.providerId ||
      !text
    )
      return;

    const fallbackImage: LocalImageReference = {
      source: 'history',
      path: target.imagePath,
      historyId: target.historyId,
      ...(target.assetId ? { assetId: target.assetId } : {}),
      name: '图 1',
    };
    const inheritedImages =
      state.refinementContext?.turnId === turnId && state.refinementContext.images.length > 0
        ? state.refinementContext.images
        : [fallbackImage];
    const referenceImages = uniqueReferenceImages([...inheritedImages, ...images]);
    const generation = useGenerationStore.getState();
    const provider = generation.providers.find((item) => item.id === turn.providerId);
    // 豆包网页已经收到所选图片；微调时只发送本轮修改要求，不能把首次
    // 生图使用的 Skill/长提示词再次嵌入请求。其他 Provider 保持原有语义。
    const prompt =
      provider?.type === 'doubao-web'
        ? text
        : composePromptWithRatioConstraint(
            composePromptWithRefinementImageHint(
              composeRefinementPrompt(turn.prompt, text),
              referenceImages.length,
            ),
            turn.params.ratioId,
          );
    if (prompt.length > WORKBENCH_PROMPT_LIMIT) {
      set({
        lastError: {
          code: 'PROMPT_TOO_LONG',
          message: `微调后的提示词共 ${prompt.length} 字，不能超过 ${WORKBENCH_PROMPT_LIMIT} 字`,
        },
      });
      return;
    }

    const refinementTurnId = uid('turn');
    const refinementTurnIndex = state.turns.length;
    const refinementResultId = uid('result');
    const jobId = uid('job');
    const refinementTurn: GenerationTurn = {
      id: refinementTurnId,
      prompt,
      userPrompt: text,
      references: turn.references.map((reference) => ({ ...reference })),
      negativePrompt: turn.negativePrompt,
      source: turn.source,
      providerId: turn.providerId,
      params: { ...turn.params, n: 1 },
      status: provider?.hasKey ? 'running' : 'failed',
      results: [
        {
          id: refinementResultId,
          jobId,
          status: provider?.hasKey ? 'pending' : 'failed',
          ...(provider?.hasKey
            ? {}
            : {
                errorCode: provider ? 'NO_KEY' : 'NO_PROVIDER',
                error: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
              }),
        },
      ],
      referenceImages: referenceImages.map((image) => ({ ...image })),
      parentHistoryId: target.historyId,
      createdAt: Date.now(),
    };

    set((current) => ({
      turns: [...current.turns, refinementTurn],
      ...(provider?.hasKey
        ? withRunRegistered(current, refinementTurnId, {
            sessionId: state.sessionId,
            jobId,
            cancelRequested: false,
            kind: 'refinement',
          })
        : {}),
      activeJobId: provider?.hasKey ? jobId : null,
      cancelRequested: false,
      lastError: provider?.hasKey
        ? null
        : {
            code: provider ? 'NO_KEY' : 'NO_PROVIDER',
            message: provider ? '当前服务商尚未配置密钥' : '尚未配置服务商',
          },
    }));

    if (!provider?.hasKey) {
      set((current) => ({
        turns: mapTurnsEverywhere(current.turns, (item) =>
          item.id === refinementTurnId ? { ...item, completedAt: Date.now() } : item,
        ),
        refinementContext: null,
        draftPrompt: '',
        draftImages: [],
      }));
      return;
    }

    try {
      const response = await getWorkbenchIO().generateImage(
        buildImageRequest({
          jobId,
          providerId: provider.id,
          prompt,
          negative: turn.negativePrompt,
          params: { ...turn.params, n: 1 },
          source: sourceToRefineSource(turn.source),
          parentHistoryId: target.historyId,
          sourceAssetId: target.assetId ?? target.historyId,
          refinementInstruction: text,
          referenceImages,
          references: turn.references,
          workbench: {
            sessionId: state.sessionId,
            sessionTitle: turn.userPrompt.slice(0, 80) || '新设计',
            turnId: refinementTurnId,
            turnIndex: refinementTurnIndex,
            resultIndex: 0,
            userPrompt: text,
          },
        }),
      );
      set((current) => ({
        turns: applyImageResult(current.turns, refinementTurnId, refinementResultId, response),
      }));
    } catch (error) {
      set((current) => ({
        turns: applyTransportError(current.turns, refinementTurnId, refinementResultId, error),
      }));
    } finally {
      set((current) => ({
        ...withRunReleased(current, refinementTurnId),
        refinementContext: null,
        draftPrompt: '',
        draftImages: [],
        turns: mapTurnsEverywhere(current.turns, (item) =>
          item.id === refinementTurnId ? { ...item, completedAt: Date.now() } : item,
        ),
      }));
      markSessionUnreadAfterTurn(refinementTurnId, get);
      if (provider.type === 'doubao-web') {
        notifyWorkbenchDoubaoUsageChanged();
      }
      notifyWorkbenchHistoryChanged();
    }
  },
  };
}
