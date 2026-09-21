import {
  startDesignSchemeAgentInputSchema,
  authorizeDesignSchemeUpdateInputSchema,
  designSchemeTextModelOfferSchema,
  cancelDesignSchemeAgentInputSchema,
  designSchemeAgentIdentitySchema,
  designSchemeAgentSessionSchema,
  confirmDesignSchemeAgentSourceInputSchema,
  designSchemeAgentEventQuerySchema,
  designSchemeAgentEventPageSchema,
  designSchemeAgentHistoryQuerySchema,
  designSchemeAgentHistoryPageSchema,
} from '@musefold/contracts';
import { AppError } from '../../lib/errors.js';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { RateLimiter } from '../rate-limit/service.js';
import type { DesignSchemeAgentService } from './service.js';

export function designSchemeAgentRoutes(service: DesignSchemeAgentService, limiter: RateLimiter) {
  const app = createAuthedRouter();
  const tags = ['design-scheme-agent'];
  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/agent/executions',
      tags,
      query: designSchemeAgentHistoryQuerySchema,
      response: designSchemeAgentHistoryPageSchema,
    },
    async (c, input) => {
      c.header('Cache-Control', 'private, no-store');
      return c.json(await safe(service.list(c.get('userId'), c.get('sessionId'), input.query)));
    },
  );
  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/agent/text-model',
      tags,
      response: designSchemeTextModelOfferSchema,
    },
    async (c) => {
      await limiter.assertAllowed('scheme-agent-text-model', c.get('userId'), {
        capacity: 5,
        windowSeconds: 60,
      });
      return c.json(await safe(service.textModelOffer(c.get('userId'), c.get('sessionId'))));
    },
  );
  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/agent/executions',
      tags,
      body: startDesignSchemeAgentInputSchema,
      response: designSchemeAgentSessionSchema,
      status: 202,
    },
    async (c, input) => {
      await limiter.assertAllowed('scheme-agent-start', c.get('userId'), {
        capacity: 20,
        windowSeconds: 60,
      });
      return c.json(
        await safe(service.start(c.get('userId'), input.body, c.get('sessionId'))),
        202,
      );
    },
  );
  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/agent/executions/{executionId}',
      tags,
      params: designSchemeAgentIdentitySchema,
      response: designSchemeAgentSessionSchema,
    },
    async (c, input) => c.json(await safe(service.get(c.get('userId'), input.params.executionId))),
  );
  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/agent/executions/{executionId}/events',
      tags,
      params: designSchemeAgentIdentitySchema,
      query: designSchemeAgentEventQuerySchema,
      response: designSchemeAgentEventPageSchema,
    },
    async (c, input) =>
      c.json(
        await safe(
          service.eventPage(c.get('userId'), input.params.executionId, input.query.afterSeq),
        ),
      ),
  );
  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/agent/confirm-source',
      tags,
      body: confirmDesignSchemeAgentSourceInputSchema,
      response: designSchemeAgentSessionSchema,
    },
    async (c, input) => c.json(await safe(service.confirm(c.get('userId'), input.body))),
  );
  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/agent/cancel',
      tags,
      body: cancelDesignSchemeAgentInputSchema,
      response: designSchemeAgentSessionSchema,
    },
    async (c, input) => {
      await limiter.assertAllowed('scheme-agent-cancel', c.get('userId'), {
        capacity: 60,
        windowSeconds: 60,
      });
      return c.json(
        await safe(service.cancel(c.get('userId'), input.body.executionId, input.body.operation)),
      );
    },
  );
  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/agent/authorize-update',
      tags,
      body: authorizeDesignSchemeUpdateInputSchema,
      response: designSchemeAgentSessionSchema,
    },
    async (c, input) => {
      await limiter.assertAllowed('scheme-agent-authorize-update', c.get('userId'), {
        capacity: 20,
        windowSeconds: 60,
      });
      return c.json(
        await safe(service.authorizeUpdate(c.get('userId'), c.get('sessionId'), input.body)),
      );
    },
  );
  return app;
}

/** PG errors can carry private request JSON; keep them out of the generic HTTP error logger. */
async function safe<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INTERNAL_ERROR', '方案任务服务暂时不可用，请使用原任务重试', 503, true);
  }
}
