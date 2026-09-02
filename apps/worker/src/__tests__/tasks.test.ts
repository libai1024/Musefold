import type { S3Client } from '@aws-sdk/client-s3';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import type { MusefoldDatabase } from '@musefold/db';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratedImage } from '../image-gateway.js';
import {
  decideFailureTransition,
  decideFinishTransition,
  decideGenerationCommit,
  decideLeaseRecovery,
  downloadReferences,
  executeGenerationAttempt,
  generationJobKey,
  ownsGenerationLease,
  processObjectCleanupBatch,
  processObjectCleanupBatches,
  reconcileStaleRuns,
  uploadImagesForGeneration,
  type ObjectCleanupStore,
} from '../tasks.js';

const generatedImage: GeneratedImage = {
  bytes: Buffer.from([1, 2, 3]),
  mimeType: 'image/png',
  width: 1,
  height: 1,
};

function generationAttemptRequest() {
  return cloudGenerationRequestSchema.parse({ prompt: 'worker attempt' });
}

function generationLease(
  overrides: Partial<{
    markUpstreamRequestSent: () => Promise<boolean>;
    assertOwned: () => Promise<void>;
  }> = {},
) {
  return {
    signal: new AbortController().signal,
    start: vi.fn(),
    stop: vi.fn(),
    assertOwned: overrides.assertOwned ?? vi.fn(async () => undefined),
    markUpstreamRequestSent: overrides.markUpstreamRequestSent ?? vi.fn(async () => true),
  };
}

function cleanupCallbacks() {
  return {
    enqueueCleanup: vi.fn(async (_keys: string[], _nextAttemptAt?: Date) => undefined),
    acknowledgeCleanup: vi.fn(async (_keys: string[]) => undefined),
    recordCleanupFailure: vi.fn(async (_keys: string[], _error: unknown) => undefined),
  };
}

describe('generation task attempt 副作用 fencing', () => {
  it('请求边界拒绝时不调用 fetch，仍调用 guarded markFailed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const lease = generationLease({
      markUpstreamRequestSent: vi.fn(async () => false),
    });
    const markFailed = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => 'succeed' as const);
    const remove = vi.fn(async () => undefined);

    await executeGenerationAttempt({
      s3: {} as S3Client,
      bucket: 'bucket',
      baseUrl: 'https://newapi.example',
      owner: { userId: 'user-1', runId: 'run-1', epoch: 2 },
      request: generationAttemptRequest(),
      apiKey: 'secret',
      references: [],
      lease,
      markFailed,
      finalize,
      remove,
      ...cleanupCallbacks(),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith('GENERATION_UPSTREAM_UNKNOWN', '生成租约已失效');
    expect(finalize).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(lease.stop).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('第二张上传结果不确定时持久清理两张已尝试对象键', async () => {
    const putKeys: string[] = [];
    const s3 = {
      send: vi.fn(async (command: { input?: { Key?: string } }) => {
        const key = command.input?.Key;
        if (!key) return {};
        putKeys.push(key);
        if (putKeys.length === 2) throw new Error('second upload failed');
        return {};
      }),
    } as unknown as S3Client;
    const removed: string[][] = [];
    const markFailed = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => 'succeed' as const);

    await executeGenerationAttempt({
      s3,
      bucket: 'bucket',
      baseUrl: 'https://newapi.example',
      owner: { userId: 'user-1', runId: 'run-1', epoch: 2 },
      request: generationAttemptRequest(),
      apiKey: 'secret',
      references: [],
      lease: generationLease(),
      markFailed,
      finalize,
      generate: vi.fn(async () => [generatedImage, generatedImage]),
      upload: uploadImagesForGeneration,
      remove: vi.fn(async (_s3, _bucket, keys) => {
        removed.push([...keys]);
      }),
      ...cleanupCallbacks(),
    });

    expect(putKeys).toHaveLength(2);
    expect(removed).toEqual([[putKeys[0] as string, putKeys[1] as string]]);
    expect(markFailed).toHaveBeenCalledWith('GENERATION_UPSTREAM_UNKNOWN', '生成执行失败');
    expect(finalize).not.toHaveBeenCalled();
  });

  it('finalize 因 lease/epoch 丢失跳过时清理对象且不视为成功提交', async () => {
    const uploadedKey = 'users/user-1/generations/run-1/asset-1';
    const remove = vi.fn(async () => undefined);
    const markFailed = vi.fn(async () => undefined);
    const finalize = vi.fn(async () => 'skip' as const);

    await executeGenerationAttempt({
      s3: {} as S3Client,
      bucket: 'bucket',
      baseUrl: 'https://newapi.example',
      owner: { userId: 'user-1', runId: 'run-1', epoch: 2 },
      request: generationAttemptRequest(),
      apiKey: 'secret',
      references: [],
      lease: generationLease(),
      markFailed,
      finalize,
      generate: vi.fn(async () => [generatedImage]),
      upload: vi.fn(async (_s3, _bucket, _owner, images, keys) => {
        keys.push(uploadedKey);
        return [
          {
            ...(images[0] as GeneratedImage),
            id: 'asset-1',
            objectKey: uploadedKey,
            checksum: '0'.repeat(64),
          },
        ];
      }),
      remove,
      ...cleanupCallbacks(),
    });

    expect(finalize).toHaveBeenCalledOnce();
    expect(markFailed).toHaveBeenCalledWith('GENERATION_UPSTREAM_UNKNOWN', '生成执行失败');
    expect(remove).toHaveBeenCalledWith(expect.anything(), 'bucket', [uploadedKey]);
  });
  it('删除失败时先固化清理意图并记录失败,不确认队列', async () => {
    const uploadedKey = 'users/user-1/generations/run-1/asset-failed-delete';
    const cleanup = cleanupCallbacks();
    const removeError = Object.assign(new Error('storage unavailable'), { name: 'S3Unavailable' });
    const order: string[] = [];
    cleanup.enqueueCleanup.mockImplementation(async () => {
      order.push('enqueue');
    });
    cleanup.recordCleanupFailure.mockImplementation(async () => {
      order.push('failure');
    });

    await executeGenerationAttempt({
      s3: {} as S3Client,
      bucket: 'bucket',
      baseUrl: 'https://newapi.example',
      owner: { userId: 'user-1', runId: 'run-1', epoch: 2 },
      request: generationAttemptRequest(),
      apiKey: 'secret',
      references: [],
      lease: generationLease(),
      markFailed: vi.fn(async () => undefined),
      finalize: vi.fn(async () => 'cancel' as const),
      generate: vi.fn(async () => [generatedImage]),
      upload: vi.fn(async (_s3, _bucket, _owner, images, keys, beforeUpload) => {
        await beforeUpload?.(uploadedKey);
        keys.push(uploadedKey);
        return [
          {
            ...(images[0] as GeneratedImage),
            id: 'asset-failed-delete',
            objectKey: uploadedKey,
            checksum: '0'.repeat(64),
          },
        ];
      }),
      remove: vi.fn(async () => {
        order.push('remove');
        throw removeError;
      }),
      ...cleanup,
    });

    expect(order).toEqual(['enqueue', 'enqueue', 'remove', 'failure']);
    expect(cleanup.enqueueCleanup).toHaveBeenNthCalledWith(1, [uploadedKey], expect.any(Date));
    expect(cleanup.enqueueCleanup).toHaveBeenNthCalledWith(2, [uploadedKey]);
    expect(cleanup.recordCleanupFailure).toHaveBeenCalledWith([uploadedKey], removeError);
    expect(cleanup.acknowledgeCleanup).not.toHaveBeenCalled();
  });
});

describe('对象存储清理维护', () => {
  function cleanupStore(input: { claimed: string[]; protected?: string[]; leased?: string[] }) {
    const store: ObjectCleanupStore = {
      queueExpiredReferences: vi.fn(async () => 2),
      claimDue: vi.fn(async () =>
        input.claimed.map((objectKey) => ({ objectKey, objectType: 'generation_asset' })),
      ),
      findProtected: vi.fn(async () => ({
        permanent: input.protected ?? [],
        leased: input.leased ?? [],
      })),
      acknowledge: vi.fn(async () => undefined),
      discardProtected: vi.fn(async () => undefined),
      deferLeased: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    };
    return store;
  }

  it('跳过仍被资产/参考链接保护的键并删除其余对象', async () => {
    const store = cleanupStore({
      claimed: ['protected-key', 'orphan-key'],
      protected: ['protected-key'],
    });
    const remove = vi.fn(async () => undefined);

    const result = await processObjectCleanupBatch(
      store,
      {} as S3Client,
      'bucket',
      remove,
      new Date('2026-09-01T00:00:00.000Z'),
    );

    expect(remove).toHaveBeenCalledWith(expect.anything(), 'bucket', ['orphan-key']);
    expect(store.discardProtected).toHaveBeenCalledWith(['protected-key']);
    expect(store.acknowledge).toHaveBeenCalledWith(['orphan-key']);
    expect(result).toEqual({ expiredReferences: 2, deleted: 1, protected: 1, failed: 0 });
  });

  it('延后仍受活跃生成租约保护的键且不丢弃清理意图', async () => {
    const store = cleanupStore({ claimed: ['leased-key'], leased: ['leased-key'] });
    const remove = vi.fn(async () => undefined);
    const now = new Date('2026-09-01T00:00:00.000Z');

    const result = await processObjectCleanupBatch(store, {} as S3Client, 'bucket', remove, now);

    expect(store.deferLeased).toHaveBeenCalledWith(['leased-key'], now);
    expect(store.discardProtected).not.toHaveBeenCalled();
    expect(store.acknowledge).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(result).toEqual({ expiredReferences: 2, deleted: 0, protected: 1, failed: 0 });
  });

  it('有界排空连续批次并在首个空批次停止', async () => {
    const store = cleanupStore({ claimed: [] });
    const claimDue = vi.mocked(store.claimDue);
    claimDue
      .mockResolvedValueOnce([{ objectKey: 'orphan-1', objectType: 'generation_asset' }])
      .mockResolvedValueOnce([{ objectKey: 'orphan-2', objectType: 'generation_asset' }])
      .mockResolvedValueOnce([]);
    vi.mocked(store.queueExpiredReferences).mockResolvedValue(0);
    const remove = vi.fn(async () => undefined);

    const result = await processObjectCleanupBatches(
      store,
      {} as S3Client,
      'bucket',
      remove,
      new Date('2026-09-01T00:00:00.000Z'),
      10,
    );

    expect(claimDue).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenNthCalledWith(1, expect.anything(), 'bucket', ['orphan-1']);
    expect(remove).toHaveBeenNthCalledWith(2, expect.anything(), 'bucket', ['orphan-2']);
    expect(result).toEqual({ expiredReferences: 0, deleted: 2, protected: 0, failed: 0 });
  });

  it('对象删除 outage 保留批次并委托 store 写 backoff', async () => {
    const store = cleanupStore({ claimed: ['orphan-1', 'orphan-2'] });
    const error = new Error('S3 down');
    const now = new Date('2026-09-01T00:00:00.000Z');

    const result = await processObjectCleanupBatch(
      store,
      {} as S3Client,
      'bucket',
      vi.fn(async () => {
        throw error;
      }),
      now,
    );

    expect(store.fail).toHaveBeenCalledWith(['orphan-1', 'orphan-2'], error, now);
    expect(store.acknowledge).not.toHaveBeenCalled();
    expect(result.failed).toBe(2);
  });
  it('S3 HTTP 成功但包含 per-object Errors 时不确认清理', async () => {
    const store = cleanupStore({ claimed: ['orphan-error'] });
    const s3 = {
      send: vi.fn(async () => ({ Errors: [{ Key: 'orphan-error', Code: 'InternalError' }] })),
    } as unknown as S3Client;

    const result = await processObjectCleanupBatch(
      store,
      s3,
      'bucket',
      undefined,
      new Date('2026-09-01T00:00:00.000Z'),
    );

    expect(store.acknowledge).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(
      ['orphan-error'],
      expect.objectContaining({ name: 'S3DeleteObjectsError' }),
      expect.any(Date),
    );
    expect(result.failed).toBe(1);
  });
});

describe('生成租约恢复决策', () => {
  const now = Date.parse('2026-08-19T00:00:00.000Z');

  it('已发出上游请求且租约过期 → 标记 unknown 而不是重试', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'running',
          upstreamRequestSent: true,
          leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z'),
        },
        now,
      ),
    ).toBe('mark_unknown');
  });

  it('租约过期但尚未发出上游请求 → 允许继续执行', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'running',
          upstreamRequestSent: false,
          leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z'),
        },
        now,
      ),
    ).toBe('continue');
  });

  it('租约仍然有效 → 不做任何处理', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'running',
          upstreamRequestSent: true,
          leaseExpiresAt: new Date('2026-08-19T00:01:00.000Z'),
        },
        now,
      ),
    ).toBe('skip');
  });

  it('没有租约 → 不做任何处理', () => {
    expect(
      decideLeaseRecovery(
        { status: 'running', upstreamRequestSent: true, leaseExpiresAt: null },
        now,
      ),
    ).toBe('skip');
  });

  it('cancelling 且未发出上游请求、租约过期 → 收敛为 cancelled 而不是重跑', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'cancelling',
          upstreamRequestSent: false,
          leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z'),
        },
        now,
      ),
    ).toBe('mark_cancelled');
  });

  it('cancelling 但上游请求已发出、租约过期 → 仍按计费安全标记 unknown', () => {
    expect(
      decideLeaseRecovery(
        {
          status: 'cancelling',
          upstreamRequestSent: true,
          leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z'),
        },
        now,
      ),
    ).toBe('mark_unknown');
  });
});

describe('epoch 与租约 fencing', () => {
  const future = new Date('2026-08-19T00:10:00.000Z');
  const now = Date.parse('2026-08-19T00:00:00.000Z');

  it('只允许相同 epoch 且未过期的 owner 写入终局', () => {
    expect(ownsGenerationLease({ attemptCount: 2, leaseExpiresAt: future }, 2, now)).toBe(true);
    expect(ownsGenerationLease({ attemptCount: 1, leaseExpiresAt: future }, 2, now)).toBe(false);
    expect(
      ownsGenerationLease(
        { attemptCount: 2, leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z') },
        2,
        now,
      ),
    ).toBe(false);
    expect(
      decideGenerationCommit(
        { status: 'succeeded', attemptCount: 1, leaseExpiresAt: future },
        2,
        now,
      ),
    ).toBe('skip');
    expect(
      decideGenerationCommit(
        {
          status: 'running',
          attemptCount: 2,
          leaseExpiresAt: new Date('2026-08-18T23:59:00.000Z'),
        },
        2,
        now,
      ),
    ).toBe('skip');
  });

  it('重试入队使用稳定 job key', () => {
    expect(generationJobKey('run-1')).toBe('generation:run-1');
  });
});

describe('终局裁决(成功/失败路径的状态守卫)', () => {
  it('成功路径:running 提交,cancelling 收敛取消,其余终态跳过', () => {
    expect(decideFinishTransition('running')).toBe('succeed');
    expect(decideFinishTransition('cancelling')).toBe('cancel');
    expect(decideFinishTransition('cancelled')).toBe('skip');
    expect(decideFinishTransition('failed')).toBe('skip');
    expect(decideFinishTransition(undefined)).toBe('skip');
  });

  it('失败路径:running 记失败,cancelling 收敛取消(用户取消意图优先),终态跳过', () => {
    expect(decideFailureTransition('running')).toBe('fail');
    expect(decideFailureTransition('cancelling')).toBe('cancel');
    expect(decideFailureTransition('succeeded')).toBe('skip');
    expect(decideFailureTransition(undefined)).toBe('skip');
  });
});

describe('卡死运行巡检(generation.reconcile)', () => {
  function fakeDb(staleRows: Array<{ id: string; userId: string }>) {
    const enqueued: string[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => staleRows,
          }),
        }),
      }),
      execute: async (query: { queryChunks?: unknown }) => {
        enqueued.push(JSON.stringify(query.queryChunks ?? query));
        return { rows: [] };
      },
    } as unknown as Pick<MusefoldDatabase, 'select' | 'execute'>;
    return { db, enqueued };
  }

  it('每个过期/卡死行重新 add_job 一次', async () => {
    const { db, enqueued } = fakeDb([
      { id: 'run-1', userId: 'user-1' },
      { id: 'run-2', userId: 'user-2' },
    ]);
    const count = await reconcileStaleRuns(db);
    expect(count).toBe(2);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[0]).toContain('run-1');
    expect(enqueued[1]).toContain('run-2');
    expect(enqueued[0]).toContain('generation:run-1');
    expect(enqueued[0]).toContain('replace');
    expect(enqueued[0]).toContain('1');
  });

  it('重复巡检仍以同一 stable key upsert,不生成不同 key', async () => {
    const { db, enqueued } = fakeDb([{ id: 'run-1', userId: 'user-1' }]);
    await reconcileStaleRuns(db);
    await reconcileStaleRuns(db);
    expect(enqueued).toHaveLength(2);
    expect(enqueued.every((query) => query.includes('generation:run-1'))).toBe(true);
  });

  it('没有卡死行时不入队', async () => {
    const { db, enqueued } = fakeDb([]);
    expect(await reconcileStaleRuns(db)).toBe(0);
    expect(enqueued).toHaveLength(0);
  });
});

describe('参考图对象下载', () => {
  const reference = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    url: '/api/v1/reference-images/01ARZ3NDEKTSV4RRFFQ69G5FAV/url',
    name: 'style.png',
    mimeType: 'image/png' as const,
    byteSize: 4,
  };
  const request = cloudGenerationRequestSchema.parse({
    prompt: 'remix',
    referenceImages: [reference],
  });

  it('按 users/{userId}/references/{id} 取字节,保持顺序与元数据', async () => {
    const requestedKeys: string[] = [];
    const s3 = {
      send: async (command: { input: { Key?: string } }) => {
        requestedKeys.push(command.input.Key ?? '');
        return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3, 4]) } };
      },
    } as unknown as S3Client;

    const downloaded = await downloadReferences(s3, 'bucket', 'user-1', request);

    expect(requestedKeys).toEqual(['users/user-1/references/01ARZ3NDEKTSV4RRFFQ69G5FAV']);
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]).toMatchObject({ mimeType: 'image/png', name: 'style.png' });
    expect([...(downloaded[0]?.bytes ?? [])]).toEqual([1, 2, 3, 4]);
  });

  it('对象缺失归一为 rejected 上游错误(带文件名提示)', async () => {
    const s3 = {
      send: async () => {
        throw new Error('NoSuchKey');
      },
    } as unknown as S3Client;

    await expect(downloadReferences(s3, 'bucket', 'user-1', request)).rejects.toMatchObject({
      code: 'rejected',
      message: '参考图「style.png」已不可用,请重新上传',
    });
  });
});
