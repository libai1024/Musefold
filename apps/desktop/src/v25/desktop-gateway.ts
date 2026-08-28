// v2.5 桌面 gateway:MusefoldGateway 的 typed IPC 实现。
// 打样域(settings/account)走主进程单通道桥;数据域方法随 M4 各域垂直切换接入,
// 在此前调用会得到显式 NOT_IMPLEMENTED,而不是静默失败。

import {
  type AppPreferences,
  appPreferencesSchema,
  accountSummarySchema,
} from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import type { z } from 'zod';

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

function notImplemented(domain: string): never {
  throw new DesktopGatewayError('NOT_IMPLEMENTED', `${domain} 域尚未迁入 v2.5 桌面桥(M4)`);
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
      redeem: () => notImplemented('account.redeem'),
    },
    prompts: {
      list: () => notImplemented('prompts'),
      get: () => notImplemented('prompts'),
      create: () => notImplemented('prompts'),
      update: () => notImplemented('prompts'),
      remove: () => notImplemented('prompts'),
      restore: () => notImplemented('prompts'),
      use: () => notImplemented('prompts'),
      listFolders: () => notImplemented('prompts'),
      createFolder: () => notImplemented('prompts'),
      updateFolder: () => notImplemented('prompts'),
      removeFolder: () => notImplemented('prompts'),
      listTags: () => notImplemented('prompts'),
      createTag: () => notImplemented('prompts'),
      updateTag: () => notImplemented('prompts'),
      removeTag: () => notImplemented('prompts'),
    },
    workbench: {
      listSessions: () => notImplemented('workbench'),
      createSession: () => notImplemented('workbench'),
      getSession: () => notImplemented('workbench'),
      updateSession: () => notImplemented('workbench'),
      removeSession: () => notImplemented('workbench'),
      restoreSession: () => notImplemented('workbench'),
    },
    generation: {
      create: () => notImplemented('generation'),
      list: () => notImplemented('generation'),
      get: () => notImplemented('generation'),
      cancel: () => notImplemented('generation'),
      retry: () => notImplemented('generation'),
      remove: () => notImplemented('generation'),
      restore: () => notImplemented('generation'),
    },
  };
}
