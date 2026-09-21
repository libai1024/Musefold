import type { AccountCloudRecoveryItem, AccountCloudLegacyList } from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountCloudRecoveryPanel } from '../AccountCloudRecoveryPanel';

vi.mock('@musefold/ui/components/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function item(index: number): AccountCloudRecoveryItem {
  return {
    requestId: `request-${index}`,
    localGenerationId: `local-${index}`,
    createdAt: '2026-09-08T00:00:00Z',
    canCancel: false,
    recovery: {
      requestId: `request-${index}`,
      remoteStatus: 'succeeded',
      costKnown: false,
      result: 'purged',
      message: '云任务已完成，素材已清理；不会重新生成。',
    },
  };
}
function mount(enabled = true) {
  const cloud = {
    listRecovery: vi.fn(async (query?: { cursor?: string }) => ({
      items: query?.cursor ? [item(20)] : Array.from({ length: 20 }, (_, i) => item(i)),
      nextCursor: query?.cursor ? null : 'cloud-page-two',
    })),
    listLegacy: vi.fn(
      async (_query?: { cursor?: string }): Promise<AccountCloudLegacyList> => ({
        items: [],
        nextCursor: null,
      }),
    ),
    reconcile: vi.fn(async () => item(0)),
    cancel: vi.fn(async () => item(0)),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = render(
    <QueryClientProvider client={client}>
      <AccountCloudRecoveryPanel
        cloud={cloud as unknown as NonNullable<MusefoldGateway['accountCloud']>}
        enabled={enabled}
      />
    </QueryClientProvider>,
  );
  return { cloud, client, ...ui };
}
describe('original task recovery pages', () => {
  it('loads past twenty terminal tasks and never offers cancellation for a purged result', async () => {
    const { cloud } = mount();
    await waitFor(() =>
      expect(screen.getAllByTestId('account-cloud-recovery-item')).toHaveLength(20),
    );
    expect(screen.queryByRole('button', { name: '停止原任务' })).toBeNull();
    expect(screen.getAllByText('费用未知，尚未结清。')).toHaveLength(20);
    fireEvent.click(screen.getByTestId('account-cloud-load-more'));
    await waitFor(() =>
      expect(screen.getAllByTestId('account-cloud-recovery-item')).toHaveLength(21),
    );
    expect(cloud.listRecovery).toHaveBeenLastCalledWith({ cursor: 'cloud-page-two' });
    expect(screen.queryByTestId('account-cloud-load-more')).toBeNull();
    fireEvent.click(
      within(screen.getAllByTestId('account-cloud-recovery-item')[0]).getByRole('button', {
        name: '核对原任务',
      }),
    );
    await waitFor(() => expect(cloud.reconcile).toHaveBeenCalledWith({ requestId: 'request-0' }));
    expect(cloud.cancel).not.toHaveBeenCalled();
  });

  it('shows paged read-only legacy diagnostics while signed out without fetching cloud identities', async () => {
    const { cloud, client } = mount(false);
    await waitFor(() => expect(cloud.listLegacy).toHaveBeenCalled());
    cloud.listLegacy.mockImplementation(async (query) => ({
      items: Array.from({ length: query?.cursor ? 3 : 20 }, (_, i) => ({
        requestId: `legacy-${query?.cursor ? i + 20 : i}`,
        createdAt: '2026-09-08T00:00:00Z',
        kind: 'image',
        reason: 'unknown_cost',
      })),
      nextCursor: query?.cursor ? null : 'legacy-page-two',
    }));
    await client.invalidateQueries();
    await waitFor(() =>
      expect(screen.getAllByTestId('account-cloud-legacy-item')).toHaveLength(20),
    );
    fireEvent.click(screen.getByTestId('account-cloud-legacy-more'));
    await waitFor(() =>
      expect(screen.getAllByTestId('account-cloud-legacy-item')).toHaveLength(23),
    );
    expect(screen.getByTestId('account-cloud-legacy').textContent).toContain('未绑定当前云账号');
    expect(within(screen.getByTestId('account-cloud-legacy')).queryByRole('button')).toBeNull();
    expect(cloud.listRecovery).not.toHaveBeenCalled();
    expect(cloud.reconcile).not.toHaveBeenCalled();
    expect(cloud.cancel).not.toHaveBeenCalled();
  });

  it('can reset an invalid or failed cursor without keeping stale duplicate pages', async () => {
    const { cloud, client } = mount();
    await screen.findByTestId('account-cloud-load-more');
    cloud.listRecovery.mockRejectedValueOnce(new Error('invalid cursor'));
    fireEvent.click(screen.getByTestId('account-cloud-load-more'));
    await screen.findByRole('button', { name: '刷新任务列表' });
    fireEvent.click(screen.getByRole('button', { name: '刷新任务列表' }));
    await waitFor(() =>
      expect(screen.getAllByTestId('account-cloud-recovery-item')).toHaveLength(20),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(cloud.listRecovery).toHaveBeenLastCalledWith({});
  });
});
