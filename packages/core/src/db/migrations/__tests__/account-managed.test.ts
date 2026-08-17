import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { up } from '../0013_account_managed';

describe('0013_account_managed', () => {
  it('adds managed_by and cost_unit while preserving legacy rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        name TEXT,
        type TEXT,
        base_url TEXT,
        model TEXT,
        has_key INTEGER,
        key_suffix TEXT,
        is_active INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE history (
        id TEXT PRIMARY KEY,
        provider_id TEXT,
        model TEXT,
        prompt_text TEXT,
        status TEXT,
        cost INTEGER,
        created_at INTEGER
      );
      INSERT INTO providers VALUES ('p1','Legacy','openai-compatible','https://x/v1','m',1,'1234',1,1,1);
      INSERT INTO history VALUES ('h1','p1','m','prompt','success',12,1);
    `);

    up(db);

    expect(db.prepare('SELECT managed_by FROM providers WHERE id = ?').get('p1')).toEqual({
      managed_by: null,
    });
    expect(db.prepare('SELECT cost_unit FROM history WHERE id = ?').get('h1')).toEqual({
      cost_unit: 'cny_cent',
    });
    const providerColumns = db.pragma('table_info(providers)') as Array<{ name: string }>;
    const historyColumns = db.pragma('table_info(history)') as Array<{ name: string }>;
    expect(providerColumns.some((column) => column.name === 'managed_by')).toBe(true);
    expect(historyColumns.some((column) => column.name === 'cost_unit')).toBe(true);
    db.close();
  });
});
