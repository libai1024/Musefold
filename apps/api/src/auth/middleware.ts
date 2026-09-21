import type { MiddlewareHandler } from 'hono';
import { AppError } from '../lib/errors.js';
import type { MusefoldAuth } from './index.js';
import type { AccountService } from '../modules/account/service.js';

export interface AuthedVariables {
  userId: string;
  sessionId: string;
}

export type AuthedEnv = { Variables: AuthedVariables };

/**
 * 要求已登录(cookie 会话或 bearer token 均可,Better Auth 统一解析)。
 * 对携带 cookie 的跨站写请求做 Origin 校验(bearer 请求天然免疫 CSRF,跳过)。
 */
export function requireSession(
  auth: MusefoldAuth,
  trustedOrigins: readonly string[],
  account?: Pick<AccountService, 'assertSessionAuthorization'>,
  servicePath = '',
): MiddlewareHandler<AuthedEnv> {
  return async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
      query: { disableCookieCache: true },
    });
    if (!session) {
      throw new AppError('AUTH_REQUIRED', '请先登录', 401);
    }
    if (account) {
      const requestPath =
        servicePath && c.req.path.startsWith(`${servicePath}/`)
          ? c.req.path.slice(servicePath.length)
          : c.req.path;
      const recoveryRead =
        c.req.method === 'GET' &&
        ['/account/status', '/account/execution-binding'].some(
          (path) => requestPath === path || requestPath === `/api/v1${path}`,
        );
      const recoveryWrite =
        c.req.method === 'POST' &&
        (requestPath === '/api/v1/account/login-sessions/touch' ||
          requestPath === '/account/login-sessions/touch' ||
          ['/retry', '/inspect', '/verify-original-session', '/independent-workspace'].some(
            (action) =>
              requestPath === `/account/recovery${action}` ||
              requestPath === `/api/v1/account/recovery${action}`,
          ));
      await account.assertSessionAuthorization(
        session.session.id,
        session.user.id,
        recoveryRead || recoveryWrite,
      );
    }
    const usesBearer = c.req.header('authorization')?.toLowerCase().startsWith('bearer ') ?? false;
    if (!usesBearer && c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin && !trustedOrigins.includes(origin)) {
        throw new AppError('AUTH_REQUIRED', '请求来源不可信', 403);
      }
    }
    c.set('userId', session.user.id);
    c.set('sessionId', session.session.id);
    await next();
  };
}
