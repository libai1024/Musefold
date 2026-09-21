import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PromptDocument, PromptFolder, PromptTag, SyncChange } from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { accountWorkspaceId, ensureAccountWorkspace } from '../../db/workspaces';
import {
  DesktopSyncRepository,
  enqueueActiveAccountMutation,
  enqueueActiveAccountUsageEvent,
} from '../repository';

let db: Database.Database;
let repository: DesktopSyncRepository;

const ownerId = '7';
const workspaceId = accountWorkspaceId(ownerId);
const now = '2026-08-18T10:00:00.000Z';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  ensureAccountWorkspace(db, ownerId);
  repository = new DesktopSyncRepository(db);
  repository.activateAccount({
    ownerId,
    username: 'libai',
    deviceId: '6f1ce4dc-5703-4bd8-9e65-c06c4f14feaa',
    deviceName: 'Musefold test',
    platform: 'macos',
    clientVersion: '1.1.0',
  });
  repository.setEnabled(ownerId, true);
});

afterEach(() => db.close());

function insertLocalPrompt(id = 'prompt-local'): void {
  db.prepare(
    `INSERT INTO prompts(
      workspace_id, id, title, content, params, preview_image_path, rating, is_pinned,
      source, source_url, created_at, updated_at
    ) VALUES (?, ?, '本地标题', '本地正文', ?, '/Users/libai/private.png', 3, 1,
      'manual', 'history://private', 1, 1)`,
  ).run(
    workspaceId,
    id,
    JSON.stringify({
      style: 'clean',
      apiKey: 'sk-secret',
      sourcePath: '/Users/libai/reference.png',
      nested: { imagePath: 'C:\\secret\\image.png', strength: 0.8 },
    }),
  );
}

function remoteTag(version = 1): PromptTag {
  return {
    id: 'tag-cloud',
    name: '海报',
    group: '用途',
    color: '#aa3300',
    version,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function remoteFolder(id: string, parentId: string | null, version = 1): PromptFolder {
  return {
    id,
    name: id,
    parentId,
    sortOrder: 0,
    version,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function remotePrompt(content: string, version: number): PromptDocument {
  return {
    id: 'prompt-cloud',
    title: '云端标题',
    description: null,
    content,
    negative: null,
    folderId: null,
    tags: [remoteTag()],
    modelId: 'musefold-image-pro',
    params: { style: 'editorial' },
    rating: 4,
    isPinned: true,
    pinOrder: 2,
    usageCount: 5,
    lastUsedAt: now,
    source: 'share',
    sourceUrl: 'https://example.com/prompt',
    version,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function remoteChange(content: string, version: number): SyncChange {
  return {
    seq: String(version),
    entityType: 'prompt',
    entityId: 'prompt-cloud',
    operation: 'upsert',
    version,
    snapshot: remotePrompt(content, version),
  };
}

describe('DesktopSyncRepository', () => {
  it.each(['ready', 'backoff', 'error'] as const)(
    'waits for related folder/prompt acknowledgements before taxonomy tombstones, even when dependencies are %s',
    (dependencyStatus) => {
      const parent = remoteFolder('parent', null);
      const child = remoteFolder('child', parent.id);
      const p = { ...remotePrompt('Keep content', 1), folderId: parent.id };
      repository.applyBootstrapSnapshot(ownerId, workspaceId, 'folder', parent);
      repository.applyBootstrapSnapshot(ownerId, workspaceId, 'folder', child);
      repository.applyBootstrapSnapshot(ownerId, workspaceId, 'tag', remoteTag());
      repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', p);
      db.prepare('UPDATE folders SET parent_id = NULL WHERE workspace_id = ? AND id = ?').run(
        workspaceId,
        child.id,
      );
      db.prepare('UPDATE prompts SET folder_id = NULL WHERE workspace_id = ? AND id = ?').run(
        workspaceId,
        p.id,
      );
      db.prepare('DELETE FROM prompt_tags WHERE workspace_id = ? AND prompt_id = ?').run(
        workspaceId,
        p.id,
      );
      repository.enqueue(ownerId, workspaceId, 'folder', parent.id, 'delete');
      repository.enqueue(ownerId, workspaceId, 'tag', remoteTag().id, 'delete');
      repository.enqueue(ownerId, workspaceId, 'folder', child.id, 'update');
      repository.enqueue(ownerId, workspaceId, 'prompt', p.id, 'update');
      const all = repository.listReadyMutations(ownerId, workspaceId);
      const dependents = all.filter((m) => m.entityId === child.id || m.entityId === p.id);
      expect(dependents).toHaveLength(2);
      if (dependencyStatus !== 'ready') {
        for (const m of dependents) {
          if (dependencyStatus === 'backoff')
            repository.markMutationAttempt(ownerId, workspaceId, m.mutationId, 'response lost');
          else
            repository.applyPushResult(ownerId, workspaceId, m, {
              mutationId: m.mutationId,
              status: 'rejected',
              version: null,
              errorCode: 'TEST_REJECTION',
              snapshot: null,
            });
        }
      }
      expect(
        repository.listReadyMutations(ownerId, workspaceId).some((m) => m.operation === 'delete'),
      ).toBe(false);
      expect(
        repository
          .listReadyMutations(ownerId, workspaceId, 1)
          .some((m) => m.operation === 'delete'),
      ).toBe(false);
      // Only an actual acknowledgement unlocks the referenced classification. Keep the
      // original mutation identity/base version through backoff; never force resolve a conflict.
      for (const m of dependents)
        repository.applyPushResult(ownerId, workspaceId, m, {
          mutationId: m.mutationId,
          status: 'applied',
          version: 2,
          errorCode: null,
          snapshot:
            m.entityType === 'folder'
              ? { ...child, parentId: null, version: 2 }
              : { ...p, folderId: null, tags: [], version: 2 },
        });
      expect(
        repository
          .listReadyMutations(ownerId, workspaceId)
          .map((m) => [m.entityId, m.operation, m.baseVersion]),
      ).toEqual([
        [parent.id, 'delete', 1],
        [remoteTag().id, 'delete', 1],
      ]);
    },
  );

  it('does not hold unrelated taxonomy deletion behind a failed prompt', () => {
    repository.applyBootstrapSnapshot(
      ownerId,
      workspaceId,
      'folder',
      remoteFolder('unrelated', null),
    );
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', remotePrompt('Original', 1));
    db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
      'Changed',
      workspaceId,
      'prompt-cloud',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
    const [m] = repository.listReadyMutations(ownerId, workspaceId);
    repository.markMutationAttempt(ownerId, workspaceId, m.mutationId, 'response lost');
    repository.enqueue(ownerId, workspaceId, 'folder', 'unrelated', 'delete');
    expect(repository.listReadyMutations(ownerId, workspaceId).map((m) => m.entityId)).toEqual([
      'unrelated',
    ]);
  });

  it('does not use another owner workspace with identical IDs as a deletion dependency', () => {
    const parent = remoteFolder('same-parent', null);
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'folder', parent);
    const foreignOwner = 'other-owner';
    const foreignWorkspace = ensureAccountWorkspace(db, foreignOwner);
    repository.activateAccount({
      ownerId: foreignOwner,
      username: 'Other',
      deviceId: 'other-device',
      deviceName: 'Other',
      platform: 'macos',
      clientVersion: 'test',
    });
    repository.setEnabled(foreignOwner, true);
    repository.applyBootstrapSnapshot(foreignOwner, foreignWorkspace, 'folder', parent);
    repository.applyBootstrapSnapshot(foreignOwner, foreignWorkspace, 'prompt', {
      ...remotePrompt('Other content', 1),
      folderId: parent.id,
      tags: [],
    });
    db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
      'Other pending edit',
      foreignWorkspace,
      'prompt-cloud',
    );
    repository.enqueue(foreignOwner, foreignWorkspace, 'prompt', 'prompt-cloud', 'update');
    repository.enqueue(ownerId, workspaceId, 'folder', parent.id, 'delete');
    expect(repository.listReadyMutations(ownerId, workspaceId).map((m) => m.entityId)).toEqual([
      parent.id,
    ]);
    expect(
      repository.listReadyMutations(foreignOwner, foreignWorkspace).map((m) => m.entityId),
    ).toEqual(['prompt-cloud']);
  });

  it.each(['pull', 'bootstrap'] as const)(
    'acknowledges a matching committed echo through %s while the outbox is in retry backoff',
    (mode) => {
      repository.applyBootstrapSnapshot(ownerId, workspaceId, 'tag', remoteTag());
      repository.applyBootstrapSnapshot(
        ownerId,
        workspaceId,
        'prompt',
        remotePrompt('初始内容', 1),
      );
      db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
        '已提交内容',
        workspaceId,
        'prompt-cloud',
      );
      repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
      const [mutation] = repository.listReadyMutations(ownerId, workspaceId);
      repository.markMutationAttempt(ownerId, workspaceId, mutation.mutationId, 'response lost');
      expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);
      if (mode === 'pull')
        repository.applyPullPage(ownerId, workspaceId, [remoteChange('已提交内容', 2)], '2');
      else
        repository.applyBootstrapSnapshot(
          ownerId,
          workspaceId,
          'prompt',
          remotePrompt('已提交内容', 2),
        );
      expect(repository.getSummary()).toMatchObject({
        pendingMutations: 0,
        conflicts: 0,
        status: 'idle',
      });
      expect(
        db
          .prepare('SELECT cloud_version,sync_status FROM cloud_entity_state WHERE local_id = ?')
          .get('prompt-cloud'),
      ).toMatchObject({ cloud_version: 2, sync_status: 'clean' });
    },
  );

  it('preserves an edit made after the lost response instead of acknowledging an older echo', () => {
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', remotePrompt('初始内容', 1));
    db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
      '较新本地内容',
      workspaceId,
      'prompt-cloud',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
    repository.applyPullPage(ownerId, workspaceId, [remoteChange('先前已提交内容', 2)], '2');
    expect(repository.listConflicts(ownerId, workspaceId)[0]).toMatchObject({
      localSnapshot: { content: '较新本地内容' },
      remoteSnapshot: { content: '先前已提交内容' },
    });
    expect(repository.getSummary().pendingMutations).toBe(1);
    expect(db.prepare('SELECT content FROM prompts WHERE id = ?').get('prompt-cloud')).toEqual({
      content: '较新本地内容',
    });
  });

  it('does not let equal text acknowledge a remote deletion of a pending update', () => {
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', remotePrompt('初始内容', 1));
    db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
      '待提交内容',
      workspaceId,
      'prompt-cloud',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
    repository.applyRemoteChange(ownerId, workspaceId, {
      ...remoteChange('待提交内容', 2),
      operation: 'delete',
      snapshot: { ...remotePrompt('待提交内容', 2), deletedAt: now },
    });
    expect(repository.getSummary()).toMatchObject({ pendingMutations: 1, conflicts: 1 });
    expect(db.prepare('SELECT deleted_at FROM prompts WHERE id = ?').get('prompt-cloud')).toEqual({
      deleted_at: null,
    });
  });

  it('acknowledges a pending deletion only when the remote snapshot is a tombstone', () => {
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', remotePrompt('初始内容', 1));
    db.prepare('UPDATE prompts SET deleted_at = 123 WHERE workspace_id = ? AND id = ?').run(
      workspaceId,
      'prompt-cloud',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'delete');
    repository.applyRemoteChange(ownerId, workspaceId, {
      ...remoteChange('初始内容', 2),
      operation: 'delete',
      snapshot: { ...remotePrompt('初始内容', 2), deletedAt: now },
    });
    expect(repository.getSummary()).toMatchObject({ pendingMutations: 0, conflicts: 0 });
    expect(db.prepare('SELECT deleted_at FROM prompts WHERE id = ?').get('prompt-cloud')).toEqual({
      deleted_at: Date.parse(now),
    });
  });

  it('builds a cloud-safe outbox and compacts edits into one stable mutation', () => {
    insertLocalPrompt();
    expect(repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create')).toBe(true);
    const first = repository.listReadyMutations(ownerId, workspaceId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      entityType: 'prompt',
      entityId: 'prompt-local',
      operation: 'create',
      baseVersion: null,
      payload: {
        title: '本地标题',
        content: '本地正文',
        sourceUrl: null,
        params: { style: 'clean', nested: { strength: 0.8 } },
      },
    });
    const serialized = JSON.stringify(first[0]);
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('C:\\');
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('preview_image_path');

    db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
      '第二次本地编辑',
      workspaceId,
      'prompt-local',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'update');
    const compacted = repository.listReadyMutations(ownerId, workspaceId);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]?.mutationId).toBe(first[0]?.mutationId);
    expect(compacted[0]).toMatchObject({
      operation: 'create',
      payload: { content: '第二次本地编辑' },
    });

    db.prepare('UPDATE prompts SET deleted_at = 2 WHERE workspace_id = ? AND id = ?').run(
      workspaceId,
      'prompt-local',
    );
    expect(repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'delete')).toBe(
      false,
    );
    expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);
  });

  it('write-path helpers enqueue paused accounts, skip unset accounts, and enqueue enabled accounts', () => {
    insertLocalPrompt();
    repository.setConsent(ownerId, 'unset');

    expect(enqueueActiveAccountMutation(db, 'prompt', 'prompt-local', 'create')).toBe(false);
    expect(enqueueActiveAccountUsageEvent(db, 'prompt-local')).toBeNull();

    repository.setConsent(ownerId, 'paused');
    expect(enqueueActiveAccountMutation(db, 'prompt', 'prompt-local', 'create')).toBe(true);
    expect(enqueueActiveAccountUsageEvent(db, 'prompt-local')).not.toBeNull();

    repository.setConsent(ownerId, 'enabled');
    expect(enqueueActiveAccountMutation(db, 'prompt', 'prompt-local', 'update')).toBe(true);
    expect(enqueueActiveAccountUsageEvent(db, 'prompt-local')).not.toBeNull();
    expect(repository.listReadyMutations(ownerId, workspaceId)).toHaveLength(1);
    expect(repository.listReadyUsageEvents(ownerId, workspaceId)).toHaveLength(2);
  });

  it('preserves durable consent and sync metadata while activating an account', () => {
    repository.markBootstrapCompleted(ownerId, '42');
    repository.setSyncError(ownerId, 'previous failure');
    repository.setConsent(ownerId, 'paused');
    const before = repository.getActiveAccount();

    const activated = repository.activateAccount(
      {
        ownerId,
        username: 'renamed-user',
        deviceName: 'Renamed device',
        platform: 'macos',
        clientVersion: '2.1.0',
      },
      true,
    );

    expect(activated).toMatchObject({
      ownerId,
      username: 'renamed-user',
      deviceId: before?.deviceId,
      consent: 'paused',
      consentDecidedAt: before?.consentDecidedAt,
      consentVersion: before?.consentVersion,
      cursor: '42',
      bootstrapCompletedAt: expect.any(Number),
      lastError: 'previous failure',
      enabled: false,
    });
  });

  it('does not mutate durable consent when another account is activated', () => {
    repository.setConsent(ownerId, 'paused');
    repository.activateAccount(
      {
        ownerId: '8',
        username: 'other-user',
        deviceName: 'Other device',
        platform: 'macos',
        clientVersion: '2.5.0',
      },
      true,
    );

    expect(
      db
        .prepare('SELECT owner_id, active, enabled FROM cloud_sync_accounts ORDER BY owner_id')
        .all(),
    ).toEqual([
      { owner_id: ownerId, active: 0, enabled: 0 },
      { owner_id: '8', active: 1, enabled: 0 },
    ]);
    expect(repository.getActiveAccount()).toMatchObject({ ownerId: '8', consent: 'unset' });
    expect(
      db.prepare('SELECT consent_state FROM cloud_sync_accounts WHERE owner_id = ?').get(ownerId),
    ).toEqual({ consent_state: 'paused' });
  });

  it('buffers usage events while sync is paused so enabling later does not lose history', () => {
    repository.setConsent(ownerId, 'paused');
    const eventId = repository.enqueueUsageEvent(ownerId, workspaceId, 'prompt-local', 'apply');
    expect(repository.listReadyUsageEvents(ownerId, workspaceId)).toEqual([
      { eventId, promptId: 'prompt-local', action: 'apply' },
    ]);
    expect(repository.getSummary().pendingMutations).toBe(1);
  });

  it('applies cloud snapshots without creating echo mutations and refreshes FTS', () => {
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'tag', remoteTag());
    repository.applyBootstrapSnapshot(
      ownerId,
      workspaceId,
      'prompt',
      remotePrompt('来自云端的正文', 1),
    );

    expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);
    expect(
      db
        .prepare(
          `SELECT title, content, preview_image_path, is_pinned, pin_order, source
         FROM prompts WHERE id = 'prompt-cloud'`,
        )
        .get(),
    ).toEqual({
      title: '云端标题',
      content: '来自云端的正文',
      preview_image_path: null,
      is_pinned: 1,
      pin_order: 2,
      source: 'shared',
    });
    expect(
      db
        .prepare(
          `SELECT count(*) AS value FROM prompts_fts
         WHERE prompts_fts MATCH '云端'`,
        )
        .get(),
    ).toEqual({ value: 1 });
    expect(repository.getSummary()).toMatchObject({
      status: 'idle',
      pendingMutations: 0,
      conflicts: 0,
    });
  });

  it('keeps bootstrap collisions as conflicts instead of seeding an overwrite', () => {
    insertLocalPrompt('prompt-cloud');
    repository.applyBootstrapSnapshot(
      ownerId,
      workspaceId,
      'prompt',
      remotePrompt('云端不同正文', 1),
    );

    expect(repository.listConflicts(ownerId, workspaceId)).toHaveLength(1);
    expect(repository.seedUnsyncedEntities(ownerId, workspaceId)).toBe(0);
    expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);
    expect(db.prepare("SELECT content FROM prompts WHERE id = 'prompt-cloud'").get()).toEqual({
      content: '本地正文',
    });
  });

  it('restores folder and tag relations after cloud tombstones', () => {
    const parent = remoteFolder('folder-parent', null);
    const child = remoteFolder('folder-child', parent.id);
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'folder', parent);
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'folder', child);
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'tag', remoteTag());
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', {
      ...remotePrompt('关联正文', 1),
      folderId: parent.id,
    });

    repository.applyRemoteChange(ownerId, workspaceId, {
      seq: '2',
      entityType: 'folder',
      entityId: parent.id,
      operation: 'delete',
      version: 2,
      snapshot: { ...parent, version: 2, deletedAt: now },
    });
    repository.applyRemoteChange(ownerId, workspaceId, {
      seq: '3',
      entityType: 'tag',
      entityId: 'tag-cloud',
      operation: 'delete',
      version: 2,
      snapshot: { ...remoteTag(2), deletedAt: now },
    });

    expect(db.prepare("SELECT parent_id FROM folders WHERE id = 'folder-child'").get()).toEqual({
      parent_id: null,
    });
    expect(db.prepare("SELECT folder_id FROM prompts WHERE id = 'prompt-cloud'").get()).toEqual({
      folder_id: null,
    });
    expect(db.prepare('SELECT count(*) AS value FROM prompt_tags').get()).toEqual({
      value: 0,
    });

    repository.applyRemoteChange(ownerId, workspaceId, {
      seq: '4',
      entityType: 'folder',
      entityId: parent.id,
      operation: 'upsert',
      version: 3,
      snapshot: { ...parent, version: 3 },
    });
    repository.applyRemoteChange(ownerId, workspaceId, {
      seq: '5',
      entityType: 'tag',
      entityId: 'tag-cloud',
      operation: 'upsert',
      version: 3,
      snapshot: remoteTag(3),
    });

    expect(db.prepare("SELECT parent_id FROM folders WHERE id = 'folder-child'").get()).toEqual({
      parent_id: parent.id,
    });
    expect(db.prepare("SELECT folder_id FROM prompts WHERE id = 'prompt-cloud'").get()).toEqual({
      folder_id: parent.id,
    });
    expect(db.prepare('SELECT prompt_id, tag_id FROM prompt_tags').get()).toEqual({
      prompt_id: 'prompt-cloud',
      tag_id: 'tag-cloud',
    });
  });

  it('preserves both snapshots during a conflict and supports all prompt resolutions', () => {
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'tag', remoteTag());
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', remotePrompt('共同基线', 1));
    db.prepare("UPDATE prompts SET content = '本地修改' WHERE workspace_id = ? AND id = ?").run(
      workspaceId,
      'prompt-cloud',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
    repository.applyRemoteChange(ownerId, workspaceId, remoteChange('云端修改', 2));

    let [conflict] = repository.listConflicts(ownerId, workspaceId);
    expect(conflict).toMatchObject({
      entityId: 'prompt-cloud',
      baseVersion: 1,
      localSnapshot: { content: '本地修改' },
      remoteSnapshot: { content: '云端修改', version: 2 },
    });
    expect(repository.getSummary().status).toBe('conflict');

    repository.resolveConflict(ownerId, workspaceId, conflict!.id, 'remote');
    expect(db.prepare("SELECT content FROM prompts WHERE id = 'prompt-cloud'").get()).toEqual({
      content: '云端修改',
    });
    expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);

    db.prepare("UPDATE prompts SET content = '再次本地修改' WHERE workspace_id = ? AND id = ?").run(
      workspaceId,
      'prompt-cloud',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
    repository.applyRemoteChange(ownerId, workspaceId, remoteChange('再次云端修改', 3));
    [conflict] = repository.listConflicts(ownerId, workspaceId);
    repository.resolveConflict(ownerId, workspaceId, conflict!.id, 'local');
    expect(db.prepare("SELECT content FROM prompts WHERE id = 'prompt-cloud'").get()).toEqual({
      content: '再次本地修改',
    });
    expect(repository.listReadyMutations(ownerId, workspaceId)[0]).toMatchObject({
      operation: 'update',
      baseVersion: 3,
      payload: { content: '再次本地修改' },
    });

    const pendingMutation = repository.listReadyMutations(ownerId, workspaceId)[0]!;
    repository.applyPushResult(ownerId, workspaceId, pendingMutation, {
      mutationId: pendingMutation.mutationId,
      status: 'applied',
      version: 4,
      snapshot: remotePrompt('再次本地修改', 4),
      errorCode: null,
    });
    db.prepare(
      "UPDATE prompts SET content = '要保留的本地版本' WHERE workspace_id = ? AND id = ?",
    ).run(workspaceId, 'prompt-cloud');
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
    repository.applyRemoteChange(ownerId, workspaceId, remoteChange('云端最终版本', 5));
    [conflict] = repository.listConflicts(ownerId, workspaceId);
    repository.resolveConflict(ownerId, workspaceId, conflict!.id, 'duplicate');

    const copies = db
      .prepare("SELECT id, title, content FROM prompts WHERE title LIKE '%本地副本%'")
      .all() as Array<{ id: string; title: string; content: string }>;
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ content: '要保留的本地版本' });
    expect(repository.listReadyMutations(ownerId, workspaceId)).toContainEqual(
      expect.objectContaining({
        entityId: copies[0]!.id,
        operation: 'create',
      }),
    );
  });

  it('commits a pull page and cursor atomically', () => {
    const invalidChild: SyncChange = {
      seq: '9',
      entityType: 'folder',
      entityId: 'child-without-parent',
      operation: 'upsert',
      version: 1,
      snapshot: {
        id: 'child-without-parent',
        name: '缺少父级',
        parentId: 'missing-parent',
        sortOrder: 1,
        version: 1,
        createdAt: 'invalid-date',
        updatedAt: now,
        deletedAt: null,
      },
    };

    expect(() => repository.applyPullPage(ownerId, workspaceId, [invalidChild], '9')).toThrow();
    expect(repository.getActiveAccount()?.cursor).toBe('0');
    expect(
      db.prepare("SELECT id FROM folders WHERE id = 'child-without-parent'").get(),
    ).toBeUndefined();
  });

  describe('push result semantics', () => {
    function pushSnapshot(version: number, title: string, content: string): PromptDocument {
      return {
        id: 'prompt-local',
        title,
        description: null,
        content,
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
        version,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
    }

    function outboxRow(): { mutation_id: string; last_error: string | null } {
      return db
        .prepare(
          'SELECT mutation_id, last_error FROM cloud_sync_outbox WHERE owner_id = ? AND workspace_id = ?',
        )
        .get(ownerId, workspaceId) as { mutation_id: string; last_error: string | null };
    }

    function entityState(): { sync_status: string; cloud_version: number | null } {
      return db
        .prepare(
          "SELECT sync_status, cloud_version FROM cloud_entity_state WHERE local_id = 'prompt-local'",
        )
        .get() as { sync_status: string; cloud_version: number | null };
    }

    it('acknowledges an exact replay duplicate, applies its snapshot, and clears the outbox', () => {
      insertLocalPrompt();
      repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
      const [mutation] = repository.listReadyMutations(ownerId, workspaceId);

      repository.applyPushResult(ownerId, workspaceId, mutation!, {
        mutationId: mutation!.mutationId,
        status: 'duplicate',
        version: 3,
        snapshot: pushSnapshot(3, '云端确认标题', '云端确认正文'),
        errorCode: null,
      });

      expect(
        db.prepare("SELECT title, content FROM prompts WHERE id = 'prompt-local'").get(),
      ).toEqual({ title: '云端确认标题', content: '云端确认正文' });
      expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);
      expect(outboxRow()).toBeUndefined();
      expect(entityState()).toEqual({ sync_status: 'clean', cloud_version: 3 });
    });

    it('retains the outbox and the dirty local payload when a replay is rejected for payload mismatch', () => {
      insertLocalPrompt();
      db.prepare(
        "UPDATE prompts SET content = '未同步的本地修改' WHERE workspace_id = ? AND id = 'prompt-local'",
      ).run(workspaceId);
      repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
      const [mutation] = repository.listReadyMutations(ownerId, workspaceId);

      repository.applyPushResult(ownerId, workspaceId, mutation!, {
        mutationId: mutation!.mutationId,
        status: 'rejected',
        version: null,
        snapshot: null,
        errorCode: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
      });

      expect(
        db.prepare("SELECT title, content FROM prompts WHERE id = 'prompt-local'").get(),
      ).toEqual({ title: '本地标题', content: '未同步的本地修改' });
      expect(outboxRow()).toEqual({
        mutation_id: mutation!.mutationId,
        last_error: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
      });
      expect(entityState()).toEqual({ sync_status: 'error', cloud_version: null });
      expect(repository.getSummary().pendingMutations).toBe(1);
    });

    it('retains the outbox when a legacy server reports the mismatch as duplicate with the stale snapshot', () => {
      insertLocalPrompt();
      repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
      const [mutation] = repository.listReadyMutations(ownerId, workspaceId);

      repository.applyPushResult(ownerId, workspaceId, mutation!, {
        mutationId: mutation!.mutationId,
        status: 'duplicate',
        version: 1,
        snapshot: pushSnapshot(1, '首次请求的旧标题', '首次请求的旧正文'),
        errorCode: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
      });

      expect(
        db.prepare("SELECT title, content FROM prompts WHERE id = 'prompt-local'").get(),
      ).toEqual({ title: '本地标题', content: '本地正文' });
      expect(outboxRow()).toEqual({
        mutation_id: mutation!.mutationId,
        last_error: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
      });
      expect(entityState()).toEqual({ sync_status: 'error', cloud_version: null });
    });

    it('re-issues under a fresh mutation id once the previous one is burned by a mismatch', () => {
      insertLocalPrompt();
      repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
      const [burned] = repository.listReadyMutations(ownerId, workspaceId);
      repository.applyPushResult(ownerId, workspaceId, burned!, {
        mutationId: burned!.mutationId,
        status: 'rejected',
        version: null,
        snapshot: null,
        errorCode: 'SYNC_MUTATION_PAYLOAD_MISMATCH',
      });

      db.prepare(
        "UPDATE prompts SET content = '再次编辑后的正文' WHERE workspace_id = ? AND id = 'prompt-local'",
      ).run(workspaceId);
      repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'update');

      const reissued = repository.listReadyMutations(ownerId, workspaceId);
      expect(reissued).toHaveLength(1);
      expect(reissued[0]!.mutationId).not.toBe(burned!.mutationId);
      expect(reissued[0]).toMatchObject({
        entityId: 'prompt-local',
        payload: { content: '再次编辑后的正文' },
      });
      expect(db.prepare('SELECT count(*) AS value FROM cloud_sync_outbox').get()).toEqual({
        value: 1,
      });
    });

    it('records a push conflict, keeps both sides, and resolves it locally', () => {
      insertLocalPrompt();
      repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-local', 'create');
      const [mutation] = repository.listReadyMutations(ownerId, workspaceId);

      repository.applyPushResult(ownerId, workspaceId, mutation!, {
        mutationId: mutation!.mutationId,
        status: 'conflict',
        version: 2,
        snapshot: pushSnapshot(2, '云端并发标题', '云端并发正文'),
        errorCode: 'SYNC_MUTATION_CONFLICT',
      });

      const [conflict] = repository.listConflicts(ownerId, workspaceId);
      expect(conflict).toMatchObject({
        entityId: 'prompt-local',
        localSnapshot: { title: '本地标题', content: '本地正文' },
        remoteSnapshot: { title: '云端并发标题', content: '云端并发正文', version: 2 },
      });
      expect(repository.getSummary()).toMatchObject({ status: 'conflict', pendingMutations: 1 });
      expect(
        db.prepare("SELECT title, content FROM prompts WHERE id = 'prompt-local'").get(),
      ).toEqual({ title: '本地标题', content: '本地正文' });

      repository.resolveConflict(ownerId, workspaceId, conflict!.id, 'local');
      expect(repository.listConflicts(ownerId, workspaceId)).toEqual([]);
      expect(
        db.prepare("SELECT title, content FROM prompts WHERE id = 'prompt-local'").get(),
      ).toEqual({ title: '本地标题', content: '本地正文' });
      expect(repository.listReadyMutations(ownerId, workspaceId)[0]).toMatchObject({
        operation: 'update',
        baseVersion: 2,
        payload: { title: '本地标题', content: '本地正文' },
      });
    });
  });
});

describe('permanent taxonomy conflict resolution', () => {
  it.each(['folder', 'tag'] as const)(
    'refuses local resurrection of a deleted %s without changing data or intent; remote resolution preserves content',
    (kind) => {
      const base = kind === 'folder' ? remoteFolder('folder-cloud', null) : remoteTag();
      repository.applyBootstrapSnapshot(ownerId, workspaceId, kind, base);
      repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', {
        ...remotePrompt('Retained content', 1),
        folderId: kind === 'folder' ? base.id : null,
        tags: kind === 'tag' ? [remoteTag()] : [],
      });
      const table = kind === 'folder' ? 'folders' : 'tags';
      db.prepare(`UPDATE ${table} SET name = ? WHERE workspace_id = ? AND id = ?`).run(
        'Local edit',
        workspaceId,
        base.id,
      );
      repository.enqueue(ownerId, workspaceId, kind, base.id, 'update');
      repository.applyBootstrapSnapshot(ownerId, workspaceId, kind, {
        ...base,
        version: 2,
        deletedAt: now,
      });
      const [conflict] = repository.listConflicts(ownerId, workspaceId);
      if (!conflict) throw new Error('Expected deleted taxonomy conflict');
      const state = () =>
        [
          'folders',
          'tags',
          'prompts',
          'prompt_tags',
          'prompts_fts',
          'cloud_sync_outbox',
          'cloud_entity_state',
          'cloud_sync_conflicts',
        ].map((t) => db.prepare(`SELECT * FROM ${t}`).all());
      const before = state();
      expect(() => repository.resolveConflict(ownerId, workspaceId, conflict.id, 'local')).toThrow(
        '分类已永久删除，不能保留本地版本',
      );
      expect(state()).toEqual(before);
      repository.resolveConflict(ownerId, workspaceId, conflict.id, 'remote');
      expect(
        db
          .prepare(`SELECT id FROM ${table} WHERE workspace_id=? AND id=?`)
          .get(workspaceId, base.id),
      ).toBeUndefined();
      expect(
        db
          .prepare('SELECT content,folder_id,deleted_at FROM prompts WHERE workspace_id=? AND id=?')
          .get(workspaceId, 'prompt-cloud'),
      ).toEqual({ content: 'Retained content', folder_id: null, deleted_at: null });
      expect(repository.listConflicts(ownerId, workspaceId)).toEqual([]);
      expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([]);
    },
  );

  it.each(['folder', 'tag'] as const)(
    'still permits keeping a local edit of an existing %s',
    (kind) => {
      const base = kind === 'folder' ? remoteFolder('folder-cloud', null) : remoteTag();
      repository.applyBootstrapSnapshot(ownerId, workspaceId, kind, base);
      const table = kind === 'folder' ? 'folders' : 'tags';
      db.prepare(`UPDATE ${table} SET name=? WHERE workspace_id=? AND id=?`).run(
        'Local edit',
        workspaceId,
        base.id,
      );
      repository.enqueue(ownerId, workspaceId, kind, base.id, 'update');
      repository.applyBootstrapSnapshot(ownerId, workspaceId, kind, {
        ...base,
        name: 'Remote edit',
        version: 2,
      });
      const [conflict] = repository.listConflicts(ownerId, workspaceId);
      if (!conflict) throw new Error('Expected live taxonomy conflict');
      repository.resolveConflict(ownerId, workspaceId, conflict.id, 'local');
      expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([
        expect.objectContaining({
          operation: 'update',
          baseVersion: 2,
          payload: expect.objectContaining({ name: 'Local edit' }),
        }),
      ]);
    },
  );

  it('keeps Prompt soft-delete restore available when resolving a local conflict', () => {
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', {
      ...remotePrompt('Base', 1),
      tags: [],
    });
    db.prepare('UPDATE prompts SET content=? WHERE workspace_id=? AND id=?').run(
      'Local content',
      workspaceId,
      'prompt-cloud',
    );
    repository.enqueue(ownerId, workspaceId, 'prompt', 'prompt-cloud', 'update');
    repository.applyBootstrapSnapshot(ownerId, workspaceId, 'prompt', {
      ...remotePrompt('Base', 2),
      tags: [],
      deletedAt: now,
    });
    const [conflict] = repository.listConflicts(ownerId, workspaceId);
    if (!conflict) throw new Error('Expected deleted Prompt conflict');
    repository.resolveConflict(ownerId, workspaceId, conflict.id, 'local');
    expect(repository.listReadyMutations(ownerId, workspaceId)).toEqual([
      expect.objectContaining({
        operation: 'restore',
        baseVersion: 2,
        payload: expect.objectContaining({ content: 'Local content' }),
      }),
    ]);
  });
});
