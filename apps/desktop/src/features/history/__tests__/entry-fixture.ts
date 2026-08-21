// V13-ENT-02：history 域测试共用的文档条目夹具（contracts GenerationJob + 桌面扩展）。

import type { DesktopGenerationEntry } from '@musefold/desktop-contracts/history-documents';

export function historyEntryFixture(
  overrides: Partial<DesktopGenerationEntry> = {},
): DesktopGenerationEntry {
  return {
    id: 'history-1',
    sessionId: null,
    parentRunId: null,
    promptId: null,
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'failed',
    progress: 0,
    request: { prompt: 'a quiet room', size: 'auto', quality: 'auto', count: 1 },
    providerModel: 'gpt-image-2',
    costPoints: null,
    assets: [],
    error: { code: 'RATE_LIMITED', message: '429' },
    createdAt: '2026-08-21T00:00:00.000+00:00',
    startedAt: '2026-08-21T00:00:00.000+00:00',
    finishedAt: '2026-08-21T00:00:00.120+00:00',
    // 桌面扩展
    providerId: 'provider-1',
    imagePath: null,
    cost: null,
    costUnit: 'point',
    durationMs: 120,
    params: null,
    createdAtMs: 1_755_731_200_000,
    errorCode: 'RATE_LIMIT',
    errorMessage: '429',
    ...overrides,
  };
}
