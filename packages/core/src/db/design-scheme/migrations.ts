import type Database from 'better-sqlite3';
import {
  DESIGN_SCHEME_CORE_TABLES_SQL,
  DESIGN_SCHEME_DB_BOOTSTRAP_SQL,
  DESIGN_SCHEME_DB_NAMESPACE,
  DESIGN_SCHEME_EVALUATION_TABLES_SQL,
  DESIGN_SCHEME_RUN_TABLES_SQL,
  DESIGN_SCHEME_SOURCE_TABLES_SQL,
  MARKET_CANDIDATE_TABLES_SQL,
  SHARE_PACKAGE_TABLES_SQL,
} from './schema';

export interface DesignSchemeDbMigration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const designSchemeDbMigrations: DesignSchemeDbMigration[] = [
  {
    version: 1,
    name: '0001_design_scheme_domain',
    up(db) {
      db.exec(DESIGN_SCHEME_DB_BOOTSTRAP_SQL);
      db.exec(DESIGN_SCHEME_SOURCE_TABLES_SQL);
      db.exec(DESIGN_SCHEME_CORE_TABLES_SQL);
      db.exec(DESIGN_SCHEME_RUN_TABLES_SQL);
      const insertMeta = db.prepare('INSERT INTO design_scheme_meta (key, value) VALUES (?, ?)');
      insertMeta.run('namespace', DESIGN_SCHEME_DB_NAMESPACE);
      insertMeta.run('schema_version', '1');
      insertMeta.run('created_at', String(Date.now()));
    },
  },
  {
    version: 2,
    name: '0002_design_scheme_evaluations',
    up(db) {
      db.exec(DESIGN_SCHEME_EVALUATION_TABLES_SQL);
    },
  },
  {
    version: 3,
    name: '0003_market_candidates',
    up(db) {
      db.exec(MARKET_CANDIDATE_TABLES_SQL);
    },
  },
  {
    version: 4,
    name: '0004_share_packages',
    up(db) {
      db.exec(SHARE_PACKAGE_TABLES_SQL);
    },
  },
];

export function runDesignSchemeDbMigrations(
  db: Database.Database,
  migrations: ReadonlyArray<DesignSchemeDbMigration> = designSchemeDbMigrations,
): void {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0);
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const target = ordered.at(-1)?.version ?? current;

  if (current > target) {
    throw new Error(`Design scheme database schema version ${current} is newer than supported ${target}`);
  }

  for (const migration of ordered.filter((item) => item.version > current)) {
    db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT OR REPLACE INTO design_scheme_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, Date.now());
      db.prepare(
        "INSERT OR REPLACE INTO design_scheme_meta (key, value) VALUES ('schema_version', ?)",
      ).run(String(migration.version));
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}
