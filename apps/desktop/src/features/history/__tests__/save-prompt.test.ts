import { describe, expect, it } from 'vitest';
import type { DesktopGenerationEntry } from '@musefold/desktop-contracts/history-documents';
import { defaultHistoryPromptTitle, historyRecordToPromptInput } from '../save-prompt';

function makeRecord(patch: Partial<DesktopGenerationEntry> = {}): DesktopGenerationEntry {
  return {
    id: 'history-save-1',
    sessionId: null,
    parentRunId: null,
    promptId: null,
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: 'cinematic portrait with amber rim light and rain',
      negative: 'blur, low quality',
      size: 'auto',
      quality: 'high',
      count: 1,
    },
    providerModel: 'gpt-image-2',
    costPoints: 32,
    assets: [],
    error: null,
    createdAt: '2025-10-03T00:00:00.000+00:00',
    startedAt: '2025-10-03T00:00:00.000+00:00',
    finishedAt: '2025-10-03T00:00:01.200+00:00',
    providerId: 'provider-1',
    imagePath: '/tmp/history-save.png',
    cost: 32,
    costUnit: 'point',
    durationMs: 1200,
    params: { schemaVersion: 1, size: '1024x1024', quality: 'high', n: 1 },
    createdAtMs: 1_728_000_000_000,
    errorCode: null,
    errorMessage: null,
    ...patch,
  };
}

describe('history save as prompt mapping', () => {
  it('uses the trimmed custom title and carries history fields', () => {
    const record = makeRecord();

    expect(historyRecordToPromptInput(record, '  Rain portrait  ')).toEqual({
      title: 'Rain portrait',
      content: record.request.prompt,
      contentNegative: record.request.negative,
      params: record.params,
      source: 'import',
      sourceUrl: 'history://history-save-1',
    });
  });

  it('falls back to the first 20 compact prompt characters', () => {
    const record = makeRecord({
      request: { ...makeRecord().request, prompt: '  first line\nsecond line with more words than needed  ' },
    });

    expect(defaultHistoryPromptTitle(record)).toBe('first line second li');
    expect(historyRecordToPromptInput(record, '').title).toBe('first line second li');
  });

  it('omits nullable optional fields when history has none', () => {
    const base = makeRecord();
    const record = makeRecord({ request: { ...base.request, negative: undefined }, params: null });

    expect(historyRecordToPromptInput(record, undefined)).toEqual({
      title: 'cinematic portrait w',
      content: record.request.prompt,
      contentNegative: undefined,
      params: undefined,
      source: 'import',
      sourceUrl: 'history://history-save-1',
    });
  });
});
