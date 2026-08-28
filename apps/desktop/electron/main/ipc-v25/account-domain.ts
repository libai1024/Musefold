// v2.5 桌面账号域桥:账密委托云端 API(→ New API),bearer token 本机安全存储。
// token 密文(safeStorage)落 userData 文件;明文只在主进程内存,永不过渲染层。
// 云端不可达时统一转 ACCOUNT_SERVICE_UNAVAILABLE,渲染层可提示重试。

import {
  accountSummarySchema,
  loginRequestSchema,
  redeemRequestSchema,
  redeemResultSchema,
} from '@musefold/contracts';
import { app } from 'electron';
import { readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import { resolveSafeStorage } from '../../security/e2e-safe-storage';
import { createLogger } from '../../system/logger';
import { BridgeError, type MethodDef } from './envelope';

const logger = createLogger('ipc-v25:account');

const TOKEN_FILE = 'v25-account-session.json';
const tokenFileSchema = z.object({ encrypted: z.string().min(1) });

const DEFAULT_API_BASE = 'https://api.musefold.app';

export function apiBase(): string {
  return (process.env.MUSEFOLD_API_URL ?? DEFAULT_API_BASE).replace(/\/+$/, '');
}

function tokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILE);
}

/** 供 sync 域等主进程内其他 v25 桥读取当前登录凭据(明文不出主进程)。 */
export async function readSessionToken(): Promise<string | null> {
  try {
    const raw = tokenFileSchema.parse(JSON.parse(await readFile(tokenPath(), 'utf8')));
    return resolveSafeStorage().decryptString(Buffer.from(raw.encrypted, 'base64'));
  } catch {
    return null;
  }
}

async function writeSessionToken(token: string): Promise<void> {
  const storage = resolveSafeStorage();
  if (!storage.isEncryptionAvailable()) {
    throw new BridgeError('INTERNAL_ERROR', '系统安全存储不可用,无法保存登录状态');
  }
  const encrypted = storage.encryptString(token).toString('base64');
  await writeFile(tokenPath(), JSON.stringify({ encrypted }), 'utf8');
}

async function clearSessionToken(): Promise<void> {
  await unlink(tokenPath()).catch(() => undefined);
}

/** 从云端错误响应提取 code/message:兼容契约信封与 Better Auth 顶层形状。 */
async function extractError(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { code?: string; message?: string }; code?: string; message?: string }
    | undefined;
  const code = body?.error?.code ?? body?.code;
  const message = body?.error?.message ?? body?.message;
  return {
    code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
    message: typeof message === 'string' ? message : `云服务请求失败(HTTP ${response.status})`,
  };
}

async function cloudFetch(
  path: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown },
): Promise<Response> {
  try {
    return await fetch(`${apiBase()}${path}`, {
      method: init.method,
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    logger.warn('云服务不可达', { path, error: error instanceof Error ? error.message : error });
    throw new BridgeError('ACCOUNT_SERVICE_UNAVAILABLE', '无法连接 Musefold 云服务,请检查网络');
  }
}

export async function fetchAccountStatus(token: string) {
  return fetchStatus(token);
}

async function fetchStatus(token: string) {
  const response = await cloudFetch('/api/v1/account/status', { method: 'GET', token });
  if (response.status === 401) {
    await clearSessionToken();
    throw new BridgeError('AUTH_REQUIRED', '登录状态已失效,请重新登录');
  }
  if (!response.ok) {
    const { code, message } = await extractError(response);
    throw new BridgeError(code, message);
  }
  return accountSummarySchema.parse(await response.json());
}

/**
 * 账号身份变化(登录成功/登出)监听。sync 域据此停调度并关同步开关——
 * 登录 ≠ 同步,换账号后必须由用户重新显式开启。
 */
const accountChangedListeners: Array<() => void> = [];

export function onAccountChanged(listener: () => void): void {
  accountChangedListeners.push(listener);
}

function emitAccountChanged(): void {
  for (const listener of accountChangedListeners) {
    try {
      listener();
    } catch (error) {
      logger.warn('账号变化监听失败', error instanceof Error ? error.message : String(error));
    }
  }
}

const signInResponseSchema = z.looseObject({ token: z.string().min(1) });

async function signIn(
  endpoint: '/sign-in/new-api' | '/sign-up/new-api',
  input: { username: string; password: string },
) {
  const response = await cloudFetch(`/api/auth${endpoint}`, {
    method: 'POST',
    body: { email: input.username, password: input.password },
  });
  if (!response.ok) {
    const { code, message } = await extractError(response);
    throw new BridgeError(code, message);
  }
  const session = signInResponseSchema.parse(await response.json());
  await writeSessionToken(session.token);
  const status = await fetchStatus(session.token);
  emitAccountChanged();
  return status;
}

export function buildAccountDomainMethods(): Record<string, MethodDef> {
  return {
    'account.getStatus': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const token = await readSessionToken();
        if (!token) throw new BridgeError('AUTH_REQUIRED', '桌面端尚未登录');
        return fetchStatus(token);
      },
    },
    'account.login': {
      input: loginRequestSchema,
      handle: (input) => signIn('/sign-in/new-api', input as z.infer<typeof loginRequestSchema>),
    },
    'account.register': {
      input: loginRequestSchema,
      handle: (input) => signIn('/sign-up/new-api', input as z.infer<typeof loginRequestSchema>),
    },
    'account.logout': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const token = await readSessionToken();
        if (token) {
          // 云端会话失效尽力而为;本地凭据必须删除。
          await cloudFetch('/api/auth/sign-out', { method: 'POST', token, body: {} }).catch(
            () => undefined,
          );
        }
        await clearSessionToken();
        emitAccountChanged();
        return null;
      },
    },
    'account.redeem': {
      input: redeemRequestSchema,
      handle: async (input) => {
        const token = await readSessionToken();
        if (!token) throw new BridgeError('AUTH_REQUIRED', '桌面端尚未登录');
        const { code } = input as z.infer<typeof redeemRequestSchema>;
        const response = await cloudFetch('/api/v1/account/redeem', {
          method: 'POST',
          token,
          body: { code },
        });
        if (response.status === 401) {
          await clearSessionToken();
          throw new BridgeError('AUTH_REQUIRED', '登录状态已失效,请重新登录');
        }
        if (!response.ok) {
          const { code: errorCode, message } = await extractError(response);
          throw new BridgeError(errorCode, message);
        }
        return redeemResultSchema.parse(await response.json());
      },
    },
  };
}
