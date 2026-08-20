// electron/account/managed-provisioner.ts
// 账号托管双栈供给器（V05-ACC-03/04）：
// 同一设备 sk- 令牌写入生图 Provider + 文本 AI 连接；已有活动通道时只供给不抢占。

import { ulid } from 'ulid';
import { ACCOUNT_MANAGED_NAME } from '@musefold/domain/constants';
import { getDb } from '@musefold/core/db/index';
import { getAiConnectionStore } from '../ai/connection-store';
import { deleteApiKey, getKeySuffix, saveApiKey } from '../security/keychain';
import { deleteProviderPricing, setProviderPricing } from '../settings/pricing';
import type { ManagedProvisioner } from './account-service';

function relayV1Url(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/v1`;
}

function managedProviderId(existingId: string | null): string | null {
  const db = getDb();
  if (existingId) {
    const row = db.prepare(
      `SELECT id FROM providers WHERE id = ? AND managed_by = 'account'`,
    ).get(existingId) as { id: string } | undefined;
    if (row) return row.id;
  }
  const fallback = db.prepare(
    `SELECT id FROM providers WHERE managed_by = 'account' ORDER BY updated_at DESC LIMIT 1`,
  ).get() as { id: string } | undefined;
  return fallback?.id ?? null;
}

function upsertManagedProvider(
  existingId: string | null,
  input: { baseUrl: string; model: string; skKey: string },
): string {
  const db = getDb();
  const id = managedProviderId(existingId) ?? ulid();
  const exists = db.prepare('SELECT 1 FROM providers WHERE id = ?').get(id);
  const active = db.prepare('SELECT id FROM providers WHERE is_active = 1 LIMIT 1').get() as { id: string } | undefined;
  const shouldActivate = !active || active.id === id;
  const now = Date.now();

  db.transaction(() => {
    if (shouldActivate) db.prepare('UPDATE providers SET is_active = 0').run();
    if (exists) {
      db.prepare(
        `UPDATE providers
         SET name = ?, type = 'openai-compatible', base_url = ?, model = ?,
             has_key = 1, key_suffix = ?, is_active = ?, managed_by = 'account', updated_at = ?
         WHERE id = ?`,
      ).run(
        ACCOUNT_MANAGED_NAME,
        input.baseUrl,
        input.model,
        input.skKey.slice(-4),
        shouldActivate ? 1 : 0,
        now,
        id,
      );
    } else {
      db.prepare(
        `INSERT INTO providers
          (id, name, type, base_url, model, has_key, key_suffix, is_active, managed_by, created_at, updated_at)
         VALUES (?, ?, 'openai-compatible', ?, ?, 1, ?, ?, 'account', ?, ?)`,
      ).run(
        id,
        ACCOUNT_MANAGED_NAME,
        input.baseUrl,
        input.model,
        input.skKey.slice(-4),
        shouldActivate ? 1 : 0,
        now,
        now,
      );
    }
  })();

  try {
    saveApiKey(id, input.skKey);
    // 以 keychain 实际值为准同步后缀（safeStorage 正常时与 slice 一致）。
    db.prepare('UPDATE providers SET key_suffix = ? WHERE id = ?').run(getKeySuffix(id), id);
    return id;
  } catch (error) {
    db.prepare(`DELETE FROM providers WHERE id = ? AND managed_by = 'account'`).run(id);
    deleteApiKey(id);
    throw error;
  }
}

function removeManagedProvider(existingId: string | null): void {
  const db = getDb();
  let rows = existingId
    ? db.prepare(
      `SELECT id FROM providers WHERE id = ? AND managed_by = 'account'`,
    ).all(existingId) as Array<{ id: string }>
    : db.prepare(`SELECT id FROM providers WHERE managed_by = 'account'`).all() as Array<{ id: string }>;
  if (rows.length === 0 && existingId) {
    rows = db.prepare(`SELECT id FROM providers WHERE managed_by = 'account'`).all() as Array<{ id: string }>;
  }
  if (rows.length === 0) return;

  const ids = rows.map((row) => row.id);
  const wasActive = db.prepare(
    `SELECT 1 FROM providers WHERE is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`,
  ).get(...ids);
  db.prepare(
    `DELETE FROM providers WHERE managed_by = 'account' AND id IN (${ids.map(() => '?').join(',')})`,
  ).run(...ids);
  for (const id of ids) {
    deleteApiKey(id);
    deleteProviderPricing(id);
  }

  if (wasActive) {
    const replacement = db.prepare(
      `SELECT id FROM providers WHERE managed_by IS NULL ORDER BY updated_at DESC LIMIT 1`,
    ).get() as { id: string } | undefined;
    if (replacement) {
      db.prepare('UPDATE providers SET is_active = 1, updated_at = ? WHERE id = ?')
        .run(Date.now(), replacement.id);
    }
  }
}

export function createManagedProvisioner(): ManagedProvisioner {
  return {
    upsert(input) {
      const baseUrl = relayV1Url(input.serverUrl);
      let providerId: string | null = null;
      let connectionId: string | null = null;
      try {
        providerId = upsertManagedProvider(input.existing.providerId, {
          baseUrl,
          model: input.imageModel,
          skKey: input.skKey,
        });
        const connection = getAiConnectionStore().upsertManagedAccount(
          input.existing.connectionId,
          {
            name: ACCOUNT_MANAGED_NAME,
            baseUrl,
            model: input.textModel,
            apiKey: input.skKey,
          },
        );
        connectionId = connection.id;
        return { providerId, connectionId };
      } catch (error) {
        // 供给器自身保证不留下半配置；AccountService 仍有外层回滚作为第二道防线。
        if (providerId) removeManagedProvider(providerId);
        getAiConnectionStore().removeManagedAccount(connectionId ?? input.existing.connectionId);
        throw error;
      }
    },

    remove(targets) {
      removeManagedProvider(targets.providerId);
      getAiConnectionStore().removeManagedAccount(targets.connectionId);
    },

    applyImagePrice(providerId, pricePoints) {
      const row = getDb().prepare(
        `SELECT 1 FROM providers WHERE id = ? AND managed_by = 'account'`,
      ).get(providerId);
      if (!row) return;
      setProviderPricing({ providerId, mode: 'per-image', unitPoints: pricePoints });
    },
  };
}
