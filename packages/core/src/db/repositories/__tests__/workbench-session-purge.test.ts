import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchSessionStore } from '../workbench-sessions';
import { createWorkbenchRepositories } from '../workbench';

let db: Database.Database;
let store: WorkbenchSessionStore;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  store = new WorkbenchSessionStore(db);
});
afterEach(() => db.close());

function linkedRun(sessionId: string) {
  const repos = createWorkbenchRepositories(db);
  const run = repos.runs.create({
    id: 'original-run',
    workbenchSessionId: sessionId,
    providerId: 'provider',
    model: 'model',
    userPrompt: 'user',
    basePrompt: 'base',
    finalPrompt: 'final',
    params: { schemaVersion: 1, n: 1 },
    createdAt: 10,
  });
  repos.runs.start(run.id, 'owned-provider-request', 10);
  repos.runs.complete(run.id, {
    finishedAt: 11,
    actualCost: 0.25,
    assets: [{ id: 'original-asset', mediaPath: '/owned/original.png' }],
  });
  return run.id;
}
const facts = () => ({
  sessions: db.prepare('SELECT * FROM workbench_sessions ORDER BY id').all(),
  drafts: db.prepare('SELECT * FROM workbench_drafts ORDER BY session_id').all(),
  runs: db.prepare('SELECT * FROM generation_runs ORDER BY id').all(),
  assets: db.prepare('SELECT * FROM generated_assets ORDER BY id').all(),
});

describe('permanent Session cleanup preserves generation and blocks identity reuse', () => {
  it('removes only a trashed Session and draft, detaches its run and is idempotent', () => {
    const initial = store.create({ title: 'Deleted', draft: { prompt: 'private draft' } });
    linkedRun(initial.row.id);
    store.changeDeleted(initial.row.id, true);
    const before = facts();
    expect(before.runs).toEqual([
      expect.objectContaining({ status: 'success', actual_cost: 0.25 }),
    ]);
    expect(before.assets).toHaveLength(1);
    expect(store.purge(initial.row.id)).toEqual({ purged: 1 });
    expect(facts()).toEqual({
      sessions: [],
      drafts: [],
      runs: before.runs.map((row) => ({ ...(row as object), workbench_session_id: null })),
      assets: before.assets,
    });
    expect(store.purge(initial.row.id)).toEqual({ purged: 0 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects permanent deletion after restore and preserves archive state', () => {
    const initial = store.create({ title: 'Restored' });
    store.update(initial.row.id, { expectedVersion: 1, archived: true });
    store.changeDeleted(initial.row.id, true);
    store.changeDeleted(initial.row.id, false);
    const before = facts();
    expect(() => store.purge(initial.row.id)).toThrow('只能永久删除回收站中的会话');
    expect(facts()).toEqual(before);
    expect(store.emptyTrash()).toEqual({ purged: 0 });
  });

  it('clears over 500 trashed Sessions including archived rows and preserves live rows', () => {
    const active = store.create({ title: 'Keep' });
    db.transaction(() => {
      for (let index = 0; index < 501; index++) {
        const item = store.create({ title: `Deleted ${index}` });
        if (index % 2) store.update(item.row.id, { expectedVersion: 1, archived: true });
        store.changeDeleted(item.row.id, true);
      }
    })();
    expect(store.emptyTrash()).toEqual({ purged: 501 });
    expect(store.get(active.row.id)).toEqual(active);
    expect(db.prepare('SELECT COUNT(*) AS count FROM workbench_sessions').get()).toEqual({
      count: 1,
    });
    expect(store.emptyTrash()).toEqual({ purged: 0 });
  });

  it('rolls back the whole clear when a later Session delete fails, including references and deletion markers', () => {
    const first = store.create({ title: 'First' });
    const second = store.create({ title: 'Second' });
    linkedRun(first.row.id);
    store.changeDeleted(first.row.id, true);
    store.changeDeleted(second.row.id, true);
    const last = [first.row.id, second.row.id].sort().at(-1);
    db.exec(
      `CREATE TRIGGER owned_purge_fault BEFORE DELETE ON workbench_sessions WHEN OLD.id='${last}' BEGIN SELECT RAISE(ABORT,'owned Session purge fault'); END`,
    );
    const before = facts();
    expect(() => store.emptyTrash()).toThrow('owned Session purge fault');
    expect(facts()).toEqual(before);
    expect(db.prepare('SELECT * FROM workbench_session_deletions').all()).toEqual([]);
    db.exec('DROP TRIGGER owned_purge_fault');
    expect(store.emptyTrash()).toEqual({ purged: 2 });
  });

  it('prevents a late legacy ensure and direct insertion from recreating the purged identity', () => {
    const initial = store.create({ title: 'Deleted' });
    store.changeDeleted(initial.row.id, true);
    store.purge(initial.row.id);
    expect(() =>
      createWorkbenchRepositories(db).sessions.ensure({
        id: initial.row.id,
        title: 'Late generation',
      }),
    ).toThrow('已永久删除');
    expect(() =>
      db
        .prepare('INSERT INTO workbench_sessions(id,title,created_at,updated_at) VALUES (?,?,1,1)')
        .run(initial.row.id, 'Old importer'),
    ).toThrow('permanently deleted');
    expect(facts().sessions).toEqual([]);
    expect(() => store.changeDeleted(initial.row.id, false)).toThrow('会话不存在');
    expect(store.create({ title: 'Fresh identity' }).row.id).not.toBe(initial.row.id);
  });
});
