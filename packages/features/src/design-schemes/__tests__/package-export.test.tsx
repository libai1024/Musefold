import {
  PlatformProvider,
  WEB_CAPABILITIES,
  queryKeys,
  type MusefoldGateway,
} from '@musefold/platform';
import type {
  DesignSchemePackageExport,
  DesignSchemePackageDelivery,
  DesignSchemePackageExportRecovery,
} from '@musefold/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { usePackageExport } from '../use-package-export';
import { SchemePackageExportDialog } from '../SchemePackageExportDialog';
import { beginAccountTransition } from '../../account/account-session';

const selection = { schemeId: 'scheme', revisionId: 'formal_revision', expectedVersion: 4 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let stage: DesignSchemePackageExport;
  const transport = {
    begin: vi.fn(async (input) => {
      stage = {
        ...input,
        exportId: 'export_1',
        status: 'ready',
        packageHash: 'a'.repeat(64),
        sizeBytes: 32,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
      return stage;
    }),
    get: vi.fn(async () => stage),
    cancel: vi.fn(async () => ({ ...stage, status: 'cancelled' as const })),
    save: vi.fn(async (_stage, options): Promise<DesignSchemePackageDelivery> => {
      options.assertCurrent();
      return { exportId: 'export_1', status: 'download-started' };
    }),
  };
  const recovery = {
    get: vi.fn(
      async (id: string): Promise<DesignSchemePackageExportRecovery> => ({
        export: stage
          ? { ...stage, exportId: id }
          : {
              exportId: id,
              requestId: 'original_request',
              schemeId: 'original_scheme',
              revisionId: 'original_revision',
              formatVersion: 2 as const,
              status: 'ready' as const,
              packageHash: 'b'.repeat(64),
              sizeBytes: 128,
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
        expectedVersion: 7,
        createdAt: '2026-09-09T00:00:00.000Z',
        schemeName: '原方案',
        canDownload: true,
        blockedReason: null,
      }),
    ),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const getStatus = vi.fn(async () => ({ id: 'account', username: 'tester' }));
  const gateway = {
    designSchemes: { packageExport: { ...transport, recovery } },
    account: { getStatus },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  return {
    transport,
    recovery,
    client,
    wrapper,
    getStatus,
    change: (patch: Partial<DesignSchemePackageExport>) => {
      stage = { ...stage, ...patch };
    },
  };
}
function hook() {
  const f = setup();
  return {
    ...f,
    ...renderHook(({ selected }) => usePackageExport(selected), {
      wrapper: f.wrapper,
      initialProps: { selected: selection },
    }),
  };
}
it('freezes the original formal revision/version through re-render and requires a separate save gesture', async () => {
  const f = hook();
  f.rerender({ selected: { ...selection, revisionId: 'working_draft', expectedVersion: 9 } });
  await act(() => f.result.current.prepare());
  expect(f.transport.begin).toHaveBeenCalledWith(
    expect.objectContaining({ ...selection, formatVersion: 2 }),
  );
  expect(f.result.current.phase).toBe('ready');
  expect(f.transport.save).not.toHaveBeenCalled();
  await act(() => f.result.current.save());
  expect(f.result.current.receipt?.status).toBe('download-started');
  expect(f.transport.cancel).not.toHaveBeenCalled();
});
it('ambiguous begin retries with exactly the same request ID', async () => {
  const f = hook();
  f.transport.begin.mockRejectedValueOnce(new Error('lost response'));
  await act(() => f.result.current.prepare());
  await act(() => f.result.current.prepare());
  expect(f.transport.begin.mock.calls[0]).toEqual(f.transport.begin.mock.calls[1]);
});
it('preparing polls the same export and never silently builds a fresh one', async () => {
  const f = hook();
  await act(() => f.result.current.prepare());
  f.change({ status: 'preparing' });
  await act(() => f.result.current.prepare());
  expect(f.result.current.error).toContain('仍在准备');
  f.change({ status: 'ready' });
  await act(() => f.result.current.prepare());
  expect(f.transport.begin).toHaveBeenCalledOnce();
  expect(f.transport.get).toHaveBeenCalledTimes(2);
});
it('rejects a different revision from a retried stage', async () => {
  const f = hook();
  await act(() => f.result.current.prepare());
  f.change({ revisionId: 'other' });
  await act(() => f.result.current.prepare());
  expect(f.result.current.error).toContain('不一致');
});
it('duplicate prepare/save clicks cannot dispatch concurrent requests', async () => {
  const f = hook();
  await act(async () => {
    await Promise.all([f.result.current.prepare(), f.result.current.prepare()]);
  });
  await act(async () => {
    await Promise.all([f.result.current.save(), f.result.current.save()]);
  });
  expect(f.transport.begin).toHaveBeenCalledOnce();
  expect(f.transport.save).toHaveBeenCalledOnce();
});
it('save picker cancellation retains the same ready export for another explicit click', async () => {
  const f = hook();
  await act(() => f.result.current.prepare());
  f.transport.save.mockResolvedValueOnce({ exportId: 'export_1', status: 'cancelled' });
  await act(() => f.result.current.save());
  expect(f.result.current.phase).toBe('ready');
  expect(f.transport.cancel).not.toHaveBeenCalled();
  await act(() => f.result.current.save());
  expect(f.transport.save.mock.calls[0]?.[0]).toEqual(f.transport.save.mock.calls[1]?.[0]);
});
it('actual handoff preserves the archive without attempting cancellation', async () => {
  const f = hook();
  await act(() => f.result.current.prepare());
  f.transport.cancel.mockRejectedValue(new Error('offline'));
  await act(() => f.result.current.save());
  expect(f.result.current.phase).toBe('finished');
  expect(f.result.current.error).toBeNull();
  expect(f.transport.cancel).not.toHaveBeenCalled();
});
it('closing during begin preserves the durable late export for history recovery', async () => {
  const f = hook();
  const original = f.transport.begin.getMockImplementation()!;
  const pending = deferred<DesignSchemePackageExport>();
  f.transport.begin.mockImplementation(async (input) => {
    const s = await original(input);
    await pending.promise;
    return s;
  });
  let task!: Promise<void>;
  act(() => {
    task = f.result.current.prepare();
  });
  f.unmount();
  await act(async () => {
    pending.resolve({} as DesignSchemePackageExport);
    await task;
  });
  expect(f.transport.cancel).not.toHaveBeenCalled();
});
it('closing during save aborts IO and ignores the late delivery receipt', async () => {
  const f = hook();
  await act(() => f.result.current.prepare());
  const pending = deferred<DesignSchemePackageDelivery>();
  f.transport.save.mockReturnValue(pending.promise);
  let task!: Promise<void>;
  act(() => {
    task = f.result.current.save();
  });
  const options = f.transport.save.mock.calls[0]![1];
  f.unmount();
  expect(options.signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve({ exportId: 'export_1', status: 'delivered' });
    await task;
  });
  expect(f.result.current.receipt).toBeNull();
});
it('account transition blocks the old save and avoids cancelling under the new owner', async () => {
  const f = hook();
  await act(() => f.result.current.prepare());
  beginAccountTransition(f.client);
  await act(() => f.result.current.save());
  expect(f.transport.save).not.toHaveBeenCalled();
  expect(f.result.current.error).toContain('账号已切换');
  f.unmount();
  expect(f.transport.cancel).not.toHaveBeenCalled();
});
it('account query failure hides ready metadata and disables the action', async () => {
  const f = setup();
  render(
    <SchemePackageExportDialog
      selection={selection}
      onClose={() => {}}
      onRestoreFocus={() => {}}
    />,
    { wrapper: f.wrapper },
  );
  const button = await screen.findByTestId('scheme-package-export-action');
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  f.getStatus.mockRejectedValue(new Error('offline'));
  await act(() => f.client.invalidateQueries({ queryKey: queryKeys.account.status() }));
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByText('请先登录并完成账号核对。')).toBeTruthy();
});

it('recovery reads the original archive without begin, save or cancel and needs an explicit save gesture', async () => {
  const f = hook();
  await act(() => f.result.current.recover('original_export'));
  expect(f.result.current.selection).toMatchObject({
    requestId: 'original_request',
    schemeId: 'original_scheme',
    expectedVersion: 7,
  });
  expect(f.result.current.phase).toBe('ready');
  expect(f.transport.begin).not.toHaveBeenCalled();
  expect(f.transport.save).not.toHaveBeenCalled();
  expect(f.transport.cancel).not.toHaveBeenCalled();
  f.transport.save.mockResolvedValueOnce({
    exportId: 'original_export',
    status: 'download-started',
  });
  await act(() => f.result.current.save());
  expect(f.transport.save).toHaveBeenCalledOnce();
  expect(f.result.current.receipt?.status).toBe('download-started');
  f.unmount();
  expect(f.transport.cancel).not.toHaveBeenCalled();
});
it('failed recovery cannot fall through to a new begin and can explicitly retry the same record', async () => {
  const f = hook();
  f.recovery.get.mockRejectedValueOnce(new Error('offline'));
  await act(() => f.result.current.recover('original_export'));
  await act(() => f.result.current.prepare());
  expect(f.recovery.get.mock.calls).toEqual([['original_export'], ['original_export']]);
  expect(f.transport.begin).not.toHaveBeenCalled();
  expect(f.result.current.phase).toBe('ready');
});
it('blocked or changed original version never permits recovered save', async () => {
  const f = hook();
  const value = await f.recovery.get('original_export');
  f.recovery.get.mockResolvedValueOnce({
    ...value,
    canDownload: false,
    blockedReason: 'session_changed',
  });
  await act(() => f.result.current.recover('original_export'));
  await act(() => f.result.current.save());
  expect(f.transport.save).not.toHaveBeenCalled();
  f.recovery.get.mockResolvedValueOnce({ ...value, expectedVersion: 8 });
  await act(() => f.result.current.recover('original_export'));
  expect(f.result.current.error).toContain('已变化');
  expect(f.transport.begin).not.toHaveBeenCalled();
});
it('a response after account change cannot reveal a recovered archive or download it', async () => {
  const f = hook();
  const value = await f.recovery.get('original_export');
  const pending = deferred<typeof value>();
  f.recovery.get.mockReturnValueOnce(pending.promise);
  let task!: Promise<void>;
  act(() => {
    task = f.result.current.recover('original_export');
  });
  beginAccountTransition(f.client);
  await act(async () => {
    pending.resolve(value);
    await task;
  });
  expect(f.result.current.recovery).toBeNull();
  expect(f.result.current.stage).toBeNull();
  expect(f.transport.save).not.toHaveBeenCalled();
});
it('explicit cancellation alone cancels the bound archive and rejects a later save', async () => {
  const f = hook();
  await act(() => f.result.current.prepare());
  await act(async () => {
    expect(await f.result.current.cancel()).toBe(true);
  });
  expect(f.transport.cancel).toHaveBeenCalledOnce();
  await act(() => f.result.current.save());
  expect(f.transport.save).not.toHaveBeenCalled();
});

it('history is explicitly opened and cached records disappear on an account query error', async () => {
  const f = setup();
  render(
    <SchemePackageExportDialog
      selection={selection}
      onClose={() => {}}
      onRestoreFocus={() => {}}
    />,
    { wrapper: f.wrapper },
  );
  const trigger = await screen.findByTestId('scheme-package-export-show-history');
  expect(f.recovery.list).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  await waitFor(() => expect(f.recovery.list).toHaveBeenCalledOnce());
  expect(screen.getByTestId('scheme-package-export-history-list')).toBeTruthy();
  expect(f.transport.begin).not.toHaveBeenCalled();
  f.getStatus.mockRejectedValue(new Error('offline'));
  await act(() => f.client.invalidateQueries({ queryKey: queryKeys.account.status() }));
  await waitFor(() =>
    expect(screen.queryByTestId('scheme-package-export-history-list')).toBeNull(),
  );
});
it('cancel confirmation can be dismissed without cancelling the archive', async () => {
  const f = setup();
  render(
    <SchemePackageExportDialog
      selection={selection}
      onClose={() => {}}
      onRestoreFocus={() => {}}
    />,
    { wrapper: f.wrapper },
  );
  const action = await screen.findByTestId('scheme-package-export-action');
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(action);
  fireEvent.click(await screen.findByRole('button', { name: '取消此导出' }));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '保留记录' }));
  expect(f.transport.cancel).not.toHaveBeenCalled();
});
