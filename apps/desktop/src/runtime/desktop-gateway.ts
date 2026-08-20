// DesktopGateway：domain 六端口的桌面实现。只调 window.api；字段转换全部在 mappers/。

import type {
  AccountGateway,
  GenerationGateway,
  HistoryGateway,
  PlatformServices,
  PromptGateway,
  WorkbenchGateway,
} from '@musefold/domain';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import type { Api } from '@musefold/desktop-contracts/ipc';
import {
  DesktopGatewayError,
  DesktopGatewayNotImplementedError,
} from './errors';
import {
  accountStatusToSession,
  combinePromptListRows,
  createWorkbenchSessionToEnsureCommand,
  generationHistoryQueryToListArgs,
  historyRecordToGenerationJob,
  markGenerationJobDeleted,
  markPromptRowDeleted,
  mergeWorkbenchSessionRows,
  newPromptDocumentToRow,
  paginateGenerationJobs,
  paginatePromptRows,
  paginateWorkbenchRows,
  promptListQueryToRowQuery,
  promptRowToDocument,
  updatePromptDocumentToPatch,
  workbenchListQueryToRowQuery,
  workbenchSessionRowToDocument,
} from './mappers';

export type WindowApi = Api;

export class DesktopGateway
  implements
    PromptGateway,
    WorkbenchGateway,
    GenerationGateway,
    HistoryGateway,
    AccountGateway,
    PlatformServices,
    DesktopExtras
{
  constructor(private readonly api: WindowApi) {}

  // ---------- PromptGateway ----------

  async listPrompts(
    query: Parameters<PromptGateway['listPrompts']>[0],
  ): ReturnType<PromptGateway['listPrompts']> {
    const rowQuery = promptListQueryToRowQuery(query);
    const live = await this.api.prompt.list(rowQuery);
    const deleted = query.includeDeleted ? await this.api.prompt.listDeleted() : undefined;
    return paginatePromptRows(combinePromptListRows(live, deleted), query);
  }

  async getPrompt(id: string): ReturnType<PromptGateway['getPrompt']> {
    const row = await this.api.prompt.get(id);
    if (!row) {
      throw new DesktopGatewayError('提示词不存在', { id });
    }
    return promptRowToDocument(row);
  }

  async createPrompt(
    input: Parameters<PromptGateway['createPrompt']>[0],
  ): ReturnType<PromptGateway['createPrompt']> {
    const created = await this.api.prompt.create(newPromptDocumentToRow(input));
    return promptRowToDocument(created);
  }

  async updatePrompt(
    id: string,
    input: Parameters<PromptGateway['updatePrompt']>[1],
  ): ReturnType<PromptGateway['updatePrompt']> {
    const updated = await this.api.prompt.update(id, updatePromptDocumentToPatch(input));
    return promptRowToDocument(updated);
  }

  async deletePrompt(
    id: string,
    expectedVersion: number,
  ): ReturnType<PromptGateway['deletePrompt']> {
    void expectedVersion;
    const existing = await this.api.prompt.get(id);
    if (!existing) {
      throw new DesktopGatewayError('提示词不存在', { id });
    }
    await this.api.prompt.delete(id);
    const deleted = await this.api.prompt.get(id);
    return promptRowToDocument(deleted ?? markPromptRowDeleted(existing));
  }

  async restorePrompt(
    id: string,
    expectedVersion: number,
  ): ReturnType<PromptGateway['restorePrompt']> {
    void expectedVersion;
    const restored = await this.api.prompt.restore(id);
    return promptRowToDocument(restored);
  }

  async usePrompt(
    id: string,
    input: Parameters<PromptGateway['usePrompt']>[1],
  ): ReturnType<PromptGateway['usePrompt']> {
    void input;
    // 有损：Api.prompt.incrementUsage 只收 id，action 无法经类型面下传。
    await this.api.prompt.incrementUsage(id);
    const row = await this.api.prompt.get(id);
    if (!row) {
      throw new DesktopGatewayError('提示词不存在', { id });
    }
    return { prompt: promptRowToDocument(row), recorded: true };
  }

  // ---------- DesktopExtras（桌面库面直通 IPC，不经 PromptDocument mapper） ----------

  listLibraryPrompts(
    q?: Parameters<DesktopExtras['listLibraryPrompts']>[0],
  ): ReturnType<DesktopExtras['listLibraryPrompts']> {
    return this.api.prompt.list(q);
  }

  listDeletedLibraryPrompts(): ReturnType<DesktopExtras['listDeletedLibraryPrompts']> {
    return this.api.prompt.listDeleted();
  }

  libraryStats(): ReturnType<DesktopExtras['libraryStats']> {
    return this.api.prompt.stats();
  }

  createLibraryPrompt(
    p: Parameters<DesktopExtras['createLibraryPrompt']>[0],
  ): ReturnType<DesktopExtras['createLibraryPrompt']> {
    return this.api.prompt.create(p);
  }

  toggleLibraryPin(
    id: string,
    pinned: boolean,
  ): ReturnType<DesktopExtras['toggleLibraryPin']> {
    return this.api.prompt.togglePin(id, pinned);
  }

  reorderLibraryPins(ids: string[]): ReturnType<DesktopExtras['reorderLibraryPins']> {
    return this.api.prompt.reorderPins(ids);
  }

  purgeLibraryPrompt(id: string): ReturnType<DesktopExtras['purgeLibraryPrompt']> {
    return this.api.prompt.purge(id);
  }

  purgeLibraryPrompts(): ReturnType<DesktopExtras['purgeLibraryPrompts']> {
    return this.api.prompt.purgeAll();
  }

  listSearchHistory(
    limit?: number,
  ): ReturnType<DesktopExtras['listSearchHistory']> {
    return this.api.searchHistory.list(limit);
  }

  addSearchHistory(term: string): ReturnType<DesktopExtras['addSearchHistory']> {
    return this.api.searchHistory.add(term);
  }

  clearSearchHistory(): ReturnType<DesktopExtras['clearSearchHistory']> {
    return this.api.searchHistory.clear();
  }

  relatedHistory(
    q: Parameters<DesktopExtras['relatedHistory']>[0],
  ): ReturnType<DesktopExtras['relatedHistory']> {
    return this.api.history.related(q);
  }

  linkHistoryPrompt(
    req: Parameters<DesktopExtras['linkHistoryPrompt']>[0],
  ): ReturnType<DesktopExtras['linkHistoryPrompt']> {
    return this.api.history.linkPrompt(req);
  }

  listHistory(
    q?: Parameters<DesktopExtras['listHistory']>[0],
  ): ReturnType<DesktopExtras['listHistory']> {
    return this.api.history.list(q);
  }

  getSystemVersion(): ReturnType<DesktopExtras['getSystemVersion']> {
    return this.api.system.getVersion();
  }

  // ---------- DesktopExtras account / cloudSync（桌面状态直通 IPC，不经 AccountSession mapper） ----------

  accountStatus(): ReturnType<DesktopExtras['accountStatus']> {
    return this.api.account.status();
  }

  accountRegister(
    input: Parameters<DesktopExtras['accountRegister']>[0],
  ): ReturnType<DesktopExtras['accountRegister']> {
    return this.api.account.register(input);
  }

  accountLogin(
    input: Parameters<DesktopExtras['accountLogin']>[0],
  ): ReturnType<DesktopExtras['accountLogin']> {
    return this.api.account.login(input);
  }

  accountLogout(): ReturnType<DesktopExtras['accountLogout']> {
    return this.api.account.logout();
  }

  accountRedeem(code: string): ReturnType<DesktopExtras['accountRedeem']> {
    return this.api.account.redeem(code);
  }

  accountRefreshQuota(): ReturnType<DesktopExtras['accountRefreshQuota']> {
    return this.api.account.refreshQuota();
  }

  accountSetServerUrl(url: string): ReturnType<DesktopExtras['accountSetServerUrl']> {
    return this.api.account.setServerUrl(url);
  }

  onAccountChanged(
    cb: Parameters<DesktopExtras['onAccountChanged']>[0],
  ): ReturnType<DesktopExtras['onAccountChanged']> {
    return this.api.account.onChanged(cb);
  }

  cloudSyncStatus(): ReturnType<DesktopExtras['cloudSyncStatus']> {
    return this.api.cloudSync.status();
  }

  cloudSyncSetEnabled(
    enabled: boolean,
  ): ReturnType<DesktopExtras['cloudSyncSetEnabled']> {
    return this.api.cloudSync.setEnabled(enabled);
  }

  cloudSyncNow(): ReturnType<DesktopExtras['cloudSyncNow']> {
    return this.api.cloudSync.syncNow();
  }

  cloudSyncConflicts(): ReturnType<DesktopExtras['cloudSyncConflicts']> {
    return this.api.cloudSync.conflicts();
  }

  cloudSyncResolve(
    conflictId: string,
    resolution: Parameters<DesktopExtras['cloudSyncResolve']>[1],
  ): ReturnType<DesktopExtras['cloudSyncResolve']> {
    return this.api.cloudSync.resolve(conflictId, resolution);
  }

  onCloudSyncChanged(
    cb: Parameters<DesktopExtras['onCloudSyncChanged']>[0],
  ): ReturnType<DesktopExtras['onCloudSyncChanged']> {
    return this.api.cloudSync.onChanged(cb);
  }

  // ---------- WorkbenchGateway ----------

  async listWorkbenchSessions(
    query: Parameters<WorkbenchGateway['listWorkbenchSessions']>[0],
  ): ReturnType<WorkbenchGateway['listWorkbenchSessions']> {
    const active = await this.api.workbenchSession.list(
      workbenchListQueryToRowQuery(query, false),
    );
    if (query.includeArchived) {
      const archived = await this.api.workbenchSession.list(
        workbenchListQueryToRowQuery(query, true),
      );
      return paginateWorkbenchRows(mergeWorkbenchSessionRows(active, archived), query);
    }
    return paginateWorkbenchRows(mergeWorkbenchSessionRows(active), query);
  }

  async getWorkbenchSession(
    id: string,
  ): ReturnType<WorkbenchGateway['getWorkbenchSession']> {
    const document = await this.api.workbenchSession.get(id);
    if (!document) {
      throw new DesktopGatewayError('工作台会话不存在', { id });
    }
    return workbenchSessionRowToDocument(document.session);
  }

  async createWorkbenchSession(
    input: Parameters<WorkbenchGateway['createWorkbenchSession']>[0],
  ): ReturnType<WorkbenchGateway['createWorkbenchSession']> {
    const created = await this.api.workbenchSession.ensure(
      createWorkbenchSessionToEnsureCommand(input, crypto.randomUUID()),
    );
    return workbenchSessionRowToDocument(created);
  }

  updateWorkbenchSession(
    _id: string,
    _input: Parameters<WorkbenchGateway['updateWorkbenchSession']>[1],
  ): ReturnType<WorkbenchGateway['updateWorkbenchSession']> {
    return notImplemented(
      'updateWorkbenchSession',
      '草稿在渲染层 localStorage，无 IPC 落盘；title/archive 是 rename 与 archive 两条独立通道，骨架不在一个方法里拼',
    );
  }

  async deleteWorkbenchSession(
    id: string,
    expectedVersion: number,
  ): ReturnType<WorkbenchGateway['deleteWorkbenchSession']> {
    void expectedVersion;
    const deleted = await this.api.workbenchSession.delete(id);
    return workbenchSessionRowToDocument(deleted);
  }

  // ---------- GenerationGateway ----------

  createGeneration(
    _input: Parameters<GenerationGateway['createGeneration']>[0],
    _idempotencyKey: string,
  ): ReturnType<GenerationGateway['createGeneration']> {
    return notImplemented(
      'createGeneration',
      '端口无 providerId，桌面 image.generate 必填 providerId，不能发明默认服务商',
    );
  }

  async getGeneration(id: string): ReturnType<GenerationGateway['getGeneration']> {
    const row = await this.api.history.get(id);
    if (!row) {
      throw new DesktopGatewayError('生成记录不存在', { id });
    }
    return historyRecordToGenerationJob(row);
  }

  streamGenerationEvents(
    _id: string,
    _afterSeq: number,
    _onEvent: Parameters<GenerationGateway['streamGenerationEvents']>[2],
    _signal?: AbortSignal,
  ): ReturnType<GenerationGateway['streamGenerationEvents']> {
    return notImplemented(
      'streamGenerationEvents',
      '桌面只有 image.onProgress 的 retrying 推送，无 seq / 终态 / afterSeq，与端口 SSE 流形状不对齐，留待 GW-06 决策',
    );
  }

  async cancelGeneration(id: string): ReturnType<GenerationGateway['cancelGeneration']> {
    await this.api.image.cancel(id);
    const row = await this.api.history.get(id);
    if (!row) {
      throw new DesktopGatewayError('生成记录不存在', { id });
    }
    return historyRecordToGenerationJob(row);
  }

  async retryGeneration(
    id: string,
    idempotencyKey: string,
  ): ReturnType<GenerationGateway['retryGeneration']> {
    void idempotencyKey;
    const result = await this.api.image.retry(id);
    const row = await this.api.history.get(result.historyId);
    if (!row) {
      throw new DesktopGatewayError('生成记录不存在', { id: result.historyId });
    }
    return historyRecordToGenerationJob(row);
  }

  approveGeneration(
    _id: string,
    _token: string,
  ): ReturnType<GenerationGateway['approveGeneration']> {
    return notImplemented(
      'approveGeneration',
      '桌面生图无云审批/MCP 预算闸门，没有对应 IPC',
    );
  }

  // ---------- HistoryGateway ----------

  async listGenerationHistory(
    query: Parameters<HistoryGateway['listGenerationHistory']>[0],
  ): ReturnType<HistoryGateway['listGenerationHistory']> {
    const args = generationHistoryQueryToListArgs(query);
    const rows = await this.api.history.list(args);
    return paginateGenerationJobs(rows, query);
  }

  async deleteGeneration(id: string): ReturnType<HistoryGateway['deleteGeneration']> {
    const existing = await this.api.history.get(id);
    if (!existing) {
      throw new DesktopGatewayError('生成记录不存在', { id });
    }
    const snapshot = historyRecordToGenerationJob(existing);
    await this.api.history.delete(id);
    return markGenerationJobDeleted(snapshot);
  }

  restoreGeneration(id: string): ReturnType<HistoryGateway['restoreGeneration']> {
    void id;
    return notImplemented(
      'restoreGeneration',
      '桌面 history.delete 是硬删，没有恢复 IPC',
    );
  }

  // ---------- AccountGateway ----------

  async getSession(): ReturnType<AccountGateway['getSession']> {
    const session = accountStatusToSession(await this.api.account.status());
    if (!session) {
      throw new DesktopGatewayError('未登录');
    }
    return session;
  }

  async login(
    input: Parameters<AccountGateway['login']>[0],
  ): ReturnType<AccountGateway['login']> {
    const session = accountStatusToSession(await this.api.account.login(input));
    if (!session) {
      throw new DesktopGatewayError('登录未建立会话');
    }
    return session;
  }

  async logout(): ReturnType<AccountGateway['logout']> {
    await this.api.account.logout();
  }

  listConnections(): ReturnType<AccountGateway['listConnections']> {
    return this.api.cloudConnections.list();
  }

  updateConnection(
    id: string,
    input: Parameters<AccountGateway['updateConnection']>[1],
  ): ReturnType<AccountGateway['updateConnection']> {
    return this.api.cloudConnections.update(id, input);
  }

  revokeConnection(id: string): ReturnType<AccountGateway['revokeConnection']> {
    return this.api.cloudConnections.revoke(id);
  }
}

export function createDesktopGateway(api: WindowApi): DesktopGateway {
  return new DesktopGateway(api);
}

function readWindowApi(): WindowApi {
  if (typeof window === 'undefined' || window.api == null) {
    throw new DesktopGatewayError('window.api 未注入，无法使用默认 DesktopGateway');
  }
  return window.api;
}

/**
 * 默认单例：懒读 preload 的 window.api。测试请走 createDesktopGateway(fake)。
 * 本卡不接线 store；导入本模块不改变现有行为。
 */
export const desktopGateway: DesktopGateway = createDesktopGateway(
  new Proxy({} as WindowApi, {
    get(_target, property, receiver) {
      return Reflect.get(readWindowApi() as object, property, receiver);
    },
  }),
);

function notImplemented(method: string, reason: string): never {
  throw new DesktopGatewayNotImplementedError(`${method}: ${reason}`);
}
