// electron/main/ipc/providers.ts
// Provider IPC handler —— 详见 docs/07-ipc-contracts.md §3.5
// 密钥约定：永不返回明文 key，只返回 hasKey + keySuffix

import { BrowserWindow, ipcMain } from 'electron';
import { ulid } from 'ulid';
import { IPC } from '@shared/types/ipc';
import type { ProviderConfig, NewProviderConfig } from '@shared/types/models';
import { getDb } from '@musefold/core/db/index';
import { saveApiKey, deleteApiKey, hasApiKey, getKeySuffix } from '../../security/keychain';
import { deleteProviderPricing } from '../../settings/pricing';
import { createProvider } from '@musefold/core/providers/registry';
// 行映射真源在 core 服务面（V04-CORE-04）
import { rowToProvider } from '@musefold/core/services/providers';
import { createLogger } from '../../system/logger';
import { AccountError } from '../../account/errors';
import {
  getDoubaoWebAccountStatus,
  logoutDoubaoWeb,
  openDoubaoWebLogin,
  refreshDoubaoWebLogin,
  setDoubaoDeveloperWindowVisible,
  startDoubaoWebLogin,
  subscribeDoubaoWebLogin,
} from '../../doubao-web/browser-service';

const logger = createLogger('provider');

function requireProviderRow(id: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error('Provider 不存在');
  return row;
}

function assertManagedProviderWriteAllowed(
  id: string,
  operation: 'update' | 'delete' | 'key',
): void {
  const row = requireProviderRow(id);
  if (row.managed_by !== 'account') return;
  throw new AccountError(
    'ACCOUNT/MANAGED_READONLY',
    operation === 'delete'
      ? '此配置由账号管理，退出登录后会自动移除'
      : operation === 'key'
        ? '账号托管令牌不能手动修改'
        : '账号生图模型由 Musefold 固定管理',
  );
}

export function registerProviderHandlers(): void {
  ipcMain.handle(IPC.PROVIDER_LIST, () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM providers ORDER BY created_at').all();
    return rows.map(rowToProvider);
  });

  ipcMain.handle(IPC.PROVIDER_CREATE, (_e, p: NewProviderConfig) => {
    const db = getDb();
    const id = ulid();
    const now = Date.now();
    if (p.isActive) {
      db.prepare('UPDATE providers SET is_active = 0').run();
    }
    db.prepare(
      'INSERT INTO providers (id, name, type, base_url, model, has_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)'
    ).run(id, p.name, p.type, p.baseUrl, p.model, p.isActive ? 1 : 0, now, now);
    return rowToProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown>);
  });

  ipcMain.handle(IPC.PROVIDER_UPDATE, (_e, id: string, patch: Partial<NewProviderConfig>) => {
    assertManagedProviderWriteAllowed(id, 'update');
    const db = getDb();
    const now = Date.now();
    if (patch.name !== undefined) db.prepare('UPDATE providers SET name = ?, updated_at = ? WHERE id = ?').run(patch.name, now, id);
    if (patch.baseUrl !== undefined) db.prepare('UPDATE providers SET base_url = ?, updated_at = ? WHERE id = ?').run(patch.baseUrl, now, id);
    if (patch.model !== undefined) db.prepare('UPDATE providers SET model = ?, updated_at = ? WHERE id = ?').run(patch.model, now, id);
    return rowToProvider(db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown>);
  });

  ipcMain.handle(IPC.PROVIDER_DELETE, (_e, id: string) => {
    assertManagedProviderWriteAllowed(id, 'delete');
    const db = getDb();
    db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    deleteApiKey(id);
    deleteProviderPricing(id);
    return { ok: true as const };
  });

  ipcMain.handle(IPC.PROVIDER_SAVE_KEY, (_e, id: string, apiKey: string) => {
    assertManagedProviderWriteAllowed(id, 'key');
    if (requireProviderRow(id).type === 'doubao-web') {
      throw new Error('豆包网页版使用独立浏览器会话，不接收 API Key');
    }
    saveApiKey(id, apiKey);
    const suffix = getKeySuffix(id);
    const db = getDb();
    db.prepare('UPDATE providers SET has_key = 1, key_suffix = ?, updated_at = ? WHERE id = ?').run(suffix, Date.now(), id);
    return { ok: true as const };
  });

  ipcMain.handle(IPC.PROVIDER_HAS_KEY, (_e, id: string) => {
    const row = getDb().prepare('SELECT type, has_key, key_suffix FROM providers WHERE id = ?').get(id) as
      | { type: string; has_key: number; key_suffix: string | null }
      | undefined;
    if (row?.type === 'doubao-web') {
      return { hasKey: Boolean(row.has_key), suffix: row.key_suffix };
    }
    const has = hasApiKey(id);
    const suffix = has ? getKeySuffix(id) : null;
    return { hasKey: has, suffix };
  });

  ipcMain.handle(IPC.PROVIDER_OPEN_WEB_LOGIN, () => openDoubaoWebLogin());
  ipcMain.handle(IPC.PROVIDER_WEB_LOGIN_START, () => startDoubaoWebLogin());
  ipcMain.handle(IPC.PROVIDER_WEB_LOGIN_REFRESH, () => refreshDoubaoWebLogin());
  ipcMain.handle(IPC.PROVIDER_WEB_LOGOUT, async () => {
    const result = await logoutDoubaoWeb();
    const db = getDb();
    db.prepare("UPDATE providers SET has_key = 0, key_suffix = NULL, updated_at = ? WHERE type = 'doubao-web'").run(Date.now());
    return result;
  });
  ipcMain.handle(IPC.PROVIDER_WEB_LOGIN_STATE, () => getDoubaoWebAccountStatus());
  ipcMain.handle(IPC.PROVIDER_WEB_DEVELOPER_VISIBLE, async (_event, visible: boolean) => {
    await setDoubaoDeveloperWindowVisible(Boolean(visible));
    return { ok: true as const };
  });
  ipcMain.handle(IPC.PROVIDER_WEB_USAGE, async () => (await getDoubaoWebAccountStatus()).usage);
  ipcMain.handle(IPC.PROVIDER_WEB_STATUS, () => getDoubaoWebAccountStatus());

  ipcMain.handle(IPC.PROVIDER_VALIDATE, async (_e, id: string) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { ok: false, message: 'Provider 不存在' };
    const isDoubaoWeb = row.type === 'doubao-web';
    if (!isDoubaoWeb && !hasApiKey(id)) return { ok: false, message: '尚未保存 API Key' };
    try {
      const provider = createProvider(
        row.type as ProviderConfig['type'],
        row.id as string,
        row.base_url as string,
        row.model as string,
        row.name as string
      );
      logger.info('测试连接', `provider=${row.name}(${row.type})`);
      const result = await provider.validateConnection();
      if (isDoubaoWeb) {
        const shouldClearSessionState = result.code === 'AUTH';
        if (result.ok || shouldClearSessionState) {
          db.prepare('UPDATE providers SET has_key = ?, key_suffix = ?, updated_at = ? WHERE id = ?')
            .run(result.ok ? 1 : 0, result.ok ? '网页会话' : null, Date.now(), id);
        }
      }
      logger.info('测试连接结果', `ok=${result.ok}`, result.message);
      return result;
    } catch (err) {
      logger.error('测试连接异常', `provider=${row.name}`, (err as Error).message);
      return { ok: false, message: (err as Error).message || '连接失败' };
    }
  });

  ipcMain.handle(IPC.PROVIDER_LIST_MODELS, async (_e, id: string) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error('Provider 不存在');
    const provider = createProvider(
      row.type as ProviderConfig['type'],
      row.id as string,
      row.base_url as string,
      row.model as string,
      row.name as string,
    );
    return provider.listModels();
  });

  ipcMain.handle(IPC.PROVIDER_SET_ACTIVE, (_e, id: string) => {
    const db = getDb();
    db.transaction(() => {
      db.prepare('UPDATE providers SET is_active = 0').run();
      db.prepare('UPDATE providers SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
    })();
    return { ok: true as const };
  });

  subscribeDoubaoWebLogin((status) => {
    const db = getDb();
    db.prepare("UPDATE providers SET has_key = ?, key_suffix = ?, updated_at = ? WHERE type = 'doubao-web'")
      .run(status.loggedIn ? 1 : 0, status.loggedIn ? '网页会话' : null, Date.now());
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.PROVIDER_WEB_LOGIN_CHANGED, status);
    }
  });
}
