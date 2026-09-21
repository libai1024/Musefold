import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import Database from 'better-sqlite3';
import { designSchemeDbPath } from './electron-helpers';

/** No inserts or trial seeding: inspect persisted imports and their actual managed bytes. */
export function desktopImportSnapshot(userData: string, includeText = true) {
  const db = new Database(designSchemeDbPath(userData), { readonly: true });
  try {
    const tables = [
      'design_schemes',
      'design_scheme_revisions',
      'source_packages',
      'source_snapshots',
      'source_files',
      'design_scheme_source_bindings',
      'design_scheme_assets',
      'design_scheme_runs',
    ];
    const canonical: Record<string, unknown[]> = {};
    for (const table of tables) {
      canonical[table] = db
        .prepare(`SELECT * FROM ${table}`)
        .all()
        .map((value) => {
          const row = value as Record<string, unknown>;
          if (!includeText && typeof row.text_content === 'string')
            row.text_content = {
              bytes: Buffer.byteLength(row.text_content),
              sha256: createHash('sha256').update(row.text_content).digest('hex'),
            };
          return row;
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    const rows = db
      .prepare('SELECT snapshot_id,path,kind,content_hash,store_key,text_content FROM source_files')
      .all() as Array<{
      snapshot_id: string;
      path: string;
      kind: string;
      content_hash: string;
      store_key: string | null;
      text_content: string | null;
    }>;
    const content = rows.map((row) => {
      const bytes =
        row.text_content !== null
          ? Buffer.from(row.text_content)
          : row.store_key
            ? readFileSync(
                isAbsolute(row.store_key) ? row.store_key : join(userData, row.store_key),
              )
            : null;
      return {
        snapshotId: row.snapshot_id,
        path: row.path,
        kind: row.kind,
        expectedHash: row.content_hash,
        hash: bytes ? createHash('sha256').update(bytes).digest('hex') : null,
        bytes: bytes?.length ?? null,
        text: includeText && bytes && row.kind === 'text' ? bytes.toString('utf8') : null,
      };
    });
    return { canonical, content };
  } finally {
    db.close();
  }
}
