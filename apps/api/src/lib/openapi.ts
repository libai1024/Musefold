import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { AuthedEnv } from '../auth/middleware.js';
import { AppError } from './errors.js';

type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface RouteDef<
  P extends z.ZodType | undefined,
  Q extends z.ZodType | undefined,
  B extends z.ZodType | undefined,
> {
  method: HttpMethod;
  /** OpenAPI 风格路径(`/prompts/{id}`),注册到 Hono 时自动转 `:id`。 */
  path: string;
  tags: string[];
  summary?: string;
  params?: P;
  query?: Q;
  body?: B;
  status?: 200 | 201 | 202;
  response: z.ZodType;
}

type Parsed<S extends z.ZodType | undefined> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteInput<
  P extends z.ZodType | undefined,
  Q extends z.ZodType | undefined,
  B extends z.ZodType | undefined,
> {
  params: Parsed<P>;
  query: Parsed<Q>;
  body: Parsed<B>;
}

export function createAuthedRouter(): OpenAPIHono<AuthedEnv> {
  return new OpenAPIHono<AuthedEnv>();
}

/**
 * 注册一条 JSON 路由:OpenAPI 文档进 registry,运行时用 zod 手动校验。
 * 刻意不走 app.openapi() 的全量类型推导——40+ 条路由的编译开销与类型摩擦不划算,
 * 响应形状由服务层 schema.parse 保证。
 */
export function route<
  P extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
>(
  app: OpenAPIHono<AuthedEnv>,
  def: RouteDef<P, Q, B>,
  handler: (c: Context<AuthedEnv>, input: RouteInput<P, Q, B>) => Promise<Response>,
): void {
  app.openAPIRegistry.registerPath(
    createRoute({
      method: def.method,
      path: def.path,
      tags: def.tags,
      summary: def.summary,
      request: {
        params: def.params as never,
        query: def.query as never,
        body: def.body
          ? {
              content: { 'application/json': { schema: def.body } },
              required: !def.body.isOptional(),
            }
          : undefined,
      },
      responses: {
        [def.status ?? 200]: {
          description: 'OK',
          content: { 'application/json': { schema: def.response } },
        },
      },
    }),
  );

  const honoPath = def.path.replace(/\{([^}]+)\}/g, ':$1');
  app.on(def.method.toUpperCase(), honoPath, async (c) => {
    const input = {
      params: parseWith(def.params, c.req.param(), 'params'),
      query: parseWith(def.query, queryRecord(c), 'query'),
      body: def.body ? parseWith(def.body, await readJsonBody(c), 'body') : undefined,
    } as RouteInput<P, Q, B>;
    return handler(c, input);
  });
}

async function readJsonBody(c: Context<AuthedEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'body: JSON 格式无效', 400);
  }
}

function queryRecord(c: Context<AuthedEnv>): Record<string, string | string[]> {
  const queries = c.req.queries();
  const result: Record<string, string | string[]> = {};
  for (const [key, values] of Object.entries(queries)) {
    result[key] = values.length === 1 ? (values[0] as string) : values;
  }
  return result;
}

function parseWith<S extends z.ZodType | undefined>(
  schema: S,
  value: unknown,
  where: 'params' | 'query' | 'body',
): Parsed<S> {
  if (!schema) return undefined as Parsed<S>;
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError(
      'VALIDATION_FAILED',
      first ? `${where}.${first.path.join('.') || '?'}: ${first.message}` : '请求参数无效',
      400,
    );
  }
  return result.data as Parsed<S>;
}
