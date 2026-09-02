import { describe, expect, it } from 'vitest';
import type { SyncMutation } from '@musefold/contracts';
import type { syncMutationResults } from '@musefold/db';
import { SyncService, fingerprintSyncMutation } from '../service.js';

const DEVICE_ID = 'device-1';
const SNAPSHOT = {
  id: 'prompt-1',
  title: 'A prompt',
  description: null,
  content: 'a prompt',
  negative: null,
  folderId: null,
  tags: [],
  modelId: null,
  params: null,
  rating: 0,
  isPinned: false,
  pinOrder: null,
  usageCount: 0,
  lastUsedAt: null,
  source: 'manual',
  sourceUrl: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

function createMutation(
  overrides: Partial<SyncMutation> = {},
  payload: Record<string, unknown> = {
    title: 'A prompt',
    description: null,
    content: 'a prompt',
    negative: null,
    folderId: null,
    tagIds: ['tag-b', 'tag-a', 'tag-a'],
    modelId: null,
    params: null,
  },
): SyncMutation {
  return {
    mutationId: 'mutation-1',
    entityType: 'prompt',
    entityId: 'prompt-1',
    operation: 'create',
    baseVersion: null,
    payload,
    ...overrides,
  };
}

class FakeDatabase {
  rows: Array<typeof syncMutationResults.$inferSelect> = [];
  insertCount = 0;
  promptCalls = 0;
  conflictOnInsert = false;

  async transaction<T>(callback: (tx: FakeDatabase) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async execute(query: unknown): Promise<{ rows: Array<{ device_id: string }> }> {
    void query;
    return { rows: [{ device_id: DEVICE_ID }] };
  }

  select() {
    return {
      from: (_table: unknown) => ({
        where: async (condition: unknown) => {
          const values = new Set(collectConditionValues(condition));
          return this.rows.filter(
            (row) =>
              values.has(row.userId) && values.has(row.deviceId) && values.has(row.mutationId),
          );
        },
      }),
    };
  }

  insert(_table: unknown) {
    return {
      values: async (value: Record<string, unknown>) => {
        this.insertCount += 1;
        if (this.conflictOnInsert) {
          this.conflictOnInsert = false;
          const row = {
            ...value,
            resultVersion: value.resultVersion ?? null,
            resultSnapshot: value.resultSnapshot ?? null,
            errorCode: value.errorCode ?? null,
            requestFingerprint: value.requestFingerprint ?? null,
            createdAt: new Date(),
          } as typeof syncMutationResults.$inferSelect;
          this.rows.push(row);
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        this.rows.push({
          ...value,
          resultVersion: value.resultVersion ?? null,
          resultSnapshot: value.resultSnapshot ?? null,
          errorCode: value.errorCode ?? null,
          requestFingerprint: value.requestFingerprint ?? null,
          createdAt: new Date(),
        } as typeof syncMutationResults.$inferSelect);
      },
    };
  }
}

function collectConditionValues(value: unknown, seen = new Set<object>()): unknown[] {
  if (value === null || typeof value !== 'object') return [value];
  if (seen.has(value)) return [];
  seen.add(value);
  const values = Array.isArray(value)
    ? value.flatMap((item) => collectConditionValues(item, seen))
    : Object.values(value).flatMap((item) => collectConditionValues(item, seen));
  seen.delete(value);
  return values;
}

function createPrompts(db: FakeDatabase) {
  return {
    createPrompt: async () => {
      db.promptCalls += 1;
      return SNAPSHOT;
    },
  } as never;
}

describe('sync mutation fingerprints', () => {
  it('sorts object keys recursively, preserves non-tag arrays, and normalizes tagIds', () => {
    const first = createMutation(
      {},
      {
        title: 'A prompt',
        description: null,
        content: 'a prompt',
        negative: null,
        folderId: null,
        tagIds: ['tag-b', 'tag-a', 'tag-a'],
        modelId: null,
        params: { nested: { z: 1, a: 2 }, values: ['b', 'a'] },
      },
    );
    const equivalent = createMutation(
      {},
      {
        params: { values: ['b', 'a'], nested: { a: 2, z: 1 } },
        modelId: null,
        tagIds: ['tag-a', 'tag-b'],
        folderId: null,
        negative: null,
        content: 'a prompt',
        description: null,
        title: 'A prompt',
      },
    );

    expect(fingerprintSyncMutation(first)).toBe(fingerprintSyncMutation(equivalent));
    expect(fingerprintSyncMutation(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('includes every request field and distinguishes changed semantic values', () => {
    const first = fingerprintSyncMutation(createMutation());
    expect(fingerprintSyncMutation(createMutation({ entityType: 'tag' }))).not.toBe(first);
    expect(fingerprintSyncMutation(createMutation({ entityId: 'prompt-2' }))).not.toBe(first);
    expect(
      fingerprintSyncMutation(createMutation({ operation: 'update', baseVersion: 1 })),
    ).not.toBe(first);
    expect(
      fingerprintSyncMutation(
        createMutation({}, { ...createMutation().payload, title: 'changed' }),
      ),
    ).not.toBe(first);
  });
});

describe('SyncService mutation replay', () => {
  it('replays an equivalent request as duplicate and rejects a payload mismatch without executing again', async () => {
    const db = new FakeDatabase();
    const service = new SyncService(db as never, createPrompts(db));
    const first = createMutation();
    const equivalent = createMutation(
      {},
      {
        params: null,
        modelId: null,
        tagIds: ['tag-a', 'tag-b'],
        folderId: null,
        negative: null,
        content: 'a prompt',
        description: null,
        title: 'A prompt',
      },
    );
    const mismatch = createMutation({}, { ...equivalent.payload, title: 'changed' });

    await expect(service.push('user-1', DEVICE_ID, [first])).resolves.toMatchObject({
      results: [{ status: 'applied', errorCode: null }],
    });
    await expect(service.push('user-1', DEVICE_ID, [equivalent])).resolves.toMatchObject({
      results: [{ status: 'duplicate', errorCode: null, version: 1, snapshot: SNAPSHOT }],
    });
    // A mismatched replay must never look like a success: no stale snapshot is
    // returned and the status is `rejected` so clients retain their outbox row.
    await expect(service.push('user-1', DEVICE_ID, [mismatch])).resolves.toEqual({
      results: [
        {
          mutationId: 'mutation-1',
          status: 'rejected',
          errorCode: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
          version: null,
          snapshot: null,
        },
      ],
    });
    expect(db.promptCalls).toBe(1);
    expect(db.rows).toHaveLength(1);
    // The rejection is derived per request; the stored first result stays intact
    // so an exact replay still deduplicates against it.
    await expect(service.push('user-1', DEVICE_ID, [equivalent])).resolves.toMatchObject({
      results: [{ status: 'duplicate', errorCode: null, version: 1 }],
    });
    expect(db.promptCalls).toBe(1);
    expect(db.rows).toHaveLength(1);
  });

  it('keeps mutation keys isolated between users', async () => {
    const db = new FakeDatabase();
    const service = new SyncService(db as never, createPrompts(db));
    const mutation = createMutation();

    await expect(service.push('user-1', DEVICE_ID, [mutation])).resolves.toMatchObject({
      results: [{ status: 'applied' }],
    });
    await expect(service.push('user-2', DEVICE_ID, [mutation])).resolves.toMatchObject({
      results: [{ status: 'applied' }],
    });
    expect(db.promptCalls).toBe(2);
    expect(db.rows).toHaveLength(2);
  });

  it('re-reads a persisted result after a unique-key race', async () => {
    const db = new FakeDatabase();
    const service = new SyncService(db as never, createPrompts(db));
    const mutation = createMutation();
    db.conflictOnInsert = true;

    await expect(service.push('user-1', DEVICE_ID, [mutation])).resolves.toMatchObject({
      results: [{ status: 'duplicate', errorCode: null }],
    });
    expect(db.promptCalls).toBe(1);
    expect(db.rows).toHaveLength(1);
  });

  it('keeps legacy NULL fingerprints on the compatibility duplicate path', async () => {
    const db = new FakeDatabase();
    const service = new SyncService(db as never, createPrompts(db));
    const mutation = createMutation();
    db.rows.push({
      userId: 'user-1',
      deviceId: DEVICE_ID,
      mutationId: mutation.mutationId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      resultStatus: 'applied',
      resultVersion: 1,
      resultSnapshot: SNAPSHOT,
      errorCode: null,
      requestFingerprint: null,
      createdAt: new Date(),
    });

    await expect(
      service.push('user-1', DEVICE_ID, [
        createMutation({}, { ...mutation.payload, title: 'changed' }),
      ]),
    ).resolves.toMatchObject({ results: [{ status: 'duplicate', errorCode: null }] });
    expect(db.promptCalls).toBe(0);
  });
});
