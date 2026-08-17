// ProviderService（V04-CORE-04）：Provider 只读面（v1 暴露矩阵：list 🟢 / models 🟢）。
// 红线（V04-SECURITY §8）：服务返回的 ProviderConfig 永不含明文 key——
// hasKey / keySuffix 均为非敏感展示字段；对外 HTTP/MCP 层再按级别裁剪。

import type Database from 'better-sqlite3';
import type { ProviderConfig } from '@shared/types/models';
import type { ImageProvider, ModelInfo } from '@shared/types/providers';
import { getDb } from '../db/index';
import { createProvider } from '../providers/registry';
import { notFound } from './errors';

/** 自 electron/main/ipc/providers.ts 原样迁入（单一真源，IPC 反向引用）。 */
export function rowToProvider(row: unknown): ProviderConfig {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    name: r.name as string,
    type: r.type as ProviderConfig['type'],
    baseUrl: r.base_url as string,
    model: r.model as string,
    hasKey: Boolean(r.has_key),
    keySuffix: (r.key_suffix as string) ?? null,
    isActive: Boolean(r.is_active),
    managedBy: r.managed_by === 'account' ? 'account' : null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export type ProviderFactory = (
  type: ProviderConfig['type'],
  id: string,
  baseUrl: string,
  model: string,
  name: string,
) => Pick<ImageProvider, 'listModels'>;

export interface ProviderService {
  list(): ProviderConfig[];
  get(id: string): ProviderConfig | null;
  /** 触发 Provider /models 网络请求（🟢 只读但 openWorld）。 */
  listModels(id: string): Promise<ModelInfo[]>;
}

export function createProviderService(
  db: () => Database.Database = getDb,
  providerFactory: ProviderFactory = createProvider,
): ProviderService {
  const load = (id: string) =>
    db().prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown> | undefined;

  return {
    list() {
      return db().prepare('SELECT * FROM providers ORDER BY created_at').all().map(rowToProvider);
    },
    get(id) {
      const row = load(id);
      return row ? rowToProvider(row) : null;
    },
    async listModels(id) {
      const row = load(id);
      if (!row) throw notFound('Provider', { providerId: id });
      const config = rowToProvider(row);
      const provider = providerFactory(config.type, config.id, config.baseUrl, config.model, config.name);
      return provider.listModels();
    },
  };
}
