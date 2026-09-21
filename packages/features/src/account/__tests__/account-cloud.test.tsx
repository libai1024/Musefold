import type { AccountCloudStatus } from '@musefold/contracts';
import { DESKTOP_CAPABILITIES, PlatformProvider, type MusefoldGateway } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountCloudConnectionCard } from '../AccountCloudConnectionCard';
import { beginAccountTransition } from '../account-session';

vi.mock('@musefold/ui/components/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const preview: AccountCloudStatus = {
  mode: 'not_enabled',
  principalId: 'principal-a',
  apiIssuer: 'https://cloud.example.com',
  connectionId: null,
  reviewRef: '11111111-1111-4111-8111-111111111111',
  reviewAction: 'connect',
  message: '连接当前账号的云图像服务；不会自动生成图片或开启同步。',
};
function fixture(status = preview, available = true) {
  const item = {
    requestId: 'original-request',
    localGenerationId: 'local-run',
    createdAt: '2026-09-08T00:00:00Z',
    canCancel: true,
    recovery: {
      requestId: 'original-request',
      remoteStatus: 'queued' as const,
      costKnown: false,
      result: 'not_ready' as const,
      message: '核对原任务',
    },
  };
  const cloud = {
    getStatus: vi.fn(async () => status),
    connect: vi.fn(async () => ({
      ...status,
      mode: 'active' as const,
      reviewRef: null,
      reviewAction: null,
    })),
    resume: vi.fn(async () => ({
      ...status,
      mode: 'active' as const,
      reviewRef: null,
      reviewAction: null,
    })),
    listRecovery: vi.fn(async (_query?: { cursor?: string }) => ({
      items: [item],
      nextCursor: null as string | null,
    })),
    listLegacy: vi.fn(async () => ({ items: [], nextCursor: null })),
    reconcile: vi.fn(async () => item),
    cancel: vi.fn(async () => item),
  };
  const gateway = {
    account: {
      getStatus: async () => ({
        id: 'u1',
        username: '创作者甲',
        displayName: null,
        quota: 500000,
        quotaUnit: '点',
        canGenerate: true,
      }),
    },
    aiProviders: { list: async () => [], setActive: vi.fn() },
    ...(available ? { accountCloud: cloud } : {}),
  } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = render(
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: DESKTOP_CAPABILITIES }}>
        <AccountCloudConnectionCard />
      </PlatformProvider>
    </QueryClientProvider>,
  );
  return { cloud, client, ...ui };
}

describe('explicit account cloud connection and original-task recovery', () => {
  it('does not render on hosts without this local setup domain', () => {
    const { cloud } = fixture(preview, false);
    expect(screen.queryByTestId('account-cloud-card')).toBeNull();
    expect(cloud.getStatus).not.toHaveBeenCalled();
  });

  it('preview and dismissing review never enable a connection or send a request', async () => {
    const { cloud } = fixture();
    await screen.findByTestId('account-cloud-review');
    expect(cloud.connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('account-cloud-review'));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('创作者甲');
    expect(dialog.textContent).toContain(preview.apiIssuer);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(cloud.connect).not.toHaveBeenCalled();
    expect(cloud.resume).not.toHaveBeenCalled();
  });

  it.each(['connect', 'resume'] as const)(
    'submits only the reviewed reference for %s',
    async (action) => {
      const { cloud } = fixture({
        ...preview,
        mode: action === 'resume' ? 'query_only' : 'not_enabled',
        reviewAction: action,
      });
      fireEvent.click(await screen.findByTestId('account-cloud-review'));
      fireEvent.click(screen.getByTestId('account-cloud-confirm'));
      await waitFor(() =>
        expect(cloud[action]).toHaveBeenCalledExactlyOnceWith({ reviewRef: preview.reviewRef }),
      );
      expect(cloud[action === 'connect' ? 'resume' : 'connect']).not.toHaveBeenCalled();
    },
  );

  it('does not apply a review opened before an account transition', async () => {
    const { cloud, client } = fixture();
    fireEvent.click(await screen.findByTestId('account-cloud-review'));
    beginAccountTransition(client);
    fireEvent.click(screen.getByTestId('account-cloud-confirm'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(cloud.connect).not.toHaveBeenCalled();
  });

  it('uses separate original-request query and cancellation methods', async () => {
    const { cloud } = fixture();
    const recovery = await screen.findByTestId('account-cloud-recovery');
    fireEvent.click(within(recovery).getByRole('button', { name: '核对原任务' }));
    await waitFor(() =>
      expect(cloud.reconcile).toHaveBeenCalledExactlyOnceWith({ requestId: 'original-request' }),
    );
    await waitFor(() =>
      expect(
        within(recovery).getByRole('button', { name: '停止原任务' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(within(recovery).getByRole('button', { name: '停止原任务' }));
    await waitFor(() =>
      expect(cloud.cancel).toHaveBeenCalledExactlyOnceWith({ requestId: 'original-request' }),
    );
    expect(cloud.connect).not.toHaveBeenCalled();
  });

  it('does not query task records when identity is unavailable, including manual checks', async () => {
    const { cloud } = fixture({
      ...preview,
      mode: 'blocked',
      principalId: null,
      apiIssuer: null,
      reviewRef: null,
      reviewAction: null,
    });
    await screen.findByTestId('account-cloud-check');
    fireEvent.click(screen.getByTestId('account-cloud-check'));
    await waitFor(() => expect(cloud.getStatus).toHaveBeenCalledTimes(2));
    expect(cloud.listRecovery).not.toHaveBeenCalled();
  });
});
