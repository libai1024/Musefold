// DesktopGateway：domain 五数据端口的桌面实现。只调 window.api；字段转换全部在 mappers/。

import type {
  AccountGateway,
  GenerationGateway,
  HistoryGateway,
  PromptGateway,
  WorkbenchGateway,
} from '@musefold/domain';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import type { Api } from '@musefold/desktop-contracts/ipc';
import type {
  EnsureWorkbenchSessionCommand,
  WorkbenchSession,
} from '@musefold/desktop-contracts/workbench';
import { DesktopGatewayError, DesktopGatewayNotImplementedError } from './errors';
import { DesktopExtrasImpl } from './desktop-extras-impl';
import {
  accountStatusToSummary,
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
  workbenchSessionDocumentToSession,
  workbenchSessionRowToDocument,
} from './mappers';

export type WindowApi = Api;

export class DesktopGateway
  extends DesktopExtrasImpl
  implements
    PromptGateway,
    WorkbenchGateway,
    GenerationGateway,
    HistoryGateway,
    AccountGateway,
    DesktopExtras
{
  constructor(api: WindowApi) {
    super(api);
  }

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

  // ---------- WorkbenchGateway ----------

  async listWorkbenchSessions(
    query: Parameters<WorkbenchGateway['listWorkbenchSessions']>[0],
  ): ReturnType<WorkbenchGateway['listWorkbenchSessions']> {
    const active = await this.api.workbenchSession.list(workbenchListQueryToRowQuery(query, false));
    if (query.includeArchived) {
      const archived = await this.api.workbenchSession.list(
        workbenchListQueryToRowQuery(query, true),
      );
      return paginateWorkbenchRows(mergeWorkbenchSessionRows(active, archived), query);
    }
    return paginateWorkbenchRows(mergeWorkbenchSessionRows(active), query);
  }

  async getWorkbenchSession(id: string): ReturnType<WorkbenchGateway['getWorkbenchSession']> {
    const document = await this.api.workbenchSession.get(id);
    if (!document) {
      throw new DesktopGatewayError('工作台会话不存在', { id });
    }
    return workbenchSessionDocumentToSession(document);
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

  async renameWorkbenchSession(id: string, title: string): Promise<WorkbenchSession> {
    const renamed = await this.api.workbenchSession.rename(id, title);
    return renamed;
  }

  async archiveWorkbenchSession(id: string, archived = true): Promise<WorkbenchSession> {
    const result = await this.api.workbenchSession.archive(id, archived);
    return result;
  }

  async ensureWorkbenchSession(command: EnsureWorkbenchSessionCommand): Promise<WorkbenchSession> {
    const session = await this.api.workbenchSession.ensure(command);
    return session;
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
    return notImplemented('approveGeneration', '桌面生图无云审批/MCP 预算闸门，没有对应 IPC');
  }

  async generateImage(
    req: import('@musefold/desktop-contracts/providers').GenerateImageRequest,
  ): Promise<import('@musefold/desktop-contracts/providers').GenerateImageResult> {
    return this.api.image.generate(req);
  }

  async cancelImage(jobId: string): Promise<{ ok: true }> {
    await this.api.image.cancel(jobId);
    return { ok: true };
  }

  async retryImage(
    historyId: string,
    jobId?: string,
  ): Promise<import('@musefold/desktop-contracts/providers').GenerateImageResult> {
    return this.api.image.retry(historyId, jobId);
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
    return notImplemented('restoreGeneration', '桌面 history.delete 是硬删，没有恢复 IPC');
  }

  // ---------- AccountGateway ----------

  async getAccount(): ReturnType<AccountGateway['getAccount']> {
    const account = accountStatusToSummary(await this.api.account.status());
    if (!account) {
      throw new DesktopGatewayError('未登录');
    }
    return account;
  }

  async login(input: Parameters<AccountGateway['login']>[0]): ReturnType<AccountGateway['login']> {
    const account = accountStatusToSummary(await this.api.account.login(input));
    if (!account) {
      throw new DesktopGatewayError('登录未建立会话');
    }
    return account;
  }

  async register(
    input: Parameters<AccountGateway['register']>[0],
  ): ReturnType<AccountGateway['register']> {
    const account = accountStatusToSummary(await this.api.account.register(input));
    if (!account) {
      throw new DesktopGatewayError('注册未建立会话');
    }
    return account;
  }

  async redeem(code: string): ReturnType<AccountGateway['redeem']> {
    const result = await this.api.account.redeem(code);
    const account = accountStatusToSummary(result.status);
    if (!account) {
      throw new DesktopGatewayError('兑换后账号状态不可用');
    }
    return { account, creditedQuota: result.quotaAdded };
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
