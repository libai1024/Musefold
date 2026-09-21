import { expect, it, vi } from 'vitest';
import { ApiHttp } from '../http';
import { createCloudDesignSchemeAgentClient } from '../design-scheme-agent';
import { startDesignSchemeAgentInputSchema } from '@musefold/contracts';
it('uses durable Agent identities and a separate cancel surface without polling or inventing a result', async () => {
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
    createdAt: '2026-09-09T00:00:00Z',
    expiresAt: '2026-09-09T01:00:00Z',
  };
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json(String(url).includes('/events') ? { events: [], nextSeq: 3 } : session);
  });
  const client = createCloudDesignSchemeAgentClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
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
  expect(await client.start(input)).toEqual(session);
  await client.get('agent-1');
  expect(await client.events('agent-1', 3)).toEqual({ events: [], nextSeq: 3 });
  await client.confirmSource({
    executionId: 'agent-1',
    confirmationId: 'confirmation-1',
    decision: 'install',
  });
  await client.cancel('agent-1');
  expect(calls.map((item) => item.url)).toEqual([
    '/api/v1/design-schemes/agent/executions',
    '/api/v1/design-schemes/agent/executions/agent-1',
    '/api/v1/design-schemes/agent/executions/agent-1/events?afterSeq=3',
    '/api/v1/design-schemes/agent/confirm-source',
    '/api/v1/design-schemes/agent/cancel',
  ]);
  expect(calls[0].body).toEqual(startDesignSchemeAgentInputSchema.parse(input));
  expect(calls[3].body).toMatchObject({ confirmationId: 'confirmation-1' });
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it('reads an explicit text offer through the typed client without starting a model call', async () => {
  const offer = {
    binding: {
      apiIssuer: 'https://api.example.test',
      principalId: 'owner',
      payer: { issuer: 'https://account.example.test', ownerId: 'payer' },
      credential: { ref: 'credential', version: 1 },
      providerId: 'cloud-agent',
      model: 'operator-text',
      capabilities: { image: false, text: true },
      policyVersion: 'agent-text-v1',
    },
    maxModelCalls: 17,
    maxOutputTokens: 8192,
    cost: 'unknown',
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(offer));
  const client = createCloudDesignSchemeAgentClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  expect(await client.textModel()).toEqual(offer);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe('/api/v1/design-schemes/agent/text-model');
  expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
});

it('preserves the exact modify base and authorization and sends a modify cancel-before-start identity', async () => {
  const session = {
    executionId: 'modify-1',
    operation: 'modify',
    status: 'queued',
    version: 1,
    sourceCount: 0,
    confirmedSources: 0,
    pendingSource: null,
    blocker: null,
    result: null,
    createdAt: '2026-09-09T00:00:00Z',
    expiresAt: '2026-09-09T01:00:00Z',
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(session));
  const client = createCloudDesignSchemeAgentClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  const input = {
    operation: 'modify' as const,
    input: {
      executionId: 'modify-1',
      schemeId: 'scheme-1',
      baseRevisionId: 'revision-1',
      expectedVersion: 3,
      instruction: 'Change to red',
    },
    text: {
      binding: {
        apiIssuer: 'https://api.example.test',
        principalId: 'owner',
        payer: { issuer: 'https://account.example.test', ownerId: 'payer' },
        credential: { ref: 'credential', version: 1 },
        providerId: 'cloud-agent' as const,
        model: 'operator-text',
        capabilities: { image: false as const, text: true as const },
        policyVersion: 'agent-text-v1' as const,
      },
      maxModelCalls: 1,
      maxOutputTokens: 8192 as const,
      acceptUnknownCost: true as const,
    },
  };
  expect(await client.start(input)).toEqual(session);
  await client.cancel('modify-1', 'modify');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(
    startDesignSchemeAgentInputSchema.parse(input),
  );
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    executionId: 'modify-1',
    operation: 'modify',
  });
});

it('starts free update inspection without automatically authorizing, then sends the exact confirmation-stage version and text scope', async () => {
  const session = {
    executionId: 'update',
    operation: 'check-update',
    status: 'queued',
    version: 1,
    sourceCount: 1,
    confirmedSources: 0,
    pendingSource: null,
    blocker: null,
    result: null,
    update: { checkedSources: 0, changes: [] },
    createdAt: '2026-09-09T00:00:00Z',
    expiresAt: '2026-09-09T01:00:00Z',
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(session));
  const client = createCloudDesignSchemeAgentClient(new ApiHttp({ baseUrl: '', fetch: fetcher }));
  const input = {
    operation: 'check-update' as const,
    input: {
      executionId: 'update',
      schemeId: 'scheme',
      baseRevisionId: 'base',
      expectedVersion: 2,
    },
  };
  expect(await client.start(input)).toEqual(session);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const scope = {
    executionId: 'update',
    expectedSessionVersion: 6,
    text: {
      binding: {
        apiIssuer: 'https://api.example.test',
        principalId: 'owner',
        payer: { issuer: 'https://account.example.test', ownerId: 'payer' },
        credential: { ref: 'credential', version: 1 },
        providerId: 'cloud-agent' as const,
        model: 'operator-text',
        policyVersion: 'agent-text-v1' as const,
        capabilities: { image: false as const, text: true as const },
      },
      maxModelCalls: 2,
      maxOutputTokens: 8192 as const,
      acceptUnknownCost: true as const,
    },
  };
  await client.authorizeUpdate(scope);
  await client.cancel('update', 'check-update');
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(String(fetcher.mock.calls[1][0])).toBe('/api/v1/design-schemes/agent/authorize-update');
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(
    startDesignSchemeAgentInputSchema.parse(input),
  );
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(scope);
  expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
    executionId: 'update',
    operation: 'check-update',
  });
});
