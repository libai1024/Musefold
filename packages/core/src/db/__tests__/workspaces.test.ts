import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import {
  ACCOUNT_WORKSPACE_KIND,
  LEGACY_WORKSPACE_ID,
  LEGACY_WORKSPACE_KIND,
  accountWorkspaceId,
  adoptLegacyWorkspace,
  ensureAccountWorkspace,
  resolveActiveWorkspace,
  resolveActiveWorkspaceScope,
  resolveLocalContentWorkspace,
} from '../workspaces';

const databases: Database.Database[] = [];

function openDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  databases.push(db);
  return db;
}

function insertAccount(
  db: Database.Database,
  ownerId: string,
  active: 0 | 1,
  enabled: 0 | 1,
): void {
  db.prepare(
    `INSERT INTO cloud_sync_accounts (
       owner_id, username, device_id, device_name, platform, client_version,
       active, enabled, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'macos', 'test', ?, ?, 1, 1)`,
  ).run(ownerId, ownerId, `device-${ownerId}`, 'Test device', active, enabled);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('workspace resolution', () => {
  it('falls back to the preserved legacy workspace without creating account state', () => {
    const db = openDatabase();

    expect(resolveActiveWorkspaceScope(db)).toEqual({
      status: 'legacy',
      workspaceId: LEGACY_WORKSPACE_ID,
      kind: LEGACY_WORKSPACE_KIND,
      ownerId: null,
    });
    expect(resolveActiveWorkspace(db)).toBe(LEGACY_WORKSPACE_ID);
    expect(db.prepare('SELECT COUNT(*) AS count FROM local_workspaces').get()).toEqual({
      count: 1,
    });
  });

  it('keeps an active-but-disabled account isolated from legacy data', () => {
    const db = openDatabase();
    insertAccount(db, 'owner-disabled', 1, 0);

    expect(resolveActiveWorkspaceScope(db)).toMatchObject({
      status: 'missing-account-workspace',
      workspaceId: null,
      ownerId: 'owner-disabled',
    });
    expect(() => resolveActiveWorkspace(db)).toThrow('has no explicit workspace');
  });

  it('uses the preserved legacy workspace for local content before explicit adoption', () => {
    const db = openDatabase();
    insertAccount(db, 'owner-local-only', 1, 0);

    expect(resolveLocalContentWorkspace(db)).toBe(LEGACY_WORKSPACE_ID);
    expect(resolveActiveWorkspaceScope(db)).toMatchObject({
      status: 'missing-account-workspace',
      ownerId: 'owner-local-only',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM local_workspaces').get()).toEqual({
      count: 1,
    });
  });

  it('resolves only an explicitly established account workspace', () => {
    const db = openDatabase();
    insertAccount(db, 'owner-explicit', 1, 1);
    const workspaceId = ensureAccountWorkspace(db, 'owner-explicit', 2);

    expect(workspaceId).toBe(accountWorkspaceId('owner-explicit'));
    expect(resolveActiveWorkspaceScope(db)).toEqual({
      status: 'account',
      workspaceId,
      kind: ACCOUNT_WORKSPACE_KIND,
      ownerId: 'owner-explicit',
    });
    expect(resolveActiveWorkspace(db)).toBe(workspaceId);
    expect(db.prepare('SELECT COUNT(*) AS count FROM local_workspaces').get()).toEqual({
      count: 2,
    });
  });

  it('explicitly adopts legacy content, usage, tags, and rebuilds FTS while preserving source', () => {
    const db = openDatabase();
    db.prepare(
      `INSERT INTO folders (workspace_id, id, name, parent_id, sort_order, created_at)
       VALUES (?, 'folder-1', 'Research', NULL, 0, 1)`,
    ).run(LEGACY_WORKSPACE_ID);
    db.prepare(
      `INSERT INTO tags (workspace_id, id, name, tag_group, color, created_at)
       VALUES (?, 'tag-1', 'Visual', 'fixture', '#fff', 1)`,
    ).run(LEGACY_WORKSPACE_ID);
    db.prepare(
      `INSERT INTO prompts (
         workspace_id, id, title, description, content, folder_id, params, usage_count,
         source, created_at, updated_at
       ) VALUES (?, 'prompt-1', '庭院', 'description', 'misty garden', 'folder-1',
         '{"schemaVersion":1}', 7, 'manual', 1, 2)`,
    ).run(LEGACY_WORKSPACE_ID);
    db.prepare('INSERT INTO prompt_tags (workspace_id, prompt_id, tag_id) VALUES (?, ?, ?)').run(
      LEGACY_WORKSPACE_ID,
      'prompt-1',
      'tag-1',
    );
    db.prepare(
      `INSERT INTO prompts_fts (rowid, title, description, content, tags_index)
       SELECT rowid, 'stale', '', 'stale', '' FROM prompts WHERE workspace_id = ? AND id = ?`,
    ).run(LEGACY_WORKSPACE_ID, 'prompt-1');

    const result = adoptLegacyWorkspace(db, 'owner-adopted', 10);
    const target = accountWorkspaceId('owner-adopted');
    expect(result).toMatchObject({
      workspaceId: target,
      sourceWorkspaceId: LEGACY_WORKSPACE_ID,
      folders: 1,
      prompts: 1,
      tags: 1,
      promptTags: 1,
      copiedUsage: 7,
      copiedEntityState: 0,
      copiedOutbox: 0,
      copiedUsageOutbox: 0,
    });
    expect(
      db.prepare('SELECT usage_count FROM prompts WHERE workspace_id = ?').get(target),
    ).toEqual({
      usage_count: 7,
    });
    expect(
      db
        .prepare('SELECT workspace_id FROM prompts WHERE id = ? ORDER BY workspace_id')
        .all('prompt-1'),
    ).toEqual([{ workspace_id: target }, { workspace_id: LEGACY_WORKSPACE_ID }]);
    expect(
      db
        .prepare(
          `SELECT title, content, tags_index FROM prompts_fts
           WHERE rowid = (SELECT rowid FROM prompts WHERE workspace_id = ? AND id = ?)`,
        )
        .get(target, 'prompt-1'),
    ).toMatchObject({ title: '庭院', content: 'misty garden' });
  });

  it('is idempotent for the exact copy and rejects a non-empty divergent target', () => {
    const db = openDatabase();
    db.prepare(
      `INSERT INTO prompts (workspace_id, id, title, content, created_at, updated_at, usage_count)
       VALUES (?, 'prompt-1', 'Legacy', 'content', 1, 1, 2)`,
    ).run(LEGACY_WORKSPACE_ID);

    const first = adoptLegacyWorkspace(db, 'owner-repeat', 2);
    const second = adoptLegacyWorkspace(db, 'owner-repeat', 3);
    expect(second).toEqual(first);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM prompts WHERE workspace_id = ?')
        .get(accountWorkspaceId('owner-repeat')),
    ).toEqual({ count: 1 });

    const divergent = accountWorkspaceId('owner-divergent');
    ensureAccountWorkspace(db, 'owner-divergent');
    db.prepare(
      `INSERT INTO prompts (workspace_id, id, title, content, created_at, updated_at)
       VALUES (?, 'prompt-other', 'Other', 'different', 1, 1)`,
    ).run(divergent);
    expect(() => adoptLegacyWorkspace(db, 'owner-divergent')).toThrow(/not an exact legacy copy/);
  });

  it('never copies legacy cloud state or outbox rows into the adopted account workspace', () => {
    const db = openDatabase();
    db.prepare(
      `INSERT INTO cloud_sync_accounts (
         owner_id, username, device_id, device_name, platform, client_version,
         active, enabled, created_at, updated_at
       ) VALUES ('owner-cloud-source', 'source', 'device', 'Device', 'macos', 'test', 0, 0, 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO cloud_entity_state (
         owner_id, workspace_id, entity_type, local_id, cloud_id, sync_status
       ) VALUES ('owner-cloud-source', ?, 'prompt', 'prompt-1', 'cloud-1', 'clean')`,
    ).run(LEGACY_WORKSPACE_ID);
    db.prepare(
      `INSERT INTO cloud_sync_outbox (
         mutation_id, owner_id, workspace_id, entity_type, entity_id, operation, payload_json, created_at
       ) VALUES ('mutation-source', 'owner-cloud-source', ?, 'prompt', 'prompt-1', 'update', '{}', 1)`,
    ).run(LEGACY_WORKSPACE_ID);
    db.prepare(
      `INSERT INTO cloud_sync_usage_outbox (
         event_id, owner_id, workspace_id, prompt_id, action, created_at
       ) VALUES ('usage-source', 'owner-cloud-source', ?, 'prompt-1', 'copy', 1)`,
    ).run(LEGACY_WORKSPACE_ID);
    db.prepare(
      `INSERT INTO prompts (workspace_id, id, title, content, created_at, updated_at)
       VALUES (?, 'prompt-1', 'Legacy', 'content', 1, 1)`,
    ).run(LEGACY_WORKSPACE_ID);

    const result = adoptLegacyWorkspace(db, 'owner-clean', 2);
    const target = accountWorkspaceId('owner-clean');
    expect(result.copiedEntityState).toBe(0);
    expect(result.copiedOutbox).toBe(0);
    expect(result.copiedUsageOutbox).toBe(0);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM cloud_entity_state WHERE workspace_id = ?')
        .get(target),
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM cloud_sync_outbox WHERE workspace_id = ?')
        .get(target),
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM cloud_sync_usage_outbox WHERE workspace_id = ?')
        .get(target),
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM cloud_entity_state WHERE workspace_id = ?')
        .get(LEGACY_WORKSPACE_ID),
    ).toEqual({ count: 1 });
  });
});
