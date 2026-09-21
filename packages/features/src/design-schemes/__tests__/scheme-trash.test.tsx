import {
  designSchemeSummarySchema,
  type DesignSchemePage,
  type PurgeDesignSchemeResult,
} from '@musefold/contracts';
import {
  PlatformProvider,
  WEB_CAPABILITIES,
  type DesignSchemesGateway,
  type MusefoldGateway,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { toast } from '@musefold/ui/components/sonner';
import { beginAccountTransition } from '../../account/account-session';
import { SchemeTrashDialog } from '../SchemeTrashDialog';

const user = userEvent.setup({ pointerEventsCheck: 0 });
afterEach(() => vi.restoreAllMocks());
const summary = (index: number) =>
  designSchemeSummarySchema.parse({
    id: `removed-${index}`,
    name: `移除方案 ${index}`,
    summary: '旧方案',
    status: 'draft',
    sourcePresentation: 'musefold-created',
    sourceLabel: 'Musefold 创建',
    currentRevisionId: `revision-${index}`,
    version: 8,
    fidelity: 'adapted',
    createdAt: 100,
    updatedAt: 200,
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(count = 1) {
  let rows = Array.from({ length: count }, (_, index) => summary(index));
  const list = vi.fn<DesignSchemesGateway['list']>(async (query = {}) => {
    const filtered = rows.filter((row) => !query.query || row.name.includes(query.query));
    const start = query.cursor ? Number(query.cursor.slice(5)) : 0;
    return {
      items: filtered.slice(start, start + 20),
      nextCursor: start + 20 < filtered.length ? `page-${start + 20}` : null,
    };
  });
  const purge = vi.fn<DesignSchemesGateway['purge']>(async (input) => {
    rows = rows.filter((row) => row.id !== input.schemeId);
    return { schemeId: input.schemeId, purged: true, retiredKeys: 2, deferredKeys: 1 };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const gateway = { designSchemes: { list, purge } } as unknown as MusefoldGateway;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  const close = vi.fn(),
    focus = vi.fn();
  return {
    list,
    purge,
    client,
    close,
    focus,
    render: () => render(<SchemeTrashDialog onClose={close} onRestoreFocus={focus} />, { wrapper }),
  };
}
async function ask() {
  const trigger = await screen.findByTestId('scheme-trash-purge-removed-0');
  await user.click(trigger);
  await screen.findByRole('alertdialog');
  return trigger;
}

it('loads only removed schemes, traverses more than 200 and resets the server search cursor', async () => {
  const f = setup(205);
  f.render();
  await screen.findByTestId('scheme-trash-row-removed-0');
  expect(f.list).toHaveBeenCalledWith({
    deletedOnly: true,
    limit: 20,
    query: undefined,
    cursor: undefined,
  });
  expect(screen.getByTestId('scheme-trash-count').textContent).toContain('20+');
  for (let page = 1; page <= 10; page++) {
    await user.click(screen.getByTestId('scheme-trash-load-more'));
    await screen.findByTestId(`scheme-trash-row-removed-${page * 20}`);
  }
  expect(screen.getAllByTestId(/^scheme-trash-row-/)).toHaveLength(205);
  expect(screen.queryByTestId('scheme-trash-load-more')).toBeNull();
  fireEvent.change(screen.getByTestId('scheme-trash-search'), { target: { value: '方案 204' } });
  await waitFor(() => expect(screen.getAllByTestId(/^scheme-trash-row-/)).toHaveLength(1));
  expect(f.list).toHaveBeenLastCalledWith({
    deletedOnly: true,
    limit: 20,
    query: '方案 204',
    cursor: undefined,
  });
});

it('shows loading and empty states without inventing an action or an automatic write', async () => {
  const f = setup(0),
    pending = deferred<DesignSchemePage>();
  f.list.mockReturnValue(pending.promise);
  f.render();
  expect(screen.getByTestId('scheme-trash-loading')).toBeTruthy();
  await act(async () => pending.resolve({ items: [], nextCursor: null }));
  await screen.findByTestId('scheme-trash-empty');
  expect(f.purge).not.toHaveBeenCalled();
});

it('requires explicit retry for first-page errors and retains earlier pages after a later-page failure', async () => {
  const f = setup(21);
  f.list.mockRejectedValueOnce(new Error('offline'));
  f.render();
  await screen.findByRole('alert');
  expect(f.list).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: '重试读取' }));
  await screen.findByTestId('scheme-trash-row-removed-0');
  f.list.mockRejectedValueOnce(new Error('next page failed'));
  await user.click(screen.getByTestId('scheme-trash-load-more'));
  await screen.findByText('后续方案加载失败，已加载的内容仍保留。');
  expect(screen.getAllByTestId(/^scheme-trash-row-/)).toHaveLength(20);
  await user.click(screen.getByRole('button', { name: '重试读取' }));
  await screen.findByTestId('scheme-trash-row-removed-20');
  f.list.mockRejectedValueOnce(new Error('session unavailable'));
  await user.click(screen.getByTestId('scheme-trash-refresh'));
  await screen.findByText('已移除的方案读取失败，请重试。');
  expect(screen.queryByTestId('scheme-trash-row-removed-0')).toBeNull();
});

it('cancel and Escape do not delete or close the surrounding list and return focus to the row', async () => {
  const f = setup();
  f.render();
  const trigger = await ask();
  await user.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await user.click(trigger);
  await screen.findByRole('alertdialog');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(f.close).not.toHaveBeenCalled();
  expect(f.purge).not.toHaveBeenCalled();
});

it('locks duplicate confirmation and close while pending, then refreshes without claiming physical file deletion', async () => {
  const f = setup(),
    pending = deferred<PurgeDesignSchemeResult>();
  const success = vi.spyOn(toast, 'success');
  f.purge.mockImplementationOnce(() => pending.promise);
  f.render();
  await ask();
  const confirm = screen.getByTestId('scheme-trash-confirm');
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(f.purge).toHaveBeenCalledTimes(1));
  expect(f.purge).toHaveBeenCalledWith({ schemeId: 'removed-0', expectedVersion: 8 });
  expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(f.close).not.toHaveBeenCalled();
  f.list.mockResolvedValue({ items: [], nextCursor: null });
  await act(async () =>
    pending.resolve({ schemeId: 'removed-0', purged: true, retiredKeys: 2, deferredKeys: 1 }),
  );
  await screen.findByTestId('scheme-trash-empty');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(success).toHaveBeenCalledWith(
    '方案已永久删除',
    expect.objectContaining({ description: expect.stringContaining('将由系统清理') }),
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByTestId('scheme-trash-search')),
  );
});

it('retains the confirmed version and visible error after failure without adopting a refreshed version', async () => {
  const f = setup();
  f.render();
  await ask();
  f.list.mockResolvedValue({ items: [{ ...summary(0), version: 9 }], nextCursor: null });
  f.purge.mockRejectedValue(new Error('版本已变化，请取消后重新选择'));
  await user.click(screen.getByTestId('scheme-trash-confirm'));
  await screen.findByText('版本已变化，请取消后重新选择');
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '重试永久删除' }));
  await waitFor(() => expect(f.purge).toHaveBeenCalledTimes(2));
  expect(f.purge.mock.calls.map(([input]) => input.expectedVersion)).toEqual([8, 8]);
});

it('account transitions immediately hide the old target and prevent confirmation', async () => {
  const f = setup();
  f.render();
  await ask();
  act(() => {
    beginAccountTransition(f.client);
  });
  await screen.findByText('账号已变化，请关闭后重新打开，核对当前账号的方案。');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByTestId('scheme-trash-row-removed-0')).toBeNull();
  expect(f.purge).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(f.close).toHaveBeenCalledTimes(1);
});

it('ignores a late deletion receipt after account transition without reporting success to the new account', async () => {
  const f = setup(),
    pending = deferred<PurgeDesignSchemeResult>(),
    success = vi.spyOn(toast, 'success');
  f.purge.mockReturnValueOnce(pending.promise);
  f.render();
  await ask();
  await user.click(screen.getByTestId('scheme-trash-confirm'));
  act(() => {
    beginAccountTransition(f.client);
  });
  await act(async () =>
    pending.resolve({ schemeId: 'removed-0', purged: true, retiredKeys: 0, deferredKeys: 0 }),
  );
  expect(success).not.toHaveBeenCalled();
  expect(screen.queryByTestId('scheme-trash-row-removed-0')).toBeNull();
});
