import { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it, vi } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { promptRoutes } from '../routes.js';
import type { PromptService } from '../service.js';

function testApp(service: PromptService) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', 'prompt-routes-user');
    c.set('sessionId', 'prompt-routes-session');
    await next();
  });
  app.route('/', promptRoutes(service));
  return app;
}

describe('prompt route query parsing', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('parses deletedOnly=%s before listing prompts', async (wire, expected) => {
    const listPrompts = vi.fn(async () => ({ items: [], nextCursor: null }));
    const app = testApp({ listPrompts } as unknown as PromptService);
    const response = await app.request(`/prompts?deletedOnly=${wire}&includeDeleted=true`);
    expect(response.status).toBe(200);
    expect(listPrompts).toHaveBeenCalledWith(
      'prompt-routes-user',
      expect.objectContaining({ deletedOnly: expected, includeDeleted: true }),
    );
  });

  it.each([
    ['false', false],
    ['true', true],
  ])('parses includeDeleted=%s as %s', async (wireValue, expected) => {
    const listFolders = vi.fn(async () => []);
    const app = testApp({ listFolders } as unknown as PromptService);

    const response = await app.request(`/folders?includeDeleted=${wireValue}`);

    expect(response.status).toBe(200);
    expect(listFolders).toHaveBeenCalledWith('prompt-routes-user', expected);
  });
});

describe('清空回收站路由', () => {
  it('POST /prompts/empty-trash 走集合级动作(不被 /prompts/{id} 吃掉)并回传条数', async () => {
    const emptyTrash = vi.fn(async () => ({ purged: 4 }));
    const getPrompt = vi.fn(async () => {
      throw new Error('empty-trash 不应被当作 id 路由');
    });
    const app = testApp({ emptyTrash, getPrompt } as unknown as PromptService);

    const response = await app.request('/prompts/empty-trash', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ purged: 4 });
    expect(emptyTrash).toHaveBeenCalledWith('prompt-routes-user');
    expect(getPrompt).not.toHaveBeenCalled();
  });

  it('回收站为空时返回 0(幂等,不报错)', async () => {
    const emptyTrash = vi.fn(async () => ({ purged: 0 }));
    const app = testApp({ emptyTrash } as unknown as PromptService);

    const response = await app.request('/prompts/empty-trash', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ purged: 0 });
  });
});

describe('封面字段出入参', () => {
  it('创建入参透传 coverImageUrl,出参带回封面', async () => {
    const createPrompt = vi.fn(async (_userId: string, input: { coverImageUrl?: unknown }) => ({
      id: 'p1',
      title: '来自生成',
      description: null,
      content: 'from generation',
      negative: null,
      folderId: null,
      tags: [],
      modelId: null,
      params: null,
      rating: 0,
      isPinned: false,
      pinOrder: null,
      usageCount: 0,
      lastUsedAt: null,
      source: 'generation' as const,
      sourceUrl: null,
      coverImageUrl: input.coverImageUrl ?? null,
      version: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      deletedAt: null,
    }));
    const app = testApp({ createPrompt } as unknown as PromptService);

    const response = await app.request('/prompts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '来自生成',
        description: null,
        content: 'from generation',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
        coverImageUrl: 'https://cdn.example/cover.png',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      coverImageUrl: 'https://cdn.example/cover.png',
    });
  });

  it('本地绝对路径的封面入参被契约拒绝(路径不进云端)', async () => {
    const createPrompt = vi.fn();
    const app = testApp({ createPrompt } as unknown as PromptService);

    const response = await app.request('/prompts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '越界封面',
        description: null,
        content: 'x',
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
        coverImageUrl: '/Users/me/Pictures/a.png',
      }),
    });

    // 契约校验在 route 层抛 VALIDATION_FAILED;本测试壳没装全局错误中间件,
    // 只断言「没落到 service、没建成」——路径绝不进云端。
    expect(response.status).not.toBe(201);
    expect(createPrompt).not.toHaveBeenCalled();
  });
});
