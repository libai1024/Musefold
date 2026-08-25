// musefold serve（V04-SRV-01）：headless 守护 —— 无 GUI 拥有三库与控制面。
//
// 与桌面 App 经 owner.lock 互斥（单写者 C2）；密钥走环境变量注入
// （MUSEFOLD_PROVIDER_KEY_<ID>，V04-SECURITY §4.2 优先级 2，CI 标准姿势）；
// 花钱动作无人值守一律拒绝确认——只有预算或 CLI 交互同意能放行。
// v0.4 headless 能力面：全部只读端点 + 生图闭环（方案/Skill 运行需桌面 App）。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { candidateDataDirs } from '@musefold/client';
import {
  acquireOwnerLock,
  createAutomationServer,
  createGenerationGate,
  createV1ReadRoutes,
  type GenerationHost,
} from '@musefold/automation-server';
import { createEventHub, createMusefoldCore } from '@musefold/core';
import { configureCoreRuntime, type CorePaths } from '@musefold/core/runtime';
import { closeDb, getDb, initDb } from '@musefold/core/db/index';
import { closeDesignSchemeDb, initDesignSchemeDb } from '@musefold/core/db/design-scheme';
import { stageLocalImageBytes, isManagedUploadPath } from '@musefold/core/providers/local-image';
import {
  BACKUPS_DIR_NAME,
  DB_NAME,
  LOGS_DIR_NAME,
  PICTURES_DIR_NAME,
  PREVIEWS_DIR_NAME,
  STORE_NAME,
} from '@musefold/core/constants';
import packageInfo from '../package.json';

export interface ServeOptions {
  dataDir?: string;
  port?: number;
  log?: (line: string) => void;
}

function resolveDataDir(explicit?: string): string {
  if (explicit) return explicit;
  const candidates = candidateDataDirs();
  return candidates.find((dir) => existsSync(join(dir, DB_NAME))) ?? candidates[0];
}

function headlessPaths(dataDir: string): CorePaths {
  return {
    userData: dataDir,
    db: join(dataDir, DB_NAME),
    backups: join(dataDir, BACKUPS_DIR_NAME),
    previews: join(dataDir, PREVIEWS_DIR_NAME),
    pictures: process.env.MUSEFOLD_E2E === '1'
      ? join(dataDir, 'Pictures')
      : join(homedir(), 'Pictures', PICTURES_DIR_NAME),
    logs: join(dataDir, LOGS_DIR_NAME),
  };
}

/** 密钥：环境变量注入（进程内存态、不落盘）。ID 中非字母数字折叠为下划线。 */
function envKeyName(providerId: string): string {
  return `MUSEFOLD_PROVIDER_KEY_${providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
}

interface ProvidersStoreShape {
  automation?: { budget?: {
    monthlyLimitPoints?: number;
    usedPoints?: number;
    monthlyLimitCents?: number;
    usedCents?: number;
    month?: string;
  } };
}

/** 直接读写 electron-store 的 JSON 文件（守护持有 owner.lock，App 必然未运行）。 */
function providersStorePath(dataDir: string): string {
  return join(dataDir, `${STORE_NAME}.json`);
}

function readProvidersStore(dataDir: string): ProvidersStoreShape {
  try {
    return JSON.parse(readFileSync(providersStorePath(dataDir), 'utf8')) as ProvidersStoreShape;
  } catch {
    return {};
  }
}

export async function startHeadlessServe(options: ServeOptions = {}): Promise<{
  port: number;
  token: string;
  dataDir: string;
  stop: () => Promise<void>;
}> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  log('[serve] 注意：headless 模式不读取 Musefold 桌面账号会话；仅支持通过 MUSEFOLD_PROVIDER_KEY_* 注入凭据的本地 Provider。');
  log('[serve] 使用 Musefold 账号时请退出 serve，CLI/MCP 会自动拉起桌面 App。');
  const dataDir = resolveDataDir(options.dataDir);

  const lock = acquireOwnerLock(dataDir, 'headless-daemon');
  if (!lock.acquired) {
    const holder = lock.holder;
    throw Object.assign(
      new Error(
        holder
          ? `数据目录已被 ${holder.owner === 'desktop-app' ? 'Musefold 桌面应用' : '另一个守护进程'}（pid ${holder.pid}）持有`
          : '数据目录所有权获取失败',
      ),
      { code: 'OWNER_LOCK_HELD' },
    );
  }

  const paths = headlessPaths(dataDir);
  configureCoreRuntime({
    getPaths: () => paths,
    loadApiKey: (providerId) => process.env[envKeyName(providerId)] ?? null,
    createLogger: (scope) => ({
      debug: () => {},
      info: (...args: unknown[]) => log(`[${scope}] ${args.map(String).join(' ')}`),
      warn: (...args: unknown[]) => log(`[${scope}] WARN ${args.map(String).join(' ')}`),
      error: (...args: unknown[]) => log(`[${scope}] ERROR ${args.map(String).join(' ')}`),
    }),
    estimateProviderCost: () => null,
  });

  initDb();
  initDesignSchemeDb();

  const hub = createEventHub();
  const core = createMusefoldCore({
    paths: { dataDir, picturesDir: paths.pictures, logsDir: paths.logs },
    secrets: {
      getProviderKey: async (providerId) => process.env[envKeyName(providerId)] ?? null,
      setProviderKey: async () => {
        throw new Error('headless 守护不支持写入密钥（请用环境变量注入）');
      },
      deleteProviderKey: async () => undefined,
      getAiConnectionKey: async () => null,
      setAiConnectionKey: async () => undefined,
      deleteAiConnectionKey: async () => undefined,
    },
    events: hub.sink,
    logger: {
      debug: () => {},
      info: (...args: unknown[]) => log(`[core] ${args.map(String).join(' ')}`),
      warn: (...args: unknown[]) => log(`[core] WARN ${args.map(String).join(' ')}`),
      error: (...args: unknown[]) => log(`[core] ERROR ${args.map(String).join(' ')}`),
    },
  });

  const budget = () => {
    const stored = readProvidersStore(dataDir).automation?.budget;
    const month = new Date().toISOString().slice(0, 7);
    const monthlyLimitPoints = stored?.monthlyLimitPoints ?? ((stored?.monthlyLimitCents ?? 0) / 10);
    const usedPoints = stored?.usedPoints ?? ((stored?.usedCents ?? 0) / 10);
    if (!stored || stored.month !== month) return { monthlyLimitPoints, usedPoints: 0, month };
    return { monthlyLimitPoints, usedPoints, month };
  };
  const settleBudget = (actualPoints: number) => {
    if (actualPoints <= 0) return;
    const store = readProvidersStore(dataDir);
    const current = budget();
    const next = { ...current, usedPoints: current.usedPoints + actualPoints };
    writeFileSync(providersStorePath(dataDir), JSON.stringify({ ...store, automation: { ...store.automation, budget: next } }, null, 2));
  };

  const host: GenerationHost = {
    run: (req, onProgress) => core.generation.generate(req, onProgress),
    cancel: (jobId) => core.generation.cancel(jobId),
    estimate(body) {
      const db = getDb();
      const row = (body.providerId
        ? db.prepare('SELECT * FROM providers WHERE id = ?').get(body.providerId)
        : db.prepare('SELECT * FROM providers WHERE is_active = 1 LIMIT 1').get()) as Record<string, unknown> | undefined;
      if (!row) {
        throw Object.assign(new Error('没有激活的图像 Provider'), { code: 'INVALID_STATE', details: {} });
      }
      const n = body.n ?? 1;
      return {
        points: null,
        managedByAccount: false,
        providerId: row.id as string,
        providerName: row.name as string,
        model: body.model ?? (row.model as string),
        n,
      };
    },
    budget: {
      remainingPoints: () => Math.max(0, budget().monthlyLimitPoints - budget().usedPoints),
      settle: settleBudget,
    },
    // 无人值守：确认一律拒绝（T9）；只有预算/交互同意可放行
    requestConfirmation: async () => 'denied',
    authorizeReferencePath: (path) => isManagedUploadPath(path),
    stageUpload: (bytes, name, mimeType) =>
      stageLocalImageBytes({ bytes, name, mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp' }),
    resolveHistoryImage(historyId) {
      const row = getDb().prepare('SELECT image_path FROM history WHERE id = ?').get(historyId) as
        | { image_path: string | null }
        | undefined;
      return row?.image_path ? { path: row.image_path } : null;
    },
  };

  const gate = createGenerationGate(host, hub);
  const server = createAutomationServer({
    core,
    events: hub,
    dataDir,
    owner: 'headless-daemon',
    appVersion: packageInfo.version,
    port: options.port ?? 0,
    routes: { ...createV1ReadRoutes(core), ...gate.routes },
  });
  const info = await server.start();
  log(`[serve] Musefold headless 守护就绪 · 127.0.0.1:${info.port} · data=${dataDir}`);

  return {
    port: info.port,
    token: info.token,
    dataDir,
    stop: async () => {
      await server.stop();
      closeDb();
      closeDesignSchemeDb();
      lock.release?.();
    },
  };
}
