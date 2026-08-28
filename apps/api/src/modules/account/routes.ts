import { accountSummarySchema, redeemResultSchema } from '@musefold/contracts';
import { z } from 'zod';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import { RATE_LIMIT_POLICIES, type RateLimiter } from '../rate-limit/service.js';
import type { AccountService } from './service.js';

const redeemBody = z.object({ code: z.string().trim().min(4).max(128) });

/**
 * 账号域自有路由(登录/注册/登出/会话由 Better Auth 在 /api/auth/* 承接)。
 * 这里只保留 New API 委托面:余额状态与兑换码。
 */
export function accountRoutes(service: AccountService, rateLimiter: RateLimiter) {
  const app = createAuthedRouter();
  const tags = ['account'];

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
