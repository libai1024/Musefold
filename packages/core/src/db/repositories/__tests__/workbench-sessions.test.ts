import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workbenchDraftSchema } from '@musefold/contracts';
import { WorkbenchSessionStore } from '../workbench-sessions';

let directory: string;
let db: Database.Database;
let store: WorkbenchSessionStore;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'session-store-'));
  db = new Database(join(directory, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  store = new WorkbenchSessionStore(db);
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
const legacyDraft = workbenchDraftSchema.parse({
  prompt: '旧'.repeat(12_000),
  negative: '',
  params: { aspectRatio: '7:3' },
});
function seedWithoutDraft(id: string) {
  db.prepare('INSERT INTO workbench_sessions(id,title,created_at,updated_at) VALUES (?,?,1,2)').run(
    id,
    id,
  );
}
const facts = () => ({
  sessions: db.prepare('SELECT * FROM workbench_sessions ORDER BY id').all(),
  drafts: db.prepare('SELECT * FROM workbench_drafts ORDER BY session_id').all(),
});

describe('Session store legacy import and independent connections', () => {
  it('imports missing legacy drafts once without overwriting current data or moving activity time', () => {
    seedWithoutDraft('old');
    const current = store.create({ title: 'Current', draft: { prompt: 'Current draft' } });
    expect(
      store.importLegacyDrafts({
        old: legacyDraft,
        missing: legacyDraft,
        [current.row.id]: legacyDraft,
      }),
    ).toBe(1);
    expect(store.get('old')).toMatchObject({
      row: { version: 2, updated_at: 2 },
      draft: legacyDraft,
    });
    expect(store.get(current.row.id)).toEqual(current);
    const before = facts();
    expect(store.importLegacyDrafts({ old: legacyDraft })).toBe(0);
    expect(facts()).toEqual(before);
  });

  it('rolls back all imported drafts and versions if a later draft fails', () => {
    seedWithoutDraft('first');
    seedWithoutDraft('second');
    const before = facts();
    db.exec(
      "CREATE TRIGGER import_fault BEFORE INSERT ON workbench_drafts WHEN NEW.session_id='second' BEGIN SELECT RAISE(ABORT,'owned import fault'); END",
    );
    expect(() => store.importLegacyDrafts({ first: legacyDraft, second: legacyDraft })).toThrow(
      'owned import fault',
    );
    expect(facts()).toEqual(before);
    db.exec('DROP TRIGGER import_fault');
    expect(store.importLegacyDrafts({ first: legacyDraft, second: legacyDraft })).toBe(2);
  });

  it('reads historical drafts verbatim and preserves them through title-only writes', () => {
    seedWithoutDraft('old');
    store.importLegacyDrafts({ old: legacyDraft });
    const before = db.prepare('SELECT * FROM workbench_drafts').all();
    const changed = store.update('old', { expectedVersion: 2, title: '题'.repeat(120) });
    expect(changed.row.version).toBe(3);
    expect(changed.draft).toEqual(legacyDraft);
    expect(db.prepare('SELECT * FROM workbench_drafts').all()).toEqual(before);
  });

  it('keeps the existing empty fallback for malformed persisted drafts', () => {
    seedWithoutDraft('broken');
    db.prepare('INSERT INTO workbench_drafts VALUES (?,?,?)').run('broken', '{broken', 1);
    expect(store.get('broken').draft).toEqual(
      workbenchDraftSchema.parse({ prompt: '', negative: '', params: {} }),
    );
    expect(store.update('broken', { expectedVersion: 1, title: 'Renamed' }).row.version).toBe(2);
    expect(db.prepare('SELECT draft_json FROM workbench_drafts').get()).toEqual({
      draft_json: '{broken',
    });
  });

  it('rejects a stale independent connection and returns the winning draft with its version', () => {
    const initial = store.create({ title: 'Initial' });
    const secondDb = new Database(join(directory, 'test.db'));
    try {
      const other = new WorkbenchSessionStore(secondDb);
      const observed = other.get(initial.row.id);
      const changed = store.update(initial.row.id, {
        expectedVersion: initial.row.version,
        title: 'Winner',
        draft: {
          prompt: 'Winning draft',
          negative: '',
          params: {},
          promptReferenceSelections: [],
          promptReferenceIds: [],
        },
      });
      expect(() =>
        other.update(initial.row.id, { expectedVersion: observed.row.version, title: 'Loser' }),
      ).toThrow('会话已删除或草稿已更新');
      expect(other.get(initial.row.id)).toEqual(changed);
      expect(changed).toMatchObject({
        row: { version: 2, title: 'Winner' },
        draft: { prompt: 'Winning draft' },
      });
    } finally {
      secondDb.close();
    }
  });
});
