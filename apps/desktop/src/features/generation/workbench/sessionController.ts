import type {
  WorkbenchSession,
  WorkbenchSessionDocument,
  WorkbenchSessionListResult,
  WorkbenchSessionSummary,
} from '@musefold/desktop-contracts/workbench';
import {
  workbenchSessionControllerReducer,
  type WorkbenchSessionControllerAction,
} from '@musefold/product-ui';
import type { GenerationTurn } from './types';
import { getWorkbenchIO } from './io';

export type WorkbenchSessionOperation<T> =
  { status: 'success'; value: T } | { status: 'stale' } | { status: 'error'; error: unknown };

const SESSION_TURNS_CACHE_LIMIT = 12;

export class DesktopWorkbenchSessionController {
  private readonly turnsCache = new Map<string, GenerationTurn[]>();
  private activeListRequest = 0;
  private archivedListRequest = 0;
  private openRequest = 0;

  reduceSummaries(
    items: WorkbenchSessionSummary[],
    selectedId: string | null,
    action: WorkbenchSessionControllerAction<WorkbenchSessionSummary>,
  ) {
    return workbenchSessionControllerReducer(
      {
        items,
        selectedId,
        openingId: null,
        loading: false,
        error: null,
      },
      action,
    );
  }

  mergeSummary(
    session: WorkbenchSession,
    current?: WorkbenchSessionSummary,
  ): WorkbenchSessionSummary {
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      archivedAt: session.archivedAt,
      deletedAt: session.deletedAt,
      turnCount: current?.turnCount ?? 0,
      runCount: current?.runCount ?? 0,
      latestAssetPath: current?.latestAssetPath ?? null,
      conversationKind: current?.conversationKind ?? 'prompt',
      latestStatus: current?.latestStatus ?? null,
    };
  }

  async list(archived: boolean): Promise<WorkbenchSessionOperation<WorkbenchSessionListResult>> {
    const requestId = archived ? ++this.archivedListRequest : ++this.activeListRequest;
    try {
      const value = await getWorkbenchIO().listDesktopWorkbenchSessions({
        archived,
        limit: 200,
        offset: 0,
      });
      const current = archived ? this.archivedListRequest : this.activeListRequest;
      return requestId === current ? { status: 'success', value } : { status: 'stale' };
    } catch (error) {
      const current = archived ? this.archivedListRequest : this.activeListRequest;
      return requestId === current ? { status: 'error', error } : { status: 'stale' };
    }
  }

  open(
    id: string,
  ):
    | { source: 'cache'; turns: GenerationTurn[] }
    | { source: 'remote'; result: Promise<WorkbenchSessionOperation<WorkbenchSessionDocument>> } {
    const requestId = ++this.openRequest;
    const cached = this.turnsCache.get(id);
    if (cached?.length) return { source: 'cache', turns: cached };

    return {
      source: 'remote',
      result: getWorkbenchIO()
        .getDesktopWorkbenchSession(id)
        .then(
          (document) => {
            if (requestId !== this.openRequest) return { status: 'stale' as const };
            if (!document) {
              return { status: 'error' as const, error: new Error('对话不存在或已删除') };
            }
            return { status: 'success' as const, value: document };
          },
          (error: unknown) =>
            requestId === this.openRequest
              ? { status: 'error' as const, error }
              : { status: 'stale' as const },
        ),
    };
  }

  cacheTurns(sessionId: string, turns: GenerationTurn[]): void {
    if (!sessionId || turns.length === 0) return;
    this.turnsCache.delete(sessionId);
    this.turnsCache.set(sessionId, turns);
    while (this.turnsCache.size > SESSION_TURNS_CACHE_LIMIT) {
      const oldest = this.turnsCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.turnsCache.delete(oldest);
    }
  }

  deleteCachedTurns(sessionId: string): void {
    this.turnsCache.delete(sessionId);
  }

  clearCache(): void {
    this.turnsCache.clear();
  }

  mapTurnsEverywhere(
    currentTurns: GenerationTurn[],
    mapper: (turn: GenerationTurn) => GenerationTurn,
  ): GenerationTurn[] {
    for (const [sessionId, cached] of this.turnsCache) {
      this.turnsCache.set(sessionId, cached.map(mapper));
    }
    return currentTurns.map(mapper);
  }

  findTurn(currentTurns: GenerationTurn[], turnId: string): GenerationTurn | undefined {
    const current = currentTurns.find((turn) => turn.id === turnId);
    if (current) return current;
    for (const cached of this.turnsCache.values()) {
      const found = cached.find((turn) => turn.id === turnId);
      if (found) return found;
    }
    return undefined;
  }

  sessionIdForTurn(turnId: string): string | null {
    for (const [sessionId, cached] of this.turnsCache) {
      if (cached.some((turn) => turn.id === turnId)) return sessionId;
    }
    return null;
  }

  cachedTurns(sessionId: string): GenerationTurn[] | undefined {
    return this.turnsCache.get(sessionId);
  }
}

export const workbenchSessionController = new DesktopWorkbenchSessionController();
