import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  PromptDocument,
  PromptFolder,
  PromptTag,
  SyncChange,
} from "@musefold/contracts";
import { SCHEMA_SQL } from "../../db/schema";
import { up as addCloudSync } from "../../db/migrations/0017_cloud_prompt_sync";
import { up as addUsageEvents } from "../../db/migrations/0019_cloud_sync_usage_events";
import { DesktopSyncRepository } from "../repository";

let db: Database.Database;
let repository: DesktopSyncRepository;

const ownerId = "7";
const now = "2026-08-18T10:00:00.000Z";

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  addCloudSync(db);
  addUsageEvents(db);
  repository = new DesktopSyncRepository(db);
  repository.activateAccount({
    ownerId,
    username: "libai",
    deviceId: "6f1ce4dc-5703-4bd8-9e65-c06c4f14feaa",
    deviceName: "Musefold test",
    platform: "macos",
    clientVersion: "1.1.0",
  });
  repository.setEnabled(ownerId, true);
});

afterEach(() => db.close());

function insertLocalPrompt(id = "prompt-local"): void {
  db.prepare(
    `INSERT INTO prompts(
      id, title, content, params, preview_image_path, rating, is_pinned,
      source, source_url, created_at, updated_at
    ) VALUES (?, '本地标题', '本地正文', ?, '/Users/libai/private.png', 3, 1,
      'manual', 'history://private', 1, 1)`,
  ).run(
    id,
    JSON.stringify({
      style: "clean",
      apiKey: "sk-secret",
      sourcePath: "/Users/libai/reference.png",
      nested: { imagePath: "C:\\secret\\image.png", strength: 0.8 },
    }),
  );
}

function remoteTag(version = 1): PromptTag {
  return {
    id: "tag-cloud",
    name: "海报",
    group: "用途",
    color: "#aa3300",
    version,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function remoteFolder(
  id: string,
  parentId: string | null,
  version = 1,
): PromptFolder {
  return {
    id,
    name: id,
    parentId,
    sortOrder: 0,
    version,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function remotePrompt(content: string, version: number): PromptDocument {
  return {
    id: "prompt-cloud",
    title: "云端标题",
    description: null,
    content,
    negative: null,
    folderId: null,
    tags: [remoteTag()],
    modelId: "musefold-image-pro",
    params: { style: "editorial" },
    rating: 4,
    isPinned: true,
    pinOrder: 2,
    usageCount: 5,
    lastUsedAt: now,
    source: "share",
    sourceUrl: "https://example.com/prompt",
    version,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function remoteChange(content: string, version: number): SyncChange {
  return {
    seq: String(version),
    entityType: "prompt",
    entityId: "prompt-cloud",
    operation: "upsert",
    version,
    snapshot: remotePrompt(content, version),
  };
}

describe("DesktopSyncRepository", () => {
  it("builds a cloud-safe outbox and compacts edits into one stable mutation", () => {
    insertLocalPrompt();
    expect(
      repository.enqueue(ownerId, "prompt", "prompt-local", "create"),
    ).toBe(true);
    const first = repository.listReadyMutations(ownerId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      entityType: "prompt",
      entityId: "prompt-local",
      operation: "create",
      baseVersion: null,
      payload: {
        title: "本地标题",
        content: "本地正文",
        sourceUrl: null,
        params: { style: "clean", nested: { strength: 0.8 } },
      },
    });
    const serialized = JSON.stringify(first[0]);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("C:\\");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("preview_image_path");

    db.prepare("UPDATE prompts SET content = ? WHERE id = ?").run(
      "第二次本地编辑",
      "prompt-local",
    );
    repository.enqueue(ownerId, "prompt", "prompt-local", "update");
    const compacted = repository.listReadyMutations(ownerId);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]?.mutationId).toBe(first[0]?.mutationId);
    expect(compacted[0]).toMatchObject({
      operation: "create",
      payload: { content: "第二次本地编辑" },
    });

    db.prepare("UPDATE prompts SET deleted_at = 2 WHERE id = ?").run(
      "prompt-local",
    );
    expect(
      repository.enqueue(ownerId, "prompt", "prompt-local", "delete"),
    ).toBe(false);
    expect(repository.listReadyMutations(ownerId)).toEqual([]);
  });

  it("buffers usage events while sync is disabled so enabling later does not lose history", () => {
    repository.setEnabled(ownerId, false);
    const eventId = repository.enqueueUsageEvent(ownerId, "prompt-local", "apply");
    expect(repository.listReadyUsageEvents(ownerId)).toEqual([
      { eventId, promptId: "prompt-local", action: "apply" },
    ]);
    expect(repository.getSummary().pendingMutations).toBe(1);
  });

  it("applies cloud snapshots without creating echo mutations and refreshes FTS", () => {
    repository.applyBootstrapSnapshot(ownerId, "tag", remoteTag());
    repository.applyBootstrapSnapshot(
      ownerId,
      "prompt",
      remotePrompt("来自云端的正文", 1),
    );

    expect(repository.listReadyMutations(ownerId)).toEqual([]);
    expect(
      db
        .prepare(
          `SELECT title, content, preview_image_path, is_pinned, pin_order, source
         FROM prompts WHERE id = 'prompt-cloud'`,
        )
        .get(),
    ).toEqual({
      title: "云端标题",
      content: "来自云端的正文",
      preview_image_path: null,
      is_pinned: 1,
      pin_order: 2,
      source: "shared",
    });
    expect(
      db
        .prepare(
          `SELECT count(*) AS value FROM prompts_fts
         WHERE prompts_fts MATCH '云端'`,
        )
        .get(),
    ).toEqual({ value: 1 });
    expect(repository.getSummary()).toMatchObject({
      status: "idle",
      pendingMutations: 0,
      conflicts: 0,
    });
  });

  it("keeps bootstrap collisions as conflicts instead of seeding an overwrite", () => {
    insertLocalPrompt("prompt-cloud");
    repository.applyBootstrapSnapshot(
      ownerId,
      "prompt",
      remotePrompt("云端不同正文", 1),
    );

    expect(repository.listConflicts(ownerId)).toHaveLength(1);
    expect(repository.seedUnsyncedEntities(ownerId)).toBe(0);
    expect(repository.listReadyMutations(ownerId)).toEqual([]);
    expect(
      db.prepare("SELECT content FROM prompts WHERE id = 'prompt-cloud'").get(),
    ).toEqual({ content: "本地正文" });
  });

  it("restores folder and tag relations after cloud tombstones", () => {
    const parent = remoteFolder("folder-parent", null);
    const child = remoteFolder("folder-child", parent.id);
    repository.applyBootstrapSnapshot(ownerId, "folder", parent);
    repository.applyBootstrapSnapshot(ownerId, "folder", child);
    repository.applyBootstrapSnapshot(ownerId, "tag", remoteTag());
    repository.applyBootstrapSnapshot(ownerId, "prompt", {
      ...remotePrompt("关联正文", 1),
      folderId: parent.id,
    });

    repository.applyRemoteChange(ownerId, {
      seq: "2",
      entityType: "folder",
      entityId: parent.id,
      operation: "delete",
      version: 2,
      snapshot: { ...parent, version: 2, deletedAt: now },
    });
    repository.applyRemoteChange(ownerId, {
      seq: "3",
      entityType: "tag",
      entityId: "tag-cloud",
      operation: "delete",
      version: 2,
      snapshot: { ...remoteTag(2), deletedAt: now },
    });

    expect(
      db
        .prepare("SELECT parent_id FROM folders WHERE id = 'folder-child'")
        .get(),
    ).toEqual({
      parent_id: null,
    });
    expect(
      db
        .prepare("SELECT folder_id FROM prompts WHERE id = 'prompt-cloud'")
        .get(),
    ).toEqual({
      folder_id: null,
    });
    expect(
      db.prepare("SELECT count(*) AS value FROM prompt_tags").get(),
    ).toEqual({
      value: 0,
    });

    repository.applyRemoteChange(ownerId, {
      seq: "4",
      entityType: "folder",
      entityId: parent.id,
      operation: "upsert",
      version: 3,
      snapshot: { ...parent, version: 3 },
    });
    repository.applyRemoteChange(ownerId, {
      seq: "5",
      entityType: "tag",
      entityId: "tag-cloud",
      operation: "upsert",
      version: 3,
      snapshot: remoteTag(3),
    });

    expect(
      db
        .prepare("SELECT parent_id FROM folders WHERE id = 'folder-child'")
        .get(),
    ).toEqual({
      parent_id: parent.id,
    });
    expect(
      db
        .prepare("SELECT folder_id FROM prompts WHERE id = 'prompt-cloud'")
        .get(),
    ).toEqual({
      folder_id: parent.id,
    });
    expect(
      db.prepare("SELECT prompt_id, tag_id FROM prompt_tags").get(),
    ).toEqual({
      prompt_id: "prompt-cloud",
      tag_id: "tag-cloud",
    });
  });

  it("preserves both snapshots during a conflict and supports all prompt resolutions", () => {
    repository.applyBootstrapSnapshot(ownerId, "tag", remoteTag());
    repository.applyBootstrapSnapshot(
      ownerId,
      "prompt",
      remotePrompt("共同基线", 1),
    );
    db.prepare(
      "UPDATE prompts SET content = '本地修改' WHERE id = 'prompt-cloud'",
    ).run();
    repository.enqueue(ownerId, "prompt", "prompt-cloud", "update");
    repository.applyRemoteChange(ownerId, remoteChange("云端修改", 2));

    let [conflict] = repository.listConflicts(ownerId);
    expect(conflict).toMatchObject({
      entityId: "prompt-cloud",
      baseVersion: 1,
      localSnapshot: { content: "本地修改" },
      remoteSnapshot: { content: "云端修改", version: 2 },
    });
    expect(repository.getSummary().status).toBe("conflict");

    repository.resolveConflict(ownerId, conflict!.id, "remote");
    expect(
      db.prepare("SELECT content FROM prompts WHERE id = 'prompt-cloud'").get(),
    ).toEqual({ content: "云端修改" });
    expect(repository.listReadyMutations(ownerId)).toEqual([]);

    db.prepare(
      "UPDATE prompts SET content = '再次本地修改' WHERE id = 'prompt-cloud'",
    ).run();
    repository.enqueue(ownerId, "prompt", "prompt-cloud", "update");
    repository.applyRemoteChange(ownerId, remoteChange("再次云端修改", 3));
    [conflict] = repository.listConflicts(ownerId);
    repository.resolveConflict(ownerId, conflict!.id, "local");
    expect(
      db.prepare("SELECT content FROM prompts WHERE id = 'prompt-cloud'").get(),
    ).toEqual({ content: "再次本地修改" });
    expect(repository.listReadyMutations(ownerId)[0]).toMatchObject({
      operation: "update",
      baseVersion: 3,
      payload: { content: "再次本地修改" },
    });

    repository.applyPushResult(
      ownerId,
      repository.listReadyMutations(ownerId)[0]!,
      {
        mutationId: repository.listReadyMutations(ownerId)[0]!.mutationId,
        status: "applied",
        version: 4,
        snapshot: remotePrompt("再次本地修改", 4),
        errorCode: null,
      },
    );
    db.prepare(
      "UPDATE prompts SET content = '要保留的本地版本' WHERE id = 'prompt-cloud'",
    ).run();
    repository.enqueue(ownerId, "prompt", "prompt-cloud", "update");
    repository.applyRemoteChange(ownerId, remoteChange("云端最终版本", 5));
    [conflict] = repository.listConflicts(ownerId);
    repository.resolveConflict(ownerId, conflict!.id, "duplicate");

    const copies = db
      .prepare(
        "SELECT id, title, content FROM prompts WHERE title LIKE '%本地副本%'",
      )
      .all() as Array<{ id: string; title: string; content: string }>;
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ content: "要保留的本地版本" });
    expect(repository.listReadyMutations(ownerId)).toContainEqual(
      expect.objectContaining({
        entityId: copies[0]!.id,
        operation: "create",
      }),
    );
  });

  it("commits a pull page and cursor atomically", () => {
    const invalidChild: SyncChange = {
      seq: "9",
      entityType: "folder",
      entityId: "child-without-parent",
      operation: "upsert",
      version: 1,
      snapshot: {
        id: "child-without-parent",
        name: "缺少父级",
        parentId: "missing-parent",
        sortOrder: 1,
        version: 1,
        createdAt: "invalid-date",
        updatedAt: now,
        deletedAt: null,
      },
    };

    expect(() =>
      repository.applyPullPage(ownerId, [invalidChild], "9"),
    ).toThrow();
    expect(repository.getActiveAccount()?.cursor).toBe("0");
    expect(
      db
        .prepare("SELECT id FROM folders WHERE id = 'child-without-parent'")
        .get(),
    ).toBeUndefined();
  });
});
