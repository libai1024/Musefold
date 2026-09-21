import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDesignSchemeDbMigrations } from '../migrations';
import { DesignSchemeRepository } from '../repositories';
import { DesignSchemeListCursorError } from '../list-cursor';

describe('scheme SQL pagination and removed scope', () => {
  let db: Database.Database;
  let repo: DesignSchemeRepository;
  beforeEach(() => {
    db = new Database(':memory:');
    runDesignSchemeDbMigrations(db);
    repo = new DesignSchemeRepository(db);
    const insert = db.prepare(`INSERT INTO design_schemes
      (id, name, summary, status, source_presentation, current_revision_id, fidelity, created_at, updated_at, deleted_at, version)
      VALUES (?, ?, '100%_ literal', 'draft', 'musefold-created', ?, 'adapted', 10, ?, ?, ?)`);
    db.transaction(() => {
      for (let index = 0; index < 241; index++) {
        const id = `scheme_${String(index).padStart(3, '0')}`;
        insert.run(id, `ÄBC 封面 ${index}`, `revision_${index}`, 20 + (index % 3), 15, 2);
      }
      insert.run('active', 'ÄBC 封面', 'active-revision', 50, null, 1);
    })();
  });
  afterEach(() => db.close());

  it('enumerates all 241 removed rows with ties, even when each previous page is purged', () => {
    const expected = db
      .prepare(
        'SELECT id FROM design_schemes WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC, id COLLATE BINARY DESC',
      )
      .all() as Array<{ id: string }>;
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = repo.listSummaryPage({ deletedOnly: true, limit: 37, cursor });
      expect(page.items.every((item) => item.version === 2)).toBe(true);
      seen.push(...page.items.map((item) => item.id));
      for (const item of page.items)
        db.prepare('DELETE FROM design_schemes WHERE id = ?').run(item.id);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(expected.map((item) => item.id));
    expect(new Set(seen).size).toBe(241);
    expect(repo.listSummaryPage({}).items.map((item) => item.id)).toEqual(['active']);
  });

  it('keeps literal wildcard characters, Unicode folding and status filters', () => {
    expect(
      repo.listSummaryPage({ deletedOnly: true, query: 'äbc 封面', limit: 100 }).items,
    ).toHaveLength(100);
    expect(repo.listSummaryPage({ deletedOnly: true, query: '%_', limit: 100 }).items).toHaveLength(
      100,
    );
    expect(repo.listSummaryPage({ deletedOnly: true, query: '%__' }).items).toHaveLength(0);
    expect(repo.listSummaryPage({ deletedOnly: true, status: 'formal' }).items).toHaveLength(0);
    expect(repo.listSummaryPage({ deletedOnly: 'false' }).items.map((item) => item.id)).toEqual([
      'active',
    ]);
  });

  it('rejects malformed cursors and reuse after the query scope changes', () => {
    const cursor = repo.listSummaryPage({ deletedOnly: true, limit: 1 }).nextCursor;
    if (!cursor) throw new Error('Expected a second page');
    for (const query of [
      {},
      { deletedOnly: false },
      { deletedOnly: true, query: '封面' },
      { deletedOnly: true, status: 'formal' as const },
      { deletedOnly: true, fidelity: 'faithful' as const },
    ]) {
      expect(() => repo.listSummaryPage({ ...query, cursor })).toThrow(DesignSchemeListCursorError);
    }
    for (const invalid of [
      '1',
      '{}',
      `${cursor}=`,
      `${cursor}\n`,
      Buffer.from('{"version":1}').toString('base64url'),
    ]) {
      expect(() => repo.listSummaryPage({ deletedOnly: true, cursor: invalid })).toThrow(
        DesignSchemeListCursorError,
      );
    }
    expect(repo.listSummaryPage({ deletedOnly: true, limit: 100, cursor }).items).toHaveLength(100);
  });
});
