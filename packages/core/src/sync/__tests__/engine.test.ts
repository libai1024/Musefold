import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PromptDocument,
  PromptFolder,
  PromptTag,
  SyncMutation,
  SyncMutationResult,
  SyncPushRequest,
  SyncUsagePushRequest,
  SyncSnapshot,
} from '@musefold/contracts';
import { SCHEMA_SQL } from '../../db/schema';
import { up as addCloudSync } from '../../db/migrations/0017_cloud_prompt_sync';
import { up as addUsageEvents } from '../../db/migrations/0019_cloud_sync_usage_events';
import { DesktopSyncEngine, type DesktopSyncTransport } from '../engine';
import { DesktopSyncRepository } from '../repository';

let db: Database.Database;
let repository: DesktopSyncRepository;
const ownerId = '7';
const deviceId = '6f1ce4dc-5703-4bd8-9e65-c06c4f14feaa';
const timestamp = '2026-08-18T10:00:00.000Z';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  addCloudSync(db);
  addUsageEvents(db);
  repository = new DesktopSyncRepository(db);
  repository.activateAccount({
    ownerId,
    username: 'libai',
    deviceId,
    deviceName: 'Musefold integration test',
    platform: 'macos',
    clientVersion: '1.1.0',
  });
  repository.setEnabled(ownerId, true);
});

afterEach(() => db.close());

function snapshotFor(mutation: SyncMutation, version = 1): SyncSnapshot {
  const common = {
    id: mutation.entityId,
    version,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  if (mutation.entityType === 'folder') {
    return {
      ...common,
      name: String(mutation.payload.name),
      parentId:
        typeof mutation.payload.parentId === 'string'
          ? mutation.payload.parentId
          : null,
      sortOrder: Number(mutation.payload.sortOrder),
    } satisfies PromptFolder;
  }
  if (mutation.entityType === 'tag') {
    return {
      ...common,
      name: String(mutation.payload.name),
      group:
        typeof mutation.payload.group === 'string'
          ? mutation.payload.group
          : null,
      color:
        typeof mutation.payload.color === 'string'
          ? mutation.payload.color
          : null,
    } satisfies PromptTag;
  }
  return {
    ...common,
    title: String(mutation.payload.title),
    description: (mutation.payload.description as string | null) ?? null,
    content: String(mutation.payload.content),
    negative: (mutation.payload.negative as string | null) ?? null,
    folderId: (mutation.payload.folderId as string | null) ?? null,
    tags: [],
    modelId: (mutation.payload.modelId as string | null) ?? null,
    params: (mutation.payload.params as Record<string, unknown> | null) ?? null,
    rating: Number(mutation.payload.rating ?? 0),
    isPinned: Boolean(mutation.payload.isPinned),
    pinOrder: (mutation.payload.pinOrder as number | null) ?? null,
    usageCount: 0,
    lastUsedAt: null,
    source: (mutation.payload.source as PromptDocument['source']) ?? 'manual',
    sourceUrl: (mutation.payload.sourceUrl as string | null) ?? null,
  } satisfies PromptDocument;
}

function transport(
  pushImpl?: (mutations: SyncMutation[]) => Promise<SyncMutationResult[]>,
): DesktopSyncTransport {
  return {
    registerDevice: vi.fn(async (input) => ({
      ...input,
      revoked: false,
      lastPullCursor: '0',
    })),
    bootstrap: vi.fn(async () => ({
      snapshotCursor: '0',
      items: [],
      nextPage: null,
    })),
    pull: vi.fn(async ({ cursor }) => ({
      changes: [],
      nextCursor: cursor,
      hasMore: false,
    })),
    push: vi.fn(async ({ mutations }: SyncPushRequest) => ({
      results: pushImpl
        ? await pushImpl(mutations)
        : mutations.map((mutation) => ({
            mutationId: mutation.mutationId,
            status: 'applied' as const,
            version: 1,
            snapshot: snapshotFor(mutation),
            errorCode: null,
          })),
    })),
    pushUsage: vi.fn(async ({ events }: SyncUsagePushRequest) => ({
      results: events.map((event) => ({
        eventId: event.eventId,
        status: 'applied' as const,
        errorCode: null,
      })),
    })),
  };
}

describe('DesktopSyncEngine', () => {
  it('bootstraps in dependency order and uploads existing local entities in order', async () => {
    db.exec(`
      INSERT INTO folders(id, name, parent_id, sort_order, created_at)
      VALUES ('folder-local', '本地文件夹', NULL, 0, 1);
      INSERT INTO tags(id, name, tag_group, color, created_at)
      VALUES ('tag-local', '本地标签', '用途', '#336699', 1);
      INSERT INTO prompts(
        id, title, content, folder_id, rating, is_pinned, source, created_at, updated_at
      ) VALUES ('prompt-local', '本地提示词', '本地正文', 'folder-local', 0, 0, 'manual', 1, 1);
      INSERT INTO prompt_tags(prompt_id, tag_id) VALUES ('prompt-local', 'tag-local');
    `);
    const cloud = transport();
    const engine = new DesktopSyncEngine(repository, cloud);

    await expect(engine.run()).resolves.toMatchObject({
      status: 'idle',
      pendingMutations: 0,
      conflicts: 0,
    });

    expect(
      vi.mocked(cloud.bootstrap).mock.calls.map(([input]) => input.entity),
    ).toEqual(['folder', 'tag', 'prompt']);
    const pushed = vi
      .mocked(cloud.push)
      .mock.calls.flatMap(([input]) => input.mutations);
    expect(pushed.map((mutation) => mutation.entityType)).toEqual([
      'folder',
      'tag',
      'prompt',
    ]);
    expect(repository.getActiveAccount()).toMatchObject({
      bootstrapCompletedAt: expect.any(Number),
      lastSyncAt: expect.any(Number),
      cursor: '0',
    });
    expect(vi.mocked(cloud.pull).mock.calls[0]?.[0]).toMatchObject({
      deviceId,
    });
  });

  it('keeps the mutation id after a lost push response so retry can deduplicate', async () => {
    db.prepare(
      `INSERT INTO prompts(id, title, content, rating, is_pinned, source, created_at, updated_at)
       VALUES ('prompt-local', '标题', '正文', 0, 0, 'manual', 1, 1)`,
    ).run();
    let acceptedMutation: SyncMutation | null = null;
    const firstTransport = transport(async (mutations) => {
      acceptedMutation = mutations[0]!;
      throw new Error('response lost');
    });
    const firstEngine = new DesktopSyncEngine(repository, firstTransport);
    await expect(firstEngine.run()).rejects.toThrow('response lost');
    expect(acceptedMutation).not.toBeNull();

    db.prepare('UPDATE cloud_sync_outbox SET next_attempt_at = 0').run();
    const retryTransport = transport(async (mutations) => [
      {
        mutationId: mutations[0]!.mutationId,
        status: 'duplicate',
        version: 1,
        snapshot: snapshotFor(mutations[0]!),
        errorCode: null,
      },
    ]);
    await new DesktopSyncEngine(repository, retryTransport).run();

    const retried = vi.mocked(retryTransport.push).mock.calls[0]![0]
      .mutations[0]!;
    expect(retried.mutationId).toBe(acceptedMutation!.mutationId);
    expect(repository.listReadyMutations(ownerId)).toEqual([]);
  });
});
