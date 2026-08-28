// v2.5 桌面 gateway:MusefoldGateway 的 typed IPC 实现。
// 全部数据域走主进程单通道桥(musefold:invoke),每方法出参 zod 复核。

import {
  type AppPreferences,
  accountSummarySchema,
  aiProviderSchema,
  appPreferencesSchema,
  desktopSyncStatusSchema,
  generationHistoryPageSchema,
  redeemResultSchema,
  generationJobSchema,
  promptDocumentSchema,
  promptFolderSchema,
  promptPageSchema,
  promptTagSchema,
  promptUseResultSchema,
  providerOptionSchema,
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

declare global {
  interface Window {
    musefoldV25?: {
      invoke(method: string, payload?: unknown): Promise<unknown>;
    };
  }
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
const voidSchema = z.unknown().transform(() => undefined);

async function invoke<S extends z.ZodType>(
  method: string,
  payload: unknown,
  response: S,
): Promise<z.output<S>> {
  const bridge = window.musefoldV25;
  if (!bridge) {
    throw new DesktopGatewayError('BRIDGE_MISSING', 'v2.5 preload 桥未注入');
  }
  const envelope = (await bridge.invoke(method, payload)) as BridgeEnvelope;
  if (!envelope.ok) {
    throw new DesktopGatewayError(
      envelope.code ?? 'INTERNAL_ERROR',
      envelope.message ?? '调用失败',
    );
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
      setEnabled: (enabled) => invoke('sync.setEnabled', { enabled }, desktopSyncStatusSchema),
      syncNow: () => invoke('sync.syncNow', undefined, desktopSyncStatusSchema),
    },
    aiProviders: {
      list: () => invoke('aiProviders.list', undefined, aiProviderListSchema),
      create: (input) => invoke('aiProviders.create', input, aiProviderSchema),
      update: (id, patch) => invoke('aiProviders.update', { id, patch }, aiProviderSchema),
      remove: (id) => invoke('aiProviders.remove', { id }, voidSchema),
      setActive: (id) => invoke('aiProviders.setActive', { id }, aiProviderSchema),
    },
    prompts: {
      list: (query) => invoke('prompts.list', query, promptPageSchema),
      get: (id) => invoke('prompts.get', { id }, promptDocumentSchema),
      create: (input) => invoke('prompts.create', input, promptDocumentSchema),
      update: (id, patch) => invoke('prompts.update', { id, patch }, promptDocumentSchema),
      remove: (id) => invoke('prompts.remove', { id }, promptDocumentSchema),
      restore: (id) => invoke('prompts.restore', { id }, promptDocumentSchema),
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
      create: (input) => invoke('generation.create', input, generationJobSchema),
      list: (query) => invoke('generation.list', query, generationHistoryPageSchema),
      get: (id) => invoke('generation.get', id, generationJobSchema),
      cancel: (id) => invoke('generation.cancel', id, generationJobSchema),
      retry: (id) => invoke('generation.retry', id, generationJobSchema),
      remove: (id) => invoke('generation.remove', id, generationJobSchema),
      restore: (id) => invoke('generation.restore', id, generationJobSchema),
      listProviders: () => invoke('generation.listProviders', undefined, providerOptionListSchema),
    },
  };
}
