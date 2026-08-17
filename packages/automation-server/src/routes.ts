// Automation API v1 只读路由表（V04-API-02）。
// 端点目录与暴露矩阵一一对应（V04-ARCHITECTURE §5.2）；
// 花钱端点（generations / scheme runs / skill runs）由宿主在 P2/P3 注入。

import type { MusefoldCore } from '@musefold/core';
import { AutomationError, type AutomationRouteContext, type AutomationRouteHandler } from './server';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function queryLimit(context: AutomationRouteContext): number {
  const raw = context.url.searchParams.get('limit');
  if (raw == null) return DEFAULT_LIST_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AutomationError('INVALID_PARAMS', 'limit 必须是正整数', 400, { limit: raw });
  }
  return Math.min(parsed, MAX_LIST_LIMIT);
}

function optionalString(context: AutomationRouteContext, name: string): string | undefined {
  const value = context.url.searchParams.get(name);
  return value == null || value === '' ? undefined : value;
}

function optionalNumber(context: AutomationRouteContext, name: string): number | undefined {
  const value = optionalString(context, name);
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AutomationError('INVALID_PARAMS', `${name} 必须是数字`, 400, { [name]: value });
  }
  return parsed;
}

function requireObjectBody(context: AutomationRouteContext): Record<string, unknown> {
  const body = context.body;
  if (body == null) return {};
  if (typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
    throw new AutomationError('INVALID_PARAMS', '请求体必须是 JSON 对象', 400);
  }
  return body as Record<string, unknown>;
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AutomationError('INVALID_PARAMS', `${field} 必须是对象（键值均为字符串）`, 400);
  }
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    record[key] = String(item ?? '');
  }
  return record;
}

export function createV1ReadRoutes(core: MusefoldCore): Record<string, AutomationRouteHandler> {
  return {
    // —— 提示词库 ——
    'GET /v1/prompts': (context) => {
      const source = optionalString(context, 'source');
      const prompts = core.library.search({
        search: optionalString(context, 'query'),
        folderId: optionalString(context, 'folderId'),
        tagIds: optionalString(context, 'tagIds')?.split(',').filter(Boolean),
        ...(source && source !== 'any'
          ? { filters: { source: source as 'manual' | 'slip' } }
          : {}),
      });
      const limit = queryLimit(context);
      return { prompts: prompts.slice(0, limit), total: prompts.length };
    },
    'GET /v1/prompts/:id': (context) => {
      const prompt = core.library.get(context.params.id);
      if (!prompt) throw new AutomationError('NOT_FOUND', '提示词不存在', 404, { id: context.params.id });
      return { prompt };
    },
    'POST /v1/prompts': (context) => {
      const body = requireObjectBody(context);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const content = typeof body.body === 'string' ? body.body : typeof body.content === 'string' ? body.content : '';
      if (!title || !content) {
        throw new AutomationError('INVALID_PARAMS', 'title 与 body 均为必填', 400);
      }
      const prompt = core.library.create({
        title,
        content,
        description: typeof body.note === 'string' ? body.note : undefined,
        folderId: typeof body.folderId === 'string' ? body.folderId : undefined,
        source: body.source === 'slip' ? 'slip' : 'manual',
      });
      context.json({ id: prompt.id, created: true }, 201);
    },

    // —— Provider（只读；明文 key 永不出现） ——
    'GET /v1/providers': () => ({
      providers: core.providers.list().map((provider) => ({
        ...provider,
        available: provider.hasKey,
      })),
    }),
    'GET /v1/providers/:id/models': async (context) => {
      try {
        return { models: await core.providers.listModels(context.params.id) };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'NOT_FOUND') throw error;
        throw new AutomationError(
          'PROVIDER_ERROR',
          `Provider 模型列举失败：${error instanceof Error ? error.message : String(error)}`,
          502,
          { providerId: context.params.id },
        );
      }
    },

    // —— 历史账本 ——
    'GET /v1/history': (context) => ({
      history: core.history.list({
        status: optionalString(context, 'status') as never,
        providerId: optionalString(context, 'providerId'),
        from: optionalNumber(context, 'from'),
        to: optionalNumber(context, 'to'),
        limit: queryLimit(context),
        offset: optionalNumber(context, 'offset'),
      }),
    }),
    'GET /v1/history/:id': (context) => {
      const record = core.history.get(context.params.id);
      if (!record) throw new AutomationError('NOT_FOUND', '历史记录不存在', 404, { id: context.params.id });
      return { history: record };
    },

    // —— 设计方案（仅正式版可见，v0.3.2 纪律） ——
    'GET /v1/schemes': () => ({ schemes: core.schemes.list() }),
    'GET /v1/schemes/:id': (context) => {
      const detail = core.schemes.get(context.params.id);
      if (!detail) {
        throw new AutomationError('NOT_FOUND', '设计方案不存在（或尚未转正）', 404, { id: context.params.id });
      }
      return detail;
    },
    'POST /v1/schemes/:id/compile': (context) => {
      const body = requireObjectBody(context);
      return core.schemes.compile({
        schemeId: context.params.id,
        inputs: stringRecord(body.inputs, 'inputs'),
        brief: typeof body.brief === 'string' ? body.brief : undefined,
        imageCount: typeof body.imageCount === 'number' ? body.imageCount : undefined,
        ratioId: typeof body.ratioId === 'string' ? body.ratioId : undefined,
        priorityMode: body.priorityMode as never,
      });
    },
  };
}
