import {
  queryKeys,
  PlatformProvider,
  WEB_CAPABILITIES,
  type MusefoldGateway,
} from '@musefold/platform';
import type {
  DesignSchemePackageStage,
  ImportDesignSchemeResult,
  DesignSchemePackageRecovery,
  DesignSchemePackageRecoveryPage,
} from '@musefold/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { usePackageImport } from '../use-package-import';
import { SchemePackageImportDialog } from '../SchemePackageImportDialog';
import { beginAccountTransition } from '../../account/account-session';

// Digest fixture only; actual browser SHA-256 is asserted by the Playwright transport test.
beforeEach(() =>
  vi.stubGlobal('crypto', {
    randomUUID: () => 'request_1',
    subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(97).buffer) },
  }),
);
afterEach(() => vi.unstubAllGlobals());
const preview = {
  name: '分享方案',
  summary: '完整来源与素材',
  sourceCount: 2,
  imageCount: 3,
  entryCount: 8,
  legacyPreviewCount: 1,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  let stage: DesignSchemePackageStage;
  const result = {
    scheme: { id: 'new_scheme', name: '分享方案' },
    revisionId: 'new_revision',
    status: 'draft',
  } as ImportDesignSchemeResult;
  const transport = {
    begin: vi.fn(async (input) => {
      stage = {
        ...input,
        stagedPackageId: 'stage_1',
        parserVersion: 1,
        status: 'awaiting_upload',
        preview: null,
        confirmationHash: null,
        expiresAt: '2026-10-01T00:00:00.000Z',
      };
      return stage;
    }),
    get: vi.fn(async () => stage),
    upload: vi.fn(async () => {
      stage = { ...stage, status: 'ready', preview, confirmationHash: 'c'.repeat(64) };
      return stage;
    }),
    decide: vi.fn(async () => {
      stage = { ...stage, status: 'confirmed' };
      return stage;
    }),
    cancel: vi.fn(async () => {
      stage = { ...stage, status: 'cancelled' };
      return stage;
    }),
  };
  const importPackage = vi.fn(async () => {
    stage = { ...stage, status: 'imported' };
    return result;
  });
  const gateway = {
    designSchemes: { packageImport: transport, importPackage },
    account: { getStatus: vi.fn(async () => ({ id: 'account_1', username: 'tester' })) },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const imported = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  const file = new File(['ZIP'], 'example.musefold.design');
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn(async () => new Uint8Array([90, 73, 80]).buffer),
  });
  return {
    transport,
    importPackage,
    gateway,
    client,
    imported,
    wrapper,
    file,
    result,
    changeStage: (patch: Partial<DesignSchemePackageStage>) => {
      stage = { ...stage, ...patch };
    },
  };
}
function hook() {
  const fixture = setup();
  return {
    ...fixture,
    ...renderHook(() => usePackageImport(fixture.imported), { wrapper: fixture.wrapper }),
  };
}
async function upload(f: ReturnType<typeof hook>) {
  act(() => f.result.current.setFile(f.file));
  await act(() => f.result.current.upload());
}

it('uploads exact bytes, renders a preview, and waits for explicit confirmation before import', async () => {
  const f = hook();
  await upload(f);
  expect(f.result.current.phase).toBe('review');
  expect(f.result.current.stage?.preview).toEqual(preview);
  expect(f.transport.begin).toHaveBeenCalledWith(
    expect.objectContaining({
      sizeBytes: 3,
      formatVersion: 2,
      packageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  );
  expect(f.transport.upload).toHaveBeenCalledWith(
    'stage_1',
    new Uint8Array([90, 73, 80]),
    expect.any(AbortSignal),
  );
  expect(f.transport.decide).not.toHaveBeenCalled();
  expect(f.importPackage).not.toHaveBeenCalled();
  await act(() => f.result.current.confirm());
  const stage = f.result.current.stage!;
  expect(f.transport.decide).toHaveBeenCalledWith('stage_1', {
    packageHash: stage.packageHash,
    formatVersion: 2,
    parserVersion: 1,
    confirmationHash: 'c'.repeat(64),
    decision: 'confirm',
  });
  expect(f.importPackage).toHaveBeenCalledWith({
    stagedPackageId: 'stage_1',
    packageHash: stage.packageHash,
    formatVersion: 2,
  });
  expect(f.imported).toHaveBeenCalledOnce();
});

it('keeps legacy format explicit and does not infer successful trials from previews', async () => {
  const f = hook();
  act(() => {
    f.result.current.setFile(f.file);
    f.result.current.setFormatVersion(1);
  });
  await act(() => f.result.current.upload());
  expect(f.transport.begin).toHaveBeenCalledWith(expect.objectContaining({ formatVersion: 1 }));
  expect(f.importPackage).not.toHaveBeenCalled();
});

it.each([
  ['empty', 0],
  ['over-limit', 256 * 1024 * 1024 + 1],
])('rejects %s files before reading or networking', async (_name, size) => {
  const f = hook();
  Object.defineProperty(f.file, 'size', { value: size });
  await upload(f);
  expect(f.file.arrayBuffer).not.toHaveBeenCalled();
  expect(f.transport.begin).not.toHaveBeenCalled();
  expect(f.result.current.error).toContain('256 MiB');
});

it('synchronously suppresses duplicate upload and confirmation clicks', async () => {
  const f = hook();
  act(() => f.result.current.setFile(f.file));
  await act(async () => {
    await Promise.all([f.result.current.upload(), f.result.current.upload()]);
  });
  await act(async () => {
    await Promise.all([f.result.current.confirm(), f.result.current.confirm()]);
  });
  expect(f.transport.begin).toHaveBeenCalledOnce();
  expect(f.transport.decide).toHaveBeenCalledOnce();
  expect(f.importPackage).toHaveBeenCalledOnce();
});

it('recovers a lost upload response by reading the same stage without a second upload', async () => {
  const f = hook();
  const original = f.transport.upload.getMockImplementation()!;
  f.transport.upload.mockImplementationOnce(async () => {
    await original();
    throw new Error('response lost');
  });
  await upload(f);
  expect(f.result.current.error).toBe('response lost');
  await act(() => f.result.current.upload());
  expect(f.result.current.phase).toBe('review');
  expect(f.transport.begin).toHaveBeenCalledOnce();
  expect(f.transport.upload).toHaveBeenCalledOnce();
});

it('retries an ambiguous begin using the same immutable request id', async () => {
  const f = hook();
  const original = f.transport.begin.getMockImplementation()!;
  f.transport.begin.mockImplementationOnce(async (input) => {
    await original(input);
    throw new Error('response lost');
  });
  await upload(f);
  await act(() => f.result.current.upload());
  expect(f.transport.begin.mock.calls[1]).toEqual(f.transport.begin.mock.calls[0]);
});

it('recovers a lost commit response using the original import receipt, without confirming twice', async () => {
  const f = hook();
  await upload(f);
  const original = f.importPackage.getMockImplementation()!;
  f.importPackage.mockImplementationOnce(async () => {
    await original();
    throw new Error('response lost');
  });
  await act(() => f.result.current.confirm());
  expect(f.imported).not.toHaveBeenCalled();
  await act(() => f.result.current.confirm());
  expect(f.transport.decide).toHaveBeenCalledOnce();
  expect(f.importPackage.mock.calls[1]).toEqual(f.importPackage.mock.calls[0]);
  expect(f.imported).toHaveBeenCalledOnce();
});

it('refuses changed confirmation and expired stages without importing', async () => {
  const f = hook();
  await upload(f);
  f.changeStage({ confirmationHash: 'd'.repeat(64) });
  await act(() => f.result.current.confirm());
  expect(f.result.current.error).toContain('预览已变化');
  expect(f.importPackage).not.toHaveBeenCalled();
  f.changeStage({ status: 'expired' });
  await act(() => f.result.current.confirm());
  expect(f.importPackage).not.toHaveBeenCalled();
});

it('retains a late begin for recovery after lifecycle disposal and never uploads', async () => {
  const f = hook();
  const gate = deferred<void>();
  const original = f.transport.begin.getMockImplementation()!;
  f.transport.begin.mockImplementationOnce(async (input) => {
    const stage = await original(input);
    await gate.promise;
    return stage;
  });
  act(() => f.result.current.setFile(f.file));
  let pending!: Promise<void>;
  act(() => {
    pending = f.result.current.upload();
  });
  await waitFor(() => expect(f.transport.begin).toHaveBeenCalledOnce());
  f.unmount();
  await act(async () => {
    gate.resolve();
    await pending;
  });
  expect(f.transport.upload).not.toHaveBeenCalled();
  expect(f.transport.cancel).not.toHaveBeenCalled();
});

it('aborts local upload on disposal without cancelling another page’s server intent', async () => {
  const f = hook();
  const gate = deferred<DesignSchemePackageStage>();
  f.transport.upload.mockImplementationOnce(() => gate.promise);
  act(() => f.result.current.setFile(f.file));
  let pending!: Promise<void>;
  act(() => {
    pending = f.result.current.upload();
  });
  await waitFor(() => expect(f.transport.upload).toHaveBeenCalledOnce());
  const signal = (
    f.transport.upload.mock.calls as unknown as [string, Uint8Array, AbortSignal][]
  )[0]![2];
  const stage = f.result.current.stage!;
  f.unmount();
  expect(signal.aborted).toBe(true);
  expect(f.transport.cancel).not.toHaveBeenCalled();
  await act(async () => {
    gate.resolve({ ...stage, status: 'ready', preview, confirmationHash: 'c'.repeat(64) });
    await pending;
  });
  expect(f.imported).not.toHaveBeenCalled();
});

it('does not confirm or clean up under a switched account', async () => {
  const f = hook();
  await upload(f);
  act(() => {
    beginAccountTransition(f.client);
  });
  await act(() => f.result.current.confirm());
  expect(f.transport.decide).not.toHaveBeenCalled();
  expect(f.importPackage).not.toHaveBeenCalled();
  expect(f.result.current.error).toContain('账号已切换');
  f.unmount();
  expect(f.transport.cancel).not.toHaveBeenCalled();
});

it('suppresses a late import receipt after account transition', async () => {
  const f = hook();
  await upload(f);
  const gate = deferred<ImportDesignSchemeResult>();
  f.importPackage.mockImplementationOnce(() => gate.promise);
  let pending!: Promise<void>;
  act(() => {
    pending = f.result.current.confirm();
  });
  await waitFor(() => expect(f.importPackage).toHaveBeenCalledOnce());
  act(() => {
    beginAccountTransition(f.client);
  });
  await act(async () => {
    gate.resolve({ status: 'draft' } as ImportDesignSchemeResult);
    await pending;
  });
  expect(f.imported).not.toHaveBeenCalled();
});

it('shows review and recovery controls, keeping an uncertain import in the dialog', async () => {
  const f = setup();
  const close = vi.fn();
  render(<SchemePackageImportDialog onClose={close} onImported={f.imported} />, {
    wrapper: f.wrapper,
  });
  await waitFor(() =>
    expect(screen.getByTestId('scheme-package-file').hasAttribute('disabled')).toBe(false),
  );
  fireEvent.change(screen.getByTestId('scheme-package-file'), { target: { files: [f.file] } });
  fireEvent.click(screen.getByTestId('scheme-package-upload'));
  await screen.findByTestId('scheme-package-preview');
  expect(screen.getByText(/预览图不代表试运行成功/)).toBeTruthy();
  f.importPackage.mockRejectedValueOnce(new Error('网络响应丢失'));
  fireEvent.click(screen.getByTestId('scheme-package-confirm'));
  await screen.findByText('核对并继续导入');
  expect(f.imported).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('scheme-package-confirm'));
  await waitFor(() => expect(f.imported).toHaveBeenCalledOnce());
});

it('hides cached preview and disables confirmation when a refreshed account query fails', async () => {
  const f = setup();
  render(<SchemePackageImportDialog onClose={vi.fn()} onImported={f.imported} />, {
    wrapper: f.wrapper,
  });
  await waitFor(() =>
    expect(screen.getByTestId('scheme-package-file').hasAttribute('disabled')).toBe(false),
  );
  fireEvent.change(screen.getByTestId('scheme-package-file'), { target: { files: [f.file] } });
  fireEvent.click(screen.getByTestId('scheme-package-upload'));
  await screen.findByTestId('scheme-package-preview');
  vi.mocked(f.gateway.account.getStatus).mockRejectedValue(new Error('session expired'));
  await act(() => f.client.refetchQueries({ queryKey: queryKeys.account.status() }));
  await screen.findByText('请先登录并完成账号核对。');
  expect(screen.queryByTestId('scheme-package-preview')).toBeNull();
  expect(screen.getByTestId('scheme-package-confirm').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByTestId('scheme-package-confirm'));
  expect(f.importPackage).not.toHaveBeenCalled();
});

it('cancels only on an explicit action, while simply closing keeps the durable intent', async () => {
  const f = hook();
  await upload(f);
  await act(async () => {
    expect(await f.result.current.cancel()).toBe(true);
  });
  expect(f.transport.cancel).toHaveBeenCalledOnce();
  expect(f.result.current.stage?.status).toBe('cancelled');
});

async function recoverable() {
  const f = setup();
  await f.transport.begin({
    requestId: 'request_1',
    packageHash: '61'.repeat(32),
    sizeBytes: 3,
    formatVersion: 2,
  });
  await f.transport.upload();
  f.transport.begin.mockClear();
  f.transport.upload.mockClear();
  const recovery = {
    list: vi.fn(
      async (): Promise<DesignSchemePackageRecoveryPage> => ({
        items: [await recovery.get()],
        nextCursor: null,
      }),
    ),
    get: vi.fn(async (): Promise<DesignSchemePackageRecovery> => {
      const stage = await f.transport.get();
      return {
        stage,
        createdAt: '2026-09-09T00:00:00.000Z',
        execution: stage.status === 'imported' ? ('completed' as const) : ('not_started' as const),
        receipt: stage.status === 'imported' ? f.result : null,
        canContinue: stage.status !== 'imported',
        blockedReason: null,
      };
    }),
  };
  Object.assign(f.transport, { recovery });
  return { ...f, recovery };
}

it('reopens a lost completion as a read-only receipt, without another confirm or import', async () => {
  const f = await recoverable();
  await f.importPackage();
  const view = renderHook(() => usePackageImport(f.imported), { wrapper: f.wrapper });
  await act(() => view.result.current.recover('stage_1'));
  expect(view.result.current.recovery?.receipt).toEqual(f.result);
  expect(f.imported).not.toHaveBeenCalled();
  await act(() => view.result.current.confirm());
  expect(f.imported).toHaveBeenCalledWith(f.result);
  expect(f.importPackage).toHaveBeenCalledTimes(1);
  expect(f.transport.decide).not.toHaveBeenCalled();
  view.unmount();
  expect(f.transport.cancel).not.toHaveBeenCalled();
});

it('reselects only the original file and never begins a new request during upload recovery', async () => {
  const f = await recoverable();
  f.changeStage({ status: 'awaiting_upload', preview: null, confirmationHash: null });
  const view = renderHook(() => usePackageImport(f.imported), { wrapper: f.wrapper });
  await act(() => view.result.current.recover('stage_1'));
  expect(view.result.current.canSelectFile).toBe(true);
  const wrong = new File(['wrong'], 'wrong.musefold.design');
  Object.defineProperty(wrong, 'arrayBuffer', { value: async () => new Uint8Array(4).buffer });
  act(() => view.result.current.setFile(wrong));
  await act(() => view.result.current.upload());
  expect(view.result.current.error).toContain('与原上传不一致');
  expect(f.transport.upload).not.toHaveBeenCalled();
  act(() => view.result.current.setFile(f.file));
  await act(() => view.result.current.upload());
  expect(f.transport.upload).toHaveBeenCalledOnce();
  expect(f.transport.begin).not.toHaveBeenCalled();
});

it('does not import or cancel an in-flight recovered execution and rechecks before explicit continuation', async () => {
  const f = await recoverable();
  const ready = await f.recovery.get();
  f.recovery.get.mockResolvedValue({
    ...ready,
    execution: 'running',
    canContinue: false,
    blockedReason: 'import_in_progress',
  });
  const view = renderHook(() => usePackageImport(f.imported), { wrapper: f.wrapper });
  await act(() => view.result.current.recover('stage_1'));
  await act(() => view.result.current.confirm());
  await act(async () => {
    expect(await view.result.current.cancel()).toBe(false);
  });
  expect(f.importPackage).not.toHaveBeenCalled();
  expect(f.transport.cancel).not.toHaveBeenCalled();
  f.recovery.get.mockResolvedValue(ready);
  await act(() => view.result.current.recover('stage_1'));
  await act(() => view.result.current.confirm());
  expect(f.importPackage).toHaveBeenCalledOnce();
});

it('rejects a changed recovery preview instead of authorizing the newly returned content', async () => {
  const f = await recoverable();
  const view = renderHook(() => usePackageImport(f.imported), { wrapper: f.wrapper });
  await act(() => view.result.current.recover('stage_1'));
  f.changeStage({ confirmationHash: 'd'.repeat(64) });
  await act(() => view.result.current.confirm());
  expect(view.result.current.error).toContain('预览已变化');
  expect(f.importPackage).not.toHaveBeenCalled();
  expect(f.transport.decide).not.toHaveBeenCalled();
});

it('drops a late recovery result after account transition, and disposal never mutates either account', async () => {
  const f = await recoverable();
  const ready = await f.recovery.get();
  const deferredRead = deferred<typeof ready>();
  f.recovery.get.mockImplementationOnce(() => deferredRead.promise);
  const view = renderHook(() => usePackageImport(f.imported), { wrapper: f.wrapper });
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.recover('stage_1');
  });
  act(() => {
    beginAccountTransition(f.client);
  });
  await act(async () => {
    deferredRead.resolve(ready);
    await pending;
  });
  expect(view.result.current.stage).toBeNull();
  expect(view.result.current.changedAccount).toBe(true);
  view.unmount();
  expect(f.transport.cancel).not.toHaveBeenCalled();
});

it('loads recovery history only on request and hides it when current account verification fails', async () => {
  const f = await recoverable();
  render(<SchemePackageImportDialog onClose={vi.fn()} onImported={f.imported} />, {
    wrapper: f.wrapper,
  });
  const history = await screen.findByTestId('scheme-package-show-recovery');
  expect(f.recovery.list).not.toHaveBeenCalled();
  fireEvent.click(history);
  await screen.findByTestId('scheme-package-recover-stage_1');
  expect(f.transport.begin).not.toHaveBeenCalled();
  expect(f.transport.decide).not.toHaveBeenCalled();
  expect(f.importPackage).not.toHaveBeenCalled();
  vi.mocked(f.gateway.account.getStatus).mockRejectedValue(new Error('session expired'));
  await act(() => f.client.refetchQueries({ queryKey: queryKeys.account.status() }));
  await screen.findByText('请先登录并完成账号核对。');
  expect(screen.queryByTestId('scheme-package-recovery-list')).toBeNull();
  expect(screen.queryByText(preview.name)).toBeNull();
});
