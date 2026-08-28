// v2.5 单通道 typed IPC 桥(V25-ARCHITECTURE §5):
// 渲染层 window.musefoldV25.invoke(method, payload) → 'musefold:invoke'。
// 每方法入参 zod 校验;返回结构化信封,业务错误不走异常序列化。
// 域方法表:settings/account 在本文件,数据域各自成文件(prompts-domain 等)。

import {
  type AppPreferences,
  appPreferencesPatchSchema,
  appPreferencesSchema,
  defaultAppPreferences,
} from '@musefold/contracts';
import { app, ipcMain } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { BridgeError, type BridgeEnvelope, type MethodDef } from './envelope';
import { buildPromptsDomainMethods } from './prompts-domain';

export type { BridgeEnvelope } from './envelope';

const V25_CHANNEL = 'musefold:invoke';
const PREFERENCES_FILE = 'v25-preferences.json';

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

function buildMethods(): Record<string, MethodDef> {
  return {
    'settings.getPreferences': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => readV25Preferences(),
    },
    'settings.updatePreferences': {
      input: appPreferencesPatchSchema,
      handle: async (patch) => {
        const next = {
          ...(await readV25Preferences()),
          ...(patch as Partial<AppPreferences>),
        };
        await writeV25Preferences(next);
        return next;
      },
    },
    // 桌面账号会话随 M4d 账号域接入;打样阶段固定未登录,features 按此渲染。
    'account.getStatus': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        throw new BridgeError('AUTH_REQUIRED', '桌面端尚未登录');
      },
    },
    ...buildPromptsDomainMethods(),
  };
}

export function registerV25GatewayBridge(): void {
  const methods = buildMethods();

  ipcMain.handle(
    V25_CHANNEL,
    async (_event, method: unknown, payload: unknown): Promise<BridgeEnvelope<unknown>> => {
      try {
        if (typeof method !== 'string' || !(method in methods)) {
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
        return { ok: true, data: await def.handle(parsed.data) };
      } catch (error) {
        if (error instanceof BridgeError) {
          return { ok: false, code: error.code, message: error.message };
        }
        return {
          ok: false,
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : '主进程处理失败',
        };
      }
    },
  );
}
