import { describe, expect, it } from 'vitest';
import { generationJobSchema } from '@musefold/contracts';
import type { HistoryRecord } from '@musefold/desktop-contracts/models';
import {
  generationHistoryQueryToListArgs,
  historyRecordToGenerationJob,
  markGenerationJobDeleted,
  paginateGenerationJobs,
} from '../mappers/history';
import { epochMsToIso } from '../mappers/time';

function record(patch: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'hist-1',
    promptId: 'prompt-1',
    providerId: 'prov-1',
    model: 'gpt-image-2',
    promptText: 'paper collage',
    negativeText: 'text',
    params: { schemaVersion: 1, size: '2048x2048', quality: 'high', n: 4, aspectRatio: '1:1' },
    status: 'success',
    errorCode: null,
    errorMessage: null,
    imagePath: '/tmp/out.png',
    cost: 32.4,
    costUnit: 'point',
    durationMs: 1200,
    createdAt: 1_728_000_000_000,
    parentHistoryId: 'hist-0',
    ...patch,
  };
}

describe('history record → generation job mapping', () => {
  it('maps success rows into a contract-shaped job and drops desktop-only size', () => {
    const job = historyRecordToGenerationJob(record());
    expect(generationJobSchema.parse(job)).toMatchObject({
      id: 'hist-1',
      status: 'succeeded',
      actorType: 'web',
      approvalStatus: 'not_required',
      progress: 100,
      costPoints: 32,
      parentRunId: 'hist-0',
      sessionId: null,
    });
    expect(job.request.size).toBe('auto');
    expect(job.request.count).toBe(1);
    expect(job.assets[0]).toMatchObject({
      url: '/tmp/out.png',
      mimeType: 'image/png',
      width: 1,
      byteSize: 0,
    });
  });

  it('maps failed status and RATE_LIMIT to RATE_LIMITED', () => {
    const job = historyRecordToGenerationJob(
      record({
        status: 'failed',
        errorCode: 'RATE_LIMIT',
        errorMessage: '429',
        imagePath: null,
      }),
    );
    expect(job.status).toBe('failed');
    expect(job.progress).toBe(0);
    expect(job.assets).toEqual([]);
    expect(job.error).toEqual({ code: 'RATE_LIMITED', message: '429' });
  });

  it('encodes list offset from cursor and marks hard-delete snapshots', () => {
    expect(generationHistoryQueryToListArgs({ cursor: '40', limit: 10 })).toEqual({
      limit: 10,
      offset: 40,
    });
    expect(generationHistoryQueryToListArgs({ cursor: 'bad' }).offset).toBe(0);
    const page = paginateGenerationJobs([record(), record({ id: 'hist-2' })], { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('2');
    const deleted = markGenerationJobDeleted(page.items[0], 1_730_000_000_000);
    expect(deleted.deletedAt).toBe(epochMsToIso(1_730_000_000_000));
  });
});
