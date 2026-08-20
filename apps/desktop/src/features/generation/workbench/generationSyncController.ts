import type {
  GenerateImageResult,
  ImageGenerationProgress,
} from '@musefold/desktop-contracts/providers';
import type { GenerationResultItem, GenerationTurn, GenerationTurnStatus } from './types';
import { workbenchSessionController } from './sessionController';

export interface RunningTurnEntry {
  sessionId: string;
  jobId: string | null;
  cancelRequested: boolean;
  kind: 'image' | 'retry' | 'refinement' | 'skill' | 'scheme-creation' | 'scheme-run';
}

export interface WorkbenchGenerationSyncState {
  turns: GenerationTurn[];
  isGenerating: boolean;
  runningTurns: Record<string, RunningTurnEntry>;
  activeTurnId: string | null;
  activeJobId: string | null;
  cancelRequested: boolean;
}

export function resultStatus(results: GenerationResultItem[]): GenerationTurnStatus {
  if (results.some((result) => result.status === 'pending')) return 'running';
  if (
    results.some((result) => result.status === 'success') &&
    results.some((result) => result.status !== 'success')
  )
    return 'partial';
  if (results.every((result) => result.status === 'success')) return 'success';
  if (results.every((result) => result.status === 'cancelled')) return 'cancelled';
  return 'failed';
}

export function sessionHasRunningTurn(
  state: Pick<WorkbenchGenerationSyncState, 'runningTurns'>,
  sessionId: string,
): boolean {
  return Object.values(state.runningTurns).some((entry) => entry.sessionId === sessionId);
}

export function withRunRegistered(
  state: Pick<WorkbenchGenerationSyncState, 'runningTurns'>,
  turnId: string,
  entry: RunningTurnEntry,
): Pick<WorkbenchGenerationSyncState, 'runningTurns' | 'isGenerating' | 'activeTurnId'> {
  return {
    runningTurns: { ...state.runningTurns, [turnId]: entry },
    isGenerating: true,
    activeTurnId: turnId,
  };
}

export function withRunReleased(
  state: Pick<WorkbenchGenerationSyncState, 'runningTurns' | 'activeTurnId'>,
  turnId: string,
): Partial<WorkbenchGenerationSyncState> {
  const runningTurns = { ...state.runningTurns };
  delete runningTurns[turnId];
  const remaining = Object.keys(runningTurns);
  return {
    runningTurns,
    isGenerating: remaining.length > 0,
    activeTurnId: state.activeTurnId === turnId ? (remaining.at(-1) ?? null) : state.activeTurnId,
    ...(remaining.length === 0 ? { activeJobId: null, cancelRequested: false } : {}),
  };
}

export function updateGenerationResult(
  turns: GenerationTurn[],
  turnId: string,
  resultId: string,
  patch: Partial<GenerationResultItem>,
): GenerationTurn[] {
  return workbenchSessionController.mapTurnsEverywhere(turns, (turn) => {
    if (turn.id !== turnId) return turn;
    const results = turn.results.map((result) =>
      result.id === resultId ? { ...result, ...patch } : result,
    );
    return { ...turn, results, status: resultStatus(results) };
  });
}

export function applyImageResult(
  turns: GenerationTurn[],
  turnId: string,
  resultId: string,
  result: GenerateImageResult,
): GenerationTurn[] {
  const images =
    result.images?.filter((image) => Boolean(image.imagePath)) ??
    (result.imagePath ? [{ imagePath: result.imagePath, actualSize: result.actualSize }] : []);
  if (result.status === 'success' && images.length > 0) {
    return workbenchSessionController.mapTurnsEverywhere(turns, (turn) => {
      if (turn.id !== turnId) return turn;
      const targetIndex = turn.results.findIndex((item) => item.id === resultId);
      if (targetIndex < 0) return turn;
      const target = turn.results[targetIndex];
      const replacements: GenerationResultItem[] = images.map((image, index) => ({
        ...target,
        id: index === 0 ? resultId : `${resultId}-variant-${index + 1}-${image.assetId ?? index}`,
        status: 'success',
        historyId: result.historyId,
        assetId: image.assetId,
        imagePath: image.imagePath,
        cost: result.cost,
        durationMs: result.durationMs,
        error: undefined,
        errorCode: undefined,
        retrying: false,
        retryAttempt: undefined,
        retryMax: undefined,
        retryDelayMs: undefined,
      }));
      const nextResults = [
        ...turn.results.slice(0, targetIndex),
        ...replacements,
        ...turn.results.slice(targetIndex + 1),
      ];
      return {
        ...turn,
        results: nextResults,
        params: { ...turn.params, n: nextResults.length },
        status: resultStatus(nextResults),
        ...(result.providerResponse ? { providerResponse: result.providerResponse } : {}),
      };
    });
  }
  return updateGenerationResult(turns, turnId, resultId, {
    status: result.status === 'cancelled' ? 'cancelled' : 'failed',
    historyId: result.historyId,
    error: result.error?.message ?? '生成失败',
    errorCode: result.error?.code ?? 'UNKNOWN',
    durationMs: result.durationMs,
    retrying: false,
    retryAttempt: undefined,
    retryMax: undefined,
    retryDelayMs: undefined,
  });
}

export function applyTransportError(
  turns: GenerationTurn[],
  turnId: string,
  resultId: string,
  error: unknown,
): GenerationTurn[] {
  const code = (error as { code?: string })?.code ?? 'UNKNOWN';
  return updateGenerationResult(turns, turnId, resultId, {
    status: code === 'CANCELLED' ? 'cancelled' : 'failed',
    errorCode: code,
    error: error instanceof Error ? error.message : '生成失败',
    retrying: false,
    retryAttempt: undefined,
    retryMax: undefined,
    retryDelayMs: undefined,
  });
}

export function applyGenerationProgress(
  turns: GenerationTurn[],
  progress: ImageGenerationProgress,
): GenerationTurn[] {
  return workbenchSessionController.mapTurnsEverywhere(turns, (turn) => ({
    ...turn,
    results: turn.results.map((result) =>
      result.jobId === progress.jobId
        ? {
            ...result,
            retrying: progress.phase === 'retrying',
            retryAttempt: progress.attempt,
            retryMax: progress.maxRetries,
            retryDelayMs: progress.delayMs,
          }
        : result,
    ),
  }));
}
