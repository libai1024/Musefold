// 本地专属通道的 Electron 管理操作（V04-SECURITY §4.3）。
// 与 IPC handlers 使用同一批底层原语（db SQL / keychain / system 模块）。

import { ulid } from 'ulid';
import type { LocalAdminOps } from '@musefold/automation-server';
import { getDb } from '@musefold/core/db/index';
import { createProvider } from '@musefold/core/providers/registry';
import { promptsRepo } from '@musefold/core/db/repositories/prompts';
import { rowToProvider } from '@musefold/core/services/providers';
import type { ProviderConfig } from '@shared/types/models';
import { deleteApiKey, getKeySuffix, hasApiKey, saveApiKey } from '../security/keychain';
import { deleteProviderPricing } from '../settings/pricing';
import { createBackup, listBackups, restoreBackup } from '../system/backup';
import { runExport, defaultExportName } from '../system/export';
import { runImport } from '../system/import';
import type { ExportRequest, ImportRequest } from '@shared/types/ipc';
import { join } from 'path';
import { app } from 'electron';

function requireProviderRow(providerId: string): Record<string, unknown> {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    const error = new Error('Provider 不存在');
    (error as { code?: string }).code = 'NOT_FOUND';
    throw error;
  }
  return row;
}

export function createElectronLocalAdminOps(): LocalAdminOps {
  return {
    createProvider(input) {
      const db = getDb();
      const id = ulid();
      const now = Date.now();
      if (input.isActive) db.prepare('UPDATE providers SET is_active = 0').run();
      db.prepare(
        'INSERT INTO providers (id, name, type, base_url, model, has_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
      ).run(id, input.name, input.type, input.baseUrl, input.model, input.isActive ? 1 : 0, now, now);
      return rowToProvider(requireProviderRow(id));
    },
    setProviderKey(providerId, apiKey) {
      requireProviderRow(providerId);
      saveApiKey(providerId, apiKey);
      getDb()
        .prepare('UPDATE providers SET has_key = 1, key_suffix = ?, updated_at = ? WHERE id = ?')
        .run(getKeySuffix(providerId), Date.now(), providerId);
      return { ok: true as const, keySuffix: getKeySuffix(providerId) };
    },
    deleteProvider(providerId) {
      requireProviderRow(providerId);
      getDb().prepare('DELETE FROM providers WHERE id = ?').run(providerId);
      deleteApiKey(providerId);
      deleteProviderPricing(providerId);
      return { ok: true as const };
    },
    setActiveProvider(providerId) {
      requireProviderRow(providerId);
      const db = getDb();
      db.transaction(() => {
        db.prepare('UPDATE providers SET is_active = 0').run();
        db.prepare('UPDATE providers SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), providerId);
      })();
      return { ok: true as const };
    },
    async validateProvider(providerId) {
      const row = requireProviderRow(providerId);
      const isDoubaoWeb = row.type === 'doubao-web';
      if (!isDoubaoWeb && !hasApiKey(providerId)) return { ok: false, message: '尚未保存 API Key' };
      const provider = createProvider(
        row.type as ProviderConfig['type'],
        row.id as string,
        row.base_url as string,
        row.model as string,
        row.name as string,
      );
      try {
        const result = await provider.validateConnection();
        if (isDoubaoWeb && (result.ok || result.code === 'AUTH')) {
          getDb().prepare('UPDATE providers SET has_key = ?, key_suffix = ?, updated_at = ? WHERE id = ?')
            .run(result.ok ? 1 : 0, result.ok ? '网页会话' : null, Date.now(), providerId);
        }
        return result;
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : '连接失败' };
      }
    },
    async backupNow() {
      const path = await createBackup('cli');
      return { path };
    },
    async listBackups() {
      return { backups: await listBackups() };
    },
    async restoreBackup(file) {
      return restoreBackup(file);
    },
    async exportLibrary(request) {
      const req = request as ExportRequest;
      const targetPath =
        typeof req.targetPath === 'string' && req.targetPath
          ? req.targetPath
          : join(app.getPath('downloads'), defaultExportName(req.mode ?? 'db-only'));
      return runExport({ ...req, targetPath }, targetPath);
    },
    async importLibrary(request) {
      const req = request as ImportRequest;
      if (!req.sourcePath) {
        const error = new Error('sourcePath 为必填（本地通道不弹对话框）');
        (error as { code?: string }).code = 'INVALID_PARAMS';
        throw error;
      }
      return runImport(req, req.sourcePath);
    },
    deletePrompt(promptId) {
      const prompt = promptsRepo.get(promptId);
      if (!prompt) {
        const error = new Error('提示词不存在');
        (error as { code?: string }).code = 'NOT_FOUND';
        throw error;
      }
      promptsRepo.softDelete(promptId);
      return { ok: true as const, trashed: promptId };
    },
  };
}
