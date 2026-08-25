// electron/security/keychain.ts
// safeStorage 异步 API 封装 —— 密钥安全存储
// 详见 docs/05-image-generation.md §4、docs/01-architecture.md §3.1

import Store from 'electron-store';
import { STORE_NAME } from '@musefold/core/constants';
import { resolveSafeStorage } from './e2e-safe-storage';
import { ensureOsCryptKeyPersisted } from './os-crypt-durability';
import { orphanedProviderKeyIds } from './provider-key-cleanup';

const store = new Store<{ keys: Record<string, string> }>({
  name: STORE_NAME,
  defaults: { keys: {} },
});

/** 检查系统是否支持 safeStorage */
export function isEncryptionAvailable(): boolean {
  return resolveSafeStorage().isEncryptionAvailable();
}

/** 加密保存 API key（base64 密文存于 electron-store） */
export function saveApiKey(providerId: string, apiKey: string): void {
  const encryption = resolveSafeStorage();
  if (!encryption.isEncryptionAvailable()) {
    throw new Error('系统不支持 safeStorage 加密，无法保存密钥');
  }
  ensureOsCryptKeyPersisted();
  const encrypted = encryption.encryptString(apiKey);
  store.set(`keys.${providerId}`, encrypted.toString('base64'));
}

/** 读取并解密 API key（明文仅在主进程内存） */
export function loadApiKey(providerId: string): string | null {
  const b64 = store.get(`keys.${providerId}`);
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    return resolveSafeStorage().decryptString(buf);
  } catch {
    // 密文在但解不开 = 系统主密钥换了，界面只会显示「未配置」。留一行日志好定位。
    console.warn(`[security] provider ${providerId} 的密钥无法解密，系统主密钥可能已变更`);
    return null;
  }
}

/** 删除 API key */
export function deleteApiKey(providerId: string): void {
  store.delete(`keys.${providerId}`);
}

/** 删除不再有 SQLite Provider 行的遗留密文。 */
export function sweepOrphanedProviderKeys(validProviderIds: ReadonlySet<string>): number {
  const orphanedIds = orphanedProviderKeyIds(store.get('keys'), validProviderIds);
  for (const providerId of orphanedIds) store.delete(`keys.${providerId}`);
  return orphanedIds.length;
}

/** 获取 key 末 4 位用于显示（不暴露完整 key） */
export function getKeySuffix(providerId: string): string | null {
  const key = loadApiKey(providerId);
  if (!key || key.length < 4) return null;
  return key.slice(-4);
}

/** 是否已存 key */
export function hasApiKey(providerId: string): boolean {
  const b64 = store.get(`keys.${providerId}`);
  return Boolean(b64);
}
