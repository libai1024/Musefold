import { usageSummaryQuerySchema, usageSummarySchema } from '@musefold/contracts';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { UsageService } from './service.js';

export function usageRoutes(service: UsageService) {
  const app = createAuthedRouter();

  route(
    app,
    {
      method: 'get',
      path: '/usage/summary',
      tags: ['usage'],
      summary: '使用统计汇总(owner 作用域,按 range 聚合生成任务)',
      query: usageSummaryQuerySchema,
      response: usageSummarySchema,
    },
    async (c, input) => c.json(await service.summary(c.get('userId'), input.query.range)),
  );

  return app;
}
