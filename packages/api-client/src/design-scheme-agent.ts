import type { z } from 'zod';
import {
  startDesignSchemeAgentInputSchema,
  authorizeDesignSchemeUpdateInputSchema,
  confirmDesignSchemeAgentSourceInputSchema,
  cancelDesignSchemeAgentInputSchema,
  designSchemeAgentIdentitySchema,
  designSchemeAgentEventQuerySchema,
  designSchemeAgentHistoryQuerySchema,
  designSchemeAgentHistoryPageSchema,
  designSchemeAgentSessionSchema,
  designSchemeTextModelOfferSchema,
  designSchemeAgentEventPageSchema,
} from '@musefold/contracts';
import type { DesignSchemeAgentGateway } from '@musefold/platform';
import type { ApiHttp } from './http';

/** Explicit asynchronous cloud lifecycle; callers retain executionId and event cursor across reconnects. */
export function createCloudDesignSchemeAgentClient(http: ApiHttp) {
  const root = '/design-schemes/agent';
  const identity = (executionId: string) =>
    designSchemeAgentIdentitySchema.parse({ executionId }).executionId;
  const sessionFor = (
    executionId: string,
    operation?: z.infer<typeof designSchemeAgentSessionSchema>['operation'],
  ) =>
    designSchemeAgentSessionSchema.refine(
      (session) =>
        session.executionId === executionId && (!operation || session.operation === operation),
      'Agent response does not match the requested execution',
    );
  return {
    list: (query: z.input<typeof designSchemeAgentHistoryQuerySchema> = {}) =>
      http.request({
        method: 'GET',
        path: `${root}/executions`,
        query: designSchemeAgentHistoryQuerySchema.parse(query),
        response: designSchemeAgentHistoryPageSchema,
      }),
    textModel: () =>
      http.request({
        method: 'GET',
        path: `${root}/text-model`,
        response: designSchemeTextModelOfferSchema,
      }),
    start: (input: z.input<typeof startDesignSchemeAgentInputSchema>) => {
      const body = startDesignSchemeAgentInputSchema.parse(input);
      return http.request({
        method: 'POST',
        path: `${root}/executions`,
        body,
        response: sessionFor(body.input.executionId, body.operation),
      });
    },
    get: (executionId: string) => {
      const id = identity(executionId);
      return http.request({
        method: 'GET',
        path: `${root}/executions/${encodeURIComponent(id)}`,
        response: sessionFor(id),
      });
    },
    events: (executionId: string, afterSeq = 0) => {
      const id = identity(executionId);
      const query = designSchemeAgentEventQuerySchema.parse({ afterSeq });
      return http.request({
        method: 'GET',
        path: `${root}/executions/${encodeURIComponent(id)}/events`,
        query,
        response: designSchemeAgentEventPageSchema.refine((page) => {
          let previous = query.afterSeq;
          for (const event of page.events) {
            if (
              event.session.executionId !== id ||
              event.seq !== event.session.version ||
              event.seq <= previous
            )
              return false;
            previous = event.seq;
          }
          return page.nextSeq === previous;
        }, 'Agent events do not match the execution or cursor'),
      });
    },
    confirmSource: (input: z.input<typeof confirmDesignSchemeAgentSourceInputSchema>) => {
      const body = confirmDesignSchemeAgentSourceInputSchema.parse(input);
      return http.request({
        method: 'POST',
        path: `${root}/confirm-source`,
        body,
        response: sessionFor(body.executionId),
      });
    },
    authorizeUpdate: (input: z.input<typeof authorizeDesignSchemeUpdateInputSchema>) => {
      const body = authorizeDesignSchemeUpdateInputSchema.parse(input);
      return http.request({
        method: 'POST',
        path: `${root}/authorize-update`,
        body,
        response: sessionFor(body.executionId, 'check-update'),
      });
    },
    cancel: (
      executionId: string,
      operation?: z.infer<typeof cancelDesignSchemeAgentInputSchema>['operation'],
    ) => {
      const body = cancelDesignSchemeAgentInputSchema.parse({
        executionId,
        ...(operation ? { operation } : {}),
      });
      return http.request({
        method: 'POST',
        path: `${root}/cancel`,
        body,
        response: sessionFor(body.executionId),
      });
    },
  } satisfies DesignSchemeAgentGateway;
}
