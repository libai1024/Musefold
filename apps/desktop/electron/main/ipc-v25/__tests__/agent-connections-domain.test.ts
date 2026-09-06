/**
 * v2.5 Agent 文本连接域桥单测:内存 AiConnectionStore + 内存 keychain 驱动全部 6 个方法。
 * 重点:实体形状与契约一致、密钥 write-only、默认切换/删除接管、托管连接只读、探测走 bearer。
 */
import { V25_METHODS_BY_DOMAIN, agentConnectionSchema } from '@musefold/contracts';
import type { AiSecretKeychain } from '../../../security/ai-keychain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/musefold-agent-connections-test' } }));
// probeProvider 来自 providers-domain;其生图连接依赖(SQLite、keychain、豆包冻结面)与本域无关,按 bridge 测试口径 mock。
vi.mock('@musefold/core/db', () => ({ getDb: vi.fn() }));
vi.mock('../../../security/keychain', () => ({
  saveApiKey: vi.fn(),
  loadApiKey: vi.fn(() => null),
  deleteApiKey: vi.fn(),
  hasApiKey: vi.fn(() => false),
  getKeySuffix: vi.fn(() => null),
}));
vi.mock('../../../doubao-web/browser-service', () => ({ validateDoubaoWebSession: vi.fn() }));

import { AiConnectionStore } from '../../../ai/connection-store';
import { buildAgentConnectionsDomainMethods } from '../agent-connections-domain';
import { BridgeError } from '../envelope';

class MemoryBackend {
  data = { connections: {} as Record<string, unknown>, activeId: null as string | null };
  get(key: 'connections' | 'activeId') {
    return this.data[key];
  }
  set(key: 'connections' | 'activeId', value: unknown) {
    (this.data as Record<string, unknown>)[key] = value;
  }
}

class MemorySecrets implements AiSecretKeychain {
  readonly values = new Map<string, string>();
  save(id: string, key: string) {
    this.values.set(id, key.trim());
  }
  load(id: string) {
    return this.values.get(id) ?? null;
  }
  delete(id: string) {
    this.values.delete(id);
  }
  has(id: string) {
    return this.values.has(id);
  }
  suffix(id: string) {
    const key = this.values.get(id);
    return key ? key.slice(-4) : null;
  }
}

let store: AiConnectionStore;
let secrets: MemorySecrets;
let fetchImpl: ReturnType<typeof vi.fn>;
let methods: ReturnType<typeof buildAgentConnectionsDomainMethods>;
let now: number;

async function invoke<T = any>(name: string, payload?: unknown): Promise<T> {
  const def = methods[`agentConnections.${name}`];
  if (!def) throw new Error(`missing method agentConnections.${name}`);
  return (await def.handle(def.input.parse(payload))) as T;
}

async function invokeError(name: string, payload?: unknown): Promise<BridgeError> {
  try {
    await invoke(name, payload);
  } catch (error) {
    expect(error).toBeInstanceOf(BridgeError);
    return error as BridgeError;
  }
  throw new Error(`agentConnections.${name} 应当失败`);
}

beforeEach(() => {
  now = 1_700_000_000_000;
  secrets = new MemorySecrets();
  store = new AiConnectionStore({
    store: new MemoryBackend() as never,
    secrets,
    idFactory: (() => {
      let seq = 0;
      return () => `conn_${++seq}`;
    })(),
    now: () => (now += 1_000),
  });
  fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
  methods = buildAgentConnectionsDomainMethods({ store, fetchImpl: fetchImpl as never });
});

describe('agentConnections 域方法表', () => {
  it('逐名锁定为契约方法集', () => {
    expect(Object.keys(methods).sort()).toEqual([...V25_METHODS_BY_DOMAIN.agentConnections].sort());
  });

  it('create → list:实体过契约;首个连接自动成为默认;密钥只回 hasKey/keySuffix', async () => {
    const created = await invoke('create', {
      name: 'TvT 文本',
      baseUrl: 'https://ai.tvt.wiki/v1/',
      model: 'gpt-5.4-mini',
      apiKey: 'sk-test-secret-1234',
    });
    expect(() => agentConnectionSchema.parse(created)).not.toThrow();
    expect(created).toMatchObject({
      id: 'conn_1',
      name: 'TvT 文本',
      type: 'openai-compatible',
      baseUrl: 'https://ai.tvt.wiki/v1',
      model: 'gpt-5.4-mini',
      hasKey: true,
      keySuffix: '1234',
      isActive: true,
      managedBy: null,
    });
    expect(JSON.stringify(created)).not.toContain('sk-test');
    expect(secrets.load('conn_1')).toBe('sk-test-secret-1234');

    const second = await invoke('create', {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    expect(second).toMatchObject({ id: 'conn_2', hasKey: false, keySuffix: null, isActive: false });
    const list = await invoke<Array<{ id: string; isActive: boolean }>>('list');
    expect(list.map((item) => [item.id, item.isActive])).toEqual([
      ['conn_1', true],
      ['conn_2', false],
    ]);
  });

  it('create 带 activate → 直接成为默认;setActive 切换默认', async () => {
    await invoke('create', { name: 'A', baseUrl: 'https://a.example/v1', model: 'm' });
    const b = await invoke('create', {
      name: 'B',
      baseUrl: 'https://b.example/v1',
      model: 'm',
      activate: true,
    });
    expect(b.isActive).toBe(true);
    const switched = await invoke('setActive', { id: 'conn_1' });
    expect(switched.isActive).toBe(true);
    const list = await invoke<Array<{ id: string; isActive: boolean }>>('list');
    expect(list.find((item) => item.id === 'conn_2')?.isActive).toBe(false);
  });

  it('update:元数据、替换密钥(string)、删除密钥(null)、留空不动(undefined)', async () => {
    await invoke('create', {
      name: 'A',
      baseUrl: 'https://a.example/v1',
      model: 'm',
      apiKey: 'sk-old-0000',
    });
    const renamed = await invoke('update', { id: 'conn_1', patch: { name: 'A2', model: 'm2' } });
    expect(renamed).toMatchObject({ name: 'A2', model: 'm2', hasKey: true, keySuffix: '0000' });

    const rekeyed = await invoke('update', { id: 'conn_1', patch: { apiKey: 'sk-new-9999' } });
    expect(rekeyed).toMatchObject({ hasKey: true, keySuffix: '9999' });
    expect(secrets.load('conn_1')).toBe('sk-new-9999');

    const cleared = await invoke('update', { id: 'conn_1', patch: { apiKey: null } });
    expect(cleared).toMatchObject({ hasKey: false, keySuffix: null });
    expect(secrets.has('conn_1')).toBe(false);
  });

  it('remove:连接与密钥一并删除;删除默认连接时另一条接管默认', async () => {
    await invoke('create', {
      name: 'A',
      baseUrl: 'https://a.example/v1',
      model: 'm',
      apiKey: 'sk-a-1111',
    });
    await invoke('create', { name: 'B', baseUrl: 'https://b.example/v1', model: 'm' });
    expect(await invoke('remove', { id: 'conn_1' })).toBeNull();
    expect(secrets.has('conn_1')).toBe(false);
    const list = await invoke<Array<{ id: string; isActive: boolean }>>('list');
    expect(list).toEqual([expect.objectContaining({ id: 'conn_2', isActive: true })]);
  });

  it('test:GET {baseUrl}/models 带 bearer;无密钥不带 authorization;401 给人话', async () => {
    await invoke('create', {
      name: 'A',
      baseUrl: 'https://a.example/v1',
      model: 'm',
      apiKey: 'sk-a-1111',
    });
    const ok = await invoke('test', { id: 'conn_1' });
    expect(ok).toMatchObject({ ok: true, message: '连接正常' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://a.example/v1/models',
      expect.objectContaining({ headers: { authorization: 'Bearer sk-a-1111' } }),
    );

    await invoke('create', { name: 'B', baseUrl: 'https://b.example/v1', model: 'm' });
    fetchImpl.mockResolvedValueOnce(new Response('', { status: 401 }));
    const denied = await invoke('test', { id: 'conn_2' });
    expect(denied).toMatchObject({ ok: false, message: 'API Key 无效或无权限' });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://b.example/v1/models',
      expect.objectContaining({ headers: {} }),
    );
  });

  it('结构化错误:不存在 → NOT_FOUND;非法 Base URL → VALIDATION_FAILED;账号托管连接只读', async () => {
    expect((await invokeError('setActive', { id: 'conn_ghost' })).code).toBe('NOT_FOUND');
    expect((await invokeError('remove', { id: 'conn_ghost' })).code).toBe('NOT_FOUND');
    expect(
      (
        await invokeError('create', {
          name: 'bad',
          baseUrl: 'https://user:pw@a.example/v1',
          model: 'm',
        })
      ).code,
    ).toBe('VALIDATION_FAILED');

    const managed = await invoke('create', {
      name: 'Managed',
      baseUrl: 'https://m.example/v1',
      model: 'm',
    });
    // 模拟 v2.1 账号托管记录:store 层拒绝手动改写与删除。
    const backend = (store as unknown as { store: MemoryBackend }).store;
    const records = backend.get('connections') as Record<string, { managedBy?: string }>;
    records[managed.id] = { ...records[managed.id], managedBy: 'account' };
    backend.set('connections', records);
    expect((await invokeError('update', { id: managed.id, patch: { name: 'x' } })).code).toBe(
      'AGENT_CONNECTION_MANAGED_READONLY',
    );
    expect((await invokeError('remove', { id: managed.id })).code).toBe(
      'AGENT_CONNECTION_MANAGED_READONLY',
    );
    expect((await invoke('list'))[0]).toMatchObject({ id: managed.id, managedBy: 'account' });
  });

  it('拒绝越界入参:空名称、缺模型、非 URL 的 Base URL', async () => {
    const create = methods['agentConnections.create'];
    expect(() => create.input.parse({ name: 'A', baseUrl: 'https://a.example/v1' })).toThrow();
    expect(() =>
      create.input.parse({ name: '', baseUrl: 'https://a.example/v1', model: 'm' }),
    ).toThrow();
    expect(() => create.input.parse({ name: 'A', baseUrl: 'not-a-url', model: 'm' })).toThrow();
  });
});
