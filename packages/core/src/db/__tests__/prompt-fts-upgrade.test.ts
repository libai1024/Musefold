import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';
import { closeDb, initDb } from '../index';
import { ensureAccountWorkspace, LEGACY_WORKSPACE_ID } from '../workspaces';
import { repairPromptFtsIndex } from '../prompt-fts-upgrade';

let root: string | undefined;
afterEach(() => {
  closeDb();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('managed workspace migration prompt search repair', () => {
  it('repairs multiple keyset pages and the full signed SQLite rowid range', () => {
    root = mkdtempSync(join(tmpdir(), 'musefold-fts-pages-'));
    configureTestCoreRuntime(root);
    const db = initDb();
    const add =
      db.prepare(`INSERT INTO prompts(rowid,workspace_id,id,title,content,source,created_at,updated_at)
      VALUES(?,?,?,'批量分词','原内容','manual',1,1)`);
    db.transaction(() => {
      for (let i = 0; i < 205; i++) add.run(1_000_000 + i, LEGACY_WORKSPACE_ID, `batch-${i}`);
      add.run(-9223372036854775808n, LEGACY_WORKSPACE_ID, 'min-rowid');
      add.run(9223372036854775807n, LEGACY_WORKSPACE_ID, 'max-rowid');
      db.exec('DELETE FROM prompt_fts_state');
    })();
    expect(repairPromptFtsIndex(db)).toBe(true);
    expect(
      db.prepare(`SELECT count(*) AS n FROM prompts_fts WHERE prompts_fts MATCH '"批量"'`).get(),
    ).toEqual({ n: 207 });
    expect(
      db
        .prepare('SELECT rowid FROM prompts_fts WHERE rowid IN (?,?) ORDER BY rowid')
        .safeIntegers()
        .all(-9223372036854775808n, 9223372036854775807n),
    ).toEqual([{ rowid: -9223372036854775808n }, { rowid: 9223372036854775807n }]);
  });

  it('rebuilds scoped tags atomically, retries a failed marker write, and skips completed repairs', () => {
    root = mkdtempSync(join(tmpdir(), 'musefold-fts-atomic-'));
    configureTestCoreRuntime(root);
    const db = initDb();
    const scopes: string[] = [];
    for (const [owner, name] of [
      ['fts-owner-a', '云海风景'],
      ['fts-owner-b', '山川夜色'],
    ]) {
      db.prepare(`INSERT INTO cloud_sync_accounts(owner_id,username,device_id,device_name,platform,client_version,active,enabled,created_at,updated_at)
        VALUES (?,?,?,'fixture','macos','test',0,0,1,1)`).run(owner, owner, `device-${owner}`);
      const scope = ensureAccountWorkspace(db, owner, 1);
      scopes.push(scope);
      db.prepare(`INSERT INTO prompts(workspace_id,id,title,content,source,created_at,updated_at)
        VALUES (?,'same-prompt','Scoped prompt','Unchanged body','manual',1,1)`).run(scope);
      db.prepare(`INSERT INTO tags(workspace_id,id,name,created_at) VALUES(?,'same-tag',?,1)`).run(
        scope,
        name,
      );
      db.prepare(
        `INSERT INTO prompt_tags(workspace_id,prompt_id,tag_id) VALUES(?,'same-prompt','same-tag')`,
      ).run(scope);
    }
    db.exec('DELETE FROM prompt_fts_state');
    const business = db.prepare('SELECT * FROM prompts ORDER BY rowid').all();
    const oldIndex = db.prepare('SELECT rowid,* FROM prompts_fts ORDER BY rowid').all();
    db.exec(`CREATE TEMP TRIGGER fail_fts_marker BEFORE INSERT ON prompt_fts_state
      BEGIN SELECT RAISE(ABORT,'fixture marker write failed'); END;`);
    expect(() => repairPromptFtsIndex(db)).toThrow('fixture marker write failed');
    expect(db.prepare('SELECT rowid,* FROM prompts_fts ORDER BY rowid').all()).toEqual(oldIndex);
    expect(db.prepare('SELECT * FROM prompt_fts_state').all()).toEqual([]);
    db.exec('DROP TRIGGER fail_fts_marker');
    expect(repairPromptFtsIndex(db)).toBe(true);
    expect(db.prepare('SELECT * FROM prompts ORDER BY rowid').all()).toEqual(business);
    const find = db.prepare(
      `SELECT p.workspace_id FROM prompts_fts f JOIN prompts p ON p.rowid=f.rowid WHERE prompts_fts MATCH ? ORDER BY p.workspace_id`,
    );
    expect(find.all('"云海"')).toEqual([{ workspace_id: scopes[0] }]);
    expect(find.all('"山川"')).toEqual([{ workspace_id: scopes[1] }]);
    const repaired = db.prepare('SELECT rowid,* FROM prompts_fts ORDER BY rowid').all();
    expect(repairPromptFtsIndex(db)).toBe(false);
    expect(db.prepare('SELECT rowid,* FROM prompts_fts ORDER BY rowid').all()).toEqual(repaired);
  });

  it('restores Chinese partial searches after the SQL-only workspace index rebuild', () => {
    root = mkdtempSync(join(tmpdir(), 'musefold-fts-upgrade-'));
    configureTestCoreRuntime(root);
    const db = initDb();
    db.prepare(`INSERT INTO prompts(workspace_id,id,title,content,source,created_at,updated_at)
      VALUES (?, 'fts-upgrade-prompt', '赛博朋克城市', '雨夜霓虹街景', 'manual', 1, 1)`).run(
      LEGACY_WORKSPACE_ID,
    );
    // Exactly the SQL 0004 representation: text columns survive, JS-pretokenized
    // tags_index is replaced by tag names only (empty for this prompt).
    db.prepare(`INSERT INTO prompts_fts(rowid,title,description,content,tags_index)
      SELECT rowid,title,'',content,'' FROM prompts WHERE id='fts-upgrade-prompt'`).run();
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='prompt_fts_state'").get())
      db.exec('DELETE FROM prompt_fts_state');
    const before = db.prepare("SELECT * FROM prompts WHERE id='fts-upgrade-prompt'").get();
    const find = (database: typeof db) =>
      database
        .prepare(`SELECT p.id FROM prompts_fts f
      JOIN prompts p ON p.rowid=f.rowid WHERE prompts_fts MATCH ? AND p.workspace_id=? AND p.id='fts-upgrade-prompt'`)
        .all('"赛博"', LEGACY_WORKSPACE_ID);
    expect(find(db)).toEqual([]);
    closeDb();
    const upgraded = initDb();
    expect(find(upgraded)).toEqual([{ id: 'fts-upgrade-prompt' }]);
    expect(upgraded.prepare("SELECT * FROM prompts WHERE id='fts-upgrade-prompt'").get()).toEqual(
      before,
    );
    closeDb();
    expect(find(initDb())).toEqual([{ id: 'fts-upgrade-prompt' }]);
  });
});
