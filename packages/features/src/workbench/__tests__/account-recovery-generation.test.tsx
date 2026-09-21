import {
  type AccountSummary,
  defaultAppPreferences,
  type GenerationJob,
} from '@musefold/contracts';
import {
  DESKTOP_CAPABILITIES,
  type MusefoldGateway,
  PlatformProvider,
  queryKeys,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginAccountTransition } from '../../account/account-session';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { useCreateGeneration, useRetryGeneration } from '../hooks';
import { useActiveSession } from '../session-store';
import { WorkbenchScreen } from '../WorkbenchScreen';

const ACCOUNT: AccountSummary = {
  id: 'owner-a',
  username: 'test-a',
  displayName: null,
  quota: 0,
  quotaUnit: 'points',
  canGenerate: false,
  identity: {
    apiIssuer: 'https://api.example.test',
    principalId: 'principal-a',
    identityVersion: 1,
    status: 'recovery_required',
  },
  recovery: {
    requestId: 'request-a',
    reason: 'legacy_evidence_missing',
    expiresAt: '2099-01-01T00:00:00.000Z',
    actions: ['retry'],
  },
};

function setup(account: AccountSummary | undefined = ACCOUNT, desktop = false) {
  const create = vi.fn(async () => ({ id: 'job-a' }) as GenerationJob);
  const retry = vi.fn(async () => ({ id: 'job-a' }) as GenerationJob);
  const createSession = vi.fn();
  const gateway = {
    account: {
      getStatus: async () => {
        if (!account) throw new Error('not signed in');
        return account;
      },
    },
    settings: { getPreferences: async () => defaultAppPreferences },
    generation: {
      create,
      retry,
      listProviders: async () => [{ id: 'provider-a', label: 'Test Provider', model: 'fake' }],
      list: async () => ({ items: [], nextCursor: null }),
    },
    workbench: { listSessions: async () => ({ items: [], nextCursor: null }), createSession },
    prompts: { list: async () => ({ items: [], nextCursor: null }) },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (account) client.setQueryData(queryKeys.account.status(), account);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PlatformProvider
          runtime={{ gateway, capabilities: desktop ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES }}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return { create, retry, createSession, client, Wrapper };
}

beforeEach(() => {
  useActiveSession.setState({
    activeSessionId: null,
    draftSession: true,
    pendingDraft: null,
    draftParamOverrides: {},
    seenAt: {},
    unreadMarks: {},
  });
  useScreenIntent.setState({ intent: null });
});

describe('recovery session generation boundary', () => {
  it.each([false, true])(
    'blocks create and retry before gateway dispatch (desktop=%s)',
    async (desktop) => {
      const { Wrapper, create, retry } = setup(ACCOUNT, desktop);
      const { result } = renderHook(
        () => ({ create: useCreateGeneration(), retry: useRetryGeneration() }),
        { wrapper: Wrapper },
      );
      await act(async () => {
        await expect(
          result.current.create.mutateAsync([{ prompt: 'keep this input' }, 'intent-a']),
        ).rejects.toThrow('账号恢复');
      });
      await act(async () => {
        await expect(result.current.retry.mutateAsync(['job-a', 'intent-b'])).rejects.toThrow(
          '账号恢复',
        );
      });
      expect(create).not.toHaveBeenCalled();
      expect(retry).not.toHaveBeenCalled();
    },
  );

  it('retains unsigned desktop BYOK generation', async () => {
    const { Wrapper, client, create } = setup(undefined, true);
    client.removeQueries({ queryKey: queryKeys.account.status() });
    const { result } = renderHook(() => useCreateGeneration(), { wrapper: Wrapper });
    await act(() => result.current.mutateAsync([{ prompt: 'BYOK image' }, 'intent-a']));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not expose a late result as mutation success after an account transition', async () => {
    const { Wrapper, client, create } = setup({
      ...ACCOUNT,
      identity: undefined,
      recovery: null,
      canGenerate: true,
    });
    let finish!: (job: GenerationJob) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCreateGeneration(), { wrapper: Wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync([{ prompt: 'old account' }, 'intent-a'], { onSuccess })
        .catch((error: Error) => error);
    });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    beginAccountTransition(client);
    await act(async () => {
      finish({ id: 'old-job' } as GenerationJob);
      await pending;
    });
    expect(await pending).toBeInstanceOf(Error);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does not replay a failed mutation under another account during automatic retry', async () => {
    const { Wrapper, client, create } = setup({
      ...ACCOUNT,
      identity: undefined,
      recovery: null,
      canGenerate: true,
    });
    client.setMutationDefaults([], { retry: 1, retryDelay: 0 });
    create.mockImplementationOnce(async () => {
      beginAccountTransition(client);
      throw Object.assign(new Error('old account quota'), { code: 'ACCOUNT_QUOTA_INSUFFICIENT' });
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useCreateGeneration(), { wrapper: Wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync([{ prompt: 'old request' }, 'intent-a'], { onError }),
      ).rejects.toThrow('账号已切换');
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).not.toMatchObject({ code: 'ACCOUNT_QUOTA_INSUFFICIENT' });
  });

  it.each([false, true])(
    'shows recovery guidance, preserves the draft and disables submit (desktop=%s)',
    async (desktop) => {
      const { Wrapper, create, createSession } = setup(ACCOUNT, desktop);
      const onOpenSettings = vi.fn();
      render(<WorkbenchScreen onOpenSettings={onOpenSettings} />, { wrapper: Wrapper });
      const prompt = await screen.findByTestId('composer-prompt');
      fireEvent.change(prompt, { target: { value: 'keep my draft' } });
      expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);
      fireEvent.keyDown(prompt, { key: 'Enter' });
      expect((prompt as HTMLTextAreaElement).value).toBe('keep my draft');
      expect(create).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '恢复账号' }));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      expect(useScreenIntent.getState().intent).toEqual({ kind: 'settings-account' });
      expect(screen.queryByText('去兑换')).toBeNull();
    },
  );
});
