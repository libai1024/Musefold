// v2.5 桌面 AI 连接(生图 Provider)域桥:SQLite providers 表 + keychain 密钥。
// 密钥经 security/keychain(safeStorage)存取,渲染层只见 hasKey / keySuffix;
// 表列 has_key / key_suffix 同步维护(core 旧读者仍在),事实源是 keychain。

import type { AiProvider, AiProviderTestResult } from '@musefold/contracts';
import {
  aiProviderTestResultSchema,
  createAiProviderSchema,
  entityIdSchema,
  updateAiProviderSchema,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import { ulid } from 'ulid';
import { z } from 'zod';
import { validateDoubaoWebSession } from '../../doubao-web/browser-service';
import {
  deleteApiKey,
  getKeySuffix,
  hasApiKey,
  loadApiKey,
  saveApiKey,
} from '../../security/keychain';
import { BridgeError, type MethodDef } from './envelope';

interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  model: string;
  is_active: number;
  managed_by: string | null;
  created_at: number;
  updated_at: number;
}

function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '+00:00');
}

function toAiProvider(row: ProviderRow): AiProvider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    model: row.model,
    hasKey: hasApiKey(row.id),
    keySuffix: getKeySuffix(row.id),
    isActive: row.is_active === 1,
    managedBy: row.managed_by === 'account' ? ('account' as const) : null,
    createdAt: epochMsToIso(row.created_at),
    updatedAt: epochMsToIso(row.updated_at),
  };
}

function requireRow(id: string): ProviderRow {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as
    | ProviderRow
    | undefined;
  if (!row) throw new BridgeError('NOT_FOUND', 'AI 连接不存在');
  return row;
}

/** 写入密钥并同步展示列;失败(如系统安全存储不可用)转业务错误。 */
function persistKey(id: string, apiKey: string): void {
  try {
    saveApiKey(id, apiKey);
  } catch (error) {
    throw new BridgeError(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : '密钥保存失败',
    );
  }
  getDb()
    .prepare('UPDATE providers SET has_key = 1, key_suffix = ? WHERE id = ?')
    .run(getKeySuffix(id), id);
}

function removeKey(id: string): void {
  deleteApiKey(id);
  getDb().prepare('UPDATE providers SET has_key = 0, key_suffix = NULL WHERE id = ?').run(id);
}

function setActiveRow(id: string): void {
  const db = getDb();
  db.transaction((targetId: string) => {
    db.prepare('UPDATE providers SET is_active = 0 WHERE is_active = 1').run();
    const activated = db.prepare('UPDATE providers SET is_active = 1 WHERE id = ?').run(targetId);
    if (activated.changes !== 1) throw new BridgeError('NOT_FOUND', 'AI 连接不存在');
  })(id);
}

function removeProviderRow(id: string): ProviderRow {
  const db = getDb();
  return db.transaction((targetId: string) => {
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(targetId) as
      | ProviderRow
      | undefined;
    if (!row) throw new BridgeError('NOT_FOUND', 'AI 连接不存在');

    const next =
      row.is_active === 1
        ? (db
            .prepare('SELECT id FROM providers WHERE id <> ? ORDER BY updated_at DESC LIMIT 1')
            .get(targetId) as { id: string } | undefined)
        : undefined;
    const removed = db.prepare('DELETE FROM providers WHERE id = ?').run(targetId);
    if (removed.changes !== 1) throw new BridgeError('NOT_FOUND', 'AI 连接不存在');
    if (next) {
      const activated = db.prepare('UPDATE providers SET is_active = 1 WHERE id = ?').run(next.id);
      if (activated.changes !== 1) throw new BridgeError('INTERNAL_ERROR', 'AI 连接接管失败');
    }
    return row;
  })(id);
}

const updatePayloadSchema = z.object({ id: entityIdSchema, patch: updateAiProviderSchema });

const TEST_TIMEOUT_MS = 8_000;

/**
 * 「测试连接」探测(§7.2):GET {baseUrl}/models 带 bearer。
 * openai-compatible 网关的标准轻量端点,不产生任何生成费用。
 */
export async function probeProvider(
  baseUrl: string,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<AiProviderTestResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`;
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) return { ok: true, message: '连接正常', latencyMs };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'API Key 无效或无权限', latencyMs };
    }
    return { ok: false, message: `服务返回 HTTP ${response.status}`, latencyMs };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      message: timedOut ? '连接超时,请检查 Base URL 与网络' : '无法连接到服务,请检查 Base URL',
      latencyMs: null,
    };
  }
}

export function buildAiProvidersDomainMethods(): Record<string, MethodDef> {
  return {
    'aiProviders.list': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const rows = getDb()
          .prepare('SELECT * FROM providers ORDER BY is_active DESC, updated_at DESC')
          .all() as ProviderRow[];
        return rows.map(toAiProvider);
      },
    },
    'aiProviders.create': {
      input: createAiProviderSchema,
      handle: async (payload) => {
        const input = payload as z.infer<typeof createAiProviderSchema>;
        const db = getDb();
        const id = ulid();
        const now = Date.now();
        db.prepare(
          `INSERT INTO providers (id, name, type, base_url, model, has_key, key_suffix, is_active, created_at, updated_at)
           VALUES (?, ?, 'openai-compatible', ?, ?, 0, NULL, 0, ?, ?)`,
        ).run(id, input.name, input.baseUrl, input.model, now, now);
        if (input.apiKey) persistKey(id, input.apiKey);
        const hasActive = db
          .prepare('SELECT COUNT(*) AS count FROM providers WHERE is_active = 1')
          .get() as { count: number };
        if (input.activate || hasActive.count === 0) setActiveRow(id);
        return toAiProvider(requireRow(id));
      },
    },
    'aiProviders.update': {
      input: updatePayloadSchema,
      handle: async (payload) => {
        const { id, patch } = payload as z.infer<typeof updatePayloadSchema>;
        requireRow(id);
        const db = getDb();
        const sets: string[] = [];
        const values: unknown[] = [];
        if (patch.name !== undefined) {
          sets.push('name = ?');
          values.push(patch.name);
        }
        if (patch.baseUrl !== undefined) {
          sets.push('base_url = ?');
          values.push(patch.baseUrl);
        }
        if (patch.model !== undefined) {
          sets.push('model = ?');
          values.push(patch.model);
        }
        sets.push('updated_at = ?');
        values.push(Date.now());
        db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
        if (typeof patch.apiKey === 'string') persistKey(id, patch.apiKey);
        else if (patch.apiKey === null) removeKey(id);
        return toAiProvider(requireRow(id));
      },
    },
    'aiProviders.remove': {
      input: z.object({ id: entityIdSchema }),
      handle: async (payload) => {
        const { id } = payload as { id: string };
        removeProviderRow(id);
        deleteApiKey(id);
        return null;
      },
    },
    'aiProviders.setActive': {
      input: z.object({ id: entityIdSchema }),
      handle: async (payload) => {
        const { id } = payload as { id: string };
        requireRow(id);
        setActiveRow(id);
        return toAiProvider(requireRow(id));
      },
    },
    'aiProviders.test': {
      input: z.object({ id: entityIdSchema }),
      handle: async (payload) => {
        const { id } = payload as { id: string };
        const row = requireRow(id);
        // doubao-web 存量行没有 openai-compatible /models 端点,通用探测只会误报;
        // 改用冻结面的会话校验(带登录态与当日用量的人话结果),密钥探测不适用。
        if (row.type === 'doubao-web') {
          const result = await validateDoubaoWebSession();
          return aiProviderTestResultSchema.parse({
            ok: result.ok,
            message: result.message,
            latencyMs: null,
          });
        }
        return probeProvider(row.base_url, loadApiKey(id));
      },
    },
  };
}
