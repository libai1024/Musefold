import type { SyncMutation } from '@musefold/contracts';
import { describe, expect, it } from 'vitest';
import { fingerprintSyncMutation } from '../service.js';

function promptCreate(payload: Record<string, unknown>): SyncMutation {
  return {
    mutationId: 'mutation-00000001',
    entityType: 'prompt',
    entityId: 'prompt-00000001',
    operation: 'create',
    baseVersion: null,
    payload,
  };
}

const basePayload = {
  title: '测试提示词',
  description: null,
  content: '主提示词',
  negative: null,
  folderId: null,
  modelId: null,
  params: { nested: { z: 1, a: 2 }, samples: ['first', 'second'] },
};

describe('fingerprintSyncMutation', () => {
  it('is stable across recursive object-key order and equivalent defaults', () => {
    const implicitDefaults = promptCreate(basePayload);
    const explicitDefaults = promptCreate({
      sourceUrl: null,
      source: 'manual',
      pinOrder: null,
      isPinned: false,
      rating: 0,
      tagIds: [],
      params: { samples: ['first', 'second'], nested: { a: 2, z: 1 } },
      modelId: null,
      folderId: null,
      negative: null,
      content: '主提示词',
      description: null,
      title: '测试提示词',
    });

    expect(fingerprintSyncMutation(implicitDefaults)).toBe(
      fingerprintSyncMutation(explicitDefaults),
    );
  });

  it('deduplicates and sorts prompt tagIds without sorting ordinary arrays', () => {
    const tagsA = promptCreate({
      ...basePayload,
      tagIds: ['tag-00000002', 'tag-00000001', 'tag-00000002'],
    });
    const tagsB = promptCreate({
      ...basePayload,
      tagIds: ['tag-00000001', 'tag-00000002'],
    });
    expect(fingerprintSyncMutation(tagsA)).toBe(fingerprintSyncMutation(tagsB));

    const reversedSamples = promptCreate({
      ...basePayload,
      params: { ...basePayload.params, samples: ['second', 'first'] },
    });
    expect(fingerprintSyncMutation(reversedSamples)).not.toBe(
      fingerprintSyncMutation(promptCreate(basePayload)),
    );
  });

  it('binds entity identity, operation, and base version into the fingerprint', () => {
    const update: SyncMutation = {
      mutationId: 'mutation-00000001',
      entityType: 'prompt',
      entityId: 'prompt-00000001',
      operation: 'update',
      baseVersion: 1,
      payload: { title: '更新标题' },
    };

    expect(fingerprintSyncMutation(update)).not.toBe(
      fingerprintSyncMutation({ ...update, entityId: 'prompt-00000002' }),
    );
    expect(fingerprintSyncMutation(update)).not.toBe(
      fingerprintSyncMutation({ ...update, baseVersion: 2 }),
    );
    expect(fingerprintSyncMutation(update)).not.toBe(
      fingerprintSyncMutation({ ...update, operation: 'restore', payload: {} }),
    );
  });
});
