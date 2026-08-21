import Store from 'electron-store';
import { AI_CONNECTION_STORE_NAME } from '@musefold/core/constants';
import { resolveSafeStorage } from './e2e-safe-storage';

export interface AiSecretKeychain {
  save(connectionId: string, apiKey: string): void;
  load(connectionId: string): string | null;
  delete(connectionId: string): void;
  has(connectionId: string): boolean;
  suffix(connectionId: string): string | null;
}

interface SecretStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ElectronAiSecretKeychain implements AiSecretKeychain {
  constructor(
    private readonly store: SecretStore = new Store({
      name: AI_CONNECTION_STORE_NAME,
      defaults: { keys: {} },
    }),
    private readonly encryption: SafeStorageLike = resolveSafeStorage(),
  ) {}

  save(connectionId: string, apiKey: string): void {
    const normalized = apiKey.trim();
    if (!normalized) throw new Error('API Key 不能为空');
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('系统不支持 safeStorage 加密，无法保存密钥');
    }
    const encrypted = this.encryption.encryptString(normalized).toString('base64');
    this.store.set(`keys.${connectionId}`, encrypted);
  }

  load(connectionId: string): string | null {
    const encrypted = this.store.get(`keys.${connectionId}`);
    if (typeof encrypted !== 'string' || !encrypted) return null;
    try {
      return this.encryption.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }

  delete(connectionId: string): void {
    this.store.delete(`keys.${connectionId}`);
  }

  has(connectionId: string): boolean {
    return typeof this.store.get(`keys.${connectionId}`) === 'string';
  }

  suffix(connectionId: string): string | null {
    const value = this.load(connectionId);
    return value && value.length >= 4 ? value.slice(-4) : null;
  }
}
