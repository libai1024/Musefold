// StatusService（V04-CORE-04）：`musefold status` 与 /v1/health 的数据源。
// 只做轻量计数，不触网、不解密。

import type Database from 'better-sqlite3';
import { getDb } from '../db/index';
import { getDesignSchemeDb } from '../db/design-scheme';

export interface StatusSnapshot {
  prompts: number;
  /** 正式设计方案数（草稿对外不可见，延续 v0.3.2 决策） */
  formalSchemes: number;
  providers: number;
  activeProviderId: string | null;
}

export interface StatusService {
  snapshot(): StatusSnapshot;
}

interface StatusDbs {
  library: () => Database.Database;
  scheme: () => Database.Database;
}

export function createStatusService(
  dbs: StatusDbs = { library: getDb, scheme: getDesignSchemeDb },
): StatusService {
  const count = (db: Database.Database, sql: string): number => {
    const row = db.prepare(sql).get() as { c?: number } | undefined;
    return Number(row?.c ?? 0);
  };
  return {
    snapshot() {
      const library = dbs.library();
      const active = library
        .prepare('SELECT id FROM providers WHERE is_active = 1 LIMIT 1')
        .get() as { id?: string } | undefined;
      return {
        prompts: count(library, 'SELECT COUNT(*) AS c FROM prompts WHERE deleted_at IS NULL'),
        formalSchemes: count(
          dbs.scheme(),
          "SELECT COUNT(*) AS c FROM design_schemes WHERE status = 'formal'",
        ),
        providers: count(library, 'SELECT COUNT(*) AS c FROM providers'),
        activeProviderId: active?.id ?? null,
      };
    },
  };
}
