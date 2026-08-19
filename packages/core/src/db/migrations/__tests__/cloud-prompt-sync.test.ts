import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../0017_cloud_prompt_sync";
import { up as addRemoteSnapshot } from "../0018_cloud_sync_snapshot";
import { up as addUsageEvents } from "../0019_cloud_sync_usage_events";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("0017_cloud_prompt_sync", () => {
  it("creates account-isolated sync state, outbox, and conflict tables", () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    up(db);
    up(db);
    addRemoteSnapshot(db);
    addUsageEvents(db);

    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    expect([...tables]).toEqual(
      expect.arrayContaining([
        "cloud_sync_accounts",
        "cloud_entity_state",
        "cloud_sync_outbox",
        "cloud_sync_conflicts",
        "cloud_sync_usage_outbox",
      ]),
    );
    expect(
      (
        db.pragma("table_info(cloud_entity_state)") as Array<{ name: string }>
      ).map((column) => column.name),
    ).toContain("remote_snapshot_json");

    const insertAccount = db.prepare(`
      INSERT INTO cloud_sync_accounts
        (owner_id, username, device_id, device_name, platform, client_version,
         active, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'macos', '1.1.0', ?, 1, 1, 1)
    `);
    insertAccount.run("1", "one", "device-1", "Mac one", 1);
    expect(() =>
      insertAccount.run("2", "two", "device-2", "Mac two", 1),
    ).toThrow();

    db.prepare(
      `INSERT INTO cloud_sync_outbox
        (mutation_id, owner_id, entity_type, entity_id, operation,
         base_version, payload_json, created_at)
       VALUES ('mutation-1', '1', 'prompt', 'prompt-1', 'create', NULL, '{}', 1)`,
    ).run();
    expect(
      db.prepare("SELECT owner_id, operation FROM cloud_sync_outbox").get(),
    ).toEqual({ owner_id: "1", operation: "create" });
  });

  it("rejects invalid payload JSON and sync states", () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    up(db);
    db.prepare(
      `
      INSERT INTO cloud_sync_accounts
        (owner_id, username, device_id, device_name, platform, client_version,
         active, enabled, created_at, updated_at)
      VALUES ('1', 'one', 'device-1', 'Mac', 'macos', '1.1.0', 1, 1, 1, 1)
    `,
    ).run();

    expect(() =>
      db!
        .prepare(
          `INSERT INTO cloud_sync_outbox
          (mutation_id, owner_id, entity_type, entity_id, operation,
           payload_json, created_at)
         VALUES ('bad-json', '1', 'prompt', 'prompt-1', 'create', 'not-json', 1)`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db!
        .prepare(
          `INSERT INTO cloud_entity_state
          (owner_id, entity_type, local_id, cloud_id, sync_status)
         VALUES ('1', 'prompt', 'prompt-1', 'prompt-1', 'unknown')`,
        )
        .run(),
    ).toThrow();
  });
});
