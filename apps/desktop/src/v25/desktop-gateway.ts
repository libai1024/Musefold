import { releaseReferenceImageInputSchema } from '@musefold/contracts';
import { purgeDesignSchemeResultSchema } from '@musefold/contracts';
// v2.5 桌面 gateway:MusefoldGateway 的 typed IPC 实现。
// 全部数据域走主进程单通道桥(musefold:invoke),每方法出参 zod 复核。

import {
  accountCloudStatusSchema,
  retryGenerationCommandSchema,
  accountCloudRecoveryListSchema,
  accountCloudLegacyListSchema,
  accountCloudRecoveryItemSchema,
  type AppPreferences,
  accountExecutionBindingSchema,
  accountModelCatalogSchema,
  accountRecoveryReviewSchema,
  accountSummarySchema,
  accountNoticesSchema,
  loginReleaseStatusSchema,
  agentConnectionListSchema,
  agentConnectionSchema,
  agentConnectionTestResultSchema,
  aiProviderModelListSchema,
  aiProviderSchema,
  aiProviderTestResultSchema,
  appInfoSchema,
  appPreferencesSchema,
  automationConfirmationEventSchema,
  automationIntegrationGuideSchema,
  automationRequestLogSchema,
  automationSpendAuditListSchema,
  automationStatusSchema,
  backupListSchema,
  cancelDesignSchemeResultSchema,
  clearAllDataResultSchema,
  createBackupResultSchema,
  diagnosticLogSchema,
  restoreBackupResultSchema,
  storageLocationListSchema,
  checkDesignSchemeUpdateResultSchema,
  confirmDesignSchemeInstallResultSchema,
  createDesignSchemeResultSchema,
  designSchemeDetailSchema,
  designSchemeEventSchema,
  designSchemePageSchema,
  designSchemeRunResultSchema,
  DESIGN_SCHEME_WIRE_METHODS,
  exportDesignSchemeResultSchema,
  formalizeDesignSchemeResultSchema,
  promoteWorkingDraftResultSchema,
  prepareDesignSchemeImportPackageResultSchema,
  prepareDesignSchemeRunResultSchema,
  importDesignSchemeResultSchema,
  marketSearchResultSchema,
  modifyDesignSchemeResultSchema,
  renameDesignSchemeResultSchema,
  removeDesignSchemeResultSchema,
  selectCoverResultSchema,
  updateDesignSchemeResultSchema,
  desktopSyncStatusSchema,
  localWorkspaceRecoveryStatusSchema,
  localWorkspacePreviewSchema,
  doubaoAccountStatusSchema,
  generationCleanupResultSchema,
  generationHistoryPageSchema,
  generationReferenceImageSchema,
  generationStorageUsageSchema,
  redeemResultSchema,
  generationJobSchema,
  promptDocumentSchema,
  promptEmptyTrashResultSchema,
  promptFolderSchema,
  promptPageSchema,
  promptTagSchema,
  promptUseResultSchema,
  providerOptionSchema,
  resolveAutomationConfirmationResultSchema,
  saveAssetResultSchema,
  syncConflictListSchema,
  usageSummarySchema,
  cloudMcpAuthorizationListSchema,
  cloudMcpRevokeResultSchema,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
  workbenchSessionCleanupResultSchema,
} from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { z } from 'zod';

interface BridgeEnvelope {
  ok: boolean;
  data?: unknown;
  code?: string;
  message?: string;
}

type ParsedBridgeEnvelope =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string };

declare global {
  interface Window {
    musefoldV25?: {
      invoke(method: string, payload?: unknown): Promise<unknown>;
      prepareDesignSchemeImportPackage?(payload: unknown): Promise<unknown>;
      onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
      onDesignSchemeEvent(callback: (payload: unknown) => void): () => void;
      onAutomationEvent?(callback: (payload: unknown) => void): () => void;
      isFullscreen(): Promise<boolean>;
      /** 窗口生命周期 chrome(Win/Linux 自绘控件);与数据域 invoke 通道分离。 */
      minimize(): void;
      maximizeToggle(): void;
      close(): void;
      isMaximized(): Promise<boolean>;
      onMaximizeChange(callback: (isMaximized: boolean) => void): () => void;
    };
  }
}

const DESIGN_SCHEME_ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Renderer-visible scheme media URLs contain only canonical opaque ids; main resolves storage. */
export function resolveDesktopDesignSchemeAssetUrl(assetId: string): string | null {
  return DESIGN_SCHEME_ASSET_ID_PATTERN.test(assetId)
    ? `media://scheme-asset/${encodeURIComponent(assetId)}`
    : null;
}

export class DesktopGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopGatewayError';
  }
}

const promptFolderListSchema = z.array(promptFolderSchema);
const promptTagListSchema = z.array(promptTagSchema);
const providerOptionListSchema = z.array(providerOptionSchema);
const aiProviderListSchema = z.array(aiProviderSchema);
const MALFORMED_ENVELOPE_CODE = 'MALFORMED_ENVELOPE';
const MALFORMED_ENVELOPE_MESSAGE = '桌面桥返回格式无效';
const voidSchema = z.unknown().transform(() => undefined);

function malformedEnvelope(): DesktopGatewayError {
  return new DesktopGatewayError(MALFORMED_ENVELOPE_CODE, MALFORMED_ENVELOPE_MESSAGE);
}

function parseBridgeEnvelope(value: unknown): ParsedBridgeEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw malformedEnvelope();
  }
  const envelope = value as BridgeEnvelope;
  if (!Object.hasOwn(envelope, 'ok') || typeof envelope.ok !== 'boolean') {
    throw malformedEnvelope();
  }
  if (envelope.ok) {
    if (!Object.hasOwn(envelope, 'data')) throw malformedEnvelope();
    return { ok: true, data: envelope.data };
  }
  if (
    !Object.hasOwn(envelope, 'code') ||
    typeof envelope.code !== 'string' ||
    !Object.hasOwn(envelope, 'message') ||
    typeof envelope.message !== 'string'
  ) {
    throw malformedEnvelope();
  }
  return { ok: false, code: envelope.code, message: envelope.message };
}

function subscribeDesignSchemeEvents(
  listener: Parameters<NonNullable<MusefoldGateway['designSchemes']>['subscribeEvents']>[0],
): () => void {
  const bridge = window.musefoldV25;
  if (!bridge) {
    throw new DesktopGatewayError('BRIDGE_MISSING', 'v2.5 preload 桥未注入');
  }
  if (!bridge.onDesignSchemeEvent) {
    throw new DesktopGatewayError('DESIGN_SCHEME_UNAVAILABLE', '设计方案事件暂不可用');
  }
  return bridge.onDesignSchemeEvent((payload) => {
    const parsed = designSchemeEventSchema.safeParse(payload);
    if (parsed.success) listener(parsed.data);
  });
}

/**
 * 花钱确认事件订阅:preload 把主进程两条广播归并成带 type 的单流,
 * 解析失败的载荷静默丢弃(与设计方案事件同口径,坏事件不炸壳)。
 */
function subscribeAutomationConfirmations(
  listener: Parameters<NonNullable<MusefoldGateway['automation']>['subscribeConfirmations']>[0],
): () => void {
  const bridge = window.musefoldV25;
  if (!bridge) {
    throw new DesktopGatewayError('BRIDGE_MISSING', 'v2.5 preload 桥未注入');
  }
  if (!bridge.onAutomationEvent) {
    throw new DesktopGatewayError('AUTOMATION_UNAVAILABLE', '开放能力事件暂不可用');
  }
  return bridge.onAutomationEvent((payload) => {
    const parsed = automationConfirmationEventSchema.safeParse(payload);
    if (parsed.success) listener(parsed.data);
  });
}

const designSchemesGateway: NonNullable<MusefoldGateway['designSchemes']> = {
  list: (query) => invoke(DESIGN_SCHEME_WIRE_METHODS.list, query, designSchemePageSchema),
  get: (id, revision = { kind: 'current' }) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.get, { id, revision }, designSchemeDetailSchema),
  searchMarket: (query) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.searchMarket, query, marketSearchResultSchema),
  create: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.create, input, createDesignSchemeResultSchema),
  update: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.update, input, updateDesignSchemeResultSchema),
  modify: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.modify, input, modifyDesignSchemeResultSchema),
  cancel: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.cancel, input, cancelDesignSchemeResultSchema),
  confirmInstall: (input) =>
    invoke(
      DESIGN_SCHEME_WIRE_METHODS.confirmInstall,
      input,
      confirmDesignSchemeInstallResultSchema,
    ),
  selectCover: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.selectCover, input, selectCoverResultSchema),
  formalize: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.formalize, input, formalizeDesignSchemeResultSchema),
  promoteWorkingDraft: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.promoteWorkingDraft, input, promoteWorkingDraftResultSchema),
  rename: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.rename, input, renameDesignSchemeResultSchema),
  remove: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.remove, input, removeDesignSchemeResultSchema),
  purge: (input) => invoke(DESIGN_SCHEME_WIRE_METHODS.purge, input, purgeDesignSchemeResultSchema),
  checkUpdate: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.checkUpdate, input, checkDesignSchemeUpdateResultSchema),
  prepareImportPackage: async (input) => {
    const bridge = window.musefoldV25;
    if (!bridge) throw new DesktopGatewayError('BRIDGE_MISSING', 'v2.5 preload 桥未注入');
    if (!bridge.prepareDesignSchemeImportPackage) {
      throw new DesktopGatewayError(
        'DESIGN_SCHEME_PACKAGE_HOST_UNAVAILABLE',
        '设计方案文件选择暂不可用',
      );
    }
    const envelope = parseBridgeEnvelope(await bridge.prepareDesignSchemeImportPackage(input));
    if (!envelope.ok) throw new DesktopGatewayError(envelope.code, envelope.message);
    return prepareDesignSchemeImportPackageResultSchema.parse(envelope.data);
  },
  importPackage: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.importPackage, input, importDesignSchemeResultSchema),
  exportPackage: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.exportPackage, input, exportDesignSchemeResultSchema),
  prepareRun: (input) =>
    invoke(DESIGN_SCHEME_WIRE_METHODS.prepareRun, input, prepareDesignSchemeRunResultSchema),
  run: (input) => invoke(DESIGN_SCHEME_WIRE_METHODS.run, input, designSchemeRunResultSchema),
  subscribeEvents: subscribeDesignSchemeEvents,
};

async function invoke<S extends z.ZodType>(
  method: string,
  payload: unknown,
  response: S,
): Promise<z.output<S>> {
  const bridge = window.musefoldV25;
  if (!bridge) {
    throw new DesktopGatewayError('BRIDGE_MISSING', 'v2.5 preload 桥未注入');
  }
  const envelope = parseBridgeEnvelope(await bridge.invoke(method, payload));
  if (!envelope.ok) {
    throw new DesktopGatewayError(envelope.code, envelope.message);
  }
  return response.parse(envelope.data);
}

export function createDesktopGateway(): MusefoldGateway {
  return {
    settings: {
      getPreferences: () =>
        invoke(
          'settings.getPreferences',
          undefined,
          appPreferencesSchema,
        ) as Promise<AppPreferences>,
      updatePreferences: (patch) =>
        invoke('settings.updatePreferences', patch, appPreferencesSchema),
    },
    account: {
      listLoginSessions: () =>
        invoke('account.listLoginSessions', undefined, loginSessionPageSchema),
      getLoginCapacityReview: (input) =>
        invoke('account.getLoginCapacityReview', input, loginCapacityReviewSchema),
      completeLoginCapacity: (input) =>
        invoke('account.completeLoginCapacity', input, accountSummarySchema),
      cancelLoginCapacity: (input) => invoke('account.cancelLoginCapacity', input, voidSchema),
      revokeLoginSessions: (input) =>
        invoke('account.revokeLoginSessions', input, revokeLoginSessionsResultSchema),
      touchLoginSession: () => invoke('account.touchLoginSession', undefined, voidSchema),
      getLoginReleaseStatus: () =>
        invoke('account.getLoginReleaseStatus', undefined, loginReleaseStatusSchema),
      getStatus: () => invoke('account.getStatus', undefined, accountSummarySchema),
      login: (input) => invoke('account.login', input, accountSummarySchema),
      register: (input) => invoke('account.register', input, accountSummarySchema),
      logout: () => invoke('account.logout', undefined, voidSchema),
      redeem: (code) => invoke('account.redeem', { code }, redeemResultSchema),
      retryRecovery: (input) => invoke('account.retryRecovery', input, accountSummarySchema),
      inspectRecovery: (input) =>
        invoke('account.inspectRecovery', input, accountRecoveryReviewSchema),
      verifyOriginalSession: (input) =>
        invoke('account.verifyOriginalSession', input, accountSummarySchema),
      createIndependentWorkspace: (input) =>
        invoke('account.createIndependentWorkspace', input, accountSummarySchema),
      getExecutionBinding: () =>
        invoke('account.getExecutionBinding', undefined, accountExecutionBindingSchema),
      getModelCatalog: () =>
        invoke('account.getModelCatalog', undefined, accountModelCatalogSchema),
      getNotices: () => invoke('account.getNotices', undefined, accountNoticesSchema),
    },
    sync: {
      getStatus: () => invoke('sync.getStatus', undefined, desktopSyncStatusSchema),
      listLocalWorkspaces: () =>
        invoke('sync.listLocalWorkspaces', undefined, localWorkspaceRecoveryStatusSchema),
      previewLocalWorkspace: (input) =>
        invoke('sync.previewLocalWorkspace', input, localWorkspacePreviewSchema),
      prepareLocalWorkspace: (input) =>
        invoke('sync.prepareLocalWorkspace', input, desktopSyncStatusSchema),
      setConsent: (consent, reviewRef) =>
        invoke(
          'sync.setConsent',
          { consent, ...(reviewRef === undefined ? {} : { reviewRef }) },
          desktopSyncStatusSchema,
        ),
      listConflicts: () => invoke('sync.listConflicts', undefined, syncConflictListSchema),
      resolveConflict: (conflictId, resolution) =>
        invoke('sync.resolveConflict', { conflictId, resolution }, desktopSyncStatusSchema),
      setEnabled: (enabled, reviewRef) =>
        invoke(
          'sync.setEnabled',
          { enabled, ...(reviewRef === undefined ? {} : { reviewRef }) },
          desktopSyncStatusSchema,
        ),
      syncNow: () => invoke('sync.syncNow', undefined, desktopSyncStatusSchema),
    },
    accountCloud: {
      getStatus: () => invoke('accountCloud.getStatus', undefined, accountCloudStatusSchema),
      connect: (input) => invoke('accountCloud.connect', input, accountCloudStatusSchema),
      resume: (input) => invoke('accountCloud.resume', input, accountCloudStatusSchema),
      listRecovery: (input) =>
        invoke('accountCloud.listRecovery', input, accountCloudRecoveryListSchema),
      listLegacy: (input) => invoke('accountCloud.listLegacy', input, accountCloudLegacyListSchema),
      reconcile: (input) => invoke('accountCloud.reconcile', input, accountCloudRecoveryItemSchema),
      cancel: (input) => invoke('accountCloud.cancel', input, accountCloudRecoveryItemSchema),
    },
    aiProviders: {
      list: () => invoke('aiProviders.list', undefined, aiProviderListSchema),
      create: (input) => invoke('aiProviders.create', input, aiProviderSchema),
      update: (id, patch) => invoke('aiProviders.update', { id, patch }, aiProviderSchema),
      remove: (id) => invoke('aiProviders.remove', { id }, voidSchema),
      setActive: (id) => invoke('aiProviders.setActive', { id }, aiProviderSchema),
      test: (input) => invoke('aiProviders.test', input, aiProviderTestResultSchema),
      listModels: (input) => invoke('aiProviders.listModels', input, aiProviderModelListSchema),
    },
    // Agent 文本模型连接:与生图连接同形状,走独立方法名与独立事实源(主进程 AiConnectionStore)。
    agentConnections: {
      list: () => invoke('agentConnections.list', undefined, agentConnectionListSchema),
      create: (input) => invoke('agentConnections.create', input, agentConnectionSchema),
      update: (id, patch) =>
        invoke('agentConnections.update', { id, patch }, agentConnectionSchema),
      remove: (id) => invoke('agentConnections.remove', { id }, voidSchema),
      setActive: (id) => invoke('agentConnections.setActive', { id }, agentConnectionSchema),
      test: (input) => invoke('agentConnections.test', input, agentConnectionTestResultSchema),
      listModels: (input) =>
        invoke('agentConnections.listModels', input, aiProviderModelListSchema),
    },
    // 豆包网页登录:单通道桥直达冻结 browser-service;QR 以 data URL 随状态快照返回。
    doubao: {
      getStatus: () => invoke('doubao.getStatus', undefined, doubaoAccountStatusSchema),
      startLogin: () => invoke('doubao.startLogin', undefined, doubaoAccountStatusSchema),
      refreshLogin: () => invoke('doubao.refreshLogin', undefined, doubaoAccountStatusSchema),
      logout: () => invoke('doubao.logout', undefined, doubaoAccountStatusSchema),
    },
    // 本机数据面:备份按文件名寻址、存储位置按白名单 id 打开;出参一律过 path-free 契约。
    system: {
      getAppInfo: () => invoke('system.getAppInfo', undefined, appInfoSchema),
      listBackups: () => invoke('system.listBackups', undefined, backupListSchema),
      createBackup: () => invoke('system.createBackup', undefined, createBackupResultSchema),
      restoreBackup: (input) => invoke('system.restoreBackup', input, restoreBackupResultSchema),
      listStorageLocations: () =>
        invoke('system.listStorageLocations', undefined, storageLocationListSchema),
      openStorageLocation: (input) => invoke('system.openStorageLocation', input, voidSchema),
      readDiagnosticLog: () => invoke('system.readDiagnosticLog', undefined, diagnosticLogSchema),
      clearAllData: (input) => invoke('system.clearAllData', input, clearAllDataResultSchema),
      openExternal: (input) => invoke('system.openExternal', input, voidSchema),
      openProductDocs: () => invoke('system.openProductDocs', undefined, voidSchema),
      relaunch: () => invoke('system.relaunch', undefined, voidSchema),
    },
    // 开放能力控制面:状态出参只有掩码令牌;copyToken 由主进程写系统剪贴板,
    // 渲染层没有任何取回明文 bearer 的路径。
    automation: {
      getStatus: () => invoke('automation.getStatus', undefined, automationStatusSchema),
      setEnabled: (input) => invoke('automation.setEnabled', input, automationStatusSchema),
      rotateToken: () => invoke('automation.rotateToken', undefined, automationStatusSchema),
      copyToken: () => invoke('automation.copyToken', undefined, voidSchema),
      setMonthlyBudget: (input) =>
        invoke('automation.setMonthlyBudget', input, automationStatusSchema),
      listRequestLog: (query) =>
        invoke('automation.listRequestLog', query, automationRequestLogSchema),
      listSpendAudit: (query) =>
        invoke('automation.listSpendAudit', query, automationSpendAuditListSchema),
      resolveConfirmation: (input) =>
        invoke('automation.resolveConfirmation', input, resolveAutomationConfirmationResultSchema),
      getIntegrationGuide: () =>
        invoke('automation.getIntegrationGuide', undefined, automationIntegrationGuideSchema),
      subscribeConfirmations: subscribeAutomationConfirmations,
    },
    designSchemes: designSchemesGateway,
    prompts: {
      list: (query) => invoke('prompts.list', query, promptPageSchema),
      get: (id) => invoke('prompts.get', { id }, promptDocumentSchema),
      create: (input) => invoke('prompts.create', input, promptDocumentSchema),
      update: (id, patch) => invoke('prompts.update', { id, patch }, promptDocumentSchema),
      remove: (id) => invoke('prompts.remove', { id }, promptDocumentSchema),
      restore: (id) => invoke('prompts.restore', { id }, promptDocumentSchema),
      purge: (id) => invoke('prompts.purge', { id }, voidSchema),
      emptyTrash: () => invoke('prompts.emptyTrash', undefined, promptEmptyTrashResultSchema),
      use: (id, input) => invoke('prompts.use', { id, input }, promptUseResultSchema),
      listFolders: () => invoke('prompts.listFolders', undefined, promptFolderListSchema),
      createFolder: (input) => invoke('prompts.createFolder', input, promptFolderSchema),
      updateFolder: (id, patch) =>
        invoke('prompts.updateFolder', { id, patch }, promptFolderSchema),
      removeFolder: (id) => invoke('prompts.removeFolder', { id }, promptFolderSchema),
      listTags: () => invoke('prompts.listTags', undefined, promptTagListSchema),
      createTag: (input) => invoke('prompts.createTag', input, promptTagSchema),
      updateTag: (id, patch) => invoke('prompts.updateTag', { id, patch }, promptTagSchema),
      removeTag: (id) => invoke('prompts.removeTag', { id }, promptTagSchema),
    },
    workbench: {
      listSessions: (query) => invoke('workbench.listSessions', query, workbenchSessionPageSchema),
      createSession: (input) => invoke('workbench.createSession', input, workbenchSessionSchema),
      getSession: (id) => invoke('workbench.getSession', id, workbenchSessionSchema),
      updateSession: (id, patch) =>
        invoke('workbench.updateSession', { id, patch }, workbenchSessionSchema),
      removeSession: (id) => invoke('workbench.removeSession', id, workbenchSessionSchema),
      restoreSession: (id) => invoke('workbench.restoreSession', id, workbenchSessionSchema),
      purgeSession: (id) =>
        invoke('workbench.purgeSession', id, workbenchSessionCleanupResultSchema),
      emptyTrash: () =>
        invoke('workbench.emptyTrash', undefined, workbenchSessionCleanupResultSchema),
    },
    generation: {
      create: (input, _idempotencyKey) => invoke('generation.create', input, generationJobSchema),
      list: (query) => invoke('generation.list', query, generationHistoryPageSchema),
      get: (id) => invoke('generation.get', id, generationJobSchema),
      cancel: (id) => invoke('generation.cancel', id, generationJobSchema),
      retry: (id, idempotencyKey, input) =>
        invoke(
          'generation.retry',
          retryGenerationCommandSchema.parse({ id, idempotencyKey, ...input }),
          generationJobSchema,
        ),
      remove: (id) => invoke('generation.remove', id, generationJobSchema),
      restore: (id) => invoke('generation.restore', id, generationJobSchema),
      purge: (id) => invoke('generation.purge', id, voidSchema),
      listProviders: () => invoke('generation.listProviders', undefined, providerOptionListSchema),
      // Uint8Array 经 ipcRenderer.invoke 结构化克隆原样到主进程,由主进程嗅探魔数落 staging。
      uploadReferenceImage: (input) =>
        invoke('generation.uploadReferenceImage', input, generationReferenceImageSchema),
      // 主进程解 media:// 路径 + 系统保存对话框;取消返回 'cancelled'。
      releaseReferenceImage: (input) =>
        invoke(
          'generation.releaseReferenceImage',
          releaseReferenceImageInputSchema.parse(input),
          voidSchema,
        ),
      saveAsset: (input) => invoke('generation.saveAsset', input, saveAssetResultSchema),
      cleanup: (input) => invoke('generation.cleanup', input, generationCleanupResultSchema),
      getStorageUsage: () =>
        invoke('generation.getStorageUsage', undefined, generationStorageUsageSchema),
      // 只送资产 id:受管路径解析与越界拒绝都在主进程,渲染层不持有任何路径。
      revealAsset: (assetId) => invoke('generation.revealAsset', assetId, voidSchema),
      copyAssetToClipboard: (assetId) =>
        invoke('generation.copyAssetToClipboard', assetId, voidSchema),
    },
    usage: {
      summary: (query) => invoke('usage.summary', query, usageSummarySchema),
    },
    cloudMcp: {
      listAuthorizations: () =>
        invoke('cloudMcp.listAuthorizations', undefined, cloudMcpAuthorizationListSchema),
      revokeAuthorization: (input) =>
        invoke('cloudMcp.revokeAuthorization', input, cloudMcpRevokeResultSchema),
    },
  };
}
import {
  loginCapacityReviewSchema,
  loginSessionPageSchema,
  revokeLoginSessionsResultSchema,
} from '@musefold/contracts';
