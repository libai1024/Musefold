/** @vitest-environment jsdom */
import type { GenerationJob } from '@musefold/contracts';
import type { GenerationGateway, MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GenerationTimeline } from '../GenerationTimeline';

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/Z$/, '+00:00');
}

function makeJob(): GenerationJob {
  return {
    id: 'job-1',
    sessionId: 'session-1',
    parentRunId: null,
    promptId: null,
    userPrompt: 'seed prompt',
    promptReferences: [],
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: 'seed prompt',
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    },
    providerModel: 'test-model',
    costPoints: null,
    assets: [],
    error: null,
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: nowIso(1_000),
    deletedAt: null,
  };
}

function renderTimeline(keyboardInset?: number, composerExtraInset?: number) {
  const generation = {
    saveAsset: async () => 'saved' as const,
    copyAssetToClipboard: async () => {},
  } as unknown as GenerationGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformProvider
        runtime={{
          gateway: { generation } as MusefoldGateway,
          capabilities: WEB_CAPABILITIES,
        }}
      >
        <GenerationTimeline
          jobs={[makeJob()]}
          keyboardInset={keyboardInset}
          composerExtraInset={composerExtraInset}
          onCancel={() => {}}
          onRetry={() => {}}
          onRemove={() => {}}
          onEditMessage={() => {}}
        />
      </PlatformProvider>
    </QueryClientProvider>,
  );
}

describe('GenerationTimeline 软键盘底部留白', () => {
  it('adds the measured model panel to the keyboard inset', () => {
    renderTimeline(280, 84);
    expect(screen.getByTestId('timeline').style.paddingBottom).toBe('536px');
  });

  it('keeps the responsive base gap when adding the model panel without a keyboard', () => {
    renderTimeline(0, 84);
    expect(screen.getByTestId('timeline').style.paddingBottom).toBe(
      'calc(var(--timeline-bottom) + 84px)',
    );
  });
  it('<md inset>0 时 paddingBottom = 172 + inset', () => {
    renderTimeline(280);
    const timeline = screen.getByTestId('timeline');
    expect(timeline.getAttribute('data-keyboard-inset')).toBe('280');
    expect(timeline.style.paddingBottom).toBe('452px');
  });

  it('inset=0 / 未传入时保持 Tailwind 172/220,不写 inline padding', () => {
    renderTimeline();
    const timeline = screen.getByTestId('timeline');
    expect(timeline.getAttribute('data-keyboard-inset')).toBe('0');
    expect(timeline.style.paddingBottom).toBe('');
    expect(timeline.className).toContain('pb-[172px]');
    expect(timeline.className).toContain('md:pb-[220px]');
  });
});
