import { describe, expect, it } from 'vitest';
import { generationJobSchema } from '@musefold/contracts';
import type { HistoryRecord } from '@musefold/desktop-contracts/models';
import {
  generationHistoryQueryToListArgs,
  historyRecordToDesktopGenerationEntry,
  historyRecordToGenerationJob,
  markGenerationJobDeleted,
  paginateGenerationJobs,
  relatedHistoryRowsToDocuments,
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

describe('history record → desktop generation entry', () => {
  it('keeps lossless desktop fields on top of the contract-shaped job', () => {
    const entry = historyRecordToDesktopGenerationEntry(
      record({
        promptReferences: [{ promptId: 'prompt-1', title: '雨巷', text: 'paper', scope: 'full' }],
        promptRelations: [{ kind: 'source' }],
      }),
    );
    expect(generationJobSchema.parse(entry)).toMatchObject({ id: 'hist-1', status: 'succeeded' });
    expect(entry.providerId).toBe('prov-1');
    expect(entry.imagePath).toBe('/tmp/out.png');
    expect(entry.cost).toBe(32.4);
    expect(entry.costUnit).toBe('point');
    expect(entry.params?.n).toBe(4);
    expect(entry.createdAtMs).toBe(1_728_000_000_000);
    expect(entry.promptReferences?.[0]?.promptId).toBe('prompt-1');
    expect(entry.promptRelations).toEqual([{ kind: 'source' }]);
    expect(entry.request.prompt).toBe('paper collage');
    expect(entry.providerModel).toBe('gpt-image-2');
  });

  it('maps relatedHistory row payloads without dropping total', () => {
    const result = relatedHistoryRowsToDocuments({
      items: [record({ id: 'hist-rel' })],
      total: 7,
    });
    expect(result.total).toBe(7);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('hist-rel');
    expect(result.items[0].status).toBe('succeeded');
    expect(result.items[0].imagePath).toBe('/tmp/out.png');
  });
});
