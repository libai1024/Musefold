import { expect, it, vi } from 'vitest';
import { createCloudDataGateway } from '../gateway';
import { createCloudDesignSchemeAgentClient } from '../design-scheme-agent';
import { ApiHttp } from '../http';

const session = {
  executionId: 'agent-1',
  operation: 'create',
  status: 'queued',
  version: 1,
  sourceCount: 0,
  confirmedSources: 0,
  pendingSource: null,
  blocker: null,
  result: null,
  createdAt: '2026-09-09T00:00:00.000Z',
  expiresAt: '2026-09-09T01:00:00.000Z',
};
it('exposes asynchronous discovery through the actual gateway without starting or polling a task', async () => {
  const record = {
    executionId: session.executionId,
    operation: session.operation,
    status: session.status,
    version: session.version,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    schemeId: null,
    schemeName: null,
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ items: [record], nextCursor: 'agent-1' }),
  );
  const gateway = createCloudDataGateway({ baseUrl: '', fetch: fetcher });
  const agent = gateway.designSchemes?.agent;
  if (!agent) throw new Error('Missing asynchronous Agent gateway');
  expect(await agent.list({ limit: 2, cursor: 'agent-2' })).toEqual({
    items: [record],
    nextCursor: 'agent-1',
  });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    '/api/v1/design-schemes/agent/executions?cursor=agent-2&limit=2',
    expect.objectContaining({ method: 'GET', credentials: 'include' }),
  );
  expect(gateway.designSchemes?.create).toBeTypeOf('function');
  fetcher.mockResolvedValueOnce(
    Response.json({ items: [{ ...record, request: { brief: 'private' } }], nextCursor: null }),
  );
  await expect(agent.list({ limit: 2 })).rejects.toThrow();
});
it('rejects malformed identities, cursors and confirmations before any HTTP call', () => {
  const fetcher = vi.fn();
  const agent = createCloudDesignSchemeAgentClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  expect(() => agent.get('../foreign')).toThrow();
  expect(() => agent.events('agent-1', -1)).toThrow();
  expect(() => agent.events('agent-1', Number.POSITIVE_INFINITY)).toThrow();
  expect(() => agent.list({ limit: 51 })).toThrow();
  expect(() => agent.cancel('https://foreign.test')).toThrow();
  expect(() =>
    agent.confirmSource({ executionId: 'agent-1', confirmationId: '', decision: 'install' }),
  ).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('keeps a 202 response pending and rejects a response for another execution', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(session, { status: 202 }));
  const agent = createCloudDesignSchemeAgentClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  const input = {
    operation: 'create' as const,
    input: {
      executionId: 'agent-1',
      brief: 'Test',
      sourceUris: [],
      sourceBindings: [],
      sourceAssetIds: [],
    },
  };
  expect((await agent.start(input)).status).toBe('queued');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(Response.json({ ...session, executionId: 'foreign' }));
  await expect(agent.get('agent-1')).rejects.toThrow('does not match');
});
it.each([
  { events: [{ seq: 2, session: { ...session, version: 2, executionId: 'foreign' } }], nextSeq: 2 },
  { events: [{ seq: 2, session }], nextSeq: 2 },
  { events: [{ seq: 1, session }], nextSeq: 1 },
  {
    events: [
      { seq: 2, session: { ...session, version: 2 } },
      { seq: 2, session: { ...session, version: 2 } },
    ],
    nextSeq: 2,
  },
  { events: [], nextSeq: 9 },
])('rejects mixed, old, duplicate or cursor-skipping event pages %j', async (page) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(page));
  const agent = createCloudDesignSchemeAgentClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  await expect(agent.events('agent-1', 1)).rejects.toThrow('events do not match');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
