import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { up } from '../0016_cost_points';

describe('0016_cost_points', () => {
  it('converts history and audit values to user-visible points', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE history (id TEXT PRIMARY KEY, cost REAL, cost_unit TEXT);
      CREATE TABLE automation_audit (
        id INTEGER PRIMARY KEY,
        estimated_cents REAL,
        actual_cents REAL
      );
      INSERT INTO history VALUES ('managed', 60000, 'point');
      INSERT INTO history VALUES ('byok', 32, 'cny_cent');
      INSERT INTO automation_audit VALUES (1, 32, 40);
    `);

    up(db);

    expect(db.prepare('SELECT id, cost, cost_unit FROM history ORDER BY id').all()).toEqual([
      { id: 'byok', cost: 3.2, cost_unit: 'point' },
      { id: 'managed', cost: 1.2, cost_unit: 'point' },
    ]);
    expect(db.prepare('SELECT estimated_points, actual_points FROM automation_audit').get()).toEqual({
      estimated_points: 3.2,
      actual_points: 4,
    });
    db.close();
  });
});
