// DesktopExtras 的 IPC 直通实现（V13-ENT-02 自 desktop-gateway.ts 抽出）。
// 该面是桌面独有数据面：library/aiConnection/provider/account/cloudSync/workbench 直通行模型，
// history 面经 mappers 转文档形状。DesktopGateway 继承本类以同时满足 domain 端口与 DesktopExtras。

import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import type { Api } from '@musefold/desktop-contracts/ipc';
import { historyRecordToDesktopGenerationEntry, relatedHistoryRowsToDocuments } from './mappers';

/** DesktopGateway 的 Extras 基类：持有 window.api 并直通 IPC。 */
export class DesktopExtrasImpl implements DesktopExtras {
  constructor(protected readonly api: Api) {}

  // ---------- DesktopExtras（桌面库面直通 IPC，不经 PromptDocument mapper） ----------

  listLibraryPrompts(
    q?: Parameters<DesktopExtras['listLibraryPrompts']>[0],
  ): ReturnType<DesktopExtras['listLibraryPrompts']> {
    return this.api.prompt.list(q);
  }

  getLibraryPrompt(id: string): ReturnType<DesktopExtras['getLibraryPrompt']> {
    return this.api.prompt.get(id);
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

  toggleLibraryPin(id: string, pinned: boolean): ReturnType<DesktopExtras['toggleLibraryPin']> {
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

  listSearchHistory(limit?: number): ReturnType<DesktopExtras['listSearchHistory']> {
    return this.api.searchHistory.list(limit);
  }

  addSearchHistory(term: string): ReturnType<DesktopExtras['addSearchHistory']> {
    return this.api.searchHistory.add(term);
  }

  clearSearchHistory(): ReturnType<DesktopExtras['clearSearchHistory']> {
    return this.api.searchHistory.clear();
  }

  listAiConnectionPresets(): ReturnType<DesktopExtras['listAiConnectionPresets']> {
    return this.api.aiConnection.listPresets();
  }

  listAiConnections(): ReturnType<DesktopExtras['listAiConnections']> {
    return this.api.aiConnection.list();
  }

  createAiConnection(
    input: Parameters<DesktopExtras['createAiConnection']>[0],
  ): ReturnType<DesktopExtras['createAiConnection']> {
    return this.api.aiConnection.create(input);
  }

  updateAiConnection(
    id: string,
    patch: Parameters<DesktopExtras['updateAiConnection']>[1],
  ): ReturnType<DesktopExtras['updateAiConnection']> {
    return this.api.aiConnection.update(id, patch);
  }

  deleteAiConnection(id: string): ReturnType<DesktopExtras['deleteAiConnection']> {
    return this.api.aiConnection.delete(id);
  }

  saveAiConnectionKey(
    id: string,
    apiKey: string,
  ): ReturnType<DesktopExtras['saveAiConnectionKey']> {
    return this.api.aiConnection.saveKey(id, apiKey);
  }

  deleteAiConnectionKey(id: string): ReturnType<DesktopExtras['deleteAiConnectionKey']> {
    return this.api.aiConnection.deleteKey(id);
  }

  hasAiConnectionKey(id: string): ReturnType<DesktopExtras['hasAiConnectionKey']> {
    return this.api.aiConnection.hasKey(id);
  }

  setActiveAiConnection(id: string): ReturnType<DesktopExtras['setActiveAiConnection']> {
    return this.api.aiConnection.setActive(id);
  }

  listAiConnectionModels(id: string): ReturnType<DesktopExtras['listAiConnectionModels']> {
    return this.api.aiConnection.listModels(id);
  }

  validateAiConnection(id: string): ReturnType<DesktopExtras['validateAiConnection']> {
    return this.api.aiConnection.validate(id);
  }

  listProviders(): ReturnType<DesktopExtras['listProviders']> {
    return this.api.provider.list();
  }

  createProvider(
    p: Parameters<DesktopExtras['createProvider']>[0],
  ): ReturnType<DesktopExtras['createProvider']> {
    return this.api.provider.create(p);
  }

  updateProvider(
    id: string,
    patch: Parameters<DesktopExtras['updateProvider']>[1],
  ): ReturnType<DesktopExtras['updateProvider']> {
    return this.api.provider.update(id, patch);
  }

  deleteProvider(id: string): ReturnType<DesktopExtras['deleteProvider']> {
    return this.api.provider.delete(id);
  }

  saveProviderKey(id: string, apiKey: string): ReturnType<DesktopExtras['saveProviderKey']> {
    return this.api.provider.saveKey(id, apiKey);
  }

  hasProviderKey(id: string): ReturnType<DesktopExtras['hasProviderKey']> {
    return this.api.provider.hasKey(id);
  }

  setActiveProvider(id: string): ReturnType<DesktopExtras['setActiveProvider']> {
    return this.api.provider.setActive(id);
  }

  validateProvider(id: string): ReturnType<DesktopExtras['validateProvider']> {
    return this.api.provider.validate(id);
  }

  listProviderModels(id: string): ReturnType<DesktopExtras['listProviderModels']> {
    return this.api.provider.listModels(id);
  }

  relatedHistory(
    q: Parameters<DesktopExtras['relatedHistory']>[0],
  ): ReturnType<DesktopExtras['relatedHistory']> {
    return this.api.history.related(q).then(relatedHistoryRowsToDocuments);
  }

  linkHistoryPrompt(
    req: Parameters<DesktopExtras['linkHistoryPrompt']>[0],
  ): ReturnType<DesktopExtras['linkHistoryPrompt']> {
    return this.api.history.linkPrompt(req);
  }

  listHistory(
    q?: Parameters<DesktopExtras['listHistory']>[0],
  ): ReturnType<DesktopExtras['listHistory']> {
    return this.api.history.list(q).then((rows) => rows.map(historyRecordToDesktopGenerationEntry));
  }

  getHistory(id: string): ReturnType<DesktopExtras['getHistory']> {
    return this.api.history
      .get(id)
      .then((row) => row && historyRecordToDesktopGenerationEntry(row));
  }

  historyStats(
    q: Parameters<DesktopExtras['historyStats']>[0],
  ): ReturnType<DesktopExtras['historyStats']> {
    return this.api.history.stats(q);
  }

  deleteHistory(
    req: Parameters<DesktopExtras['deleteHistory']>[0],
  ): ReturnType<DesktopExtras['deleteHistory']> {
    return this.api.history.delete(req);
  }

  clearHistory(
    req?: Parameters<DesktopExtras['clearHistory']>[0],
  ): ReturnType<DesktopExtras['clearHistory']> {
    return this.api.history.clear(req);
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

  cloudSyncSetEnabled(enabled: boolean): ReturnType<DesktopExtras['cloudSyncSetEnabled']> {
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

  // ---------- DesktopExtras workbench（桌面摘要 / runs / 原生进度无损直通） ----------

  listDesktopWorkbenchSessions(
    query?: Parameters<DesktopExtras['listDesktopWorkbenchSessions']>[0],
  ): ReturnType<DesktopExtras['listDesktopWorkbenchSessions']> {
    return this.api.workbenchSession.list(query);
  }

  getDesktopWorkbenchSession(id: string): ReturnType<DesktopExtras['getDesktopWorkbenchSession']> {
    return this.api.workbenchSession.get(id);
  }

  onImageGenerationProgress(
    cb: Parameters<DesktopExtras['onImageGenerationProgress']>[0],
  ): ReturnType<DesktopExtras['onImageGenerationProgress']> {
    return typeof this.api.image.onProgress === 'function'
      ? this.api.image.onProgress(cb)
      : () => undefined;
  }
}
