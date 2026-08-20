import { describe, expect, it, vi } from 'vitest';
import type { AiSecretKeychain } from '../../security/ai-keychain';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

import { AiConnectionStore, normalizeAiBaseUrl } from '../connection-store';
import { ElectronAiSecretKeychain } from '../../security/ai-keychain';

class MemoryBackend {
  data = { connections: {}, activeId: null as string | null };
  get(key: 'connections' | 'activeId') { return this.data[key]; }
  set(key: 'connections' | 'activeId', value: any) { this.data[key] = value; }
}

class MemorySecrets implements AiSecretKeychain {
  readonly values = new Map<string, string>();
  save(id: string, key: string) { this.values.set(id, key.trim()); }
  load(id: string) { return this.values.get(id) ?? null; }
  delete(id: string) { this.values.delete(id); }
  has(id: string) { return this.values.has(id); }
  suffix(id: string) { return this.load(id)?.slice(-4) ?? null; }
}

describe('AI connection store', () => {
  it('stores only safeStorage ciphertext and exposes a suffix instead of the key', () => {
    const values = new Map<string, unknown>();
    const keychain = new ElectronAiSecretKeychain({
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
      delete: (key: string) => { values.delete(key); },
    }, {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`).reverse(),
      decryptString: (value: Buffer) => value.reverse().toString().replace(/^encrypted:/, ''),
    });
    keychain.save('ai-1', 'sk-safe-storage-test');
    expect(JSON.stringify([...values.values()])).not.toContain('sk-safe-storage-test');
    expect(keychain.load('ai-1')).toBe('sk-safe-storage-test');
    expect(keychain.suffix('ai-1')).toBe('test');
  });

  it('validates URLs without rejecting local LiteLLM gateways', () => {
    expect(normalizeAiBaseUrl('http://localhost:4000/v1/')).toBe('http://localhost:4000/v1');
    expect(() => normalizeAiBaseUrl('https://user:pass@example.com/v1')).toThrow('用户名或密码');
    expect(() => normalizeAiBaseUrl('https://example.com/v1?key=secret')).toThrow('查询参数');
  });

  it('returns only a sanitized profile and keeps image provider state independent', () => {
    const backend = new MemoryBackend();
    const secrets = new MemorySecrets();
    const store = new AiConnectionStore({
      store: backend as any,
      secrets,
      idFactory: () => 'ai-1',
      now: () => 100,
    });
    const created = store.create({
      name: '团队 LiteLLM',
      routeKind: 'gateway',
      presetId: 'litellm',
      baseUrl: 'http://localhost:4000/v1',
      model: 'diagram-model',
    });
    expect(created).toMatchObject({
      id: 'ai-1',
      hasKey: false,
      isActive: true,
      capabilities: { preferredStructuredOutputMode: 'json-object' },
    });
    const saved = store.saveKey('ai-1', 'sk-private-value');
    expect(saved).toMatchObject({ hasKey: true, keySuffix: 'alue' });
    expect(JSON.stringify(backend.data)).not.toContain('sk-private-value');
    expect(JSON.stringify(saved)).not.toContain('sk-private-value');
  });

  it('upserts and removes an account-managed connection while guarding manual mutations', () => {
    const backend = new MemoryBackend();
    const secrets = new MemorySecrets();
    let id = 0;
    const store = new AiConnectionStore({
      store: backend as any,
      secrets,
      idFactory: () => `ai-${++id}`,
      now: () => 100 + id,
    });

    const managed = store.upsertManagedAccount(null, {
      name: 'Musefold 账号',
      baseUrl: 'https://relay.test/v1',
      model: 'musefold-agent',
      apiKey: 'sk-managed-1234',
    });
    expect(managed).toMatchObject({
      id: 'ai-1',
      presetId: 'account',
      routeKind: 'gateway',
      managedBy: 'account',
      hasKey: true,
      keySuffix: '1234',
      isActive: true,
    });

    const updated = store.upsertManagedAccount('ai-1', {
      name: 'Musefold 账号',
      baseUrl: 'https://relay2.test/v1',
      model: 'musefold-agent-v2',
      apiKey: 'sk-rotated-5678',
    });
    expect(updated.id).toBe('ai-1');
    expect(updated.baseUrl).toBe('https://relay2.test/v1');
    expect(updated.keySuffix).toBe('5678');
    expect(store.list()).toHaveLength(1);

    expect(() => store.update('ai-1', { baseUrl: 'https://evil.test/v1' }))
      .toThrow('固定管理');
    expect(() => store.saveKey('ai-1', 'sk-user-overwrite'))
      .toThrow('不能手动修改');
    expect(() => store.delete('ai-1')).toThrow('退出登录后');
    expect(() => store.update('ai-1', { model: 'musefold-agent-v3' }))
      .toThrow('固定管理');

    store.removeManagedAccount('ai-1');
    expect(store.list()).toEqual([]);
    expect(secrets.values.size).toBe(0);
  });

  it('provisions an official account connection without replacing an active relay connection', () => {
    const backend = new MemoryBackend();
    const store = new AiConnectionStore({
      store: backend as any,
      secrets: new MemorySecrets(),
      idFactory: (() => { let id = 0; return () => `ai-${++id}`; })(),
      now: () => 100,
    });
    const relay = store.create({
      name: 'Relay',
      routeKind: 'gateway',
      baseUrl: 'https://relay.test/v1',
      model: 'relay-model',
    });
    const official = store.upsertManagedAccount(null, {
      name: 'Musefold 账号',
      baseUrl: 'https://official.test/v1',
      model: 'musefold-agent',
      apiKey: 'sk-official-1234',
    });

    expect(store.require(relay.id).isActive).toBe(true);
    expect(official.isActive).toBe(false);
  });

  it('uses schema output for direct providers and portable JSON Object for gateways', () => {
    const store = new AiConnectionStore({
      store: new MemoryBackend() as any,
      secrets: new MemorySecrets(),
      idFactory: (() => { let id = 0; return () => `ai-${++id}`; })(),
      now: () => 100,
    });
    const direct = store.create({
      name: 'Direct',
      routeKind: 'direct',
      baseUrl: 'https://direct.test/v1',
      model: 'direct-model',
    });
    const gateway = store.create({
      name: 'Gateway',
      routeKind: 'gateway',
      baseUrl: 'https://gateway.test/v1',
      model: 'gateway-model',
    });

    expect(direct.capabilities.preferredStructuredOutputMode).toBe('json-schema');
    expect(gateway.capabilities.preferredStructuredOutputMode).toBe('json-object');
    expect(store.update(direct.id, { routeKind: 'gateway' }).capabilities.preferredStructuredOutputMode)
      .toBe('json-object');
  });

  it('moves active state and removes the encrypted key with the connection', () => {
    const backend = new MemoryBackend();
    const secrets = new MemorySecrets();
    let id = 0;
    const store = new AiConnectionStore({
      store: backend as any,
      secrets,
      idFactory: () => `ai-${++id}`,
      now: () => id,
    });
    store.create({ name: 'A', routeKind: 'direct', baseUrl: 'https://a.test/v1', model: 'a' });
    store.create({ name: 'B', routeKind: 'gateway', baseUrl: 'https://b.test/v1', model: 'b' });
    store.saveKey('ai-1', 'secret-a');
    store.setActive('ai-2');
    store.delete('ai-2');
    expect(store.require('ai-1').isActive).toBe(true);
    store.delete('ai-1');
    expect(secrets.values.size).toBe(0);
    expect(store.list()).toEqual([]);
  });
});
