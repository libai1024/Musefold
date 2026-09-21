import { run } from 'graphile-worker';
import type { Pool } from 'pg';
import { z } from 'zod';
import { opaqueIdSchema } from '@musefold/contracts';
import { SCHEME_AGENT_TASK, type DesignSchemeAgentService } from './service.js';

const payloadSchema = z.object({ userId: z.string().min(1), executionId: opaqueIdSchema }).strict();

/** Separate Graphile consumer of API-domain tasks; generation workers never import API code. */
export function startDesignSchemeAgentWorker(pool: Pool, service: DesignSchemeAgentService) {
  return run({
    pgPool: pool,
    concurrency: 2,
    noHandleSignals: true,
    taskList: {
      [SCHEME_AGENT_TASK]: async (raw) => {
        const payload = payloadSchema.parse(raw);
        await service.process(payload.userId, payload.executionId);
      },
      'design-scheme-agent/reconcile': async () => service.reconcile(),
    },
    crontab: '* * * * * design-scheme-agent/reconcile',
  });
}
