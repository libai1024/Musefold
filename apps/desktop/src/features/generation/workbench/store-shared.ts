import type {
  ImageProviderResponseSummary,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import { useAppStore } from '../../../stores/app';
import { DEFAULT_REFINE_PARAMS, type RefineParams, type RefineSource } from '../params';
import type { GenerationResultItem, GenerationSource, GenerationTurn } from './types';
import type { GenerationRun, WorkbenchSessionDocument } from '@musefold/desktop-contracts/workbench';
import type {
  SkillRuntimeExecutionMode,
  SkillRuntimeSnapshot,
  SkillRuntimeTraceItem,
} from '@musefold/desktop-contracts/skill-runtime';
import { uniqueReferenceImages } from './imageReferences';
import { setSessionUnread } from './sessionPreferences';
import { workbenchSessionController } from './sessionController';
import { resultStatus } from './generationSyncController';
import { findDesktopWorkbenchSession, upsertDesktopWorkbenchSession } from './workbench-session-query';
import type { WorkbenchGet } from './store-types';

export const SKILL_RUNTIME_PROMPT_LIMIT = 8 * 1024 * 1024;
let seq = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
export const mapTurnsEverywhere = workbenchSessionController.mapTurnsEverywhere.bind(
  workbenchSessionController,
);
export const findTurnAnywhere = workbenchSessionController.findTurn.bind(workbenchSessionController);
export const cacheSessionTurns = workbenchSessionController.cacheTurns.bind(workbenchSessionController);
export const sessionIdForTurn = workbenchSessionController.sessionIdForTurn.bind(
  workbenchSessionController,
);
export const mergeSessionSummary = workbenchSessionController.mergeSummary.bind(
  workbenchSessionController,
);

export function sourceToRefineSource(source: GenerationSource): RefineSource | null {
  if (source.kind === 'prompt') {
    return { kind: 'prompt', id: source.id, label: source.label };
  }
  if (source.kind === 'history' && source.promptId) {
    return { kind: 'prompt', id: source.promptId, label: source.label };
  }
  return null;
}

export function sourcePromptId(source: GenerationSource): string | undefined {
  if (source.kind === 'prompt') return source.id;
  if (source.kind === 'history') return source.promptId;
  return undefined;
}

export function sourceParentHistoryId(source: GenerationSource): string | undefined {
  if (source.kind === 'history') return source.id;
  return undefined;
}

export function composeRefinementPrompt(parentPrompt: string, instruction: string): string {
  return `${parentPrompt.trim()}\n\n微调要求：\n${instruction.trim()}`.trim();
}

function parseSkillRuntimeSnapshot(candidate: unknown): SkillRuntimeSnapshot | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const value = candidate as Partial<SkillRuntimeSnapshot>;
  if (
    typeof value.label !== 'string' ||
    typeof value.repositoryUrl !== 'string' ||
    !['agent', 'file-fallback', 'direct-forward'].includes(value.executionMode ?? '') ||
    !Array.isArray(value.trace)
  )
    return null;
  return {
    label: value.label,
    repositoryUrl: value.repositoryUrl,
    executionMode: value.executionMode as SkillRuntimeExecutionMode,
    trace: value.trace.filter((item): item is SkillRuntimeTraceItem =>
      Boolean(
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        ['tool', 'assistant', 'system'].includes(item.kind) &&
        ['running', 'success', 'warning', 'error'].includes(item.status),
      ),
    ),
  };
}

function completedSkillTrace(
  trace: SkillRuntimeTraceItem[],
  results: GenerationResultItem[],
): SkillRuntimeTraceItem[] {
  if (results.some((result) => result.status === 'pending')) return trace;
  const successCount = results.filter((result) => result.status === 'success').length;
  const failedCount = results.length - successCount;
  const item: SkillRuntimeTraceItem = {
    id: 'image-generation',
    kind: 'tool',
    title: successCount > 0 ? '图片生成完成' : '图片生成失败',
    detail:
      successCount > 0
        ? `已返回 ${successCount} 张图片${failedCount > 0 ? `，${failedCount} 张失败` : ''}`
        : results.find((result) => result.error)?.error || '图片生成失败',
    status: successCount > 0 ? 'success' : 'error',
  };
  const index = trace.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...trace, item];
  return trace.map((candidate) =>
    candidate.id === item.id ? { ...candidate, ...item } : candidate,
  );
}

function sourceFromRun(run: GenerationRun): GenerationSource {
  const skillRuntime = parseSkillRuntimeSnapshot(run.params.skillRuntime);
  if (skillRuntime) {
    return {
      kind: 'skill',
      label: skillRuntime.label,
      repositoryUrl: skillRuntime.repositoryUrl,
      compiledPrompt: run.finalPrompt,
      executionMode: skillRuntime.executionMode,
      trace: skillRuntime.trace,
    };
  }
  return { kind: 'manual' };
}

function paramsFromRun(run: GenerationRun): RefineParams {
  return {
    ...DEFAULT_REFINE_PARAMS,
    ratioId:
      typeof run.params.aspectRatio === 'string'
        ? run.params.aspectRatio
        : DEFAULT_REFINE_PARAMS.ratioId,
    quality: run.params.quality ?? DEFAULT_REFINE_PARAMS.quality,
    n: 1,
    background: run.params.background ?? DEFAULT_REFINE_PARAMS.background,
    moderation: run.params.moderation,
  };
}

function parseReferenceImage(candidate: unknown): LocalImageReference | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const value = candidate as Partial<LocalImageReference>;
  if (
    (value.source !== 'upload' && value.source !== 'history') ||
    typeof value.path !== 'string' ||
    !value.path
  )
    return null;
  return {
    path: value.path,
    source: value.source,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.mimeType === 'string'
      ? { mimeType: value.mimeType as LocalImageReference['mimeType'] }
      : {}),
    ...(typeof value.sizeBytes === 'number' ? { sizeBytes: value.sizeBytes } : {}),
    ...(typeof value.historyId === 'string' ? { historyId: value.historyId } : {}),
  };
}

function referenceImagesFromRun(run: GenerationRun): LocalImageReference[] {
  if (!Array.isArray(run.params.referenceImages)) return [];
  return uniqueReferenceImages(
    run.params.referenceImages
      .map(parseReferenceImage)
      .filter((image): image is LocalImageReference => image !== null),
  );
}

function providerResponseFromValue(value: unknown): ImageProviderResponseSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const summary = value as Partial<ImageProviderResponseSummary>;
  if (
    summary.kind !== 'doubao-web' ||
    typeof summary.expectedImageCount !== 'number' ||
    typeof summary.receivedImageCount !== 'number'
  )
    return undefined;
  return {
    kind: 'doubao-web',
    expectedImageCount: summary.expectedImageCount,
    receivedImageCount: summary.receivedImageCount,
    ...(typeof summary.message === 'string' && summary.message.trim()
      ? { message: summary.message }
      : {}),
  };
}

export function turnsFromSession(document: WorkbenchSessionDocument): GenerationTurn[] {
  const grouped = new Map<string, typeof document.runs>();
  for (const item of document.runs) {
    const key = item.run.workbenchTurnId ?? item.run.id;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return [...grouped.entries()]
    .sort((left, right) => {
      const a = left[1][0]?.run.turnIndex ?? Number.MAX_SAFE_INTEGER;
      const b = right[1][0]?.run.turnIndex ?? Number.MAX_SAFE_INTEGER;
      return a - b;
    })
    .map(([turnId, items]) => {
      const latestByPosition = new Map<number, (typeof items)[number]>();
      for (const item of items) {
        const position = item.run.resultIndex ?? 0;
        const current = latestByPosition.get(position);
        if (!current || item.run.createdAt >= current.run.createdAt)
          latestByPosition.set(position, item);
      }
      const ordered = [...latestByPosition.entries()].sort((a, b) => a[0] - b[0]);
      const firstItem = ordered[0]?.[1] ?? items[0];
      const first = firstItem.run;
      const results: GenerationResultItem[] = ordered.flatMap(
        ([position, item]): GenerationResultItem[] => {
          const assets = item.assets
            .filter((asset) => asset.status === 'available' && asset.mediaPath)
            .sort((left, right) => left.position - right.position);
          if (assets.length > 0) {
            return assets.map((asset) => ({
              id: `${turnId}-${position}-${asset.position}`,
              jobId: item.run.id,
              historyId: item.run.id,
              assetId: asset.id,
              status: 'success' as const,
              imagePath: asset.mediaPath ?? undefined,
              cost: item.run.actualCost ?? undefined,
              durationMs: item.run.durationMs ?? undefined,
            }));
          }
          return [
            {
              id: `${turnId}-${position}`,
              jobId: item.run.id,
              historyId: item.run.id,
              status:
                item.run.status === 'queued' || item.run.status === 'running'
                  ? ('pending' as const)
                  : item.run.status,
              cost: item.run.actualCost ?? undefined,
              durationMs: item.run.durationMs ?? undefined,
              error: item.run.errorMessage ?? undefined,
              errorCode: item.run.errorCode ?? undefined,
            },
          ];
        },
      );
      const source = sourceFromRun(first);
      const providerResponse = ordered
        .map(([, item]) => providerResponseFromValue(item.providerResponse))
        .find((summary): summary is ImageProviderResponseSummary => Boolean(summary));
      return {
        id: turnId,
        prompt: first.finalPrompt,
        userPrompt: first.promptSnapshot.userPrompt || first.userPrompt,
        references: firstItem.promptReferences.map((reference) => ({ ...reference })),
        negativePrompt: first.negativePrompt ?? '',
        source:
          source.kind === 'skill'
            ? { ...source, trace: completedSkillTrace(source.trace, results) }
            : source,
        providerId: first.providerId,
        params: { ...paramsFromRun(first), n: results.length },
        status: resultStatus(results),
        results,
        ...(providerResponse ? { providerResponse } : {}),
        referenceImages: referenceImagesFromRun(first),
        parentHistoryId: first.parentRunId ?? undefined,
        createdAt: first.createdAt,
        completedAt: Math.max(...items.map((item) => item.run.finishedAt ?? item.run.createdAt)),
      } satisfies GenerationTurn;
    });
}

/** 测试隔离用：清空会话内存缓存。 */
export function clearSessionTurnsCacheForTests(): void {
  workbenchSessionController.clearCache();
}

export function rememberRunningSession(input: {
  sessionId: string;
  title: string;
  existing: ReturnType<typeof findDesktopWorkbenchSession>;
  submittedAt: number;
  conversationKind: 'chat' | 'prompt';
  latestStatus: 'running' | null;
}) {
  upsertDesktopWorkbenchSession({
    id: input.sessionId,
    title: input.title,
    createdAt: input.existing?.createdAt ?? input.submittedAt,
    updatedAt: input.submittedAt,
    archivedAt: null,
    deletedAt: null,
    turnCount: (input.existing?.turnCount ?? 0) + 1,
    runCount: input.existing?.runCount ?? 0,
    latestAssetPath: input.existing?.latestAssetPath ?? null,
    conversationKind: input.conversationKind,
    latestStatus: input.latestStatus,
  });
}

export function turnIndexForTurn(turns: GenerationTurn[], turnId: string): number {
  return Math.max(
    0,
    turns.findIndex((turn) => turn.id === turnId),
  );
}

// 生成完成但用户不在原对话查看时，把会话标记为未读（侧栏绿色光晕）。
// 生成期间允许切换/新建对话：轮次可能已随原会话进入后台缓存，
// 此时无论当前视图如何都标未读；只有仍停留在原对话且在制作视图才视为已读。
export function markSessionUnreadAfterTurn(turnId: string, get: WorkbenchGet) {
  const workbench = get();
  const inCurrentSession = workbench.turns.some((item) => item.id === turnId);
  const sessionId = inCurrentSession ? workbench.sessionId : sessionIdForTurn(turnId);
  if (!sessionId) return;
  const turn = (
    inCurrentSession ? workbench.turns : (workbenchSessionController.cachedTurns(sessionId) ?? [])
  ).find((item) => item.id === turnId);
  if (!turn?.results.some((result) => result.status === 'success')) return;
  if (inCurrentSession && useAppStore.getState().currentView === 'generate') return;
  setSessionUnread(sessionId, true);
}
