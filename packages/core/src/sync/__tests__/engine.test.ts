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
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { accountWorkspaceId, ensureAccountWorkspace } from '../../db/workspaces';
import { DesktopSyncEngine, type DesktopSyncTransport } from '../engine';
import { DesktopSyncRepository } from '../repository';

let db: Database.Database;
let repository: DesktopSyncRepository;
const ownerId = '7';
const workspaceId = accountWorkspaceId(ownerId);
const deviceId = '6f1ce4dc-5703-4bd8-9e65-c06c4f14feaa';
const timestamp = '2026-08-18T10:00:00.000Z';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  ensureAccountWorkspace(db, ownerId);
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
      parentId: typeof mutation.payload.parentId === 'string' ? mutation.payload.parentId : null,
      sortOrder: Number(mutation.payload.sortOrder),
    } satisfies PromptFolder;
  }
  if (mutation.entityType === 'tag') {
    return {
      ...common,
      name: String(mutation.payload.name),
      group: typeof mutation.payload.group === 'string' ? mutation.payload.group : null,
      color: typeof mutation.payload.color === 'string' ? mutation.payload.color : null,
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

function divergingRemoteSnapshot(): PromptDocument {
  return {
    id: 'prompt-local',
    title: '云端并发标题',
    description: null,
    content: '云端并发正文',
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
    version: 4,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

describe('DesktopSyncEngine', () => {
  it('bootstraps in dependency order and uploads existing local entities in order', async () => {
    db.prepare(
      `INSERT INTO folders(workspace_id, id, name, parent_id, sort_order, created_at)
       VALUES (?, 'folder-local', '本地文件夹', NULL, 0, 1)`,
    ).run(workspaceId);
    db.prepare(
      `INSERT INTO tags(workspace_id, id, name, tag_group, color, created_at)
       VALUES (?, 'tag-local', '本地标签', '用途', '#336699', 1)`,
    ).run(workspaceId);
    db.prepare(
      `INSERT INTO prompts(
        workspace_id, id, title, content, folder_id, rating, is_pinned, source, created_at, updated_at
      ) VALUES (?, 'prompt-local', '本地提示词', '本地正文', 'folder-local', 0, 0, 'manual', 1, 1)`,
    ).run(workspaceId);
    db.prepare(
      "INSERT INTO prompt_tags(workspace_id, prompt_id, tag_id) VALUES (?, 'prompt-local', 'tag-local')",
    ).run(workspaceId);
    const cloud = transport();
    const engine = new DesktopSyncEngine(repository, cloud);

    await expect(engine.run()).resolves.toMatchObject({
      status: 'idle',
      pendingMutations: 0,
      conflicts: 0,
    });

    expect(vi.mocked(cloud.bootstrap).mock.calls.map(([input]) => input.entity)).toEqual([
      'folder',
      'tag',
      'prompt',
    ]);
    const pushed = vi.mocked(cloud.push).mock.calls.flatMap(([input]) => input.mutations);
    expect(pushed.map((mutation) => mutation.entityType)).toEqual(['folder', 'tag', 'prompt']);
    expect(repository.getActiveAccount()).toMatchObject({
      bootstrapCompletedAt: expect.any(Number),
      lastSyncAt: expect.any(Number),
      cursor: '0',
    });
    expect(vi.mocked(cloud.pull).mock.calls[0]?.[0]).toMatchObject({
      deviceId,
    });
  });

  it('fences an in-flight run when the active account changes', async () => {
    let resolveRegistration: (
      value: Awaited<ReturnType<DesktopSyncTransport['registerDevice']>>,
    ) => void = () => {
      throw new Error('registration resolver missing');
    };
    const registration = new Promise<Awaited<ReturnType<DesktopSyncTransport['registerDevice']>>>(
      (resolve) => {
        resolveRegistration = resolve;
      },
    );
    const cloud = transport();
    vi.mocked(cloud.registerDevice).mockImplementation(() => registration);
    const engine = new DesktopSyncEngine(repository, cloud);

    const run = engine.run();
    let idle = false;
    const waiting = engine.awaitIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    repository.activateAccount(
      {
        ownerId: '8',
        username: 'other-user',
        deviceId: '7f2ce4dc-5703-4bd8-9e65-c06c4f14feaa',
        deviceName: 'Other MacBook',
        platform: 'macos',
        clientVersion: '1.1.0',
      },
      true,
    );
    resolveRegistration({
      deviceId,
      name: 'Musefold integration test',
      platform: 'macos',
      clientVersion: '1.1.0',
      revoked: false,
      lastPullCursor: '0',
    });

    await expect(run).resolves.toMatchObject({ status: 'disabled' });
    await waiting;
    expect(idle).toBe(true);
    expect(cloud.bootstrap).not.toHaveBeenCalled();
    expect(cloud.pull).not.toHaveBeenCalled();
    expect(cloud.push).not.toHaveBeenCalled();
    const oldAccount = db
      .prepare('SELECT last_sync_at, last_error FROM cloud_sync_accounts WHERE owner_id = ?')
      .get(ownerId) as { last_sync_at: number | null; last_error: string | null };
    expect(oldAccount).toEqual({ last_sync_at: null, last_error: null });
  });

  it('does not back off pending mutations when an in-flight push is cancelled', async () => {
    db.prepare(
      `INSERT INTO prompts(workspace_id, id, title, content, rating, is_pinned, source, created_at, updated_at)
       VALUES (?, 'prompt-cancelled', '标题', '正文', 0, 0, 'manual', 1, 1)`,
    ).run(workspaceId);
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cancelled', 'create');
    repository.markBootstrapCompleted(ownerId, '0');

    let rejectPush: (error: Error) => void = () => {
      throw new Error('push rejector missing');
    };
    const pendingPush = new Promise<never>((_resolve, reject) => {
      rejectPush = reject;
    });
    const cloud = transport();
    vi.mocked(cloud.push).mockImplementation(() => pendingPush);
    const engine = new DesktopSyncEngine(repository, cloud);

    const run = engine.run();
    await vi.waitFor(() => expect(cloud.push).toHaveBeenCalledOnce());
    engine.cancelCurrent();
    rejectPush(new DOMException('This operation was aborted', 'AbortError'));

    await expect(run).resolves.toMatchObject({ status: 'idle' });
    expect(
      db
        .prepare(
          `SELECT attempt_count, last_error, next_attempt_at
           FROM cloud_sync_outbox WHERE owner_id = ? AND entity_id = ?`,
        )
        .get(ownerId, 'prompt-cancelled'),
    ).toEqual({ attempt_count: 0, last_error: null, next_attempt_at: 0 });
  });

  it('keeps the mutation id after a lost push response so retry can deduplicate', async () => {
    db.prepare(
      `INSERT INTO prompts(workspace_id, id, title, content, rating, is_pinned, source, created_at, updated_at)
       VALUES (?, 'prompt-local', '标题', '正文', 0, 0, 'manual', 1, 1)`,
    ).run(workspaceId);
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
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

    const retried = vi.mocked(retryTransport.push).mock.calls[0]![0].mutations[0]!;
    expect(retried.mutationId).toBe(acceptedMutation!.mutationId);
    expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);
  });

  it('retains the outbox when the server rejects a replay for payload mismatch, then recovers on a fresh id', async () => {
    db.prepare(
      `INSERT INTO prompts(workspace_id, id, title, content, rating, is_pinned, source, created_at, updated_at)
       VALUES (?, 'prompt-local', '标题', '第一版正文', 0, 0, 'manual', 1, 1)`,
    ).run(workspaceId);
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
    repository.markBootstrapCompleted(ownerId, '0');
    const original = repository.listReadyMutations(ownerId, workspaceId)[0]!;

    // The server accepted and stored the first payload, but the response was lost.
    const lostTransport = transport(async () => {
      throw new Error('response lost');
    });
    await expect(new DesktopSyncEngine(repository, lostTransport).run()).rejects.toThrow(
      'response lost',
    );

    // The user keeps editing; the outbox compacts the diverging payload under the
    // same mutation id, which the server must refuse to acknowledge.
    db.prepare(
      "UPDATE prompts SET content = '第二版正文' WHERE workspace_id = ? AND id = 'prompt-local'",
    ).run(workspaceId);
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'update');
    expect(repository.listReadyMutations(ownerId, workspaceId)[0]!.mutationId).toBe(
      original.mutationId,
    );

    db.prepare('UPDATE cloud_sync_outbox SET next_attempt_at = 0').run();
    const mismatchTransport = transport(async (mutations) =>
      mutations.map((mutation) => ({
        mutationId: mutation.mutationId,
        status: 'rejected' as const,
        version: null,
        snapshot: null,
        errorCode: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
      })),
    );
    const mismatchRun = await new DesktopSyncEngine(repository, mismatchTransport).run();

    // The run completes, the local dirty payload survives, and the row is retained.
    expect(mismatchRun).toMatchObject({ pendingMutations: 1, conflicts: 0 });
    expect(db.prepare("SELECT content FROM prompts WHERE id = 'prompt-local'").get()).toEqual({
      content: '第二版正文',
    });
    expect(
      db.prepare('SELECT last_error FROM cloud_sync_outbox WHERE owner_id = ?').get(ownerId) as {
        last_error: string | null;
      },
    ).toEqual({ last_error: 'SYNC_MUTATION_PAYLOAD_MISMATCH' });

    // The next local edit re-issues under a fresh mutation id and syncs through.
    db.prepare(
      "UPDATE prompts SET content = '第三版正文' WHERE workspace_id = ? AND id = 'prompt-local'",
    ).run(workspaceId);
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'update');
    const reissued = repository.listReadyMutations(ownerId, workspaceId)[0]!;
    expect(reissued.mutationId).not.toBe(original.mutationId);

    await new DesktopSyncEngine(repository, transport()).run();
    expect(repository.getSummary()).toMatchObject({
      status: 'idle',
      pendingMutations: 0,
      conflicts: 0,
    });
    expect(db.prepare("SELECT content FROM prompts WHERE id = 'prompt-local'").get()).toEqual({
      content: '第三版正文',
    });
  });

  it('surfaces a push conflict through the run and completes a local resolution', async () => {
    db.prepare(
      `INSERT INTO prompts(workspace_id, id, title, content, rating, is_pinned, source, created_at, updated_at)
       VALUES (?, 'prompt-local', '标题', '本地并发编辑', 0, 0, 'manual', 1, 1)`,
    ).run(workspaceId);
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
    repository.markBootstrapCompleted(ownerId, '0');

    const conflictTransport = transport(async (mutations) =>
      mutations.map((mutation) => ({
        mutationId: mutation.mutationId,
        status: 'conflict' as const,
        version: 4,
        snapshot: divergingRemoteSnapshot(),
        errorCode: 'SYNC_MUTATION_CONFLICT',
      })),
    );
    const conflicted = await new DesktopSyncEngine(repository, conflictTransport).run();

    expect(conflicted).toMatchObject({ status: 'conflict', pendingMutations: 1, conflicts: 1 });
    const [conflict] = repository.listConflicts(ownerId, workspaceId);
    expect(conflict).toMatchObject({
      entityId: 'prompt-local',
      localSnapshot: { content: '本地并发编辑' },
      remoteSnapshot: { content: '云端并发正文', version: 4 },
    });
    expect(db.prepare("SELECT content FROM prompts WHERE id = 'prompt-local'").get()).toEqual({
      content: '本地并发编辑',
    });

    repository.resolveConflict(ownerId, workspaceId, conflict!.id, 'local');
    const recovered = await new DesktopSyncEngine(repository, transport()).run();
    expect(recovered).toMatchObject({ status: 'idle', pendingMutations: 0, conflicts: 0 });
    expect(db.prepare("SELECT content FROM prompts WHERE id = 'prompt-local'").get()).toEqual({
      content: '本地并发编辑',
    });
  });
});
