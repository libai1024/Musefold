import { StrictMode, type ReactNode } from 'react';
import { act, render, renderHook, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformProvider, WEB_CAPABILITIES, type MusefoldGateway } from '@musefold/platform';
import {
  createDesignSchemeInputSchema,
  cloudModifyDesignSchemeInputSchema,
  cloudCheckDesignSchemeUpdateInputSchema,
  designSchemeAgentSessionSchema,
  designSchemeTextModelOfferSchema,
  type DesignSchemeAgentSession,
  type DesignSchemeAgentEventPage,
} from '@musefold/contracts';
import { expect, it, vi } from 'vitest';
import { useSchemeAgent } from '../use-scheme-agent';
import { SchemeAgentDialog } from '../SchemeAgentDialog';
import { beginAccountTransition } from '../../account/account-session';

const input = createDesignSchemeInputSchema.parse({
  executionId: 'original',
  brief: '水彩',
  sourceUris: [],
  sourceBindings: [],
  sourceAssetIds: [],
});
const offer = designSchemeTextModelOfferSchema.parse({
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
});
function session(patch: Partial<DesignSchemeAgentSession> = {}): DesignSchemeAgentSession {
  return designSchemeAgentSessionSchema.parse({
    executionId: 'original',
    operation: 'create',
    status: 'queued',
    version: 1,
    sourceCount: 0,
    confirmedSources: 0,
    pendingSource: null,
    blocker: null,
    result: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...patch,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const agent = {
    textModel: vi.fn(async () => offer),
    start: vi.fn(async () => session()),
    get: vi.fn(async (_id: string) => session()),
    events: vi.fn(
      async (_id: string, after: number): Promise<DesignSchemeAgentEventPage> => ({
        events: [],
        nextSeq: after,
      }),
    ),
    list: vi.fn(async () => ({
      items: [
        {
          executionId: 'original',
          operation: 'create',
          status: 'queued',
          version: 1,
          schemeId: null,
          schemeName: null,
          createdAt: inputDate,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    })),
    authorizeUpdate: vi.fn(async (_request: unknown) =>
      session({ operation: 'check-update', status: 'queued', version: 9 }),
    ),
    confirmSource: vi.fn(async (_decision: unknown) =>
      session({ status: 'compiling', version: 3 }),
    ),
    cancel: vi.fn(async (_id: string, _operation: string) =>
      session({ status: 'cancelled', version: 5 }),
    ),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const gateway = {
    designSchemes: { agent },
    account: { getStatus: vi.fn(async () => ({ id: 'owner', username: 'tester' })) },
  } as unknown as MusefoldGateway;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  return { agent, client, wrapper };
}
const inputDate = '2026-09-09T00:00:00.000Z';
function hook() {
  const f = setup();
  return {
    ...f,
    ...renderHook(
      ({ allowed, selected }) => useSchemeAgent({ operation: 'create', input: selected }, allowed),
      {
        wrapper: f.wrapper,
        initialProps: { allowed: true, selected: input },
      },
    ),
  };
}
it('requires explicit text consent, bounds the request and suppresses duplicate clicks', async () => {
  const f = hook();
  await act(() => f.result.current.start());
  expect(f.agent.start).not.toHaveBeenCalled();
  await act(() => f.result.current.loadOffer());
  expect(f.agent.start).not.toHaveBeenCalled();
  await act(() => Promise.all([f.result.current.start(), f.result.current.start()]));
  expect(f.agent.start).toHaveBeenCalledExactlyOnceWith({
    operation: 'create',
    input,
    text: {
      binding: offer.binding,
      maxModelCalls: 1,
      maxOutputTokens: 8192,
      acceptUnknownCost: true,
    },
  });
  f.unmount();
  expect(f.agent.cancel).not.toHaveBeenCalled();
});
it('a lost response is read by original ID and explicit replay preserves the frozen request after editing', async () => {
  const f = hook();
  f.agent.start.mockRejectedValueOnce(new Error('lost 202'));
  f.agent.get.mockRejectedValue(new Error('connection lost'));
  await act(() => f.result.current.loadOffer());
  await act(() => f.result.current.start());
  await waitFor(() => expect(f.agent.get).toHaveBeenCalledWith('original'));
  expect(f.agent.start).toHaveBeenCalledTimes(1);
  f.rerender({ allowed: true, selected: { ...input, executionId: 'new-input', brief: 'changed' } });
  await act(() => f.result.current.start());
  expect(f.agent.start.mock.calls[0]).toEqual(f.agent.start.mock.calls[1]);
  await waitFor(() => expect(f.result.current.session?.executionId).toBe('original'));
});
it('ignores an old response after an account transition', async () => {
  const f = hook();
  const pending = deferred<DesignSchemeAgentSession>();
  f.agent.start.mockImplementationOnce(() => pending.promise);
  await act(() => f.result.current.loadOffer());
  let running!: Promise<void>;
  act(() => {
    running = f.result.current.start();
  });
  act(() => {
    beginAccountTransition(f.client);
  });
  await act(async () => {
    pending.resolve(session());
    await running;
  });
  expect(f.result.current.session).toBeNull();
  expect(f.result.current.changedAccount).toBe(true);
  expect(f.agent.start).toHaveBeenCalledTimes(1);
});
it('late model offers cannot revive access after the dialog loses account permission', async () => {
  const f = hook();
  const pending = deferred<typeof offer>();
  f.agent.textModel.mockImplementationOnce(() => pending.promise);
  let running!: Promise<void>;
  act(() => {
    running = f.result.current.loadOffer();
  });
  f.rerender({ allowed: false, selected: input });
  await act(async () => {
    pending.resolve(offer);
    await running;
  });
  expect(f.result.current.offer).toBeNull();
  expect(f.agent.start).not.toHaveBeenCalled();
});
it('read failure hides the stale session and never dispatches a write', async () => {
  const f = hook();
  act(() => f.result.current.select('original'));
  await waitFor(() => expect(f.result.current.session?.version).toBe(1));
  f.agent.events.mockRejectedValueOnce(new Error('permission revoked'));
  await act(() => f.client.refetchQueries({ type: 'active' }));
  await waitFor(() => expect(f.result.current.readError).toBe(true));
  expect(f.result.current.session).toBeNull();
  expect(f.agent.start).not.toHaveBeenCalled();
  expect(f.agent.cancel).not.toHaveBeenCalled();
});
it.each(['wrong-id', 'wrong-operation', 'wrong-cursor', 'duplicate-sequence'])(
  'rejects invalid event continuity: %s',
  async (kind) => {
    const f = hook();
    act(() => f.result.current.select('original'));
    await waitFor(() => expect(f.result.current.session?.version).toBe(1));
    const next = session({
      version: 2,
      ...(kind === 'wrong-id' ? { executionId: 'foreign' } : {}),
      ...(kind === 'wrong-operation' ? { operation: 'modify' } : {}),
    });
    f.agent.events.mockResolvedValueOnce({
      events: [{ seq: kind === 'duplicate-sequence' ? 1 : 2, session: next }],
      nextSeq: kind === 'wrong-cursor' ? 4 : 2,
    });
    await act(() => f.client.refetchQueries({ type: 'active' }));
    await waitFor(() => expect(f.result.current.readError).toBe(true));
    expect(f.result.current.session).toBeNull();
    expect(f.agent.start).not.toHaveBeenCalled();
  },
);
it('a response from an earlier version cannot overwrite a later one', async () => {
  const f = hook();
  f.agent.get.mockResolvedValueOnce(session({ version: 4 }));
  act(() => f.result.current.select('original'));
  await waitFor(() => expect(f.result.current.session?.version).toBe(4));
  f.agent.get.mockResolvedValueOnce(session({ version: 2 }));
  await act(() => f.result.current.refresh());
  expect(f.result.current.session?.version).toBe(4);
});
it('source confirmation binds the parent execution and the current confirmation ID', async () => {
  const f = hook();
  f.agent.get.mockResolvedValue(
    session({
      version: 2,
      status: 'confirmation-required',
      sourceCount: 1,
      pendingSource: {
        executionId: 'child-source',
        confirmationId: 'confirm-current',
        status: 'ready',
        source: {
          repositoryUrl: 'https://github.com/owner/repo',
          name: '规则',
          description: '',
          resolvedRef: 'main',
          commitHash: null,
          textFileCount: 1,
          textNames: ['README.md'],
          imageFileCount: 0,
          license: null,
        },
        snapshotId: 'snapshot',
        contentHash: 'a'.repeat(64),
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    }),
  );
  act(() => f.result.current.select('original'));
  await waitFor(() =>
    expect(f.result.current.session?.pendingSource?.confirmationId).toBe('confirm-current'),
  );
  await act(() => f.result.current.confirm('old-confirmation'));
  expect(f.agent.confirmSource).not.toHaveBeenCalled();
  await act(() => f.result.current.confirm('confirm-current'));
  expect(f.agent.confirmSource).toHaveBeenCalledExactlyOnceWith({
    executionId: 'original',
    confirmationId: 'confirm-current',
    decision: 'install',
  });
});
it('history discovery is read only and close is distinct from explicit cancellation', async () => {
  const f = setup();
  const onClose = vi.fn();
  const ui = render(
    <SchemeAgentDialog onClose={onClose} onRestoreFocus={() => {}} onOpenScheme={() => {}} />,
    { wrapper: f.wrapper },
  );
  fireEvent.click(await screen.findByTestId('scheme-agent-recover-original'));
  await screen.findByTestId('scheme-agent-session');
  expect(f.agent.start).not.toHaveBeenCalled();
  expect(f.agent.textModel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(f.agent.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消此任务' }));
  expect(f.agent.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认取消任务' }));
  await waitFor(() => expect(f.agent.cancel).toHaveBeenCalledExactlyOnceWith('original', 'create'));
  ui.unmount();
});

const modifyInput = cloudModifyDesignSchemeInputSchema.parse({
  executionId: 'original',
  schemeId: 'scheme',
  baseRevisionId: 'selected-draft',
  expectedVersion: 7,
  instruction: '保留结构，换成柔和水彩',
});
function modifyHook() {
  const f = setup();
  f.agent.start.mockImplementation(async () => session({ operation: 'modify' }));
  f.agent.get.mockImplementation(async () => session({ operation: 'modify' }));
  return {
    ...f,
    ...renderHook((selected) => useSchemeAgent({ operation: 'modify', input: selected }, true), {
      wrapper: f.wrapper,
      initialProps: modifyInput,
    }),
  };
}
it('modify freezes exact revision/version and only grants one call after explicit consent', async () => {
  const f = modifyHook();
  await act(() => f.result.current.start());
  expect(f.agent.start).not.toHaveBeenCalled();
  await act(() => f.result.current.loadOffer());
  await act(() => Promise.all([f.result.current.start(), f.result.current.start()]));
  expect(f.agent.start).toHaveBeenCalledExactlyOnceWith({
    operation: 'modify',
    input: modifyInput,
    text: {
      binding: offer.binding,
      maxModelCalls: 1,
      maxOutputTokens: 8192,
      acceptUnknownCost: true,
    },
  });
  f.unmount();
  expect(f.agent.cancel).not.toHaveBeenCalled();
});
it('modify lost reply replays original instruction/version and uses modify when cancelling before any read', async () => {
  const f = modifyHook();
  f.agent.start.mockRejectedValueOnce(new Error('lost 202'));
  f.agent.get.mockRejectedValue(new Error('offline'));
  f.agent.cancel.mockImplementation(async () =>
    session({ operation: 'modify', status: 'cancelled', version: 5 }),
  );
  await act(() => f.result.current.loadOffer());
  await act(() => f.result.current.start());
  f.rerender({ ...modifyInput, executionId: 'new', expectedVersion: 99, instruction: 'different' });
  await act(() => f.result.current.cancel());
  expect(f.agent.cancel).toHaveBeenCalledExactlyOnceWith('original', 'modify');
  await act(() => f.result.current.start());
  expect(f.agent.start.mock.calls[0]).toEqual(f.agent.start.mock.calls[1]);
});
it('modify rejects a first GET with the wrong operation after lost acceptance', async () => {
  const f = modifyHook();
  f.agent.start.mockRejectedValueOnce(new Error('lost 202'));
  f.agent.get.mockResolvedValue(session());
  await act(() => f.result.current.loadOffer());
  await act(() => f.result.current.start());
  await waitFor(() => expect(f.result.current.readError).toBe(true));
  expect(f.result.current.session).toBeNull();
});
it('modify dialog explains the preserved formal version and requires its own one-call consent', async () => {
  const f = setup();
  f.agent.start.mockImplementation(async () => session({ operation: 'modify' }));
  f.agent.get.mockImplementation(async () => session({ operation: 'modify' }));
  const closed = vi.fn();
  render(
    <SchemeAgentDialog
      intent={{ operation: 'modify', input: modifyInput }}
      onClose={closed}
      onRestoreFocus={() => {}}
      onOpenScheme={() => {}}
    />,
    { wrapper: f.wrapper },
  );
  fireEvent.click(await screen.findByTestId('scheme-agent-model-offer'));
  expect((await screen.findByTestId('scheme-agent-authorization')).textContent).toContain(
    '本次最多 1 次模型调用',
  );
  expect(screen.getByText(/新版本需试运行验证/)).toBeTruthy();
  expect(f.agent.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('scheme-agent-authorize-modify'));
  await waitFor(() => expect(f.agent.start).toHaveBeenCalledOnce());
});

it('known modify version rejection explains recovery and offers no replay or background reads', async () => {
  const f = modifyHook();
  f.agent.start.mockRejectedValueOnce(
    Object.assign(new Error('conflict'), { details: { reason: 'AGENT_BASE_REVISION_CHANGED' } }),
  );
  await act(() => f.result.current.loadOffer());
  await act(() => f.result.current.start());
  expect(f.result.current.rejected).toBe(true);
  expect(f.result.current.error).toContain('本次修改未提交');
  expect(f.result.current.canReplay).toBe(false);
  expect(f.agent.get).not.toHaveBeenCalled();
  expect(f.agent.start).toHaveBeenCalledOnce();
});

const updateInput = cloudCheckDesignSchemeUpdateInputSchema.parse({
  executionId: 'original',
  schemeId: 'scheme',
  baseRevisionId: 'revision-4',
  expectedVersion: 7,
});
const updateChange = {
  sourceExecutionId: 'new-source',
  previousSnapshotId: 'old-snapshot',
  snapshotId: 'new-snapshot',
  previousCommit: 'a'.repeat(40),
  commit: 'b'.repeat(40),
  contentHash: 'c'.repeat(64),
};
function updateSession(patch: Partial<DesignSchemeAgentSession> = {}) {
  return session({
    operation: 'check-update',
    status: 'authorization-required',
    version: 8,
    sourceCount: 3,
    confirmedSources: 1,
    update: { checkedSources: 3, changes: [updateChange] },
    ...patch,
  });
}
it('starts a frozen free inspection without loading or sending text authorization', async () => {
  const f = setup();
  f.agent.start.mockResolvedValue(
    updateSession({
      status: 'queued',
      version: 1,
      confirmedSources: 0,
      update: { checkedSources: 0, changes: [] },
    }),
  );
  const h = renderHook(
    () => useSchemeAgent({ operation: 'check-update', input: updateInput }, true),
    { wrapper: f.wrapper },
  );
  await act(() => h.result.current.start());
  expect(f.agent.start).toHaveBeenCalledWith({ operation: 'check-update', input: updateInput });
  expect(f.agent.textModel).not.toHaveBeenCalled();
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  h.unmount();
  expect(f.agent.cancel).not.toHaveBeenCalled();
});
it('a recovered update requires a separate offer and consent bounded by changed sources', async () => {
  const f = setup();
  f.agent.get.mockResolvedValue(updateSession());
  const h = renderHook(() => useSchemeAgent(undefined, true), { wrapper: f.wrapper });
  act(() => h.result.current.select('original'));
  await waitFor(() => expect(h.result.current.session?.status).toBe('authorization-required'));
  expect(f.agent.textModel).not.toHaveBeenCalled();
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  await act(() => h.result.current.authorizeUpdate());
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  await act(() => h.result.current.loadOffer());
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  await act(() => h.result.current.authorizeUpdate());
  expect(f.agent.authorizeUpdate).toHaveBeenCalledWith({
    executionId: 'original',
    expectedSessionVersion: 8,
    text: {
      binding: offer.binding,
      maxModelCalls: 2,
      maxOutputTokens: 8192,
      acceptUnknownCost: true,
    },
  });
  expect(f.agent.start).not.toHaveBeenCalled();
});
it('lost update authorization replies replay the original version and offer without another start', async () => {
  const f = setup();
  f.agent.get.mockResolvedValue(updateSession());
  f.agent.authorizeUpdate.mockRejectedValue(new Error('lost reply'));
  const h = renderHook(() => useSchemeAgent(undefined, true), { wrapper: f.wrapper });
  act(() => h.result.current.select('original'));
  await waitFor(() => expect(h.result.current.session?.version).toBe(8));
  await act(() => h.result.current.loadOffer());
  await act(() => h.result.current.authorizeUpdate());
  const original = f.agent.authorizeUpdate.mock.calls[0]?.[0];
  f.agent.get.mockResolvedValue(updateSession({ version: 9 }));
  await act(() => h.result.current.refresh());
  await act(() => h.result.current.authorizeUpdate());
  expect(f.agent.authorizeUpdate.mock.calls.map(([value]) => value)).toEqual([original, original]);
  expect(original).toMatchObject({ expectedSessionVersion: 8 });
  expect(f.agent.textModel).toHaveBeenCalledTimes(1);
  expect(f.agent.start).not.toHaveBeenCalled();
});
it('an offer obtained before a session change cannot authorize the changed version', async () => {
  const f = setup();
  f.agent.get.mockResolvedValue(updateSession());
  const h = renderHook(() => useSchemeAgent(undefined, true), { wrapper: f.wrapper });
  act(() => h.result.current.select('original'));
  await waitFor(() => expect(h.result.current.session?.version).toBe(8));
  await act(() => h.result.current.loadOffer());
  f.agent.get.mockResolvedValue(updateSession({ version: 9 }));
  await act(() => h.result.current.refresh());
  await act(() => h.result.current.authorizeUpdate());
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  expect(h.result.current.offer).toBeNull();
  expect(f.agent.textModel).toHaveBeenCalledTimes(1);
});
it('account transition after update offer prevents authorization and hides the previous state', async () => {
  const f = setup();
  f.agent.get.mockResolvedValue(updateSession());
  const h = renderHook(() => useSchemeAgent(undefined, true), { wrapper: f.wrapper });
  act(() => h.result.current.select('original'));
  await waitFor(() => expect(h.result.current.session?.version).toBe(8));
  await act(() => h.result.current.loadOffer());
  act(() => beginAccountTransition(f.client));
  await act(() => h.result.current.authorizeUpdate());
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  expect(h.result.current.session).toBeNull();
});
it.each(['no-source', 'up-to-date'] as const)(
  'free %s results never request a text offer or authorization',
  async (status) => {
    const f = setup();
    f.agent.get.mockResolvedValue(
      updateSession({
        status,
        sourceCount: status === 'no-source' ? 0 : 3,
        confirmedSources: 0,
        update: { checkedSources: status === 'no-source' ? 0 : 3, changes: [] },
      }),
    );
    const h = renderHook(() => useSchemeAgent(undefined, true), { wrapper: f.wrapper });
    act(() => h.result.current.select('original'));
    await waitFor(() => expect(h.result.current.session?.status).toBe(status));
    await act(() => h.result.current.loadOffer());
    await act(() => h.result.current.authorizeUpdate());
    expect(f.agent.textModel).not.toHaveBeenCalled();
    expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  },
);
it('the update dialog presents free inspection and later independent changed-source consent', async () => {
  const f = setup();
  f.agent.start.mockResolvedValue(updateSession());
  const close = vi.fn();
  render(
    <SchemeAgentDialog
      intent={{ operation: 'check-update', input: updateInput }}
      onClose={close}
      onRestoreFocus={vi.fn()}
      onOpenScheme={vi.fn()}
    />,
    { wrapper: f.wrapper },
  );
  fireEvent.click(await screen.findByTestId('scheme-agent-check-update'));
  await screen.findByText('核对更新模型与费用');
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('scheme-agent-model-offer'));
  await screen.findByTestId('scheme-agent-authorize-check-update');
  expect(screen.getByTestId('scheme-agent-authorization').textContent).toContain('最多 2 次');
  expect(screen.getByTestId('scheme-agent-update-changes').textContent).toContain('已检查 3 / 3');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(close).toHaveBeenCalled();
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
  expect(f.agent.cancel).not.toHaveBeenCalled();
});

it('an automatic verified original update clears the lost-response error without resending', async () => {
  const f = setup();
  const reading = deferred<DesignSchemeAgentSession>();
  f.agent.start.mockRejectedValue(new Error('lost free acceptance'));
  f.agent.get.mockReturnValue(reading.promise);
  const h = renderHook(
    () => useSchemeAgent({ operation: 'check-update', input: updateInput }, true),
    { wrapper: f.wrapper },
  );
  await act(() => h.result.current.start());
  await waitFor(() => expect(h.result.current.error).toContain('操作结果尚未核对'));
  await act(async () => reading.resolve(updateSession()));
  await waitFor(() => expect(h.result.current.session?.status).toBe('authorization-required'));
  expect(h.result.current.error).toBeNull();
  expect(f.agent.start).toHaveBeenCalledTimes(1);
  expect(f.agent.authorizeUpdate).not.toHaveBeenCalled();
});
