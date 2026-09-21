import type { GenerationJob } from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PROMPT_RELATED_WORKS_SCAN_LIMIT, usePromptRelatedWorks } from '../hooks';

function nowIso(): string {
  return new Date().toISOString().replace(/Z$/, '+00:00');
}

function makeJob(partial: Partial<GenerationJob> & { id: string }): GenerationJob {
  return {
    sessionId: null,
    parentRunId: null,
    promptId: 'prompt-1',
    promptReferences: [],
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: `prompt ${partial.id}`,
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    },
    providerModel: 'model-a',
    costPoints: null,
    assets: [
      {
        id: `${partial.id}-asset`,
        url: 'https://example.test/a.png',
        mimeType: 'image/png',
        width: 512,
        height: 512,
        byteSize: 1024,
        expiresAt: '2099-01-01T00:00:00+00:00',
      },
    ],
    error: null,
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: nowIso(),
    deletedAt: null,
    ...partial,
  };
}

describe('usePromptRelatedWorks', () => {
  it('下推 promptId + succeeded,只保留有成图的回合', async () => {
    const list = vi.fn(async () => ({
      items: [makeJob({ id: 'with-asset' }), makeJob({ id: 'empty', assets: [] })],
      nextCursor: null,
    }));
    const gateway = { generation: { list } } as unknown as MusefoldGateway;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePromptRelatedWorks('prompt-1'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
            {children}
          </PlatformProvider>
        </QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list).toHaveBeenCalledWith({
      promptId: 'prompt-1',
      status: 'succeeded',
      limit: PROMPT_RELATED_WORKS_SCAN_LIMIT,
    });
    expect(result.current.data?.map((job) => job.id)).toEqual(['with-asset']);
  });
});
