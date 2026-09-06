// v2.5 单通道 typed IPC 桥(V25-ARCHITECTURE §5):
// 渲染层 window.musefoldV25.invoke(method, payload) → 'musefold:invoke'。
// 每方法入参 zod 校验;返回结构化信封,业务错误不走异常序列化。
// 域方法表:settings/account 在本文件,数据域各自成文件(prompts-domain 等)。

import {
  type AppPreferences,
  appPreferencesPatchSchema,
  appPreferencesSchema,
  defaultAppPreferences,
  V25_METHODS_BY_DOMAIN,
} from '@musefold/contracts';
import { app, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { buildAccountDomainMethods } from './account-domain';
import type { BridgeEnvelope, MethodDef } from './envelope';
import { BridgeError } from './envelope';
import { buildDoubaoDomainMethods } from './doubao-domain';
import { buildPromptsDomainMethods } from './prompts-domain';
import { buildDesignSchemesDomainMethods } from './design-scheme-domain';
import { buildAgentConnectionsDomainMethods } from './agent-connections-domain';
import { buildAiProvidersDomainMethods } from './providers-domain';
import { buildSyncDomainMethods } from './sync-domain';
import { buildWorkbenchDomainMethods } from './workbench-domain';
import { isApplicationAdmissionOpen, trackApplicationRequest } from '../lifecycle-admission';

export type { BridgeEnvelope } from './envelope';

const V25_CHANNEL = 'musefold:invoke';
const PREFERENCES_FILE = 'v25-preferences.json';
const INTERNAL_ERROR_MESSAGE = '主进程处理失败';

export function assertMethodSet(
  label: string,
  expectedMethods: readonly string[],
  methods: Record<string, MethodDef>,
): void {
  const actual = Object.keys(methods).sort();
  const expected = [...expectedMethods].sort();
  if (
    actual.length !== expected.length ||
    actual.some((method, index) => method !== expected[index])
  ) {
    throw new Error(`IPC domain method set mismatch: ${label}`);
  }
}

export function assertDomainMethods(
  domain: keyof typeof V25_METHODS_BY_DOMAIN,
  methods: Record<string, MethodDef>,
): void {
  assertMethodSet(domain, V25_METHODS_BY_DOMAIN[domain], methods);
}

function preferencesPath(): string {
  return join(app.getPath('userData'), PREFERENCES_FILE);
}

export async function readV25Preferences(): Promise<AppPreferences> {
  try {
    const raw = await readFile(preferencesPath(), 'utf8');
    return appPreferencesSchema.parse(JSON.parse(raw));
  } catch {
    return defaultAppPreferences;
  }
}

async function writeV25Preferences(next: AppPreferences): Promise<void> {
  await writeFile(preferencesPath(), JSON.stringify(next, null, 2), 'utf8');
}

export function buildMethods(): Record<string, MethodDef> {
  const settings = {
    'settings.getPreferences': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => readV25Preferences(),
    },
    'settings.updatePreferences': {
      input: appPreferencesPatchSchema,
      handle: async (patch: unknown) => {
        const next = {
          ...(await readV25Preferences()),
          ...(patch as Partial<AppPreferences>),
        };
        await writeV25Preferences(next);
        return next;
      },
    },
  } satisfies Record<string, MethodDef>;
  assertDomainMethods('settings', settings);
  const account = buildAccountDomainMethods();
  const sync = buildSyncDomainMethods();
  const aiProviders = buildAiProvidersDomainMethods();
  const agentConnections = buildAgentConnectionsDomainMethods();
  const doubao = buildDoubaoDomainMethods();
  const designSchemes = buildDesignSchemesDomainMethods();
  const prompts = buildPromptsDomainMethods();
  const combinedWorkbench = buildWorkbenchDomainMethods();
  const workbench = Object.fromEntries(
    Object.entries(combinedWorkbench).filter(([method]) => method.startsWith('workbench.')),
  );
  const generation = Object.fromEntries(
    Object.entries(combinedWorkbench).filter(([method]) => method.startsWith('generation.')),
  );
  assertDomainMethods('account', account);
  assertDomainMethods('sync', sync);
  assertDomainMethods('aiProviders', aiProviders);
  assertDomainMethods('agentConnections', agentConnections);
  assertDomainMethods('doubao', doubao);
  assertDomainMethods('designSchemes', designSchemes);
  assertDomainMethods('prompts', prompts);
  assertDomainMethods('workbench', workbench);
  assertDomainMethods('generation', generation);

  return {
    ...settings,
    ...account,
    ...aiProviders,
    ...agentConnections,
    ...doubao,
    ...designSchemes,
    ...sync,
    ...prompts,
    ...workbench,
    ...generation,
  };
}

export function registerV25GatewayBridge(
  methods: Record<string, MethodDef> = buildMethods(),
): void {
  ipcMain.handle(
    V25_CHANNEL,
    async (event, method: unknown, payload: unknown): Promise<BridgeEnvelope<unknown>> => {
      try {
        if (!isApplicationAdmissionOpen()) {
          return {
            ok: false,
            code: 'APP_SHUTTING_DOWN',
            message: 'Musefold 正在退出，请稍后重试',
          };
        }
        if (typeof method !== 'string' || !Object.hasOwn(methods, method)) {
          return { ok: false, code: 'METHOD_NOT_FOUND', message: `未知方法:${String(method)}` };
        }
        const def = methods[method] as MethodDef;
        const parsed = def.input.safeParse(payload);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          return {
            ok: false,
            code: 'VALIDATION_FAILED',
            message: first ? `${first.path.join('.') || '?'}: ${first.message}` : '入参无效',
          };
        }
        const data = await trackApplicationRequest(() =>
          def.handle(parsed.data, { senderId: event.sender.id }),
        );
        return { ok: true, data };
      } catch (error) {
        if (error instanceof BridgeError) {
          return { ok: false, code: error.code, message: error.message };
        }
        return {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: INTERNAL_ERROR_MESSAGE,
        };
      }
    },
  );
}
