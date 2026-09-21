import type Database from 'better-sqlite3';
import { tokenizeForFts } from './fts';

const TOKENIZER_VERSION = 1;

/** SQL workspace migration 0004 could only copy raw tag names. Rebuild its derived
 * index once using the same JS tokenizer as every current write path. The marker
 * commits with all index rows; a crash or failed write leaves the repair retryable. */
export function repairPromptFtsIndex(db: Database.Database): boolean {
  const state = db.prepare('SELECT tokenizer_version FROM prompt_fts_state WHERE id=1').get() as
    | { tokenizer_version: number }
    | undefined;
  if (state?.tokenizer_version === TOKENIZER_VERSION) return false;
  if (state) throw new Error('Unsupported prompt search index version');

  db.transaction(() => {
    const fields = 'rowid,id,workspace_id,title,description,content';
    const firstPage = db
      .prepare(`SELECT ${fields} FROM prompts ORDER BY rowid LIMIT 100`)
      .safeIntegers();
    const nextPage = db
      .prepare(`SELECT ${fields} FROM prompts WHERE rowid>? ORDER BY rowid LIMIT 100`)
      .safeIntegers();
    const tags = db.prepare(`SELECT t.name FROM prompt_tags pt JOIN tags t
      ON t.workspace_id=pt.workspace_id AND t.id=pt.tag_id
      WHERE pt.workspace_id=? AND pt.prompt_id=? ORDER BY t.id`);
    const insert = db.prepare(
      'INSERT INTO prompts_fts(rowid,title,description,content,tags_index) VALUES(?,?,?,?,?)',
    );
    db.exec('DELETE FROM prompts_fts');
    let cursor: bigint | undefined;
    for (;;) {
      // SQLite cannot write while this connection has an active iterate() cursor.
      // Materialize only one keyset page, including signed 64-bit legacy rowids.
      const rows = (cursor === undefined ? firstPage.all() : nextPage.all(cursor)) as {
        rowid: bigint;
        id: string;
        workspace_id: string;
        title: string;
        description: string | null;
        content: string;
      }[];
      if (!rows.length) break;
      for (const row of rows) {
        const names = (tags.all(row.workspace_id, row.id) as { name: string }[]).map(
          (tag) => tag.name,
        );
        insert.run(
          row.rowid,
          row.title,
          row.description ?? '',
          row.content,
          tokenizeForFts(row.title, row.description, row.content, names),
        );
        cursor = row.rowid;
      }
    }
    db.prepare('INSERT INTO prompt_fts_state(id,tokenizer_version) VALUES(1,?)').run(
      TOKENIZER_VERSION,
    );
  }).immediate();
  return true;
}
