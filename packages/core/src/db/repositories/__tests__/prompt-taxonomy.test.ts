import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../../testing';
import { getDb, closeDb } from '../../index';
import { ensureAccountWorkspace } from '../../workspaces';
import { DesktopSyncRepository } from '../../../sync/repository';
import { DesktopSyncEngine, type DesktopSyncTransport } from '../../../sync/engine';
import { promptTaxonomyRepo as taxonomy } from '../prompt-taxonomy';
import { promptsRepo } from '../prompts';

let directory: string;
let scope: string;
let sync: DesktopSyncRepository;
const owner = 'taxonomy-test-owner';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'musefold-taxonomy-'));
  configureTestCoreRuntime(directory);
  const db = getDb();
  scope = ensureAccountWorkspace(db, owner);
  sync = new DesktopSyncRepository(db);
  sync.activateAccount({
    ownerId: owner,
    username: 'Synthetic',
    deviceId: 'owned-device',
    deviceName: 'Owned',
    platform: 'macos',
    clientVersion: 'test',
  });
  sync.setConsent(owner, 'enabled');
});
afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});
const folder = (name: string, parentId: string | null = null) =>
  taxonomy.createFolder({ name, parentId, sortOrder: 0 });
const tag = (name: string) => taxonomy.createTag({ name, group: null, color: null });
function state() {
  const db = getDb();
  return {
    folders: db.prepare('SELECT * FROM folders ORDER BY workspace_id,id').all(),
    tags: db.prepare('SELECT * FROM tags ORDER BY workspace_id,id').all(),
    prompts: db.prepare('SELECT * FROM prompts ORDER BY workspace_id,id').all(),
    links: db.prepare('SELECT * FROM prompt_tags ORDER BY workspace_id,prompt_id,tag_id').all(),
    fts: db.prepare('SELECT rowid,* FROM prompts_fts ORDER BY rowid').all(),
    outbox: db.prepare('SELECT * FROM cloud_sync_outbox ORDER BY mutation_id').all(),
    entityState: db
      .prepare(
        'SELECT * FROM cloud_entity_state ORDER BY owner_id,workspace_id,entity_type,local_id',
      )
      .all(),
  };
}

describe('classification transactions preserve content and synchronization intent', () => {
  it('deletes only the parent and detaches direct child and prompt while preserving the grandchild', () => {
    const parent = folder('Parent');
    const child = folder('Child', parent);
    const grandchild = folder('Grandchild', child);
    const direct = promptsRepo.create({ title: 'Direct', content: 'Keep body', folderId: parent });
    const nested = promptsRepo.create({ title: 'Nested', content: 'Keep nested', folderId: child });
    taxonomy.removeFolder(parent);
    expect(
      getDb()
        .prepare('SELECT id,parent_id FROM folders WHERE workspace_id=? ORDER BY name')
        .all(scope),
    ).toEqual([
      { id: child, parent_id: null },
      { id: grandchild, parent_id: child },
    ]);
    expect(promptsRepo.get(direct.id)).toMatchObject({ folderId: null, content: 'Keep body' });
    expect(promptsRepo.get(nested.id)).toMatchObject({ folderId: child, content: 'Keep nested' });
    const queued = sync.listReadyMutations(owner, scope);
    expect(queued.find((m) => m.entityId === child)?.payload.parentId).toBeNull();
    expect(queued.find((m) => m.entityId === direct.id)?.payload.folderId).toBeNull();
    expect(queued.some((m) => m.entityId === parent)).toBe(false);
  });

  it('rolls back detached children, prompts, FTS and pending mutations on a later DELETE failure', () => {
    const parent = folder('Owned failure');
    folder('Child', parent);
    promptsRepo.create({ title: 'Keep', content: 'Keep body', folderId: parent });
    getDb().exec(
      "CREATE TRIGGER owned_failure BEFORE DELETE ON folders WHEN OLD.name='Owned failure' BEGIN SELECT RAISE(ABORT,'owned_failure'); END",
    );
    const before = state();
    expect(() => taxonomy.removeFolder(parent)).toThrow('owned_failure');
    expect(state()).toEqual(before);
    getDb().exec('DROP TRIGGER owned_failure');
    taxonomy.removeFolder(parent);
    expect(promptsRepo.list()[0].folderId).toBeNull();
  });

  it('updates tag search terms after rename and delete while retaining other tags and prompt text', () => {
    const renamed = tag('Olduniquetag');
    const keep = tag('Keepuniquetag');
    const prompt = promptsRepo.create({
      title: 'Unrelated',
      content: 'Bodyunique',
      tagIds: [renamed, keep],
    });
    taxonomy.updateTag(renamed, { name: 'Newuniquetag', expectedVersion: 1 });
    expect(promptsRepo.list({ search: 'Olduniquetag' })).toEqual([]);
    expect(promptsRepo.list({ search: 'Newuniquetag' }).map((p) => p.id)).toEqual([prompt.id]);
    taxonomy.removeTag(renamed);
    expect(promptsRepo.list({ search: 'Newuniquetag' })).toEqual([]);
    expect(promptsRepo.list({ search: 'Keepuniquetag' }).map((p) => p.id)).toEqual([prompt.id]);
    expect(promptsRepo.list({ search: 'Bodyunique' }).map((p) => p.id)).toEqual([prompt.id]);
    expect(promptsRepo.get(prompt.id)?.tags.map((t) => t.id)).toEqual([keep]);
    expect(
      sync.listReadyMutations(owner, scope).find((m) => m.entityId === prompt.id)?.payload.tagIds,
    ).toEqual([keep]);
  });

  it('rolls back a tag rename and FTS update if queuing the change fails', () => {
    const id = tag('Olduniquetag');
    promptsRepo.create({ title: 'Unrelated', content: 'Body', tagIds: [id] });
    getDb().exec(
      "CREATE TRIGGER owned_failure BEFORE INSERT ON cloud_sync_outbox WHEN NEW.entity_type='tag' BEGIN SELECT RAISE(ABORT,'owned_queue_failure'); END",
    );
    const before = state();
    expect(() => taxonomy.updateTag(id, { name: 'Changed', expectedVersion: 1 })).toThrow(
      'owned_queue_failure',
    );
    expect(state()).toEqual(before);
  });

  it.each(['unset', 'paused', 'enabled'] as const)(
    'preserves %s consent while processing folder and tag edits',
    async (consent) => {
      sync.setConsent(owner, consent);
      const f = folder('First');
      const t = tag('First tag');
      taxonomy.updateFolder(f, { name: 'Changed folder', expectedVersion: 1 });
      taxonomy.updateTag(t, { name: 'Changed tag', expectedVersion: 1 });
      const pending = sync.listReadyMutations(owner, scope);
      expect(pending).toHaveLength(consent === 'unset' ? 0 : 2);
      expect(sync.getActiveAccount()?.consent).toBe(consent);
      if (consent !== 'enabled') {
        let calls = 0;
        const transport = new Proxy({} as DesktopSyncTransport, {
          get: () => async () => {
            calls++;
            throw new Error('No transport allowed');
          },
        });
        await new DesktopSyncEngine(sync, transport).run();
        expect(calls).toBe(0);
      }
    },
  );

  it('retains same-ID rows, associations and search data in another workspace', () => {
    const f = folder('Owned');
    const t = tag('Owned tag');
    const p = promptsRepo.create({
      title: 'Owned',
      content: 'Owned body',
      folderId: f,
      tagIds: [t],
    });
    const foreign = ensureAccountWorkspace(getDb(), 'foreign-owner');
    getDb().transaction(() => {
      getDb()
        .prepare(
          'INSERT INTO folders (workspace_id,id,name,parent_id,sort_order,created_at) VALUES (?,?,?,NULL,0,1)',
        )
        .run(foreign, f, 'Foreign folder');
      getDb()
        .prepare(
          'INSERT INTO tags (workspace_id,id,name,tag_group,color,created_at) VALUES (?,?,?,NULL,NULL,1)',
        )
        .run(foreign, t, 'Foreignuniquetag');
      getDb()
        .prepare(
          'INSERT INTO prompts (workspace_id,id,title,content,folder_id,created_at,updated_at) VALUES (?,?,?,?,?,1,1)',
        )
        .run(foreign, p.id, 'Foreign title', 'Foreign body', f);
      getDb().prepare('INSERT INTO prompt_tags VALUES (?,?,?)').run(foreign, p.id, t);
      promptsRepo.refreshSearchIndex(p.id, foreign);
    })();
    const snapshot = promptsRepo.get(p.id, foreign);
    taxonomy.removeTag(t);
    taxonomy.removeFolder(f);
    expect(promptsRepo.get(p.id, foreign)).toEqual(snapshot);
    expect(promptsRepo.list({ search: 'Foreignuniquetag' }, foreign).map((p) => p.id)).toEqual([
      p.id,
    ]);
    expect(
      getDb()
        .prepare('SELECT parent_id FROM folders WHERE workspace_id=? AND id=?')
        .get(foreign, f),
    ).toEqual({ parent_id: null });
  });

  it('rejects same-name tag creation and rename without changing any persisted state', () => {
    tag('Existing');
    const other = tag('Other');
    const before = state();
    expect(() => tag('Existing')).toThrow('已存在同名标签');
    expect(() => taxonomy.updateTag(other, { name: 'Existing', expectedVersion: 1 })).toThrow(
      '已存在同名标签',
    );
    expect(state()).toEqual(before);
  });

  it('rejects folder cycles and a parent that exists only in another workspace', () => {
    const parent = folder('Parent');
    const child = folder('Child', parent);
    const foreign = ensureAccountWorkspace(getDb(), 'foreign-owner');
    getDb()
      .prepare(
        'INSERT INTO folders (workspace_id,id,name,parent_id,sort_order,created_at) VALUES (?,?,?,NULL,0,1)',
      )
      .run(foreign, 'foreign-only', 'Foreign');
    const before = state();
    expect(() => taxonomy.updateFolder(parent, { parentId: child, expectedVersion: 1 })).toThrow(
      '自身或子文件夹',
    );
    expect(() => folder('Invalid', 'foreign-only')).toThrow('文件夹不存在');
    expect(state()).toEqual(before);
  });

  it('reports missing rows on repeat deletion without adding mutations', () => {
    const f = folder('Folder');
    const t = tag('Tag');
    taxonomy.removeFolder(f);
    taxonomy.removeTag(t);
    const before = state();
    expect(() => taxonomy.removeFolder(f)).toThrow('文件夹不存在');
    expect(() => taxonomy.removeTag(t)).toThrow('标签不存在');
    expect(state()).toEqual(before);
  });
});
