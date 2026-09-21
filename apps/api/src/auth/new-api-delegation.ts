import { randomBytes, randomUUID } from 'node:crypto';
import type { GenericEndpointContext } from '@better-auth/core';
import { completeLoginCapacitySchema, loginCapacityRequestSchema } from '@musefold/contracts';
import type { NewApiClient, RelayAuthSession } from '@musefold/new-api-client';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import type { PreparedAccountLogin } from '../modules/account/identity.js';
import type {
  LoginCapacityService,
  ManagedLoginCommit,
} from '../modules/account/login-capacity.js';

/**
 * 凭据委托插件:Musefold 不存密码,登录/注册请求原样转给自托管 New API 网关校验,
 * fresh getSelf 验证后按可信 issuer + owner 查主体,再建立 Web cookie / 桌面 bearer 会话。
 */
export interface NewApiDelegationHooks {
  loginSessions?: LoginCapacityService;
  prepareLogin(input: {
    username: string;
    relay: RelayAuthSession;
    previousSessionId: string | null;
  }): Promise<PreparedAccountLogin>;
  commitLogin(input: {
    prepared: PreparedAccountLogin;
    sessionId: string;
    previousSessionId?: string;
    managed?: ManagedLoginCommit;
  }): Promise<void>;
  assertSessionAuthorization(
    sessionId: string,
    userId: string,
    allowRecovery?: boolean,
  ): Promise<void>;
}

const credentialsBody = z.object({
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(256),
  twoFactorCode: z.string().min(1).max(128).optional(),
});

type RelayErrorLike = { code?: unknown; message?: unknown; httpStatus?: unknown };

function mapRelayError(error: unknown): APIError {
  const raw = (error ?? {}) as RelayErrorLike;
  const code = typeof raw.code === 'string' ? raw.code : 'server';
  const message = '账号服务暂时不可用，请稍后重试';
  const sessionCodes = new Set([
    'AUTH_2FA_REQUIRED',
    'AUTH_SESSION_LIMIT',
    'AUTH_SESSION_ISSUANCE_LIMIT',
    'AUTH_SESSION_REVIEW_CHANGED',
    'AUTH_LOGIN_CHALLENGE_EXPIRED',
    'AUTH_OPERATION_CONFLICT',
    'AUTH_SESSION_MANAGEMENT_UNAVAILABLE',
  ]);
  if (sessionCodes.has(code))
    return new APIError(
      code === 'AUTH_SESSION_ISSUANCE_LIMIT'
        ? 'TOO_MANY_REQUESTS'
        : code === 'AUTH_LOGIN_CHALLENGE_EXPIRED' || code === 'AUTH_2FA_REQUIRED'
          ? 'UNAUTHORIZED'
          : 'CONFLICT',
      { code, message: typeof raw.message === 'string' ? raw.message : message },
    );
  if (code === 'RATE_LIMITED' || (code === 'network' && raw.httpStatus === 429)) {
    return new APIError('TOO_MANY_REQUESTS', {
      code: 'RATE_LIMITED',
      message: '登录操作过于频繁，请稍后再试',
    });
  }
  if (code === 'credentials' || code === 'AUTH_CREDENTIALS_INVALID') {
    return new APIError('UNAUTHORIZED', {
      code: 'AUTH_CREDENTIALS_INVALID',
      message: '用户名或密码不正确',
    });
  }
  if (code === 'conflict') {
    return new APIError('CONFLICT', { code: 'VALIDATION_FAILED', message });
  }
  if (code === 'auth' || code === 'AUTH_SESSION_EXPIRED') {
    return new APIError('UNAUTHORIZED', { code: 'AUTH_SESSION_EXPIRED', message });
  }
  if (code.startsWith('ACCOUNT_'))
    return new APIError('CONFLICT', { code, message: '账号身份验证未完成，请重试登录或恢复' });
  return new APIError('BAD_GATEWAY', { code: 'INTERNAL_ERROR', message });
}

export function newApiDelegation(
  client: NewApiClient,
  hooks: NewApiDelegationHooks,
): BetterAuthPlugin {
  async function establishSession(
    ctx: GenericEndpointContext,
    email: string,
    relay: RelayAuthSession,
    managed?: ManagedLoginCommit,
  ) {
    const internal = ctx.context.internalAdapter;
    if (managed) {
      const completed = await hooks.loginSessions?.completedToken(managed);
      if (completed) return completed;
    }
    const previous = await getSessionFromCtx(ctx, {
      disableCookieCache: true,
      disableRefresh: true,
    });
    let prepared: PreparedAccountLogin;
    try {
      prepared = await hooks.prepareLogin({
        username: email,
        relay,
        previousSessionId: previous?.session.id ?? null,
      });
    } catch (error) {
      throw mapRelayError(error);
    }
    const user = await internal.findUserById(prepared.userId);
    if (!user)
      throw new APIError('INTERNAL_SERVER_ERROR', {
        code: 'INTERNAL_ERROR',
        message: '无法建立账号会话',
      });
    const existing = managed ? await internal.findSession(managed.resultToken) : null;
    const session =
      existing?.session ??
      (await internal.createSession(
        user.id,
        false,
        managed ? { token: managed.resultToken } : undefined,
        Boolean(managed),
      ));
    try {
      if (session.userId !== user.id) throw new Error('Candidate owner changed');
      if (managed) await hooks.loginSessions?.attachSession(managed, session.id);
      await hooks.commitLogin({
        prepared,
        sessionId: session.id,
        previousSessionId: previous?.session.id,
        managed,
      });
    } catch (error) {
      // Better Auth expects the token, not session.id. Never delete another device's session.
      if (!managed || (await hooks.loginSessions?.canDiscard(managed)))
        await internal.deleteSession(session.token);
      throw mapRelayError(error);
    }
    return session.token;
  }

  async function acceptToken(ctx: GenericEndpointContext, token: string, managed = false) {
    const value = await ctx.context.internalAdapter.findSession(token);
    if (!value || value.session.expiresAt.getTime() <= Date.now())
      throw mapRelayError({ code: 'AUTH_SESSION_EXPIRED' });
    try {
      await setSessionCookie(ctx, value);
    } catch (error) {
      // Legacy delivery has no resumable receipt. Managed delivery keeps its
      // encrypted receipt and short candidate lease so the same operation can
      // resume; it is never made active merely by cookie serialization.
      if (!managed) await ctx.context.internalAdapter.deleteSession(token);
      throw mapRelayError(error);
    }
    return ctx.json({
      // Managed Web login uses only HttpOnly cookies. The explicit main-process
      // binding selects desktop delivery; its gateway never exposes the token.
      ...(!managed || ctx.headers?.get('x-musefold-login-binding') ? { token } : {}),
      ...(managed ? { managed: true } : {}),
      user: { id: value.user.id, email: value.user.email, name: value.user.name },
    });
  }

  function bindingFor(ctx: GenericEndpointContext, flowRef: string) {
    return (
      ctx.headers?.get('x-musefold-login-binding') ??
      ctx.getCookie(`musefold.login-flow.${flowRef}`) ??
      ''
    );
  }

  async function managedLogin(
    ctx: GenericEndpointContext,
    credentials: z.infer<typeof credentialsBody>,
  ) {
    const service = hooks.loginSessions;
    if (!service || !client.managedSessions) return null;
    const binding =
      ctx.headers?.get('x-musefold-login-binding') ?? randomBytes(32).toString('base64url');
    const review = await service.begin(
      {
        username: credentials.email,
        password: credentials.password,
        twoFactorCode: credentials.twoFactorCode,
      },
      binding,
      ctx.headers?.get('user-agent') ?? '',
    );
    ctx.setCookie(`musefold.login-flow.${review.flowRef}`, binding, {
      httpOnly: true,
      secure: new URL(ctx.context.baseURL).protocol === 'https:',
      sameSite: 'strict',
      path: new URL(ctx.context.baseURL).pathname,
      maxAge: 300,
    });
    if (review.sessions.required > 0) {
      ctx.setStatus(409);
      return ctx.json(
        {
          code: 'AUTH_SESSION_LIMIT',
          message: '登录设备数量已达上限，请选择要退出的设备',
          details: { review },
        },
        { status: 409 },
      );
    }
    const token = await service.complete(
      { flowRef: review.flowRef, operationId: randomUUID(), selected: [] },
      binding,
      ({ relay, username, managed }) => establishSession(ctx, username, relay, managed),
    );
    return acceptToken(ctx, token, true);
  }

  return {
    id: 'new-api-delegation',
    endpoints: {
      reviewLoginCapacity: createAuthEndpoint(
        '/login-capacity/review',
        { method: 'POST', body: loginCapacityRequestSchema },
        async (ctx) => {
          try {
            if (!hooks.loginSessions) throw { code: 'AUTH_SESSION_MANAGEMENT_UNAVAILABLE' };
            return ctx.json(
              await hooks.loginSessions.review(ctx.body.flowRef, bindingFor(ctx, ctx.body.flowRef)),
            );
          } catch (error) {
            throw mapRelayError(error);
          }
        },
      ),
      cancelLoginCapacity: createAuthEndpoint(
        '/login-capacity/cancel',
        { method: 'POST', body: loginCapacityRequestSchema },
        async (ctx) => {
          try {
            if (!hooks.loginSessions) throw { code: 'AUTH_SESSION_MANAGEMENT_UNAVAILABLE' };
            await hooks.loginSessions.cancel(ctx.body.flowRef, bindingFor(ctx, ctx.body.flowRef));
            return ctx.json({ cancelled: true });
          } catch (error) {
            throw mapRelayError(error);
          }
        },
      ),
      completeLoginCapacity: createAuthEndpoint(
        '/login-capacity/complete',
        { method: 'POST', body: completeLoginCapacitySchema },
        async (ctx) => {
          try {
            if (!hooks.loginSessions) throw { code: 'AUTH_SESSION_MANAGEMENT_UNAVAILABLE' };
            const token = await hooks.loginSessions.complete(
              ctx.body,
              bindingFor(ctx, ctx.body.flowRef),
              ({ relay, username, managed }) => establishSession(ctx, username, relay, managed),
            );
            return acceptToken(ctx, token, true);
          } catch (error) {
            throw mapRelayError(error);
          }
        },
      ),
      signInNewApi: createAuthEndpoint(
        '/sign-in/new-api',
        { method: 'POST', body: credentialsBody },
        async (ctx) => {
          let relay: RelayAuthSession;
          try {
            const managed = await managedLogin(ctx, ctx.body);
            if (managed) return managed;
            relay = await client.login({ username: ctx.body.email, password: ctx.body.password });
          } catch (error) {
            throw mapRelayError(error);
          }
          return acceptToken(ctx, await establishSession(ctx, ctx.body.email, relay));
        },
      ),
      signUpNewApi: createAuthEndpoint(
        '/sign-up/new-api',
        { method: 'POST', body: credentialsBody },
        async (ctx) => {
          let relay: RelayAuthSession;
          try {
            await client.register({ username: ctx.body.email, password: ctx.body.password });
            const managed = await managedLogin(ctx, ctx.body);
            if (managed) return managed;
            relay = await client.login({ username: ctx.body.email, password: ctx.body.password });
          } catch (error) {
            throw mapRelayError(error);
          }
          return acceptToken(ctx, await establishSession(ctx, ctx.body.email, relay));
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
