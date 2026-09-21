import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import Database from 'better-sqlite3';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fileDigest = (file: string) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

/** This gate takes explicit frozen backups, never the running application's database. */
export function validateBackupSource(source: string): string {
  assert(isAbsolute(source), 'An explicit absolute backup path is required');
  assert(
    /^db-(?:v25-takeover-)?\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/.test(basename(source)),
    'Only a dated application backup is permitted',
  );
  assert(
    /^musefold-backups-v[\d.]+$/.test(basename(dirname(source))),
    'Input must be in the application backup directory',
  );
  assert(
    lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(),
    'Backup must be a regular, non-symlink file',
  );
  assert(
    !existsSync(`${source}-wal`) && !existsSync(`${source}-shm`),
    'Live SQLite sidecars are not allowed',
  );
  return realpathSync(source);
}

export function validateMediaSource(source: string, roots: string[]): string {
  assert(isAbsolute(source), 'Legacy media must have an absolute path');
  assert(
    lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(),
    'Legacy media must be a regular, non-symlink file',
  );
  const canonical = realpathSync(source);
  assert(
    roots.some((root) => {
      const offset = relative(realpathSync(root), canonical);
      return (
        offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)
      );
    }),
    'Media reference is outside the explicitly authorized image roots',
  );
  return canonical;
}

type Row = Record<string, unknown>;
const primaryTables = ['prompts', 'generation_runs', 'generated_assets', 'workbench_sessions'];
const relatedTables = [
  'prompt_tags',
  'tags',
  'folders',
  'cloud_sync_accounts',
  'cloud_sync_outbox',
  'cloud_sync_conflicts',
  'cloud_sync_usage_outbox',
  'local_workspaces',
  'workbench_drafts',
];

export function snapshotBackup(db: Database.Database) {
  const present = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((row) => row.name),
  );
  for (const table of primaryTables)
    assert(present.has(table), 'Required business table is missing');
  const tables = [...primaryTables, ...relatedTables]
    .filter((table) => present.has(table))
    .map((name) => {
      const columns = (
        db.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string }[]
      ).map((column) => column.name);
      const rows = db.prepare(`SELECT * FROM ${quote(name)}`).all() as Row[];
      return { name, columns, rows };
    });
  const history = present.has('history')
    ? (db.prepare('SELECT * FROM history ORDER BY id').all() as Row[])
    : [];
  const references = present.has('history_prompt_references')
    ? (db.prepare('SELECT * FROM history_prompt_references ORDER BY sort_order').all() as Row[])
    : [];
  const terms = present.has('prompts_fts')
    ? [
        ...new Set(
          (
            db.prepare('SELECT * FROM prompts_fts').all() as {
              tags_index?: string;
              title?: string;
              content?: string;
            }[]
          ).flatMap((row) => [
            ...(row.tags_index || '').split(/\s+/).filter(Boolean).slice(0, 3),
            ...((row.title || '').match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 2),
            ...((row.content || '').match(/[\p{L}\p{N}_]+/gu) || []).slice(0, 2),
          ]),
        ),
      ]
    : [];
  const searches = terms.map((term) => {
    const query = `"${term.replaceAll('"', '""')}"`;
    const result = db
      .prepare(
        'SELECT p.id FROM prompts_fts f JOIN prompts p ON p.rowid=f.rowid WHERE prompts_fts MATCH ? ORDER BY p.id',
      )
      .all(query);
    assert(result.length > 0, 'Original FTS query must have real hits');
    return { query, resultSha256: digest(result) };
  });
  return {
    searches,
    priorLedger: present.has('__drizzle_migrations')
      ? (db
          .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
          .all() as { hash: string; created_at: number }[])
      : [],
    tables,
    history,
    references,
    legacyVersion: db.pragma('user_version', { simple: true }),
    priorMigrationCount: present.has('__drizzle_migrations')
      ? (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n
      : 0,
  };
}

/** Compare hashes only: a failed assertion must not put private prompt text into a report. */
export function verifyOriginalRows(
  db: Database.Database,
  before: ReturnType<typeof snapshotBackup>,
) {
  for (const search of before.searches) {
    const result = db
      .prepare(
        'SELECT p.id FROM prompts_fts f JOIN prompts p ON p.rowid=f.rowid WHERE prompts_fts MATCH ? ORDER BY p.id',
      )
      .all(search.query);
    assert.equal(digest(result), search.resultSha256, 'Original FTS search hits changed');
  }
  return before.tables.map(({ name, columns, rows }) => {
    const current = db
      .prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)}`)
      .all() as Row[];
    const counts = new Map<string, number>();
    for (const row of current) {
      const key = digest(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const row of rows) {
      const key = digest(row);
      assert((counts.get(key) ?? 0) > 0, `Original ${name} row/column was not preserved`);
      counts.set(key, (counts.get(key) ?? 0) - 1);
    }
    return {
      table: name,
      originalRows: rows.length,
      afterRows: current.length,
      originalRowsSha256: digest(rows.map(digest).sort()),
      preserved: true,
    };
  });
}

export function verifyHistoryBackfill(
  db: Database.Database,
  before: ReturnType<typeof snapshotBackup>,
) {
  const originalIds = new Set(
    before.tables.find((table) => table.name === 'generation_runs')?.rows.map((row) => row.id),
  );
  let runs = 0;
  let assets = 0;
  for (const history of before.history) {
    if (originalIds.has(history.id)) continue;
    const run = db.prepare('SELECT * FROM generation_runs WHERE id=?').get(history.id) as
      | Row
      | undefined;
    assert(run, 'Legacy history run was not backfilled');
    const expected = {
      user_prompt: history.prompt_text,
      negative_prompt: history.negative_text,
      actual_cost:
        history.cost === null
          ? null
          : history.cost_unit === 'cny_cent'
            ? Number(history.cost) / 100
            : history.cost,
      created_at: history.created_at,
      finished_at: history.created_at,
      status: ['success', 'failed', 'cancelled'].includes(String(history.status))
        ? history.status
        : 'failed',
    };
    assert.equal(
      digest(Object.fromEntries(Object.keys(expected).map((key) => [key, run[key]]))),
      digest(expected),
      'Backfilled history fields/cost differ',
    );
    const snapshot = JSON.parse(String(run.prompt_snapshot_json)) as Row;
    assert.equal(digest(snapshot.userPrompt), digest(history.prompt_text));
    assert.equal(
      digest(snapshot.promptReferences),
      digest(
        before.references
          .filter((row) => row.history_id === history.id)
          .map((row) => ({
            promptId: row.prompt_id,
            title: row.prompt_title,
            excerpt: row.excerpt,
            scope: row.scope,
          })),
      ),
    );
    if (history.image_path !== null && history.status === 'success') {
      const asset = db
        .prepare('SELECT media_path FROM generated_assets WHERE run_id=? AND position=0')
        .get(history.id) as Row;
      assert.equal(digest(asset?.media_path), digest(history.image_path));
      assets++;
    }
    runs++;
  }
  return { runs, assets };
}

export function createRealBackupFixture(input: string) {
  const source = validateBackupSource(input);
  const sourceHash = fileDigest(source);
  const root = mkdtempSync(join(tmpdir(), 'musefold-real-package-backup-'));
  chmodSync(root, 0o700);
  const dbPath = join(root, 'musefold-data-v0.3.0.db');
  try {
    copyFileSync(source, dbPath);
    chmodSync(dbPath, 0o600);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    let before: ReturnType<typeof snapshotBackup>;
    try {
      before = snapshotBackup(db);
      // These samples contain terminal runs only. Do not weaken preservation assertions
      // by normalizing startup recovery or importing pending paid operations.
      assert.equal(
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM generation_runs WHERE status IN ('queued','running')",
            )
            .get() as { n: number }
        ).n,
        0,
        'A backup with in-flight generation needs a separately reviewed recovery gate',
      );
    } finally {
      db.close();
    }
    return {
      root,
      dbPath,
      before,
      sourceHash,
      assertSourceUnchanged: () =>
        assert.equal(fileDigest(source), sourceHash, 'Original backup changed'),
      remove: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/** Run only after the untouched-copy migration has been proved. Relocation is test setup,
 * not a product migration: only generated_assets.media_path is changed, in a stopped copy. */
export function copyLegacyMedia(dbPath: string, root: string, authorizedRoots: string[]) {
  const pictures = join(root, 'Pictures');
  mkdirSync(pictures, { recursive: true, mode: 0o700 });
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    const rows = db
      .prepare(
        'SELECT id,media_path FROM generated_assets WHERE media_path IS NOT NULL ORDER BY id',
      )
      .all() as { id: string; media_path: string }[];
    assert(rows.length > 0, 'Real backup must contain image references');
    const mapping = new Map<
      string,
      { source: string; copied: string; sha256: string; bytes: number }
    >();
    for (const row of rows) {
      if (mapping.has(row.media_path)) continue;
      const source = validateMediaSource(row.media_path, authorizedRoots);
      const copied = join(pictures, `${mapping.size}.image`);
      const sha256 = fileDigest(source);
      copyFileSync(source, copied);
      chmodSync(copied, 0o600);
      assert.equal(fileDigest(copied), sha256, 'Copied image bytes differ');
      mapping.set(row.media_path, { source, copied, sha256, bytes: lstatSync(copied).size });
    }
    db.transaction(() => {
      const update = db.prepare(
        'UPDATE generated_assets SET media_path=? WHERE id=? AND media_path=?',
      );
      for (const row of rows) {
        const image = mapping.get(row.media_path);
        assert(image, 'Expected copied image mapping');
        assert.equal(update.run(image.copied, row.id, row.media_path).changes, 1);
      }
    })();
    const relocated = snapshotBackup(db);
    const images = [...mapping.values()];
    return {
      relocated,
      images,
      assetCount: rows.length,
      assertSourcesUnchanged: () => {
        for (const image of images)
          assert.equal(fileDigest(image.source), image.sha256, 'Original image changed');
      },
      summary: {
        assets: rows.length,
        uniqueFiles: images.length,
        bytes: images.reduce((total, image) => total + image.bytes, 0),
        byteManifestSha256: digest(images.map((image) => image.sha256).sort()),
      },
    };
  } finally {
    db.close();
  }
}
