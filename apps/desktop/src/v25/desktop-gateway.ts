// v2.5 桌面 gateway:MusefoldGateway 的 typed IPC 实现。
// 全部数据域走主进程单通道桥(musefold:invoke),每方法出参 zod 复核。

import {
  type AppPreferences,
  accountSummarySchema,
  aiProviderSchema,
  aiProviderTestResultSchema,
  appPreferencesSchema,
  cancelDesignSchemeResultSchema,
  checkDesignSchemeUpdateResultSchema,
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
  importDesignSchemeResultSchema,
  marketSearchResultSchema,
  modifyDesignSchemeResultSchema,
  renameDesignSchemeResultSchema,
  removeDesignSchemeResultSchema,
  selectCoverResultSchema,
  updateDesignSchemeResultSchema,
  desktopSyncStatusSchema,
  doubaoAccountStatusSchema,
  generationHistoryPageSchema,
  generationReferenceImageSchema,
  redeemResultSchema,
  generationJobSchema,
  promptDocumentSchema,
  promptFolderSchema,
  promptPageSchema,
  promptTagSchema,
  promptUseResultSchema,
  providerOptionSchema,
  saveAssetResultSchema,
  syncConflictListSchema,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
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
      getStatus: () => invoke('account.getStatus', undefined, accountSummarySchema),
      login: (input) => invoke('account.login', input, accountSummarySchema),
      register: (input) => invoke('account.register', input, accountSummarySchema),
      logout: () => invoke('account.logout', undefined, voidSchema),
      redeem: (code) => invoke('account.redeem', { code }, redeemResultSchema),
    },
    sync: {
      getStatus: () => invoke('sync.getStatus', undefined, desktopSyncStatusSchema),
      setConsent: (consent) => invoke('sync.setConsent', { consent }, desktopSyncStatusSchema),
      listConflicts: () => invoke('sync.listConflicts', undefined, syncConflictListSchema),
      resolveConflict: (conflictId, resolution) =>
        invoke('sync.resolveConflict', { conflictId, resolution }, desktopSyncStatusSchema),
      setEnabled: (enabled) => invoke('sync.setEnabled', { enabled }, desktopSyncStatusSchema),
      syncNow: () => invoke('sync.syncNow', undefined, desktopSyncStatusSchema),
    },
    aiProviders: {
      list: () => invoke('aiProviders.list', undefined, aiProviderListSchema),
      create: (input) => invoke('aiProviders.create', input, aiProviderSchema),
      update: (id, patch) => invoke('aiProviders.update', { id, patch }, aiProviderSchema),
      remove: (id) => invoke('aiProviders.remove', { id }, voidSchema),
      setActive: (id) => invoke('aiProviders.setActive', { id }, aiProviderSchema),
      test: (id) => invoke('aiProviders.test', { id }, aiProviderTestResultSchema),
    },
    // 豆包网页登录:单通道桥直达冻结 browser-service;QR 以 data URL 随状态快照返回。
    doubao: {
      getStatus: () => invoke('doubao.getStatus', undefined, doubaoAccountStatusSchema),
      startLogin: () => invoke('doubao.startLogin', undefined, doubaoAccountStatusSchema),
      refreshLogin: () => invoke('doubao.refreshLogin', undefined, doubaoAccountStatusSchema),
      logout: () => invoke('doubao.logout', undefined, doubaoAccountStatusSchema),
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
    },
    generation: {
      create: (input, _idempotencyKey) => invoke('generation.create', input, generationJobSchema),
      list: (query) => invoke('generation.list', query, generationHistoryPageSchema),
      get: (id) => invoke('generation.get', id, generationJobSchema),
      cancel: (id) => invoke('generation.cancel', id, generationJobSchema),
      retry: (id, _idempotencyKey) => invoke('generation.retry', id, generationJobSchema),
      remove: (id) => invoke('generation.remove', id, generationJobSchema),
      restore: (id) => invoke('generation.restore', id, generationJobSchema),
      purge: (id) => invoke('generation.purge', id, voidSchema),
      listProviders: () => invoke('generation.listProviders', undefined, providerOptionListSchema),
      // Uint8Array 经 ipcRenderer.invoke 结构化克隆原样到主进程,由主进程嗅探魔数落 staging。
      uploadReferenceImage: (input) =>
        invoke('generation.uploadReferenceImage', input, generationReferenceImageSchema),
      // 主进程解 media:// 路径 + 系统保存对话框;取消返回 'cancelled'。
      saveAsset: (input) => invoke('generation.saveAsset', input, saveAssetResultSchema),
    },
  };
}
