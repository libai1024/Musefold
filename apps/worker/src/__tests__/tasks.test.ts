import type { S3Client } from '@aws-sdk/client-s3';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import type { MusefoldDatabase } from '@musefold/db';
import { describe, expect, it } from 'vitest';
import {
  decideFailureTransition,
  decideFinishTransition,
  decideLeaseRecovery,
  downloadReferences,
  reconcileStaleRuns,
} from '../tasks.js';

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
