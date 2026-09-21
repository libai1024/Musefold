import { createHash } from 'node:crypto';
import type { GenericEndpointContext } from '@better-auth/core';
import {
  getOAuthProviderApi,
  getOAuthProviderState,
  type OAuthOptions,
} from '@better-auth/oauth-provider';
import {
  cloudMcpClientDisplayName,
  cloudMcpOAuthRequestSchema,
  cloudMcpOAuthReviewSchema,
} from '@musefold/contracts';
import { openJsonFromString, sealJsonToString } from '@musefold/server-crypto';
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { z } from 'zod';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const proofSchema = z
  .object({
    kind: z.literal('musefold-oauth-review'),
    query: z.string(),
    client: z.string(),
    user: z.string(),
    session: z.string(),
    expires: z.number(),
  })
  .strict();
const denied = () =>
  new APIError('FORBIDDEN', {
    code: 'FORBIDDEN',
    message: '授权请求已变化或过期，请返回应用重新发起授权',
  });

/** Runs after the provider's signature hook; never reimplements its signed-query crypto. */
export function oauthBrowser(options: OAuthOptions<string[]>, origins: string[]): BetterAuthPlugin {
  async function reviewContext(ctx: GenericEndpointContext) {
    ctx.setHeader('Cache-Control', 'private, no-store');
    if (!origins.includes(ctx.headers?.get('origin') ?? '')) throw denied();
    const input = cloudMcpOAuthRequestSchema.safeParse({ oauth_query: ctx.body?.oauth_query });
    const state = await getOAuthProviderState();
    if (!input.success || !state?.query) throw denied();
    const query = new URLSearchParams(state.query);
    // No ambiguous first/last-value interpretation between preview and provider.
    // The provider's repeated ba_param signature manifest is not an OAuth field.
    for (const name of [
      'client_id',
      'redirect_uri',
      'scope',
      'state',
      'response_type',
      'prompt',
      'max_age',
      'code_challenge',
      'code_challenge_method',
    ]) {
      if (query.getAll(name).length > 1) throw denied();
    }
    query.delete('ba_param');
    const scopes = cloudMcpOAuthReviewSchema.shape.scopes.safeParse(query.get('scope')?.split(' '));
    if (!scopes.success || new Set(scopes.data).size !== scopes.data.length) throw denied();
    const client = await getOAuthProviderApi(ctx, options).getClient(query.get('client_id') ?? '');
    if (!client || client.disabled) throw denied();
    const clientFingerprint = digest(
      JSON.stringify({
        id: client.clientId,
        name: client.name,
        uri: client.uri,
        redirects: client.redirectUris,
        scopes: client.scopes,
      }),
    );
    const current = await getSessionFromCtx(ctx, {
      disableCookieCache: true,
      disableRefresh: true,
    });
    const createdAt = current ? new Date(current.session.createdAt).getTime() : 0;
    const fresh =
      !!current && !!state.signedQueryIssuedAt && createdAt >= state.signedQueryIssuedAt.getTime();
    const prompts = (query.get('prompt') ?? '').split(' ').filter(Boolean);
    const maxAge = query.get('max_age');
    const loginRequired =
      !current ||
      (!fresh &&
        (prompts.includes('login') ||
          (maxAge !== null && Date.now() - createdAt > Number(maxAge) * 1000)));
    if (fresh) {
      const remaining = prompts.filter((value) => value !== 'login');
      if (remaining.length) query.set('prompt', remaining.join(' '));
      else query.delete('prompt');
      query.delete('max_age');
    }
    return {
      input: input.data,
      query,
      scopes: scopes.data,
      client,
      clientFingerprint,
      current,
      loginRequired,
    };
  }
  return {
    id: 'musefold-oauth-browser',
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === '/oauth2/consent',
          handler: createAuthMiddleware(async (ctx) => {
            const value = await reviewContext(ctx);
            const encoded = ctx.headers?.get('x-musefold-oauth-review');
            if (!encoded || encoded.length > 4096 || !value.current || value.loginRequired)
              throw denied();
            try {
              const proof = proofSchema.parse(openJsonFromString(encoded, ctx.context.secret));
              if (
                proof.expires <= Date.now() ||
                proof.query !== digest(value.input.oauth_query) ||
                proof.client !== value.clientFingerprint ||
                proof.user !== value.current.user.id ||
                proof.session !== value.current.session.id
              )
                throw denied();
            } catch {
              throw denied();
            }
          }),
        },
      ],
    },
    endpoints: {
      musefoldOAuthReview: createAuthEndpoint(
        '/musefold/oauth-review',
        {
          method: 'POST',
          body: cloudMcpOAuthRequestSchema,
        },
        async (ctx) => {
          const value = await reviewContext(ctx);
          let origin: string | null = null;
          try {
            const url = new URL(value.client.uri ?? '');
            if (url.protocol === 'https:' || url.protocol === 'http:') origin = url.origin;
          } catch {
            /* Client metadata may omit a website. Never fetch icons or arbitrary URLs. */
          }
          return cloudMcpOAuthReviewSchema.parse({
            client: {
              id: value.client.clientId,
              name: cloudMcpClientDisplayName(value.client.name, value.client.clientId),
              origin,
            },
            scopes: value.scopes,
            account: value.current
              ? {
                  id: value.current.user.id,
                  name: value.current.user.name.slice(0, 120) || '当前账号',
                }
              : null,
            loginRequired: value.loginRequired,
            continueUrl: value.loginRequired
              ? null
              : `${new URL(ctx.context.baseURL).pathname}/oauth2/authorize?${value.query}`,
            reviewRef:
              !value.current || value.loginRequired
                ? null
                : sealJsonToString(
                    {
                      kind: 'musefold-oauth-review',
                      query: digest(value.input.oauth_query),
                      client: value.clientFingerprint,
                      user: value.current.user.id,
                      session: value.current.session.id,
                      expires: Date.now() + 5 * 60_000,
                    },
                    ctx.context.secret,
                  ),
          });
        },
      ),
    },
  };
}
