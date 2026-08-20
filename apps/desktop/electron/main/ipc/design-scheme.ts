/**
 * v0.3.2 设计方案 Runtime 的 IPC 门面（创建切片）。
 * renderer 只与这里通信；密钥、数据库与 Agent 循环都留在主进程。
 */
import { join } from 'path';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import { appError, fail, ok, type AppResult } from '@shared/app-result';
import type { DesignSchemeRevisionDocument } from '@shared/design-scheme/schema';
import { IPC } from '@shared/types/ipc';
import type {
  DesignSchemeAssetSummary,
  DesignSchemeCheckUpdateResult,
  DesignSchemeCreationEvent,
  DesignSchemeCreationResult,
  DesignSchemeExportOutcome,
  DesignSchemeImportOutcome,
  DesignSchemeInputsUpdateResult,
  DesignSchemeRunResult,
  DesignSchemeSourceSnapshotDetail,
  DesignSchemeSummary,
  MarketSearchResult,
  StartDesignSchemeCreationRequest,
  StartDesignSchemeModifyRequest,
  StartDesignSchemeRunRequest,
} from '@shared/types/design-scheme';
import type { ImageGenerationProgress } from '@shared/types/providers';
import { getAiConnectionStore } from '../../ai/connection-store';
import { getDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { DesignSchemeCreationSession } from '../design-scheme/orchestrator';
import { searchMarketCandidates } from '../design-scheme/market-search';
import { DesignSchemeModifySession } from '../design-scheme/modify-session';
import { runDesignScheme } from '../design-scheme/run-session';
import { exportDesignScheme, importDesignScheme } from '../design-scheme/share';
import { checkSchemeUpdate } from '../design-scheme/update-check';
import { OpenAiCompatibleTextAdapter } from '../design-scheme/text-adapter';
import { createLogger } from '../../system/logger';

const logger = createLogger('design-scheme');

const sessions = new Map<string, DesignSchemeCreationSession>();
const modifySessions = new Map<string, DesignSchemeModifySession>();
const runExecutions = new Map<string, AbortController>();

function resolveAdapter(): OpenAiCompatibleTextAdapter | null {
  const connections = getAiConnectionStore();
  const profile = connections.list().find((item) => item.isActive && item.hasKey)
    ?? connections.list().find((item) => item.hasKey);
  if (!profile) return null;
  try {
    return new OpenAiCompatibleTextAdapter({
      connection: profile,
      apiKey: connections.loadKey(profile.id),
    });
  } catch (error) {
    logger.warn('设计方案 Runtime 读取 AI 连接密钥失败', error);
    return null;
  }
}

export function registerDesignSchemeHandlers(): void {
  ipcMain.handle(IPC.DESIGN_SCHEME_CREATE_START, async (
    event,
    request: StartDesignSchemeCreationRequest,
  ): Promise<AppResult<DesignSchemeCreationResult>> => {
    if (!request || typeof request.executionId !== 'string' || !request.executionId) {
      return fail(appError('REQUIRED', '创建请求无效', { recoveryAction: 'retry' }));
    }
    if (!request.brief?.trim() && !request.githubUrl && !request.githubUrls?.length && !request.history?.items?.length) {
      return fail(appError('REQUIRED', '请描述你的方案想法，或提供一个 GitHub Skill 地址', {
        recoveryAction: 'edit-input',
      }));
    }
    if (sessions.has(request.executionId)) {
      return fail(appError('INVALID_STATE', '相同的创建任务正在进行中', { recoveryAction: 'retry' }));
    }

    const session = new DesignSchemeCreationSession(request, {
      db: getDesignSchemeDb(),
      resolveAdapter,
      emit: (payload: DesignSchemeCreationEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.DESIGN_SCHEME_EVENT, payload);
      },
    });
    sessions.set(request.executionId, session);
    try {
      return await session.run();
    } finally {
      sessions.delete(request.executionId);
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_CREATE_CONFIRM_INSTALL, (
    _event,
    executionId: string,
    accept: boolean,
  ) => {
    sessions.get(executionId)?.confirmInstall(Boolean(accept));
    return { ok: true as const };
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_CREATE_CANCEL, (_event, executionId: string) => {
    sessions.get(executionId)?.cancel();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_LIST, (): AppResult<DesignSchemeSummary[]> => {
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      return ok(repository.listSummaries());
    } catch (error) {
      logger.error('读取设计方案列表失败', error);
      return fail(appError('UNKNOWN', '读取设计方案列表失败', { retryable: true, recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_LIST_ASSETS, (
    _event,
    schemeId: string,
  ): AppResult<DesignSchemeAssetSummary[]> => {
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      return ok(repository.listAssets(schemeId));
    } catch (error) {
      logger.error('读取方案相册失败', error);
      return fail(appError('UNKNOWN', '读取方案相册失败', { retryable: true, recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_UPDATE_INPUTS, (
    _event,
    schemeId: string,
    baseRevisionId: string,
    inputs: Array<{ id: string; required: boolean }>,
  ): AppResult<DesignSchemeInputsUpdateResult> => {
    if (typeof schemeId !== 'string' || typeof baseRevisionId !== 'string' || !Array.isArray(inputs)) {
      return fail(appError('REQUIRED', '编辑请求无效', { recoveryAction: 'retry' }));
    }
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      const sanitized = inputs.map((slot) => ({ id: String(slot.id), required: Boolean(slot.required) }));
      return ok(repository.updateRevisionInputs(schemeId, baseRevisionId, sanitized));
    } catch (error) {
      const message = error instanceof Error ? error.message : '编辑输入槽位失败';
      logger.error('编辑输入槽位失败', error);
      return fail(appError('INVALID_STATE', message, { recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_GET_REVISION, (
    _event,
    revisionId: string,
  ): AppResult<DesignSchemeRevisionDocument> => {
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      const document = repository.getRevisionDocument(revisionId);
      if (!document) {
        return fail(appError('MISSING_REFERENCE', '方案版本不存在', { recoveryAction: 'retry' }));
      }
      return ok(document);
    } catch (error) {
      logger.error('读取设计方案版本失败', error);
      return fail(appError('UNKNOWN', '读取设计方案版本失败', { retryable: true, recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_RUN_START, async (
    event,
    request: StartDesignSchemeRunRequest,
  ): Promise<AppResult<DesignSchemeRunResult>> => {
    if (!request || typeof request.executionId !== 'string' || !request.executionId
      || typeof request.schemeId !== 'string' || typeof request.revisionId !== 'string') {
      return fail(appError('REQUIRED', '运行请求无效', { recoveryAction: 'retry' }));
    }
    const plan = request.generation;
    if (!plan?.requestTemplate || !Array.isArray(plan.jobIds) || plan.jobIds.length === 0) {
      return fail(appError('REQUIRED', '生成计划无效，请重新发送', { recoveryAction: 'retry' }));
    }
    if (runExecutions.has(request.executionId)) {
      return fail(appError('INVALID_STATE', '相同的运行任务正在进行中', { recoveryAction: 'retry' }));
    }
    const controller = new AbortController();
    runExecutions.set(request.executionId, controller);
    try {
      return await runDesignScheme(request, {
        db: getDesignSchemeDb(),
        emit: (payload: DesignSchemeCreationEvent) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.DESIGN_SCHEME_EVENT, payload);
        },
        sendProgress: (progress: ImageGenerationProgress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.IMAGE_PROGRESS, progress);
        },
        signal: controller.signal,
      });
    } catch (error) {
      logger.error('方案运行失败', error);
      const message = error instanceof Error ? error.message : '方案运行失败';
      return fail(appError('UNKNOWN', message, { retryable: true, recoveryAction: 'retry' }));
    } finally {
      runExecutions.delete(request.executionId);
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_RUN_CANCEL, (_event, executionId: string) => {
    runExecutions.get(executionId)?.abort();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_SELECT_COVER, (
    _event,
    schemeId: string,
    assetId: string,
  ): AppResult<DesignSchemeSummary> => {
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      return ok(repository.selectCover(schemeId, assetId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '设置封面失败';
      return fail(appError('INVALID_STATE', message, { recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_FORMALIZE, (
    _event,
    schemeId: string,
  ): AppResult<DesignSchemeSummary> => {
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      return ok(repository.formalize(schemeId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '转为正式失败';
      return fail(appError('INVALID_STATE', message, { recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_RENAME, (
    _event,
    schemeId: string,
    name: string,
  ): AppResult<DesignSchemeSummary> => {
    if (typeof schemeId !== 'string' || typeof name !== 'string') {
      return fail(appError('REQUIRED', '重命名请求无效', { recoveryAction: 'retry' }));
    }
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      return ok(repository.rename(schemeId, name));
    } catch (error) {
      const message = error instanceof Error ? error.message : '重命名失败';
      return fail(appError('INVALID_STATE', message, { recoveryAction: 'edit-input' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_REMOVE, (
    _event,
    schemeId: string,
  ): AppResult<{ ok: true }> => {
    if (typeof schemeId !== 'string' || !schemeId) {
      return fail(appError('REQUIRED', '删除请求无效', { recoveryAction: 'retry' }));
    }
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      repository.softDelete(schemeId);
      return ok({ ok: true as const });
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除方案失败';
      return fail(appError('INVALID_STATE', message, { recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_LIST_SOURCE_FILES, (
    _event,
    schemeId: string,
  ): AppResult<DesignSchemeSourceSnapshotDetail[]> => {
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      return ok(repository.listSourceFiles(schemeId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取来源快照失败';
      return fail(appError('INVALID_STATE', message, { recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_MODIFY_START, async (
    event,
    request: StartDesignSchemeModifyRequest,
  ): Promise<AppResult<DesignSchemeCreationResult>> => {
    if (!request || typeof request.executionId !== 'string' || !request.executionId
      || typeof request.schemeId !== 'string' || typeof request.baseRevisionId !== 'string') {
      return fail(appError('REQUIRED', '修改请求无效', { recoveryAction: 'retry' }));
    }
    if (!request.instruction?.trim()) {
      return fail(appError('REQUIRED', '请描述要修改的内容', { recoveryAction: 'edit-input' }));
    }
    if (modifySessions.has(request.executionId)) {
      return fail(appError('INVALID_STATE', '相同的修改任务正在进行中', { recoveryAction: 'retry' }));
    }
    const session = new DesignSchemeModifySession(request, {
      db: getDesignSchemeDb(),
      resolveAdapter,
      emit: (payload: DesignSchemeCreationEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.DESIGN_SCHEME_EVENT, payload);
      },
    });
    modifySessions.set(request.executionId, session);
    try {
      return await session.run();
    } finally {
      modifySessions.delete(request.executionId);
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_MODIFY_CANCEL, (_event, executionId: string) => {
    modifySessions.get(executionId)?.cancel();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_PROMOTE_DRAFT, (
    _event,
    schemeId: string,
  ): AppResult<DesignSchemeSummary> => {
    try {
      const repository = new DesignSchemeRepository(getDesignSchemeDb());
      return ok(repository.promoteWorkingDraft(schemeId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新正式版本失败';
      return fail(appError('INVALID_STATE', message, { recoveryAction: 'retry' }));
    }
  });

  ipcMain.handle(IPC.DESIGN_SCHEME_CHECK_UPDATE, async (
    _event,
    schemeId: string,
  ): Promise<AppResult<DesignSchemeCheckUpdateResult>> => {
    if (typeof schemeId !== 'string' || !schemeId) {
      return fail(appError('REQUIRED', '检查更新请求无效', { recoveryAction: 'retry' }));
    }
    return checkSchemeUpdate(schemeId, { db: getDesignSchemeDb(), resolveAdapter });
  });

  // 发现页市场搜索（Explorer）：显式触发，候选写缓存，网络失败回退缓存。
  ipcMain.handle(IPC.DESIGN_SCHEME_MARKET_SEARCH, async (
    _event,
    query: string,
  ): Promise<AppResult<MarketSearchResult>> => {
    if (typeof query !== 'string') {
      return fail(appError('REQUIRED', '搜索请求无效', { recoveryAction: 'retry' }));
    }
    return searchMarketCandidates(query, { db: getDesignSchemeDb() });
  });

  // 导出 .musefold.design（设计规范 §7）：仅正式方案；显式路径供 e2e 使用。
  ipcMain.handle(IPC.DESIGN_SCHEME_EXPORT, async (
    event,
    schemeId: string,
    explicitTarget?: string,
  ): Promise<AppResult<DesignSchemeExportOutcome>> => {
    if (typeof schemeId !== 'string' || !schemeId) {
      return fail(appError('REQUIRED', '导出请求无效', { recoveryAction: 'retry' }));
    }
    let targetPath = explicitTarget?.trim();
    if (!targetPath) {
      const summary = new DesignSchemeRepository(getDesignSchemeDb())
        .listSummaries().find((item) => item.id === schemeId);
      const safeName = (summary?.name ?? 'design-scheme').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60);
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = await dialog.showSaveDialog(win as BrowserWindow, {
        title: '导出设计方案',
        defaultPath: join(app.getPath('downloads'), `${safeName}.musefold.design`),
        filters: [{ name: 'Musefold 设计方案', extensions: ['design'] }],
      });
      if (result.canceled || !result.filePath) return ok({ cancelled: true });
      targetPath = result.filePath;
    }
    const exported = await exportDesignScheme(schemeId, targetPath, { db: getDesignSchemeDb() });
    if (!exported.ok) return exported;
    return ok({
      cancelled: false,
      path: exported.data.path,
      fileName: exported.data.fileName,
      sizeBytes: exported.data.sizeBytes,
    });
  });

  // 导入 .musefold.design：校验后生成全新草稿；不覆盖现有方案。
  ipcMain.handle(IPC.DESIGN_SCHEME_IMPORT, async (
    event,
    explicitSource?: string,
  ): Promise<AppResult<DesignSchemeImportOutcome>> => {
    let sourcePath = typeof explicitSource === 'string' ? explicitSource.trim() : '';
    if (!sourcePath) {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = await dialog.showOpenDialog(win as BrowserWindow, {
        title: '导入设计方案',
        properties: ['openFile'],
        filters: [{ name: 'Musefold 设计方案', extensions: ['design'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return ok({ cancelled: true });
      sourcePath = result.filePaths[0];
    }
    const imported = await importDesignScheme(sourcePath, { db: getDesignSchemeDb() });
    if (!imported.ok) return imported;
    return ok({ cancelled: false, scheme: imported.data.scheme });
  });
}
