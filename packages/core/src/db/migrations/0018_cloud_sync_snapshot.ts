import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  const columns = db.pragma("table_info(cloud_entity_state)") as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === "remote_snapshot_json")) return;
  db.exec(`
    ALTER TABLE cloud_entity_state
    ADD COLUMN remote_snapshot_json TEXT
      CHECK (remote_snapshot_json IS NULL OR json_valid(remote_snapshot_json));
  `);
}
