import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { DESKTOP_MIGRATIONS } from '../../packages/desktop-db/src/migrations.generated';

export const sessionPackageId = 'package-upgrade-session';

export function sessionPackageFacts(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    const rows = (table: string, id: string) =>
      db.prepare(`SELECT * FROM ${table} WHERE id=?`).all(id) as Array<Record<string, unknown>>;
    const assets = rows('generated_assets', 'package-upgrade-asset');
    return {
      sessions: rows('workbench_sessions', sessionPackageId),
      drafts: db.prepare('SELECT * FROM workbench_drafts WHERE session_id=?').all(sessionPackageId),
      runs: rows('generation_runs', 'package-upgrade-run'),
      assets,
      imageHashes: assets.map((asset) =>
        createHash('sha256')
          .update(readFileSync(String(asset.media_path)))
          .digest('hex'),
      ),
      journal: db
        .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
        .all(),
      integrity: db.pragma('integrity_check'),
      foreignKeys: db.pragma('foreign_key_check'),
    };
  } finally {
    db.close();
  }
}

/** Synthetic managed prefix, not a user's historical database or a paid generation. */
export function seedSessionPackagePrefix(userData: string, count: 10 | 11) {
  const path = join(userData, 'musefold-data-v0.3.0.db');
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const imagePath = join(userData, 'session-upgrade-fixture.png');
  writeFileSync(imagePath, image);
  const db = new Database(path);
  try {
    db.exec(
      'CREATE TABLE __drizzle_migrations(id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    for (const migration of DESKTOP_MIGRATIONS.slice(0, count)) {
      for (const sql of migration.sql) db.exec(sql);
      db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)').run(
        migration.hash,
        migration.folderMillis,
      );
    }
    // Real managed databases have already completed core's frozen legacy chain.
    db.pragma('user_version = 20');
    db.pragma('foreign_keys = ON');
    const at = Date.now() - 60_000;
    db.prepare(
      'INSERT INTO workbench_sessions(id,title,created_at,updated_at,archived_at,deleted_at) VALUES (?,?,?,?,?,?)',
    ).run(sessionPackageId, '安装包升级保留会话', at, at + 1, at + 2, at + 3);
    if (count === 11)
      db.prepare('UPDATE workbench_sessions SET version=7 WHERE id=?').run(sessionPackageId);
    db.prepare('INSERT INTO workbench_drafts(session_id,draft_json,updated_at) VALUES (?,?,?)').run(
      sessionPackageId,
      JSON.stringify({
        prompt: '旧'.repeat(12_000),
        negative: '保留负面词',
        params: { aspectRatio: '7:3' },
      }),
      at + 1,
    );
    db.prepare(`INSERT INTO generation_runs(id,run_kind,workbench_session_id,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,actual_cost,created_at)
      VALUES ('package-upgrade-run','free_generation',?,'fixture-provider','fixture-model','base','final','{}','{}','success',0.25,?)`).run(
      sessionPackageId,
      at + 4,
    );
    db.prepare(`INSERT INTO generated_assets(id,run_id,position,status,media_path,mime_type,width,height,file_size,checksum,created_at)
      VALUES ('package-upgrade-asset','package-upgrade-run',0,'available',?,'image/png',1,1,?,?,?)`).run(
      imagePath,
      image.length,
      createHash('sha256').update(image).digest('hex'),
      at + 5,
    );
  } finally {
    db.close();
  }
  return { path, before: sessionPackageFacts(path), expectedVersion: count === 10 ? 1 : 7 };
}
