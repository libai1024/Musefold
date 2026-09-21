import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PromptDocument,
  PromptTag,
  PromptFolder,
  SyncEntityType,
  SyncSnapshot,
} from '@musefold/contracts';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { getDb, closeDb } from '@musefold/core/db';
import { ensureAccountWorkspace } from '@musefold/core/db/workspaces';
import { DesktopSyncRepository } from '@musefold/core/sync';
import { buildPromptsDomainMethods } from '../prompts-domain';
import { scheduleV25CloudSync } from '../sync-domain';

vi.mock('../sync-domain', () => ({ scheduleV25CloudSync: vi.fn() }));
let directory: string;
let workspace: string;
let repository: DesktopSyncRepository;
const owner = 'owned-taxonomy-ipc';
beforeEach(() => {
  vi.clearAllMocks();
  directory = mkdtempSync(join(tmpdir(), 'musefold-taxonomy-ipc-'));
  configureTestCoreRuntime(directory);
  workspace = ensureAccountWorkspace(getDb(), owner);
  repository = new DesktopSyncRepository(getDb());
  repository.activateAccount({
    ownerId: owner,
    username: 'Synthetic',
    deviceId: 'owned-device',
    deviceName: 'Owned',
    platform: 'macos',
    clientVersion: 'test',
  });
  repository.setEnabled(owner, true);
});
afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});
async function invoke<T>(name: string, input: unknown): Promise<T> {
  const method = buildPromptsDomainMethods()[`prompts.${name}`];
  return (await method.handle(method.input.parse(input))) as T;
}
function acknowledge(entityType: SyncEntityType, snapshot: SyncSnapshot) {
  const mutation = repository
    .listReadyMutations(owner, workspace)
    .find((m) => m.entityType === entityType && m.entityId === snapshot.id);
  if (!mutation) throw new Error('Missing synthetic mutation');
  repository.applyPushResult(owner, workspace, mutation, {
    mutationId: mutation.mutationId,
    status: 'applied',
    version: 7,
    snapshot: { ...snapshot, version: 7 },
    errorCode: null,
  });
}

describe('taxonomy IPC uses core transactions and schedules only committed changes', () => {
  it('maps duplicate names and folder cycles to stable bridge errors without scheduling rejected writes', async () => {
    const parent = await invoke<PromptFolder>('createFolder', {
      name: 'Parent',
      parentId: null,
      sortOrder: 0,
    });
    const child = await invoke<PromptFolder>('createFolder', {
      name: 'Child',
      parentId: parent.id,
      sortOrder: 0,
    });
    await invoke<PromptTag>('createTag', { name: 'Existing', group: null, color: null });
    expect(scheduleV25CloudSync).toHaveBeenCalledTimes(3);
    await expect(
      invoke('createTag', { name: 'Existing', group: null, color: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: '已存在同名标签' });
    await expect(
      invoke('updateFolder', { id: parent.id, patch: { parentId: child.id, expectedVersion: 1 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(scheduleV25CloudSync).toHaveBeenCalledTimes(3);
    await invoke('removeFolder', { id: parent.id });
    expect(scheduleV25CloudSync).toHaveBeenCalledTimes(4);
    await expect(invoke('removeFolder', { id: parent.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(scheduleV25CloudSync).toHaveBeenCalledTimes(4);
  });

  it('keeps a pending prompt delete and creates the tag tombstone from its actual known cloud version', async () => {
    const tag = await invoke<PromptTag>('createTag', {
      name: 'Cloud tag',
      group: null,
      color: null,
    });
    acknowledge('tag', tag);
    const prompt = await invoke<PromptDocument>('create', {
      title: 'Keep deletion',
      content: 'Synthetic',
      description: null,
      negative: null,
      folderId: null,
      tagIds: [tag.id],
      modelId: null,
      params: null,
    });
    acknowledge('prompt', prompt);
    await invoke('remove', { id: prompt.id });
    const pending = repository
      .listReadyMutations(owner, workspace)
      .find((m) => m.entityId === prompt.id);
    expect(pending).toMatchObject({ operation: 'delete', baseVersion: 7 });
    const removed = await invoke<PromptTag>('removeTag', { id: tag.id });
    expect(removed.deletedAt).not.toBeNull();
    const after = repository.listReadyMutations(owner, workspace);
    expect(after.find((m) => m.entityId === prompt.id)).toEqual(pending);
    expect(after.find((m) => m.entityId === tag.id)).toBeUndefined();
    // 已持久化但先等相关 Prompt 删除回执；不能把“已排队”当作“立即可发送”。
    expect(
      getDb()
        .prepare(
          'SELECT entity_type,operation,base_version,payload_json FROM cloud_sync_outbox WHERE owner_id=? AND workspace_id=? AND entity_id=?',
        )
        .get(owner, workspace, tag.id),
    ).toEqual({
      entity_type: 'tag',
      operation: 'delete',
      base_version: 7,
      payload_json: '{}',
    });
    expect(
      getDb().prepare('SELECT 1 FROM tags WHERE workspace_id=? AND id=?').get(workspace, tag.id),
    ).toBeUndefined();
    expect(await invoke<PromptDocument>('get', { id: prompt.id })).toMatchObject({
      tags: [],
      deletedAt: expect.any(String),
    });
    if (!pending) throw new Error('Missing original pending deletion');
    repository.applyPushResult(owner, workspace, pending, {
      mutationId: pending.mutationId,
      status: 'applied',
      version: 8,
      errorCode: null,
      snapshot: { ...prompt, version: 8, deletedAt: removed.deletedAt },
    });
    expect(
      repository.listReadyMutations(owner, workspace).find((m) => m.entityId === tag.id),
    ).toMatchObject({ entityType: 'tag', operation: 'delete', baseVersion: 7, payload: {} });
  });

  it('queues a known folder delete and preserves its child pending create with a detached parent', async () => {
    const parent = await invoke<PromptFolder>('createFolder', {
      name: 'Parent',
      parentId: null,
      sortOrder: 0,
    });
    acknowledge('folder', parent);
    const child = await invoke<PromptFolder>('createFolder', {
      name: 'Child',
      parentId: parent.id,
      sortOrder: 0,
    });
    await invoke('removeFolder', { id: parent.id });
    const queued = repository.listReadyMutations(owner, workspace);
    expect(queued.find((m) => m.entityId === parent.id)).toMatchObject({
      entityType: 'folder',
      operation: 'delete',
      baseVersion: 7,
      payload: {},
    });
    expect(queued.find((m) => m.entityId === child.id)).toMatchObject({
      operation: 'create',
      baseVersion: null,
      payload: { parentId: null },
    });
    expect(await invoke<PromptFolder[]>('listFolders', undefined)).toEqual([
      expect.objectContaining({ id: child.id, parentId: null }),
    ]);
  });
});
