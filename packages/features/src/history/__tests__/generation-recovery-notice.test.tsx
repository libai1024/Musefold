import { generationJobSchema, type GenerationRecovery } from '@musefold/contracts';
import { DESKTOP_CAPABILITIES, PlatformProvider, type MusefoldGateway } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GenerationRecoveryNotice } from '../GenerationRecoveryNotice';
import { beginAccountTransition } from '../../account/account-session';
import { toast } from '@musefold/ui/components/sonner';

vi.mock('@musefold/ui/components/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function mount(result: GenerationRecovery['result'], costKnown = true) {
  const recovery = {
    requestId: 'durable-request',
    remoteStatus: 'succeeded' as const,
    costKnown,
    result,
    message: '云任务已完成；素材状态与费用分别核对。',
  };
  const job = generationJobSchema.parse({
    id: 'local-run',
    sessionId: null,
    parentRunId: null,
    promptId: null,
    actorType: 'desktop_local',
    approvalStatus: 'not_required',
    status: 'succeeded',
    recovery,
    progress: 100,
    request: { prompt: 'synthetic', count: 1 },
    providerModel: null,
    costPoints: null,
    assets: [],
    error: null,
    createdAt: '2026-09-08T00:00:00Z',
    startedAt: null,
    finishedAt: null,
  });
  const response = {
    requestId: 'durable-request',
    localGenerationId: job.id,
    createdAt: job.createdAt,
    canCancel: false,
    recovery,
  };
  const reconcile = vi.fn(async () => response);
  const create = vi.fn();
  const get = vi.fn();
  const gateway = {
    accountCloud: { reconcile },
    generation: { create, get },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: DESKTOP_CAPABILITIES }}>
        <GenerationRecoveryNotice job={job} />
      </PlatformProvider>
    </QueryClientProvider>,
  );
  return { reconcile, create, get, client, response };
}
describe('separate remote completion and local result notice', () => {
  it('shows a final purged explanation without a replacement action', () => {
    mount('purged');
    expect(screen.getByRole('status').textContent).toContain('云任务已完成');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('queries the durable request, never the local ID or generation create, to restore missing bytes', async () => {
    const { reconcile, create, get } = mount('missing');
    fireEvent.click(screen.getByRole('button', { name: '核对原任务' }));
    await waitFor(() =>
      expect(reconcile).toHaveBeenCalledExactlyOnceWith({ requestId: 'durable-request' }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it('keeps an unknown fee visible even when all images are available', () => {
    mount('available', false);
    expect(screen.getByRole('status').textContent).toContain('未知金额不会记作零');
    expect(screen.getByRole('button', { name: '核对原任务' })).toBeTruthy();
  });
  it('hides the notice only when both material and fee are known', () => {
    mount('available');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('rejects completion from an earlier account transition', async () => {
    vi.mocked(toast.success).mockClear();
    const { reconcile, client, response } = mount('download_pending');
    let resolve!: (value: typeof response) => void;
    reconcile.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '核对原任务' }));
    await waitFor(() => expect(reconcile).toHaveBeenCalled());
    beginAccountTransition(client);
    resolve(response);
    await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
