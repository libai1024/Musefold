import type { GenericEndpointContext } from '@better-auth/core';
import type { NewApiClient, RelayAuthSession } from '@musefold/new-api-client';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

/**
 * 凭据委托插件:Musefold 不存密码,登录/注册请求原样转给自托管 New API 网关校验,
 * 成功后在 Better Auth 侧 upsert 用户并建立会话(Web cookie + 桌面 bearer token 双通道)。
 */
export interface NewApiDelegationHooks {
  /** 会话建立后持久化中继凭据与生图 token(加密入库,失败即整个登录失败)。 */
  onSessionEstablished: (input: {
    userId: string;
    sessionId: string;
    newApiUserId: number;
    relay: RelayAuthSession;
  }) => Promise<void>;
}

const credentialsBody = z.object({
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(256),
});

type RelayErrorLike = { code?: unknown; message?: unknown };

function mapRelayError(error: unknown): APIError {
  const raw = (error ?? {}) as RelayErrorLike;
  const code = typeof raw.code === 'string' ? raw.code : 'server';
  const message = typeof raw.message === 'string' ? raw.message : '账号服务暂时不可用';
  if (code === 'credentials') {
    return new APIError('UNAUTHORIZED', { code: 'AUTH_CREDENTIALS_INVALID', message });
  }
  if (code === 'conflict') {
    return new APIError('CONFLICT', { code: 'VALIDATION_FAILED', message });
  }
  if (code === 'auth') {
    return new APIError('UNAUTHORIZED', { code: 'AUTH_SESSION_EXPIRED', message });
  }
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
  ) {
    const internal = ctx.context.internalAdapter;
    const existing = await internal.findUserByEmail(email);
    let user = existing?.user ?? null;
    if (!user) {
      user = await internal.createUser(
        {
          email,
          name: relay.user.username,
          emailVerified: true,
          newApiUserId: relay.user.id,
        },
        { method: 'new-api-delegation' },
      );
    } else if ((user as { newApiUserId?: number | null }).newApiUserId !== relay.user.id) {
      user = await internal.updateUser(user.id, { newApiUserId: relay.user.id });
    }
    const session = await internal.createSession(user.id);
    await hooks.onSessionEstablished({
      userId: user.id,
      sessionId: session.id,
      newApiUserId: relay.user.id,
      relay,
    });
    await setSessionCookie(ctx, { session, user });
    return ctx.json({
      token: session.token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  }

  return {
    id: 'new-api-delegation',
    endpoints: {
      signInNewApi: createAuthEndpoint(
        '/sign-in/new-api',
        { method: 'POST', body: credentialsBody },
        async (ctx) => {
          let relay: RelayAuthSession;
          try {
            relay = await client.login({ username: ctx.body.email, password: ctx.body.password });
          } catch (error) {
            throw mapRelayError(error);
          }
          return establishSession(ctx, ctx.body.email, relay);
        },
      ),
      signUpNewApi: createAuthEndpoint(
        '/sign-up/new-api',
        { method: 'POST', body: credentialsBody },
        async (ctx) => {
          let relay: RelayAuthSession;
          try {
            await client.register({ username: ctx.body.email, password: ctx.body.password });
            relay = await client.login({ username: ctx.body.email, password: ctx.body.password });
          } catch (error) {
            throw mapRelayError(error);
          }
          return establishSession(ctx, ctx.body.email, relay);
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
