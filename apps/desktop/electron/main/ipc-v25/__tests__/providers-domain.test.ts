// providers 域桥守护:「测试连接」探测请求的结果翻译(§7.2)。
// probeProvider 纯函数(fetch 注入),不触 SQLite;electron 仅为 import 链 mock。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const tempDir = mkdtempSync(join(tmpdir(), 'musefold-providers-domain-'));

const doubaoMocks = vi.hoisted(() => ({
  validateDoubaoWebSession: vi.fn(),
}));

vi.mock('../../../security/keychain', () => ({
  saveApiKey: vi.fn(),
  loadApiKey: vi.fn(() => null),
  deleteApiKey: vi.fn(),
  hasApiKey: vi.fn(() => false),
  getKeySuffix: vi.fn(() => null),
}));

// doubao-web 存量行的「测试连接」改走冻结会话校验;此处 mock 掉 electron 会话链。
vi.mock('../../../doubao-web/browser-service', () => ({
  validateDoubaoWebSession: doubaoMocks.validateDoubaoWebSession,
}));

import { getDb } from '@musefold/core/db';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { deleteApiKey, saveApiKey } from '../../../security/keychain';
import {
  buildAiProvidersDomainMethods,
  listProviderModels,
  parseOpenAiModelList,
  probeProvider,
} from '../providers-domain';
import { BridgeError } from '../envelope';

configureCoreRuntime({
  getPaths: () => ({
    userData: tempDir,
    db: join(tempDir, 'test.db'),
    backups: tempDir,
    previews: tempDir,
    pictures: tempDir,
    logs: tempDir,
  }),
  loadApiKey: () => null,
  createLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
  estimateProviderCost: () => null,
});

type Methods = Record<string, { handle(input: unknown): Promise<unknown> }>;

function insertProvider(id: string, active: boolean, updatedAt: number): void {
  getDb()
    .prepare(
      `INSERT INTO providers
         (id, name, type, base_url, model, is_active, created_at, updated_at)
       VALUES (?, ?, 'openai-compatible', 'https://gw.test/v1', 'gpt-image-1', ?, ?, ?)`,
    )
    .run(id, id, active ? 1 : 0, updatedAt, updatedAt);
}

function activeIds(): string[] {
  return (
    getDb().prepare('SELECT id FROM providers WHERE is_active = 1 ORDER BY id').all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

function fetchReturning(status: number): typeof fetch {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;
}

describe('AI Provider 激活事务', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildAiProvidersDomainMethods() as Methods;
    insertProvider('provider-active', true, 1_000);
    insertProvider('provider-next', false, 2_000);
    insertProvider('provider-spare', false, 3_000);
  });

  it('切换连接后恰好一个 active;重复激活结果稳定', async () => {
    await methods['aiProviders.setActive'].handle({ id: 'provider-next' });
    expect(activeIds()).toEqual(['provider-next']);

    await methods['aiProviders.setActive'].handle({ id: 'provider-next' });
    expect(activeIds()).toEqual(['provider-next']);
  });

  it('目标不存在时保留当前 active', async () => {
    await expect(
      methods['aiProviders.setActive'].handle({ id: 'provider-missing' }),
    ).rejects.toThrow('AI 连接不存在');
    expect(activeIds()).toEqual(['provider-next']);
  });

  it('激活目标写失败时回滚旧 active', async () => {
    getDb().exec(`
      CREATE TRIGGER fail_provider_activation
      BEFORE UPDATE OF is_active ON providers
      WHEN NEW.id = 'provider-spare' AND NEW.is_active = 1
      BEGIN
        SELECT RAISE(ABORT, 'forced activation failure');
      END;
    `);
    await expect(methods['aiProviders.setActive'].handle({ id: 'provider-spare' })).rejects.toThrow(
      'forced activation failure',
    );
    expect(activeIds()).toEqual(['provider-next']);
    getDb().exec('DROP TRIGGER fail_provider_activation');
  });

  it('删除 active 的接管写失败时回滚删除且不删 keychain', async () => {
    getDb().exec(`
      CREATE TRIGGER fail_provider_takeover
      BEFORE UPDATE OF is_active ON providers
      WHEN NEW.id = 'provider-spare' AND NEW.is_active = 1
      BEGIN
        SELECT RAISE(ABORT, 'forced takeover failure');
      END;
    `);
    vi.mocked(deleteApiKey).mockClear();

    await expect(methods['aiProviders.remove'].handle({ id: 'provider-next' })).rejects.toThrow(
      'forced takeover failure',
    );

    expect(
      getDb().prepare('SELECT id FROM providers WHERE id = ?').get('provider-next'),
    ).toBeDefined();
    expect(activeIds()).toEqual(['provider-next']);
    expect(deleteApiKey).not.toHaveBeenCalled();
    getDb().exec('DROP TRIGGER fail_provider_takeover');
  });
});

describe('probeProvider(测试连接)', () => {
  it('200 → 连接正常并带延迟;请求打到 /models 且带 bearer', async () => {
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://gw.test/v1/models');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sk-test');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await probeProvider('https://gw.test/v1/', 'sk-test', impl);
    expect(result.ok).toBe(true);
    expect(result.message).toBe('连接正常');
    expect(result.latencyMs).not.toBeNull();
  });

  it('401/403 → 密钥无效;其他非 2xx → HTTP 状态码', async () => {
    expect((await probeProvider('https://gw.test/v1', null, fetchReturning(401))).message).toBe(
      'API Key 无效或无权限',
    );
    expect((await probeProvider('https://gw.test/v1', null, fetchReturning(500))).message).toBe(
      '服务返回 HTTP 500',
    );
  });

  it('超时与网络错误 → 可读引导文案', async () => {
    const timeoutError = new Error('timed out');
    timeoutError.name = 'TimeoutError';
    const timeoutFetch = vi.fn(async () => {
      throw timeoutError;
    }) as unknown as typeof fetch;
    const timedOut = await probeProvider('https://gw.test/v1', null, timeoutFetch);
    expect(timedOut).toMatchObject({ ok: false, latencyMs: null });
    expect(timedOut.message).toContain('超时');

    const networkFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const failed = await probeProvider('https://gw.test/v1', null, networkFetch);
    expect(failed.message).toContain('无法连接');
  });

  it('doubao-web 存量行不走通用 /models 探测,改用冻结会话校验', async () => {
    getDb()
      .prepare(
        `INSERT INTO providers
           (id, name, type, base_url, model, is_active, created_at, updated_at)
         VALUES ('provider-doubao', '豆包网页', 'doubao-web', 'https://www.doubao.com/chat/create-image', 'seedream-4.5', 0, 4_000, 4_000)`,
      )
      .run();
    doubaoMocks.validateDoubaoWebSession.mockResolvedValue({
      ok: true,
      message: '豆包网页已登录,今日剩余 97/100 次',
      models: [{ id: 'seedream-4.5', name: 'Seedream 4.5' }],
    });

    const methods = buildAiProvidersDomainMethods() as Methods;
    const result = (await methods['aiProviders.test']?.handle({ id: 'provider-doubao' })) as {
      ok: boolean;
      message: string;
      latencyMs: number | null;
    };
    expect(doubaoMocks.validateDoubaoWebSession).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      message: '豆包网页已登录,今日剩余 97/100 次',
      latencyMs: null,
    });

    // 会话校验失败同样映射为结构化结果,不抛异常。
    doubaoMocks.validateDoubaoWebSession.mockResolvedValue({
      ok: false,
      code: 'AUTH',
      message: '豆包登录已失效,请重新登录后重试',
    });
    const failed = (await methods['aiProviders.test']?.handle({ id: 'provider-doubao' })) as {
      ok: boolean;
      message: string;
    };
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain('重新登录');
  });
});

describe('aiProviders.list 活跃置首', () => {
  it('list 把 is_active 行排在最前(与 generation.listProviders 同口径)', async () => {
    const methods = buildAiProvidersDomainMethods() as Methods;
    const listed = (await methods['aiProviders.list'].handle(undefined)) as Array<{
      id: string;
      isActive: boolean;
    }>;
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0]?.isActive).toBe(true);
    const firstInactive = listed.findIndex((row) => !row.isActive);
    if (firstInactive >= 0) {
      expect(listed.slice(firstInactive).every((row) => !row.isActive)).toBe(true);
    }
  });
});

describe('aiProviders.remove 清除 keychain', () => {
  it('删除成功后调用 deleteApiKey,失败接管路径仍不删钥匙链', async () => {
    insertProvider('provider-remove-key', false, 9_000);
    vi.mocked(deleteApiKey).mockClear();
    const methods = buildAiProvidersDomainMethods() as Methods;
    await methods['aiProviders.remove'].handle({ id: 'provider-remove-key' });
    expect(deleteApiKey).toHaveBeenCalledWith('provider-remove-key');
    expect(
      getDb().prepare('SELECT id FROM providers WHERE id = ?').get('provider-remove-key'),
    ).toBeUndefined();
  });
});

describe('listProviderModels / parseOpenAiModelList', () => {
  it('解析 OpenAI data[].id,单条带 name 时写入 label', () => {
    expect(
      parseOpenAiModelList({
        data: [{ id: 'gpt-image-2', name: 'GPT Image 2' }, { id: 'flux-schnell' }],
      }),
    ).toEqual({
      models: [{ id: 'gpt-image-2', label: 'GPT Image 2' }, { id: 'flux-schnell' }],
    });
  });

  it('畸形响应抛 INVALID_RESPONSE', () => {
    expect(() => parseOpenAiModelList(null)).toThrow(BridgeError);
    expect(() => parseOpenAiModelList({ foo: 1 })).toThrow('模型列表格式无效');
    expect(() => parseOpenAiModelList('not-json')).toThrow('模型列表格式无效');
  });

  it('200 成功返回模型;401 / 超时 / 畸形分别失败', async () => {
    const okFetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: 'only-one' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(listProviderModels('https://gw.test/v1/', 'sk-test', okFetch)).resolves.toEqual({
      models: [{ id: 'only-one' }],
    });

    const denied = vi.fn(
      async () => new Response('{}', { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(listProviderModels('https://gw.test/v1', 'sk-bad', denied)).rejects.toMatchObject({
      name: 'BridgeError',
      message: 'API Key 无效或无权限',
    });

    const timeoutError = new Error('timed out');
    timeoutError.name = 'TimeoutError';
    const timeoutFetch = vi.fn(async () => {
      throw timeoutError;
    }) as unknown as typeof fetch;
    await expect(
      listProviderModels('https://gw.test/v1', null, timeoutFetch),
    ).rejects.toMatchObject({
      message: '连接超时,请检查 Base URL 与网络',
    });

    const malformed = vi.fn(
      async () => new Response('not-json', { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(listProviderModels('https://gw.test/v1', 'sk', malformed)).rejects.toMatchObject({
      message: '网关返回的模型列表格式无效',
    });
  });
});

describe('aiProviders.listModels / draft test', () => {
  it('草稿 listModels 带 bearer 且不落 keychain;0 个模型返回空数组', async () => {
    const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://draft.test/v1/models');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sk-draft-only');
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const methods = buildAiProvidersDomainMethods({ fetchImpl: impl }) as Methods;
    vi.mocked(saveApiKey).mockClear();
    const listed = await methods['aiProviders.listModels'].handle({
      baseUrl: 'https://draft.test/v1',
      apiKey: 'sk-draft-only',
    });
    expect(listed).toEqual({ models: [] });
    expect(saveApiKey).not.toHaveBeenCalled();
  });

  it('草稿 test 不落库;已存 id 走 /models', async () => {
    const impl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const methods = buildAiProvidersDomainMethods({ fetchImpl: impl }) as Methods;
    vi.mocked(saveApiKey).mockClear();
    const draft = (await methods['aiProviders.test'].handle({
      baseUrl: 'https://draft.test/v1',
      apiKey: 'sk-draft-only',
    })) as { ok: boolean };
    expect(draft.ok).toBe(true);
    expect(saveApiKey).not.toHaveBeenCalled();

    const saved = (await methods['aiProviders.test'].handle({ id: 'provider-active' })) as {
      ok: boolean;
    };
    expect(saved.ok).toBe(true);
  });
});
