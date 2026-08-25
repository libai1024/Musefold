// electron/system/migrations.ts
// 迁移调度 —— user_version pragma + 启动备份 + 事务包裹

import type Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getPaths } from "../runtime";
import { up as migration_0001 } from "./migrations/0001_initial";
import { up as migration_0011 } from "./migrations/0011_remove_legacy_composer";
import { up as migration_0012 } from "./migrations/0012_automation_audit";
import { up as migration_0013 } from "./migrations/0013_account_managed";
import { up as migration_0014 } from "./migrations/0014_doubao_web_daily_usage";
import { up as migration_0015 } from "./migrations/0015_remove_recipes";
import { up as migration_0016 } from "./migrations/0016_cost_points";
import { up as migration_0017 } from "./migrations/0017_cloud_prompt_sync";
import { up as migration_0018 } from "./migrations/0018_cloud_sync_snapshot";
import { up as migration_0019 } from "./migrations/0019_cloud_sync_usage_events";
import { up as migration_0020 } from "./migrations/0020_remove_wukong_studio";

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  { version: 1, up: migration_0001 },
  { version: 11, up: migration_0011 },
  { version: 12, up: migration_0012 },
  { version: 13, up: migration_0013 },
  { version: 14, up: migration_0014 },
  { version: 15, up: migration_0015 },
  { version: 16, up: migration_0016 },
  { version: 17, up: migration_0017 },
  { version: 18, up: migration_0018 },
  { version: 19, up: migration_0019 },
  { version: 20, up: migration_0020 },
];

export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  const pending = migrations.filter((m) => m.version > current);

  if (pending.length === 0) return;

  // 升级前备份（首次建库时 db 文件尚不存在，跳过）
  const paths = getPaths();
  if (existsSync(paths.db) && current > 0) {
    if (!existsSync(paths.backups))
      mkdirSync(paths.backups, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(paths.backups, `db-${ts}.db`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  }

  // 事务包裹逐个执行
  for (const m of pending) {
    db.transaction(() => m.up(db))();
    db.pragma(`user_version = ${m.version}`);
  }
}
