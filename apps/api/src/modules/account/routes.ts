import {
  accountSummarySchema,
  accountNoticesSchema,
  accountModelCatalogSchema,
  redeemResultSchema,
  accountExecutionBindingSchema,
  accountRecoveryRequestSchema,
  accountRecoveryReviewSchema,
  loginSessionPageSchema,
  revokeLoginSessionsSchema,
  revokeLoginSessionsResultSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import { RATE_LIMIT_POLICIES, type RateLimiter } from '../rate-limit/service.js';
import type { AccountService } from './service.js';

const redeemBody = z.object({ code: z.string().trim().min(4).max(128) });

/**
 * 账号域自有路由(登录/注册/登出/会话由 Better Auth 在 /api/auth/* 承接)。
 * 提供去敏账号状态、可信执行绑定与受限恢复入口,兑换仅允许普通会话。
 */
export function accountRoutes(service: AccountService, rateLimiter: RateLimiter) {
  const app = createAuthedRouter();
  const tags = ['account'];

  route(
    app,
    { method: 'get', path: '/account/notices', tags, response: accountNoticesSchema },
    async (c) => {
      c.header('Cache-Control', 'private, no-store');
      return c.json(await service.getNotices(c.get('sessionId')));
    },
  );

  route(
    app,
    { method: 'get', path: '/account/login-sessions', tags, response: loginSessionPageSchema },
    async (c) => {
      c.header('Cache-Control', 'private, no-store');
      return c.json(await service.listLoginSessions(c.get('sessionId')));
    },
  );
  route(
    app,
    {
      method: 'post',
      path: '/account/login-sessions/revoke',
      tags,
      body: revokeLoginSessionsSchema,
      response: revokeLoginSessionsResultSchema,
    },
    async (c, input) => {
      c.header('Cache-Control', 'private, no-store');
      await rateLimiter.assertAllowed(
        'login-session-revoke',
        c.get('userId'),
        RATE_LIMIT_POLICIES.accountLogin,
      );
      return c.json(await service.revokeLoginSessions(c.get('sessionId'), input.body));
    },
  );
  route(
    app,
    {
      method: 'post',
      path: '/account/login-sessions/touch',
      tags,
      body: z.object({ acknowledge: z.boolean().default(false) }).strict(),
      response: z.object({ confirmed: z.literal(true) }),
    },
    async (c, input) => {
      c.header('Cache-Control', 'private, no-store');
      await service.touchLoginSession(c.get('sessionId'), input.body.acknowledge);
      return c.json({ confirmed: true as const });
    },
  );

  route(
    app,
    { method: 'get', path: '/account/models', tags, response: accountModelCatalogSchema },
    async (c) => {
      c.header('Cache-Control', 'private, no-store');
      await rateLimiter.assertAllowed(
        'account-models',
        c.get('userId'),
        RATE_LIMIT_POLICIES.accountLogin,
      );
      return c.json(await service.getModelCatalog(c.get('sessionId')));
    },
  );

  route(
    app,
    {
      method: 'get',
      path: '/account/execution-binding',
      tags,
      response: accountExecutionBindingSchema,
    },
    async (c) => c.json(await service.getExecutionBinding(c.get('sessionId'))),
  );

  for (const [path, action, response] of [
    ['retry', service.recovery.retry.bind(service.recovery), accountSummarySchema],
    ['inspect', service.recovery.inspect.bind(service.recovery), accountRecoveryReviewSchema],
    [
      'verify-original-session',
      service.recovery.verifyOriginal.bind(service.recovery),
      accountSummarySchema,
    ],
    [
      'independent-workspace',
      service.recovery.independent.bind(service.recovery),
      accountSummarySchema,
    ],
  ] as const) {
    route(
      app,
      {
        method: 'post',
        path: `/account/recovery/${path}`,
        tags,
        body: accountRecoveryRequestSchema,
        response,
      },
      async (c, input) => {
        await rateLimiter.assertAllowed(
          'account-recovery',
          c.get('userId'),
          RATE_LIMIT_POLICIES.accountLogin,
        );
        return c.json(await action(c.get('sessionId'), input.body.requestId));
      },
    );
  }

  route(
    app,
    { method: 'get', path: '/account/status', tags, response: accountSummarySchema },
    async (c) => c.json(await service.getStatus(c.get('sessionId'))),
  );

  route(
    app,
    {
      method: 'post',
      path: '/account/redeem',
      tags,
      body: redeemBody,
      response: redeemResultSchema,
    },
    async (c, input) => {
      await rateLimiter.assertAllowed(
        'account-redeem',
        c.get('userId'),
        RATE_LIMIT_POLICIES.accountRedeem,
      );
      return c.json(await service.redeem(c.get('sessionId'), input.body.code));
    },
  );

  return app;
}
