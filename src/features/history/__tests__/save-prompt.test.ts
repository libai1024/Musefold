import { describe, expect, it } from 'vitest';
import type { HistoryRecord } from '@shared/types/models';
import { defaultHistoryPromptTitle, historyRecordToPromptInput } from '../save-prompt';

function makeRecord(patch: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'history-save-1',
    promptId: null,
    providerId: 'provider-1',
    model: 'gpt-image-2',
    promptText: 'cinematic portrait with amber rim light and rain',
    negativeText: 'blur, low quality',
    params: { schemaVersion: 1, size: '1024x1024', quality: 'high', n: 1 },
    status: 'success',
    errorCode: null,
    errorMessage: null,
    imagePath: '/tmp/history-save.png',
    cost: 32,
    durationMs: 1200,
    createdAt: 1_728_000_000_000,
    ...patch,
    costUnit: patch.costUnit ?? 'cny_cent',
  };
}

describe('history save as prompt mapping', () => {
  it('uses the trimmed custom title and carries history fields', () => {
    const record = makeRecord();

    expect(historyRecordToPromptInput(record, '  Rain portrait  ')).toEqual({
      title: 'Rain portrait',
      content: record.promptText,
      contentNegative: record.negativeText,
      params: record.params,
      source: 'import',
      sourceUrl: 'history://history-save-1',
    });
  });

  it('falls back to the first 20 compact prompt characters', () => {
    const record = makeRecord({
      promptText: '  first line\nsecond line with more words than needed  ',
    });

    expect(defaultHistoryPromptTitle(record)).toBe('first line second li');
    expect(historyRecordToPromptInput(record, '').title).toBe('first line second li');
  });

  it('omits nullable optional fields when history has none', () => {
    const record = makeRecord({ negativeText: null, params: null });

    expect(historyRecordToPromptInput(record, undefined)).toEqual({
      title: 'cinematic portrait w',
      content: record.promptText,
      contentNegative: undefined,
      params: undefined,
      source: 'import',
      sourceUrl: 'history://history-save-1',
    });
  });
});
