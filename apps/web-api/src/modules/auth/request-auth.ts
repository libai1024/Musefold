import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import type { SessionStorePort } from '../account/session-store.js';
import { AppError } from '../../errors.js';

export interface MusefoldPrincipal {
  ownerId: number;
  username: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    musefoldPrincipal: MusefoldPrincipal;
  }
}

export function requireMusefoldSession(
  sessions: SessionStorePort,
  cookieName: string,
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const rawSessionId =
      bearerToken(request.headers.authorization) ??
      request.cookies?.[cookieName];
    if (!rawSessionId)
      throw new AppError('AUTH_REQUIRED', '请先登录 Musefold', 401);
    const session = await sessions.get(rawSessionId);
    if (!session)
      throw new AppError(
        'AUTH_SESSION_EXPIRED',
        '登录状态已失效，请重新登录',
        401,
      );
    request.musefoldPrincipal = {
      ownerId: session.ownerId,
      username: session.username,
      csrfToken: session.csrfToken,
    };
  };
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1];
}

export async function requireMusefoldCsrf(
  request: FastifyRequest,
): Promise<void> {
  const supplied = request.headers['x-musefold-csrf'];
  if (
    typeof supplied !== 'string' ||
    supplied !== request.musefoldPrincipal.csrfToken
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      '请求验证失败，请刷新页面后重试',
      403,
    );
  }
}
