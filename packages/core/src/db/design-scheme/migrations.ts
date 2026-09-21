import type Database from 'better-sqlite3';
import { DESIGN_SCHEME_PURGE_CLEANUP_SQL, DESIGN_SCHEME_PURGE_TABLES_SQL } from './purge-schema';
import {
  DESIGN_SCHEME_CLOUD_RUN_ASSET_SQL,
  DESIGN_SCHEME_CORE_TABLES_SQL,
  DESIGN_SCHEME_DB_BOOTSTRAP_SQL,
  DESIGN_SCHEME_DB_NAMESPACE,
  DESIGN_SCHEME_EVALUATION_TABLES_SQL,
  DESIGN_SCHEME_IMPORT_GC_TABLES_SQL,
  DESIGN_SCHEME_METADATA_COLUMNS_SQL,
  DESIGN_SCHEME_RUN_TABLES_SQL,
  DESIGN_SCHEME_SOURCE_TABLES_SQL,
  DESIGN_SCHEME_UPLOADED_ASSET_ORIGIN_SQL,
  MARKET_CANDIDATE_TABLES_SQL,
  SHARE_PACKAGE_TABLES_SQL,
  DESIGN_SCHEME_VERSION_TABLES_SQL,
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
  {
    version: 5,
    name: '0005_design_scheme_version',
    up(db) {
      db.exec(DESIGN_SCHEME_VERSION_TABLES_SQL);
    },
  },
  {
    version: 6,
    name: '0006_asset_and_source_file_metadata',
    up(db) {
      db.exec(DESIGN_SCHEME_METADATA_COLUMNS_SQL);
    },
  },
  {
    version: 7,
    name: '0007_uploaded_asset_origin',
    up(db) {
      db.exec(DESIGN_SCHEME_UPLOADED_ASSET_ORIGIN_SQL);
    },
  },
  {
    version: 8,
    name: '0008_cloud_run_assets',
    up(db) {
      db.exec(DESIGN_SCHEME_CLOUD_RUN_ASSET_SQL);
    },
  },
  {
    version: 9,
    name: '0009_import_gc_intents',
    up(db) {
      db.exec(DESIGN_SCHEME_IMPORT_GC_TABLES_SQL);
    },
  },
  {
    version: 10,
    name: '0010_scheme_purge_receipts',
    up(db) {
      db.exec(DESIGN_SCHEME_PURGE_TABLES_SQL);
      const foreignKeyErrors = db.pragma('foreign_key_check');
      if (!Array.isArray(foreignKeyErrors) || foreignKeyErrors.length > 0) {
        throw new Error('Design scheme purge migration violated foreign keys');
      }
    },
  },
  {
    version: 11,
    name: '0011_scheme_asset_cleanup',
    up(db) {
      db.exec(DESIGN_SCHEME_PURGE_CLEANUP_SQL);
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
    throw new Error(
      `Design scheme database schema version ${current} is newer than supported ${target}`,
    );
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
