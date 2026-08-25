// 主进程唯一的 core 实例（V04-CORE-02）。
// application.ts 在 whenReady 时初始化；后续任务卡（CORE-03/04、API-01）
// 经 getMusefoldCore() 取用服务面与事件集线器，禁止自行 createMusefoldCore。

import { createEventHub, createMusefoldCore, type EventHub, type MusefoldCore } from '@musefold/core';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { createLogger } from '../system/logger';
import { getPaths } from '../system/paths';
import { getDb, initDb } from '@musefold/core/db/index';
import { loadApiKey, sweepOrphanedProviderKeys } from '../security/keychain';
import { estimateProviderCost, sweepUnmanagedProviderPricing } from '../settings/pricing';
import { electronPathsPort, electronSecretsPort } from './core-adapters';
import { doubaoWebRuntime } from '../doubao-web/browser-service';

let core: MusefoldCore | null = null;
let hub: EventHub | null = null;

export function initMusefoldCore(): MusefoldCore {
  if (core) return core;
  // 搬进 core 的 db/providers 经运行时接缝取宿主能力（V04-CORE-03）：
  // 直接注入既有 Electron 实现，行为与搬移前完全一致。
  configureCoreRuntime({
    getPaths,
    loadApiKey,
    createLogger,
    estimateProviderCost,
    doubaoWeb: doubaoWebRuntime,
  });
  initDb();
  hub = createEventHub();
  core = createMusefoldCore({
    paths: electronPathsPort(),
    secrets: electronSecretsPort(),
    events: hub.sink,
    logger: createLogger('core'),
  });
  // 清掉旧版本遗留的非托管价格与已删除 Provider 密文（幂等，失败不阻断启动）。
  try {
    sweepUnmanagedProviderPricing();
    const rows = getDb().prepare('SELECT id FROM providers').all() as Array<{ id: string }>;
    sweepOrphanedProviderKeys(new Set(rows.map((row) => row.id)));
  } catch (error) {
    createLogger('core').warn('provider cleanup failed', error);
  }
  return core;
}

export function getMusefoldCore(): MusefoldCore {
  if (!core) throw new Error('Musefold core 尚未初始化（application.ts whenReady 之前不可用）');
  return core;
}

/** 控制面 SSE（V04-API-02）与渲染层推送共用的事件出口。 */
export function getCoreEventHub(): EventHub {
  if (!hub) throw new Error('Musefold core 尚未初始化');
  return hub;
}

export function disposeMusefoldCore(): void {
  core?.dispose();
  core = null;
  hub = null;
}
