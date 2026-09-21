import { describe, expect, it } from 'vitest';
import {
  accountCloudStatusSchema,
  accountCloudReviewInputSchema,
  accountCloudReconcileInputSchema,
  accountCloudRecoveryListSchema,
} from '../account-cloud';

describe('account cloud host contracts', () => {
  it('accepts a bounded status without credentials', () => {
    const status = {
      mode: 'blocked',
      principalId: null,
      apiIssuer: null,
      connectionId: null,
      reviewRef: null,
      reviewAction: null,
      message: '请登录',
    };
    expect(accountCloudStatusSchema.parse(status)).toEqual(status);
    expect(accountCloudStatusSchema.safeParse({ ...status, token: 'forbidden' }).success).toBe(
      false,
    );
  });
  it('accepts only a review reference, never caller-provided execution authority', () => {
    const input = { reviewRef: '11111111-1111-4111-8111-111111111111' };
    expect(accountCloudReviewInputSchema.parse(input)).toEqual(input);
    for (const extra of [{ principalId: 'other' }, { binding: {} }, { apiKey: 'forbidden' }])
      expect(accountCloudReviewInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    expect(
      accountCloudReconcileInputSchema.safeParse({ requestId: 'original', forceResubmit: true })
        .success,
    ).toBe(false);
  });
  it('bounds the recovery surface and excludes local paths', () => {
    const item = {
      requestId: 'request',
      localGenerationId: null,
      createdAt: '2026-09-08T00:00:00Z',
      canCancel: false,
      recovery: {
        requestId: 'request',
        remoteStatus: 'succeeded',
        costKnown: false,
        result: 'purged',
        message: '原素材已清理，费用未知',
      },
    };
    expect(accountCloudRecoveryListSchema.parse({ items: [item], nextCursor: null })).toEqual({
      items: [item],
      nextCursor: null,
    });
    expect(
      accountCloudRecoveryListSchema.safeParse({
        items: Array.from({ length: 21 }, () => item),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      accountCloudRecoveryListSchema.safeParse({
        items: [{ ...item, path: '/private/data' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
