import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidWorkbenchSessionCursorError,
  queryWorkbenchSessions,
} from '../workbench-session-query';

describe('SQLite Session keyset storage query', () => {
  let db: Database.Database;
  const now = Date.parse('2026-09-13T04:00:00Z');
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE workbench_sessions(
      id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
      archived_at INTEGER,deleted_at INTEGER,version INTEGER NOT NULL DEFAULT 1)`);
  });
  afterEach(() => db.close());
  const seed = (id: string, deleted = false) =>
    db
      .prepare(
        'INSERT INTO workbench_sessions(id,title,created_at,updated_at,archived_at,deleted_at) VALUES (?,?,?,?,?,?)',
      )
      .run(id, id, now - 1, now, null, deleted ? now : null);

  it('visits more than two full pages and filters deleted rows before LIMIT', () => {
    for (let index = 0; index < 205; index++) seed(String(index).padStart(3, '0'));
    seed('excluded', true);
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const result = queryWorkbenchSessions(db, { limit: 100, ...(cursor ? { cursor } : {}) });
      found.push(...result.rows.map((row) => row.id));
      cursor = result.nextCursor ?? undefined;
      expect(found.length).toBeLessThanOrEqual(205);
    } while (cursor);
    expect(found).toEqual(Array.from({ length: 205 }, (_, i) => String(204 - i).padStart(3, '0')));
    expect(queryWorkbenchSessions(db, { deletedOnly: true }).rows.map((row) => row.id)).toEqual([
      'excluded',
    ]);
  });

  it('keeps a middle record reachable after deleting the prior page boundary', () => {
    for (const id of ['a', 'b', 'c']) seed(id);
    const first = queryWorkbenchSessions(db, { limit: 1 });
    db.prepare('DELETE FROM workbench_sessions WHERE id=?').run('c');
    expect(
      queryWorkbenchSessions(db, { limit: 1, cursor: first.nextCursor ?? undefined }).rows.map(
        (row) => row.id,
      ),
    ).toEqual(['b']);
  });

  it.each([
    { store: 'postgres' },
    { version: 2 },
    { filter: 'trash' },
    { updatedAt: '2026-09-13T04:00:00.000001Z' },
    { extra: true },
  ])('rejects incompatible or sub-millisecond boundaries %j', (patch) => {
    seed('a');
    seed('b');
    const first = queryWorkbenchSessions(db, { limit: 1 });
    const original = JSON.parse(Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8'));
    const cursor = Buffer.from(JSON.stringify({ ...original, ...patch })).toString('base64url');
    expect(() => queryWorkbenchSessions(db, { limit: 1, cursor })).toThrow(
      InvalidWorkbenchSessionCursorError,
    );
  });
});
