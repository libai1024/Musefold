import {
  localWorkspacePreviewSchema,
  localWorkspaceRecoveryStatusSchema,
  prepareLocalWorkspaceInputSchema,
} from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listLocalWorkspaceRecovery,
  prepareLocalWorkspace,
  previewLocalWorkspace,
} from '../workspace-recovery';
import {
  ensureAccountWorkspace,
  LEGACY_WORKSPACE_ID,
  resolveAccountWorkspace,
} from '../workspaces';

const databases: Database.Database[] = [];
function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  databases.push(db);
  return db;
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const insert = (db: Database.Database, source: string, id: string) =>
  db
    .prepare(
      `INSERT INTO prompts (workspace_id,id,title,content,created_at,updated_at) VALUES (?, ?, ?, '本机预览', 1, 2)`,
    )
    .run(source, id, id);

describe('local workspace recovery', () => {
  it('previews every page and retains folders, tags and tombstones without exposing storage columns', () => {
    const db = setup();
    const source = ensureAccountWorkspace(db, 'synthetic-historical-owner');
    for (let index = 0; index < 21; index++)
      insert(db, source, `prompt-${String(index).padStart(2, '0')}`);
    db.prepare(
      'UPDATE prompts SET deleted_at = 3, preview_image_path = ? WHERE workspace_id = ? AND id = ?',
    ).run('/secret/path', source, 'prompt-20');
    const list = localWorkspaceRecoveryStatusSchema.parse({
      ...listLocalWorkspaceRecovery(db, 'verified-owner', true),
      reviewRef: null,
      targetAccount: null,
    });
    const entry = list.sources.find((item) => item.kind === 'account');
    if (!entry) throw new Error('source missing');
    const first = localWorkspacePreviewSchema.parse(
      previewLocalWorkspace(db, { sourceId: entry.sourceId }),
    );
    if (!first.nextCursor) throw new Error('second page missing');
    const last = localWorkspacePreviewSchema.parse(
      previewLocalWorkspace(db, { sourceId: entry.sourceId, cursor: first.nextCursor }),
    );
    expect(first.prompts).toHaveLength(20);
    expect(last.prompts).toHaveLength(1);
    expect(last.prompts[0].isDeleted).toBe(true);
    expect(last.nextCursor).toBeNull();
    expect(last.revision).toBe(first.revision);
    expect(JSON.stringify([list, first, last])).not.toMatch(
      /secret|path|owner|workspace_id|preview_image_path/,
    );
  });

  it('copy rollback leaves both source and missing target unchanged on malformed historical relations', () => {
    const db = setup();
    insert(db, LEGACY_WORKSPACE_ID, 'broken');
    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE prompts SET folder_id = ? WHERE workspace_id = ?').run(
      'missing-folder',
      LEGACY_WORKSPACE_ID,
    );
    db.pragma('foreign_keys = ON');
    const source = listLocalWorkspaceRecovery(db, 'verified', true).sources[0];
    expect(() =>
      prepareLocalWorkspace(db, 'verified', {
        mode: 'copy',
        reviewRef: 'd'.repeat(64),
        sourceId: source.sourceId,
        expectedRevision: source.revision,
      }),
    ).toThrow(/FOREIGN KEY/);
    expect(resolveAccountWorkspace(db, 'verified')).toBeNull();
    expect(
      db.prepare('SELECT folder_id FROM prompts WHERE workspace_id = ?').get(LEGACY_WORKSPACE_ID),
    ).toEqual({ folder_id: 'missing-folder' });
  });

  it('bounds metadata while the streaming revision still detects changes outside the visible page', () => {
    const db = setup();
    const insertTag = db.prepare(
      'INSERT INTO tags (workspace_id,id,name,created_at) VALUES (?, ?, ?, 1)',
    );
    const insertFolder = db.prepare(
      'INSERT INTO folders (workspace_id,id,name,created_at) VALUES (?, ?, ?, 1)',
    );
    for (let index = 0; index < 205; index++) {
      const id = String(index).padStart(3, '0');
      insertTag.run(LEGACY_WORKSPACE_ID, id, `tag-${id}`);
      insertFolder.run(LEGACY_WORKSPACE_ID, id, `folder-${id}`);
      insert(db, LEGACY_WORKSPACE_ID, `prompt-${id}`);
    }
    const source = listLocalWorkspaceRecovery(db, 'verified', true).sources[0];
    const preview = previewLocalWorkspace(db, { sourceId: source.sourceId });
    expect(preview.folders).toHaveLength(200);
    expect(preview.tags).toHaveLength(200);
    expect(preview.prompts).toHaveLength(20);
    expect(preview.revision).toBe(source.revision);
    db.prepare('UPDATE prompts SET content = ? WHERE workspace_id = ? AND id = ?').run(
      'changed outside page\nwith delimiters',
      LEGACY_WORKSPACE_ID,
      'prompt-204',
    );
    expect(() =>
      prepareLocalWorkspace(db, 'verified', {
        mode: 'copy',
        reviewRef: 'd'.repeat(64),
        sourceId: source.sourceId,
        expectedRevision: preview.revision,
      }),
    ).toThrow(/发生了变化/);
    const next = previewLocalWorkspace(db, { sourceId: source.sourceId });
    const target = prepareLocalWorkspace(db, 'verified', {
      mode: 'copy',
      reviewRef: 'd'.repeat(64),
      sourceId: source.sourceId,
      expectedRevision: next.revision,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags WHERE workspace_id = ?').get(target)).toEqual(
      { n: 205 },
    );
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM folders WHERE workspace_id = ?').get(target),
    ).toEqual({ n: 205 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM prompts WHERE workspace_id = ?').get(target),
    ).toEqual({ n: 205 });
  });

  it('explicit empty target leaves offline rows intact and cannot subsequently be overwritten', () => {
    const db = setup();
    insert(db, LEGACY_WORKSPACE_ID, 'offline');
    const source = listLocalWorkspaceRecovery(db, 'verified', true).sources[0];
    prepareLocalWorkspace(db, 'verified', { mode: 'empty', reviewRef: 'd'.repeat(64) });
    expect(listLocalWorkspaceRecovery(db, 'verified', true)).toMatchObject({
      targetReady: true,
      canPrepare: false,
    });
    expect(() =>
      prepareLocalWorkspace(db, 'verified', {
        mode: 'copy',
        reviewRef: 'd'.repeat(64),
        sourceId: source.sourceId,
        expectedRevision: source.revision,
      }),
    ).toThrow(/不能覆盖/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM prompts').get()).toEqual({ n: 1 });
  });

  it('canonical inputs reject caller-selected owner, target, unknown source shapes and invalid cursors', () => {
    expect(
      prepareLocalWorkspaceInputSchema.safeParse({ mode: 'empty', ownerId: 'other' }).success,
    ).toBe(false);
    expect(
      prepareLocalWorkspaceInputSchema.safeParse({
        mode: 'copy',
        reviewRef: 'd'.repeat(64),
        sourceId: 'account:old',
        expectedRevision: 'x',
      }).success,
    ).toBe(false);
    expect(
      localWorkspacePreviewSchema.safeParse({
        sourceId: 'a'.repeat(64),
        revision: 'b'.repeat(64),
        prompts: [],
        folders: [],
        tags: [],
        nextCursor: null,
        token: 'secret',
      }).success,
    ).toBe(false);
  });
});
