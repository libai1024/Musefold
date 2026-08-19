import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { runner } from "node-pg-migrate";
import { runMigrations } from "graphile-worker";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DatabaseRuntime,
  GenerationEventNotifier,
} from "../database/runtime.js";
import { SessionStore } from "../modules/account/session-store.js";
import { AccountCredentialStore } from "../modules/account/credential-store.js";
import { PromptService } from "../modules/prompts/service.js";
import { SyncService } from "../modules/sync/service.js";
import { WorkbenchService } from "../modules/workbench/service.js";
import { GenerationService } from "../modules/generation/service.js";
import { PostgresRateLimiter } from "../modules/rate-limit/service.js";
import { OAuthService } from "../modules/oauth/service.js";

const databaseTests =
  process.env.RUN_DATABASE_TESTS === "true" ? describe : describe.skip;
const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

databaseTests("PostgreSQL foundation", () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: Pool;
  let appPool: Pool;
  let appUrl: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("musefold")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();

    const adminUrl = container.getConnectionUri();
    adminPool = new Pool({ connectionString: adminUrl });
    await adminPool.query(`
      CREATE ROLE musefold_app LOGIN PASSWORD 'musefold_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      CREATE ROLE musefold_worker LOGIN PASSWORD 'musefold_worker' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT CONNECT ON DATABASE musefold TO musefold_app, musefold_worker;
      GRANT CREATE ON DATABASE musefold TO musefold_worker;
    `);
    await runMigrations({
      connectionString: withCredentials(
        adminUrl,
        "musefold_worker",
        "musefold_worker",
      ),
    });
    await runner({
      databaseUrl: adminUrl,
      dir: migrationsDir,
      direction: "up",
      migrationsTable: "pgmigrations",
    });
    appUrl = withCredentials(adminUrl, "musefold_app", "musefold_app");
    appPool = new Pool({ connectionString: appUrl });
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await adminPool?.end();
    await container?.stop();
  }, 60_000);

  it("keeps owner records isolated by request-scoped database context", async () => {
    await adminPool.query(`
      INSERT INTO app.cloud_accounts(owner_id, username_snapshot)
      VALUES (101, 'one'), (202, 'two')
    `);

    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.owner_id', '101', true)");
      const visible = await client.query<{ owner_id: string }>(
        "SELECT owner_id::text FROM app.cloud_accounts ORDER BY owner_id",
      );
      expect(visible.rows.map((row) => row.owner_id)).toEqual(["101"]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const unscoped = await appPool.query(
      "SELECT count(*)::int AS count FROM app.cloud_accounts",
    );
    expect(unscoped.rows[0].count).toBe(0);
  });

  it("creates the expected schemas, extension and migration ledger", async () => {
    const result = await adminPool.query<{ schema_name: string }>(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name IN ('app', 'auth', 'ops')
      ORDER BY schema_name
    `);
    expect(result.rows.map((row) => row.schema_name)).toEqual([
      "app",
      "auth",
      "ops",
    ]);
    const migrations = await adminPool.query<{ name: string }>(
      "SELECT name FROM pgmigrations ORDER BY name",
    );
    expect(migrations.rows.map((row) => row.name)).toEqual([
      "000001_foundation",
      "000002_session_functions",
      "000003_prompt_library",
      "000004_sync_devices",
      "000005_sync_retention",
      "000006_account_credentials",
      "000007_workbench_generations",
      "000008_fix_enqueue_generation",
      "000009_cloud_mcp",
      "000010_oidc_provider",
      "000011_rate_limits",
      "000012_mcp_spend_hardening",
      "000013_generation_events_notify",
    ]);
  });

  it("notifies the generation event channel after durable event inserts", async () => {
    const result = await adminPool.query<{ trigger_name: string }>(`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_schema = 'app'
        AND event_object_table = 'generation_events'
        AND trigger_name = 'generation_events_notify_trigger'
    `);
    expect(result.rows.map((row) => row.trigger_name)).toEqual([
      "generation_events_notify_trigger",
    ]);
  });

  it("wakes a listener after the event transaction commits", async () => {
    const runId = "integration-notify-run";
    const client = await appPool.connect();
    const notifier = new GenerationEventNotifier(appUrl);
    try {
      await notifier.start();
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.owner_id', '101', true)");
      await client.query(
        `INSERT INTO app.workbench_sessions(owner_id, id, title)
         VALUES (101, 'integration-notify-session', '通知测试')`,
      );
      await client.query(
        `INSERT INTO app.generation_runs(
           owner_id, id, session_id, request, status, idempotency_key
         ) VALUES (101, $1, 'integration-notify-session', '{"prompt":"notify"}', 'queued', $2)`,
        [runId, "integration-notify-key"],
      );
      const waiting = notifier.wait(101, runId, 0, 2_000);
      await client.query(
        `INSERT INTO app.generation_events(owner_id, run_id, event_type)
         VALUES (101, $1, 'generation.requested')`,
        [runId],
      );
      await client.query("COMMIT");
      await expect(waiting).resolves.toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await notifier.close();
    }
  });

  it("enforces rate limits atomically across concurrent API requests", async () => {
    const runtime = new DatabaseRuntime({
      DATABASE_URL: appUrl,
      DATABASE_MAX_CONNECTIONS: 10,
    });
    try {
      const limiter = new PostgresRateLimiter(
        runtime.db,
        "integration-rate-limit-secret",
      );
      const attempts = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          limiter.assertAllowed("integration", "same-subject", {
            capacity: 3,
            refillPerSecond: 1 / 3_600,
          }),
        ),
      );
      const allowed = attempts.filter(
        (attempt) => attempt.status === "fulfilled",
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === "rejected",
      );
      expect(allowed).toHaveLength(3);
      expect(rejected).toHaveLength(9);
      for (const attempt of rejected) {
        if (attempt.status !== "rejected") continue;
        expect(attempt.reason).toMatchObject({
          code: "RATE_LIMITED",
          statusCode: 429,
          details: {
            retryAfterSeconds: expect.any(Number),
            remaining: 0,
          },
        });
      }

      const stored = await adminPool.query<{
        key_hash: string;
        tokens: number;
      }>(
        "SELECT key_hash, tokens FROM ops.rate_limit_buckets ORDER BY updated_at DESC LIMIT 1",
      );
      expect(stored.rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0]?.key_hash).not.toContain("same-subject");
      expect(stored.rows[0]?.tokens).toBeLessThan(1);
    } finally {
      await runtime.close();
    }
  });

  it("stores only encrypted opaque Web sessions through narrow auth functions", async () => {
    const runtime = new DatabaseRuntime({
      DATABASE_URL: appUrl,
      DATABASE_MAX_CONNECTIONS: 2,
    });
    try {
      const store = new SessionStore(runtime.db, {
        SESSION_ENCRYPTION_KEY: "integration-test-session-key",
        SESSION_IDLE_TTL_SECONDS: 604_800,
        SESSION_ABSOLUTE_TTL_SECONDS: 2_592_000,
      });
      const created = await store.create({
        ownerId: 101,
        username: "one",
        credentials: {
          accessToken: "jwt-secret",
          refreshToken: "refresh-secret",
        },
        accessExpiresAt: new Date(Date.now() + 300_000),
      });
      expect(created.rawId).toHaveLength(43);
      await expect(store.get(created.rawId)).resolves.toMatchObject({
        ownerId: 101,
        credentials: {
          accessToken: "jwt-secret",
          refreshToken: "refresh-secret",
        },
      });
      await store.revoke(created.rawId);
      await expect(store.get(created.rawId)).resolves.toBeNull();

      const credentials = new AccountCredentialStore(runtime.db, {
        SESSION_ENCRYPTION_KEY: "integration-test-session-key",
      });
      await credentials.put(101, { apiKey: "sk-generation-secret" }, 73);
      await expect(credentials.get(101)).resolves.toEqual({
        apiKey: "sk-generation-secret",
      });
      const persisted = await adminPool.query<{ plaintext: string }>(`
        SELECT encode(credential_ciphertext, 'escape') AS plaintext
        FROM auth.account_credentials WHERE owner_id = 101
      `);
      expect(persisted.rows[0]?.plaintext).not.toContain(
        "sk-generation-secret",
      );
    } finally {
      await runtime.close();
    }
  });

  it("isolates prompt aggregates and records versioned changes in the same owner context", async () => {
    const runtime = new DatabaseRuntime({
      DATABASE_URL: appUrl,
      DATABASE_MAX_CONNECTIONS: 4,
    });
    try {
      const prompts = new PromptService(runtime.db);
      const folder = await prompts.createFolder(101, {
        name: "海报",
        parentId: null,
        sortOrder: 0,
      });
      const tag = await prompts.createTag(101, {
        name: "商业",
        group: null,
        color: "#33aa66",
      });
      const created = await prompts.createPrompt(101, {
        title: "咖啡机产品图",
        description: null,
        content: "一台咖啡机，干净的商业摄影布光",
        negative: null,
        folderId: folder.id,
        tagIds: [tag.id],
        modelId: null,
        params: { aspectRatio: "4:3" },
        rating: 4,
        isPinned: true,
        source: "manual",
        sourceUrl: null,
      });
      const linkCount = await adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.prompt_tag_links WHERE owner_id = $1 AND prompt_id = $2",
        [101, created.id],
      );
      expect(linkCount.rows[0]?.count).toBe("1");

      await expect(prompts.getPrompt(202, created.id)).rejects.toMatchObject({
        code: "PROMPT_NOT_FOUND",
      });
      const updated = await prompts.updatePrompt(101, created.id, {
        expectedVersion: created.version,
        title: "咖啡机产品主图",
      });
      expect(updated).toMatchObject({
        version: 2,
        title: "咖啡机产品主图",
        tags: [{ id: tag.id }],
      });
      await expect(
        prompts.updatePrompt(101, created.id, {
          expectedVersion: created.version,
          title: "过期更新",
        }),
      ).rejects.toMatchObject({
        code: "PROMPT_VERSION_CONFLICT",
        statusCode: 409,
      });

      const firstUse = await prompts.usePrompt(101, created.id, {
        action: "copy",
        idempotencyKey: "test-use-event-0001",
      });
      const repeatedUse = await prompts.usePrompt(101, created.id, {
        action: "copy",
        idempotencyKey: "test-use-event-0001",
      });
      expect(firstUse).toMatchObject({
        recorded: true,
        prompt: { usageCount: 1 },
      });
      expect(repeatedUse).toMatchObject({
        recorded: false,
        prompt: { usageCount: 1 },
      });

      const page = await prompts.listPrompts(101, {
        q: "咖啡机",
        limit: 20,
        includeDeleted: false,
        sort: "updated-desc",
      });
      expect(page.items.map((prompt) => prompt.id)).toContain(created.id);

      const client = await appPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.owner_id', '101', true)");
        const changes = await client.query<{
          entity_type: string;
          entity_version: number;
        }>(
          "SELECT entity_type, entity_version FROM app.sync_changes ORDER BY seq",
        );
        expect(changes.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              entity_type: "folder",
              entity_version: 1,
            }),
            expect.objectContaining({ entity_type: "tag", entity_version: 1 }),
            expect.objectContaining({
              entity_type: "prompt",
              entity_version: 2,
            }),
          ]),
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    } finally {
      await runtime.close();
    }
  });

  it("supports device registration, idempotent push, pull and bootstrap", async () => {
    const runtime = new DatabaseRuntime({
      DATABASE_URL: appUrl,
      DATABASE_MAX_CONNECTIONS: 6,
    });
    try {
      const prompts = new PromptService(runtime.db);
      const sync = new SyncService(runtime.db, prompts);
      const deviceId = "3a38c4d1-4f7c-4f7b-9a1d-0d1d7a6c4e21";
      await expect(
        sync.registerDevice(202, {
          deviceId,
          name: "测试 Mac",
          platform: "macos",
          clientVersion: "1.1.0",
        }),
      ).resolves.toMatchObject({ deviceId, revoked: false });

      const mutation = {
        mutationId: "01JTESTSYNC000000000000001",
        entityType: "prompt" as const,
        entityId: "01JTESTPROMPT00000000000001",
        operation: "create" as const,
        baseVersion: null,
        payload: {
          title: "同步提示词",
          description: null,
          content: "一张明亮的产品海报",
          negative: null,
          folderId: null,
          tagIds: [],
          modelId: null,
          params: null,
          rating: 0,
          isPinned: false,
          source: "import" as const,
          sourceUrl: null,
        },
      };
      const applied = await sync.push(202, deviceId, [mutation]);
      expect(applied.results[0]).toMatchObject({
        mutationId: mutation.mutationId,
        status: "applied",
        version: 1,
      });
      const duplicate = await sync.push(202, deviceId, [mutation]);
      expect(duplicate.results[0]).toMatchObject({
        mutationId: mutation.mutationId,
        status: "duplicate",
        version: 1,
      });

      const concurrentMutation = {
        ...mutation,
        mutationId: "01JTESTSYNC000000000000002",
        entityId: "01JTESTPROMPT00000000000002",
        payload: { ...mutation.payload, title: "并发同步提示词" },
      };
      const concurrentResults = await Promise.all([
        sync.push(202, deviceId, [concurrentMutation]),
        sync.push(202, deviceId, [concurrentMutation]),
      ]);
      expect(
        concurrentResults.map((result) => result.results[0]?.status).sort(),
      ).toEqual(["applied", "duplicate"]);
      const concurrentRows = await adminPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM app.prompts
         WHERE owner_id = 202 AND id = $1`,
        [concurrentMutation.entityId],
      );
      const concurrentReceipts = await adminPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM app.sync_mutations
         WHERE owner_id = 202 AND device_id = $1 AND mutation_id = $2`,
        [deviceId, concurrentMutation.mutationId],
      );
      expect(concurrentRows.rows[0]?.count).toBe("1");
      expect(concurrentReceipts.rows[0]?.count).toBe("1");

      const folderId = "01JTESTFOLDER00000000000001";
      const tagId = "01JTESTTAG0000000000000001";
      const relatedPromptId = "01JTESTRELATEDPROMPT0000001";
      const childFolderId = "01JTESTCHILDFOLDER000000001";
      const restored = await sync.push(202, deviceId, [
        {
          mutationId: "01JTESTSYNCFOLDERCREATE00001",
          entityType: "folder",
          entityId: folderId,
          operation: "create",
          baseVersion: null,
          payload: { name: "云同步目录", parentId: null, sortOrder: 0 },
        },
        {
          mutationId: "01JTESTSYNCTAGCREATE0000001",
          entityType: "tag",
          entityId: tagId,
          operation: "create",
          baseVersion: null,
          payload: { name: "云标签", group: null, color: null },
        },
        {
          mutationId: "01JTESTSYNCCHILDCREATE000001",
          entityType: "folder",
          entityId: childFolderId,
          operation: "create",
          baseVersion: null,
          payload: { name: "云同步子目录", parentId: folderId, sortOrder: 0 },
        },
        {
          mutationId: "01JTESTSYNCRELATEDCREATE0001",
          entityType: "prompt",
          entityId: relatedPromptId,
          operation: "create",
          baseVersion: null,
          payload: {
            ...mutation.payload,
            title: "关系同步提示词",
            folderId,
            tagIds: [tagId],
          },
        },
      ]);
      expect(restored.results.map((result) => result.status)).toEqual([
        "applied",
        "applied",
        "applied",
        "applied",
      ]);
      const deletedRelations = await sync.push(202, deviceId, [
        {
          mutationId: "01JTESTSYNCFOLDERDELETE00001",
          entityType: "folder",
          entityId: folderId,
          operation: "delete",
          baseVersion: 1,
          payload: {},
        },
        {
          mutationId: "01JTESTSYNCTAGDELETE0000001",
          entityType: "tag",
          entityId: tagId,
          operation: "delete",
          baseVersion: 1,
          payload: {},
        },
      ]);
      expect(deletedRelations.results).toEqual([
        expect.objectContaining({ status: "applied", version: 2 }),
        expect.objectContaining({ status: "applied", version: 2 }),
      ]);
      const restoredRelations = await sync.push(202, deviceId, [
        {
          mutationId: "01JTESTSYNCFOLDERRESTORE001",
          entityType: "folder",
          entityId: folderId,
          operation: "restore",
          baseVersion: 2,
          payload: {},
        },
        {
          mutationId: "01JTESTSYNCTAGRESTORE00001",
          entityType: "tag",
          entityId: tagId,
          operation: "restore",
          baseVersion: 2,
          payload: {},
        },
      ]);
      expect(restoredRelations.results).toEqual([
        expect.objectContaining({
          status: "applied",
          version: 3,
          snapshot: expect.objectContaining({ deletedAt: null }),
        }),
        expect.objectContaining({
          status: "applied",
          version: 3,
          snapshot: expect.objectContaining({ deletedAt: null }),
        }),
      ]);
      await expect(
        prompts.getPrompt(202, relatedPromptId),
      ).resolves.toMatchObject({
        folderId: null,
        tags: [],
        version: 3,
      });
      await expect(
        prompts.getFolder(202, childFolderId),
      ).resolves.toMatchObject({
        parentId: null,
        version: 2,
      });

      const pulled = await sync.pull(202, "0", 20, deviceId);
      expect(pulled.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entityType: "prompt",
            entityId: mutation.entityId,
            operation: "upsert",
            version: 1,
          }),
        ]),
      );
      await expect(sync.status(202, deviceId)).resolves.toMatchObject({
        device: { lastPullCursor: pulled.nextCursor },
      });
      const usageEvent = {
        eventId: "01JTESTUSAGEEVENT0000000001",
        promptId: mutation.entityId,
        action: "apply" as const,
      };
      await expect(sync.pushUsage(202, deviceId, [usageEvent])).resolves.toEqual({
        results: [
          { eventId: usageEvent.eventId, status: "applied", errorCode: null },
        ],
      });
      await expect(sync.pushUsage(202, deviceId, [usageEvent])).resolves.toEqual({
        results: [
          { eventId: usageEvent.eventId, status: "duplicate", errorCode: null },
        ],
      });
      await expect(prompts.getPrompt(202, mutation.entityId)).resolves.toMatchObject({
        usageCount: 1,
      });
      const bootstrapped = await sync.bootstrap(202, "prompt", undefined, 20);
      expect(bootstrapped.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: mutation.entityId,
            content: "一张明亮的产品海报",
          }),
        ]),
      );
      await expect(sync.status(101, deviceId)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(sync.status(202, deviceId)).resolves.toMatchObject({
        serverCursor: expect.any(String),
        device: { deviceId },
      });

      await adminPool.query(
        "UPDATE app.sync_devices SET revoked_at = now() WHERE owner_id = $1 AND id = $2",
        [202, deviceId],
      );
      await expect(sync.pull(202, pulled.nextCursor, 20, deviceId)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      await expect(sync.push(202, deviceId, [mutation])).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    } finally {
      await runtime.close();
    }
  });

  it("persists workbench drafts with optimistic concurrency and owner isolation", async () => {
    const runtime = new DatabaseRuntime({
      DATABASE_URL: appUrl,
      DATABASE_MAX_CONNECTIONS: 4,
    });
    try {
      const service = new WorkbenchService(runtime.db);
      const created = await service.create(101, {
        title: "产品海报工作台",
        draft: {
          prompt: "初始草稿",
          negative: "",
          params: { quality: "medium" },
          promptReferenceIds: [],
        },
      });
      await expect(service.get(202, created.id)).rejects.toMatchObject({
        code: "WORKBENCH_SESSION_NOT_FOUND",
      });
      const updated = await service.update(101, created.id, {
        expectedVersion: created.version,
        draft: {
          prompt: "新的草稿",
          negative: "水印",
          params: { quality: "high" },
          promptReferenceIds: [],
        },
      });
      expect(updated).toMatchObject({
        version: 2,
        draft: { prompt: "新的草稿" },
      });
      await expect(
        service.update(101, created.id, {
          expectedVersion: created.version,
          title: "过期标题",
        }),
      ).rejects.toMatchObject({
        code: "WORKBENCH_VERSION_CONFLICT",
        statusCode: 409,
      });
      const removed = await service.remove(101, created.id, updated.version);
      expect(removed.deletedAt).not.toBeNull();
      const restored = await service.restore(101, created.id, removed.version);
      expect(restored).toMatchObject({ version: 4, deletedAt: null });
    } finally {
      await runtime.close();
    }
  });

  it("creates one queued generation per idempotency key and enqueues the fixed task", async () => {
    const runtime = new DatabaseRuntime({
      DATABASE_URL: appUrl,
      DATABASE_MAX_CONNECTIONS: 6,
    });
    try {
      const workbench = new WorkbenchService(runtime.db);
      const session = await workbench.create(101, {
        title: "生图测试",
        draft: {},
      });
      const signer = {
        sign: vi.fn(async (objectKey: string) => ({
          url: `https://assets.example/${objectKey}`,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        })),
      };
      const generations = new GenerationService(
        runtime.db,
        signer,
        "integration-approval-secret",
      );
      const input = {
        prompt: "一张极简产品海报",
        size: "1024x1024" as const,
        aspectRatio: "1:1",
        quality: "medium" as const,
        count: 1 as const,
        sessionId: session.id,
      };
      const first = await generations.create(
        101,
        input,
        "generation-idempotency-0001",
      );
      const repeated = await generations.create(
        101,
        input,
        "generation-idempotency-0001",
      );
      expect(first).toMatchObject({
        status: "queued",
        sessionId: session.id,
        actorType: "web",
      });
      const assetId = `asset-${first.id}`;
      await adminPool.query(
        `INSERT INTO app.generation_assets(
           owner_id, id, run_id, object_key, mime_type, width, height,
           byte_size, checksum_sha256
         ) VALUES (101, $1, $2, $3, 'image/jpeg', 1024, 1024, 2048, repeat('0', 64))`,
        [assetId, first.id, `owners/101/${assetId}.jpg`],
      );
      const withAsset = await generations.get(101, first.id);
      expect(withAsset.assets).toEqual([
        expect.objectContaining({
          id: assetId,
          url: `/api/musefold/v1/assets/${assetId}/url`,
          mimeType: "image/jpeg",
          byteSize: 2048,
        }),
      ]);
      await expect(
        generations.assetSignedUrl(202, assetId),
      ).rejects.toMatchObject({
        code: "GENERATION_NOT_FOUND",
        statusCode: 404,
      });
      await expect(
        generations.history(101, { limit: 20, includeDeleted: true }),
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: first.id,
            assets: [expect.objectContaining({ id: assetId })],
          }),
        ]),
      });
      expect(repeated.id).toBe(first.id);
      const jobs = await adminPool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM graphile_worker.jobs WHERE task_identifier = 'generation.generate'",
      );
      expect(jobs.rows[0]?.count).toBe("1");
      await expect(generations.get(202, first.id)).rejects.toMatchObject({
        code: "GENERATION_NOT_FOUND",
      });
      const cancelled = await generations.cancel(101, first.id);
      expect(cancelled.status).toBe("cancelled");
      await expect(generations.cancel(101, first.id)).rejects.toMatchObject({
        code: "GENERATION_ALREADY_TERMINAL",
      });
      const removed = await generations.remove(101, first.id);
      expect(removed.deletedAt).not.toBeNull();
      await expect(
        generations.history(101, { limit: 20, includeDeleted: false }),
      ).resolves.not.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ id: first.id }),
        ]),
      });
      await expect(
        generations.history(101, { limit: 20, includeDeleted: true }),
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ id: first.id, deletedAt: removed.deletedAt }),
        ]),
      });
      const restored = await generations.restore(101, first.id);
      expect(restored.deletedAt).toBeNull();
    } finally {
      await runtime.close();
    }
  });

  it("serializes Cloud MCP daily budgets and preserves approval retries", async () => {
    const runtime = new DatabaseRuntime({
      DATABASE_URL: appUrl,
      DATABASE_MAX_CONNECTIONS: 12,
    });
    const autoGrantId = "31c60441-2f5b-4dc0-bf04-492940463b34";
    const askGrantId = "9e9160a2-f209-4794-8b73-30f5774e70e8";
    try {
      await adminPool.query(
        `INSERT INTO auth.oauth_clients(client_id, client_name, redirect_uris)
         VALUES
           ('budget-client-auto', 'Budget Auto', '[]'::jsonb),
           ('budget-client-ask', 'Budget Ask', '[]'::jsonb)
         ON CONFLICT (client_id) DO NOTHING`,
      );
      await adminPool.query(
        `INSERT INTO auth.oauth_grants(
           id, owner_id, client_id, scopes, mode,
           max_points_per_generation, max_points_per_day
         ) VALUES
           ($1, 101, 'budget-client-auto', ARRAY['generations:write'],
            'auto_with_limits', 1000, 3000),
           ($2, 101, 'budget-client-ask', ARRAY['generations:write'],
            'ask_each_time', 0, 0)
         ON CONFLICT (id) DO NOTHING`,
        [autoGrantId, askGrantId],
      );

      const generations = new GenerationService(
        runtime.db,
        {
          sign: vi.fn(async (objectKey: string) => ({
            url: `https://assets.example/${objectKey}`,
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          })),
        },
        "integration-approval-secret",
      );
      const input = {
        prompt: "Cloud MCP budget concurrency",
        size: "1024x1024" as const,
        quality: "medium" as const,
        count: 1 as const,
      };
      const concurrent = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          generations.createCloudMcp(101, input, `budget-concurrent-${index}`, {
            grantId: autoGrantId,
            approvalRequired: false,
          }),
        ),
      );
      expect(
        concurrent.filter((result) => result.job.status === "queued"),
      ).toHaveLength(3);
      expect(
        concurrent.filter((result) => result.job.status === "pending_approval"),
      ).toHaveLength(7);

      const reservations = await adminPool.query<{
        count: string;
      }>(
        `SELECT count(*)::text AS count
         FROM app.mcp_spend_reservations
         WHERE owner_id = 101 AND grant_id = $1 AND status = 'reserved'`,
        [autoGrantId],
      );
      expect(reservations.rows[0]?.count).toBe("3");

      const queued = concurrent.find(
        (result) => result.job.status === "queued",
      );
      if (!queued) throw new Error("Expected one queued budget result");
      await generations.cancel(101, queued.job.id);
      const replacement = await generations.createCloudMcp(
        101,
        input,
        "budget-after-release",
        { grantId: autoGrantId, approvalRequired: false },
      );
      expect(replacement.job.status).toBe("queued");

      await adminPool.query(
        `UPDATE app.mcp_spend_reservations
         SET status = 'settled', actual_points = estimated_points,
           settled_at = now()
         WHERE id = (
           SELECT id FROM app.mcp_spend_reservations
           WHERE owner_id = 101 AND grant_id = $1 AND status = 'reserved'
           ORDER BY reserved_at LIMIT 1
         )`,
        [autoGrantId],
      );
      const overSettledBudget = await generations.createCloudMcp(
        101,
        input,
        "budget-counts-settled",
        { grantId: autoGrantId, approvalRequired: false },
      );
      expect(overSettledBudget.job.status).toBe("pending_approval");

      const firstApproval = await generations.createCloudMcp(
        101,
        input,
        "approval-retry-same-key",
        { grantId: askGrantId, approvalRequired: true },
      );
      const repeatedApproval = await generations.createCloudMcp(
        101,
        input,
        "approval-retry-same-key",
        { grantId: askGrantId, approvalRequired: true },
      );
      expect(repeatedApproval.job.id).toBe(firstApproval.job.id);
      expect(repeatedApproval.approvalToken).toBe(firstApproval.approvalToken);
      expect(firstApproval.approvalToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const tokenRow = await adminPool.query<{
        approval_token_hash: string;
        idempotency_key: string;
      }>(
        `SELECT approval_token_hash, idempotency_key
         FROM app.generation_runs WHERE owner_id = 101 AND id = $1`,
        [firstApproval.job.id],
      );
      expect(tokenRow.rows[0]?.approval_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenRow.rows[0]?.approval_token_hash).not.toBe(
        firstApproval.approvalToken,
      );
      expect(tokenRow.rows[0]?.idempotency_key).toMatch(/^mcp:[0-9a-f]{64}$/);

      const sameCallerKeyOtherGrant = await generations.createCloudMcp(
        101,
        input,
        "budget-concurrent-0",
        { grantId: askGrantId, approvalRequired: true },
      );
      expect(sameCallerKeyOtherGrant.job.id).not.toBe(concurrent[0]?.job.id);

      await expect(
        generations.approveCloud(
          101,
          firstApproval.job.id,
          firstApproval.approvalToken ?? "",
        ),
      ).resolves.toMatchObject({
        status: "queued",
        approvalStatus: "approved",
      });

      const oauth = new OAuthService(runtime.db);
      const connections = await oauth.listConnections(101);
      expect(
        connections.find((connection) => connection.id === autoGrantId),
      ).toMatchObject({
        clientName: "Budget Auto",
        spentPointsToday: 1_000,
        reservedPointsToday: 2_000,
      });
      await expect(
        oauth.updateConnection(101, autoGrantId, {
          maxPointsPerDay: 4_000,
        }),
      ).rejects.toMatchObject({
        code: "AUTH_CREDENTIALS_INVALID",
        statusCode: 401,
      });
      await expect(
        oauth.updateConnection(
          101,
          autoGrantId,
          { maxPointsPerDay: 4_000 },
          true,
        ),
      ).resolves.toBeUndefined();
      await expect(
        oauth.updateConnection(101, autoGrantId, { suspended: true }),
      ).resolves.toBeUndefined();
      await expect(
        oauth.updateConnection(101, autoGrantId, { suspended: false }),
      ).rejects.toMatchObject({ code: "AUTH_CREDENTIALS_INVALID" });
      await expect(
        oauth.updateConnection(101, autoGrantId, { suspended: false }, true),
      ).resolves.toBeUndefined();

      const unscoped = await appPool.query(
        "SELECT count(*)::int AS count FROM app.mcp_spend_reservations",
      );
      expect(unscoped.rows[0]?.count).toBe(0);
    } finally {
      await runtime.close();
    }
  });
});

function withCredentials(
  connectionUri: string,
  username: string,
  password: string,
): string {
  const url = new URL(connectionUri);
  url.username = username;
  url.password = password;
  return url.toString();
}
