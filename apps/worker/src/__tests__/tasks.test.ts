import type { S3Client } from '@aws-sdk/client-s3';
import { cloudGenerationRequestSchema } from '@musefold/contracts';
import { describe, expect, it } from 'vitest';
import { decideLeaseRecovery, downloadReferences } from '../tasks.js';

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
