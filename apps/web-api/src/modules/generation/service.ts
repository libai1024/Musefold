import { createHash, createHmac, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import {
  cloudGenerationRequestSchema,
  createGenerationInputSchema,
  generationHistoryQuerySchema,
  generationJobSchema,
  type CreateGenerationInput,
  type GenerationHistoryPage,
  type GenerationJob,
  type ParsedGenerationHistoryQuery,
} from "@musefold/contracts";
import { assertGenerationTransition } from "@musefold/domain";
import {
  withOwnerTransaction,
  type OwnerTransaction,
} from "../../database/owner-context.js";
import type { MusefoldDatabase } from "../../database/types.js";
import { AppError } from "../../errors.js";
import type {
  AssetUrlSigner,
  SignedAssetUrl,
} from "../../storage/s3-signer.js";

const MCP_ESTIMATED_POINTS = 1_000;

type RunRow = {
  id: string;
  session_id: string | null;
  parent_run_id: string | null;
  prompt_id: string | null;
  run_kind: GenerationJob["actorType"] extends never
    ? string
    : "free_generation" | "refinement" | "retry";
  actor_type: GenerationJob["actorType"];
  approval_status: GenerationJob["approvalStatus"];
  prompt_snapshot: Record<string, unknown> | null;
  request: Record<string, unknown>;
  provider_model: string | null;
  status: GenerationJob["status"];
  progress: number;
  cost_points: number | null;
  error_code: string | null;
  error_detail_safe: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  deleted_at: Date | string | null;
};

type AssetRow = {
  id: string;
  run_id: string;
  object_key: string;
  mime_type: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  byte_size: string;
  deleted_at: Date | string | null;
};

export interface GenerationServicePort {
  create(
    ownerId: number,
    input: CreateGenerationInput,
    idempotencyKey: string,
  ): Promise<GenerationJob>;
  get(ownerId: number, id: string): Promise<GenerationJob>;
  history(
    ownerId: number,
    query: ParsedGenerationHistoryQuery,
  ): Promise<GenerationHistoryPage>;
  cancel(ownerId: number, id: string): Promise<GenerationJob>;
  retry(
    ownerId: number,
    id: string,
    idempotencyKey: string,
  ): Promise<GenerationJob>;
  remove(ownerId: number, id: string): Promise<GenerationJob>;
  restore(ownerId: number, id: string): Promise<GenerationJob>;
  assetRedirectUrl(ownerId: number, assetId: string): Promise<string>;
  assetSignedUrl(ownerId: number, assetId: string): Promise<SignedAssetUrl>;
  createCloudMcp(
    ownerId: number,
    input: CreateGenerationInput,
    idempotencyKey: string,
    options: {
      grantId: string;
      approvalRequired: boolean;
      skill?: {
        id: string;
        version: string;
        contentHash: string;
        inputs: Record<string, unknown>;
      };
    },
  ): Promise<{ job: GenerationJob; approvalToken: string | null }>;
  approveCloud(
    ownerId: number,
    id: string,
    approvalToken: string,
  ): Promise<GenerationJob>;
  events(
    ownerId: number,
    id: string,
    afterSeq?: number,
  ): Promise<
    Array<{
      seq: number;
      type: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>
  >;
}

export class GenerationService implements GenerationServicePort {
  constructor(
    private readonly db: Kysely<MusefoldDatabase>,
    private readonly signer: AssetUrlSigner,
    private readonly approvalSecret: string,
  ) {}

  async create(
    ownerId: number,
    rawInput: CreateGenerationInput,
    idempotencyKey: string,
  ): Promise<GenerationJob> {
    const input = createGenerationInputSchema.parse(rawInput);
    const baseRequest = cloudGenerationRequestSchema.parse(input);
    const result = await this.createQueued(
      ownerId,
      baseRequest,
      idempotencyKey,
      {
        sessionId: input.sessionId,
        parentRunId: input.parentRunId,
        runKind: input.runKind,
      },
    );
    return result.job;
  }

  async get(ownerId: number, id: string): Promise<GenerationJob> {
    const result = await withOwnerTransaction(this.db, ownerId, async (trx) =>
      this.getRunAndAssetsTx(trx, id),
    );
    return this.toJob(result.run, result.assets);
  }

  async history(
    ownerId: number,
    rawQuery: ParsedGenerationHistoryQuery,
  ): Promise<GenerationHistoryPage> {
    const query = generationHistoryQuerySchema.parse(rawQuery);
    const result = await withOwnerTransaction(this.db, ownerId, async (trx) => {
      const conditions = [
        query.includeDeleted ? sql`TRUE` : sql`r.deleted_at IS NULL`,
      ];
      if (query.sessionId)
        conditions.push(sql`r.session_id = ${query.sessionId}`);
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        conditions.push(
          sql`(r.created_at, r.id) < (${new Date(cursor.createdAt)}, ${cursor.id})`,
        );
      }
      const rows = await sql<RunRow>`
        SELECT r.id, r.session_id, r.parent_run_id, r.prompt_id, r.run_kind,
          r.actor_type, r.approval_status, r.prompt_snapshot, r.request,
          r.provider_model, r.status, r.progress, r.cost_points, r.error_code,
          r.error_detail_safe, r.created_at, r.started_at, r.finished_at,
          r.deleted_at
        FROM app.generation_runs r
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${query.limit + 1}
      `.execute(trx);
      const selectedRows = rows.rows.length > query.limit
        ? rows.rows.slice(0, -1)
        : rows.rows;
      const assets = selectedRows.length > 0
        ? await this.getAssetsForRunsTx(
            trx,
            selectedRows.map((run) => run.id),
          )
        : [];
      return {
        rows: rows.rows,
        assets,
        hasMore: rows.rows.length > query.limit,
      };
    });
    const rows = result.hasMore ? result.rows.slice(0, -1) : result.rows;
    const assetsByRunId = new Map<string, AssetRow[]>();
    for (const asset of result.assets) {
      const assets = assetsByRunId.get(asset.run_id) ?? [];
      assets.push(asset);
      assetsByRunId.set(asset.run_id, assets);
    }
    const items = rows.map((run) =>
      this.toJob(run, assetsByRunId.get(run.id) ?? []),
    );
    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        result.hasMore && last
          ? encodeCursor({ id: last.id, createdAt: toIso(last.created_at) })
          : null,
    };
  }

  async cancel(ownerId: number, id: string): Promise<GenerationJob> {
    const result = await withOwnerTransaction(this.db, ownerId, async (trx) => {
      const current = await this.getRunAndAssetsTx(trx, id);
      if (
        current.run.status === "cancelled" ||
        current.run.status === "succeeded" ||
        current.run.status === "failed" ||
        current.run.status === "rejected" ||
        current.run.status === "expired"
      ) {
        throw new AppError(
          "GENERATION_ALREADY_TERMINAL",
          "生成任务已经结束",
          409,
        );
      }
      const next =
        current.run.status === "running" ? "cancelling" : "cancelled";
      assertGenerationTransition(current.run.status, next);
      await sql`
        UPDATE app.generation_runs SET status = ${next}, progress = ${next === "cancelled" ? 100 : current.run.progress},
          cancelled_at = ${next === "cancelled" ? sql`now()` : sql`NULL`},
          finished_at = ${next === "cancelled" ? sql`now()` : sql`NULL`}
        WHERE owner_id = ${ownerId} AND id = ${id}
      `.execute(trx);
      await this.appendEvent(trx, ownerId, id, `generation.${next}`, {});
      if (next === "cancelled") {
        await sql`
          UPDATE app.mcp_spend_reservations
          SET status = 'released', released_at = now()
          WHERE owner_id = ${ownerId} AND generation_run_id = ${id}
            AND status = 'reserved'
        `.execute(trx);
      }
      return this.getRunAndAssetsTx(trx, id);
    });
    return this.toJob(result.run, result.assets);
  }

  async retry(
    ownerId: number,
    id: string,
    idempotencyKey: string,
  ): Promise<GenerationJob> {
    const source = await this.get(ownerId, id);
    if (source.status !== "failed" && source.status !== "cancelled")
      throw new AppError(
        "VALIDATION_FAILED",
        "只有失败或取消的任务可以重试",
        409,
      );
    const result = await this.createQueued(
      ownerId,
      source.request,
      idempotencyKey,
      { parentRunId: source.id, runKind: "retry" },
    );
    return result.job;
  }

  async remove(ownerId: number, id: string): Promise<GenerationJob> {
    return this.changeDeleted(ownerId, id, true);
  }

  async restore(ownerId: number, id: string): Promise<GenerationJob> {
    return this.changeDeleted(ownerId, id, false);
  }

  async assetRedirectUrl(ownerId: number, assetId: string): Promise<string> {
    return (await this.assetSignedUrl(ownerId, assetId)).url;
  }

  async assetSignedUrl(
    ownerId: number,
    assetId: string,
  ): Promise<SignedAssetUrl> {
    const objectKey = await withOwnerTransaction(
      this.db,
      ownerId,
      async (trx) => {
        const result = await sql<{ object_key: string }>`
        SELECT object_key FROM app.generation_assets WHERE id = ${assetId} AND deleted_at IS NULL
      `.execute(trx);
        const row = result.rows[0];
        if (!row)
          throw new AppError("GENERATION_NOT_FOUND", "生成资产不存在", 404);
        return row.object_key;
      },
    );
    return this.signer.sign(objectKey);
  }

  async createCloudMcp(
    ownerId: number,
    rawInput: CreateGenerationInput,
    idempotencyKey: string,
    options: {
      grantId: string;
      approvalRequired: boolean;
      skill?: {
        id: string;
        version: string;
        contentHash: string;
        inputs: Record<string, unknown>;
      };
    },
  ): Promise<{ job: GenerationJob; approvalToken: string | null }> {
    const input = createGenerationInputSchema.parse(rawInput);
    const request = cloudGenerationRequestSchema.parse(input);
    const scopedIdempotencyKey = `mcp:${createHash("sha256")
      .update(options.grantId)
      .update("\0")
      .update(idempotencyKey)
      .digest("hex")}`;
    const result = await this.createQueued(
      ownerId,
      request,
      scopedIdempotencyKey,
      {
        sessionId: input.sessionId,
        parentRunId: input.parentRunId,
        runKind: input.runKind,
        actorType: "cloud_mcp",
        mcpGrantId: options.grantId,
        approvalRequired: options.approvalRequired,
        skill: options.skill,
      },
    );
    return result;
  }

  async approveCloud(
    ownerId: number,
    id: string,
    approvalToken: string,
  ): Promise<GenerationJob> {
    const tokenHash = hashOpaque(approvalToken);
    const result = await withOwnerTransaction(this.db, ownerId, async (trx) => {
      const current = await sql<{
        status: GenerationJob["status"];
        approval_status: GenerationJob["approvalStatus"];
        mcp_grant_id: string;
      }>`
        SELECT status, approval_status, mcp_grant_id
        FROM app.generation_runs
        WHERE owner_id = ${ownerId} AND id = ${id}
          AND actor_type = 'cloud_mcp'
          AND approval_token_hash = ${tokenHash}
          AND approval_expires_at > now()
        FOR UPDATE
      `.execute(trx);
      if (!current.rows[0])
        throw new AppError(
          "GENERATION_APPROVAL_EXPIRED",
          "审批链接已失效，请让 AI 重新发起生成",
          410,
        );
      assertGenerationTransition(current.rows[0].status, "queued");
      if (!current.rows[0].mcp_grant_id)
        throw new AppError(
          "GENERATION_APPROVAL_EXPIRED",
          "审批任务已失效",
          410,
        );
      await this.lockAndCheckMcpBudget(
        trx,
        current.rows[0].mcp_grant_id,
        ownerId,
      );
      await sql`
        UPDATE app.generation_runs
        SET status = 'queued', approval_status = 'approved', approval_token_hash = NULL,
          approval_expires_at = NULL, approved_at = now()
        WHERE owner_id = ${ownerId} AND id = ${id}
      `.execute(trx);
      await sql`
        INSERT INTO app.mcp_spend_reservations(id, owner_id, grant_id, generation_run_id, estimated_points)
        VALUES (${randomUUID()}, ${ownerId}, ${current.rows[0].mcp_grant_id}, ${id}, ${MCP_ESTIMATED_POINTS})
        ON CONFLICT (generation_run_id) DO NOTHING
      `.execute(trx);
      await this.appendEvent(trx, ownerId, id, "generation.approved", {});
      await sql`SELECT app.enqueue_generation(${id})`.execute(trx);
      return this.getRunAndAssetsTx(trx, id);
    });
    return this.toJob(result.run, result.assets);
  }

  async events(
    ownerId: number,
    id: string,
    afterSeq = 0,
  ): Promise<
    Array<{
      seq: number;
      type: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>
  > {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      await this.requireRun(trx, id);
      const result = await sql<{
        seq: string;
        event_type: string;
        payload: Record<string, unknown>;
        created_at: Date | string;
      }>`
        SELECT seq, event_type, payload, created_at
        FROM app.generation_events
        WHERE run_id = ${id} AND seq > ${afterSeq}
        ORDER BY seq ASC LIMIT 100
      `.execute(trx);
      return result.rows.map((row) => ({
        seq: Number(row.seq),
        type: row.event_type,
        payload: row.payload,
        createdAt: toIso(row.created_at),
      }));
    });
  }

  private async createQueued(
    ownerId: number,
    request: ReturnType<typeof cloudGenerationRequestSchema.parse>,
    idempotencyKey: string,
    options: {
      sessionId?: string;
      parentRunId?: string;
      runKind: "free_generation" | "refinement" | "retry";
      actorType?: "web" | "cloud_mcp";
      mcpGrantId?: string;
      approvalRequired?: boolean;
      skill?: {
        id: string;
        version: string;
        contentHash: string;
        inputs: Record<string, unknown>;
      };
    },
  ): Promise<{ job: GenerationJob; approvalToken: string | null }> {
    if (!/^[\x20-\x7e]{8,128}$/.test(idempotencyKey))
      throw new AppError("VALIDATION_FAILED", "Idempotency-Key 无效", 400);
    const result = await withOwnerTransaction(this.db, ownerId, async (trx) => {
      const duplicate = await sql<
        RunRow & {
          mcp_grant_id: string | null;
          approval_expires_at: Date | string | null;
        }
      >`
        SELECT id, session_id, parent_run_id, prompt_id, run_kind, actor_type, approval_status,
          prompt_snapshot, request, provider_model, status, progress, cost_points, error_code,
          error_detail_safe, created_at, started_at, finished_at, deleted_at,
          mcp_grant_id, approval_expires_at
        FROM app.generation_runs WHERE idempotency_key = ${idempotencyKey}
      `.execute(trx);
      if (duplicate.rows[0]) {
        const run = duplicate.rows[0];
        return {
          result: {
            run,
            assets: await this.getAssetsTx(trx, run.id),
          },
          approvalToken:
            run.status === "pending_approval" &&
            run.mcp_grant_id &&
            run.approval_expires_at &&
            new Date(run.approval_expires_at).getTime() > Date.now()
              ? this.approvalToken(ownerId, run.id, run.mcp_grant_id)
              : null,
        };
      }
      if (options.sessionId) await this.requireSession(trx, options.sessionId);
      if (options.parentRunId) await this.requireRun(trx, options.parentRunId);
      let promptSnapshot: Record<string, unknown> | null = null;
      if (request.promptId) {
        const prompt = await sql<{ snapshot: Record<string, unknown> }>`
          SELECT jsonb_build_object('id', id, 'title', title, 'content', content, 'negative', negative, 'version', version) AS snapshot
          FROM app.prompts WHERE id = ${request.promptId}
        `.execute(trx);
        if (!prompt.rows[0])
          throw new AppError("PROMPT_NOT_FOUND", "提示词不存在", 404);
        promptSnapshot = prompt.rows[0].snapshot;
      }
      const id = randomUUID();
      const actorType = options.actorType ?? "web";
      let approvalRequired =
        actorType === "cloud_mcp" && options.approvalRequired === true;
      if (actorType === "cloud_mcp" && options.mcpGrantId) {
        const budget = await this.lockAndCheckMcpBudget(
          trx,
          options.mcpGrantId,
          ownerId,
        );
        approvalRequired = approvalRequired || !budget.allowed;
      }
      const status = approvalRequired ? "pending_approval" : "queued";
      const approvalStatus = approvalRequired
        ? "pending_approval"
        : actorType === "cloud_mcp"
          ? "approved"
          : "not_required";
      const approvalToken =
        approvalRequired && options.mcpGrantId
          ? this.approvalToken(ownerId, id, options.mcpGrantId)
          : null;
      await sql`
        INSERT INTO app.generation_runs(
          owner_id, id, session_id, parent_run_id, prompt_id, run_kind, actor_type,
          approval_status, prompt_snapshot, request, provider_model, status,
          idempotency_key, mcp_grant_id, approval_token_hash, approval_expires_at,
          skill_id, skill_version, skill_content_hash, skill_inputs
        ) VALUES (
          ${ownerId}, ${id}, ${options.sessionId ?? null}, ${options.parentRunId ?? null}, ${request.promptId ?? null},
          ${options.runKind}, ${actorType}, ${approvalStatus}, ${promptSnapshot ? JSON.stringify(promptSnapshot) : null},
          ${JSON.stringify(request)}, 'musefold-image-pro', ${status}, ${idempotencyKey},
          ${options.mcpGrantId ?? null}, ${approvalToken ? hashOpaque(approvalToken) : null},
          ${approvalToken ? sql`now() + interval '10 minutes'` : sql`NULL`},
          ${options.skill?.id ?? null}, ${options.skill?.version ?? null},
          ${options.skill?.contentHash ?? null}, ${options.skill ? JSON.stringify(options.skill.inputs) : null}
        )
      `.execute(trx);
      if (
        !approvalRequired &&
        actorType === "cloud_mcp" &&
        options.mcpGrantId
      ) {
        await sql`
          INSERT INTO app.mcp_spend_reservations(id, owner_id, grant_id, generation_run_id, estimated_points)
          VALUES (${randomUUID()}, ${ownerId}, ${options.mcpGrantId}, ${id}, ${MCP_ESTIMATED_POINTS})
        `.execute(trx);
      }
      await this.appendEvent(trx, ownerId, id, "generation.requested", {
        runKind: options.runKind,
        actorType,
      });
      if (!approvalRequired)
        await sql`SELECT app.enqueue_generation(${id})`.execute(trx);
      return { result: await this.getRunAndAssetsTx(trx, id), approvalToken };
    });
    return {
      job: this.toJob(result.result.run, result.result.assets),
      approvalToken: result.approvalToken,
    };
  }

  private async changeDeleted(
    ownerId: number,
    id: string,
    deleted: boolean,
  ): Promise<GenerationJob> {
    const result = await withOwnerTransaction(this.db, ownerId, async (trx) => {
      await this.requireRun(trx, id);
      await sql`UPDATE app.generation_runs SET deleted_at = ${deleted ? sql`now()` : sql`NULL`} WHERE owner_id = ${ownerId} AND id = ${id}`.execute(
        trx,
      );
      return this.getRunAndAssetsTx(trx, id);
    });
    return this.toJob(result.run, result.assets);
  }

  private async getRunAndAssetsTx(
    trx: OwnerTransaction,
    id: string,
  ): Promise<{ run: RunRow; assets: AssetRow[] }> {
    const result = await sql<RunRow>`
      SELECT id, session_id, parent_run_id, prompt_id, run_kind, actor_type, approval_status,
        prompt_snapshot, request, provider_model, status, progress, cost_points,
        error_code, error_detail_safe, created_at, started_at, finished_at,
        deleted_at
      FROM app.generation_runs WHERE id = ${id}
    `.execute(trx);
    const run = result.rows[0];
    if (!run) throw new AppError("GENERATION_NOT_FOUND", "生成任务不存在", 404);
    return { run, assets: await this.getAssetsTx(trx, id) };
  }

  private async getAssetsTx(
    trx: OwnerTransaction,
    runId: string,
  ): Promise<AssetRow[]> {
    const result = await sql<AssetRow>`
      SELECT id, run_id, object_key, mime_type, width, height, byte_size::text, deleted_at
      FROM app.generation_assets WHERE run_id = ${runId} AND deleted_at IS NULL ORDER BY id
    `.execute(trx);
    return result.rows;
  }

  private async getAssetsForRunsTx(
    trx: OwnerTransaction,
    runIds: readonly string[],
  ): Promise<AssetRow[]> {
    if (runIds.length === 0) return [];
    const result = await sql<AssetRow>`
      SELECT id, run_id, object_key, mime_type, width, height, byte_size::text, deleted_at
      FROM app.generation_assets
      WHERE run_id IN (${sql.join(runIds.map((id) => sql`${id}`), sql`, `)})
        AND deleted_at IS NULL
      ORDER BY run_id, id
    `.execute(trx);
    return result.rows;
  }

  private async requireSession(
    trx: OwnerTransaction,
    id: string,
  ): Promise<void> {
    const result =
      await sql`SELECT 1 FROM app.workbench_sessions WHERE id = ${id} AND deleted_at IS NULL`.execute(
        trx,
      );
    if (!result.rows[0])
      throw new AppError(
        "WORKBENCH_SESSION_NOT_FOUND",
        "工作台会话不存在",
        404,
      );
  }

  private async requireRun(trx: OwnerTransaction, id: string): Promise<void> {
    const result =
      await sql`SELECT 1 FROM app.generation_runs WHERE id = ${id}`.execute(
        trx,
      );
    if (!result.rows[0])
      throw new AppError("GENERATION_NOT_FOUND", "生成任务不存在", 404);
  }

  private async lockAndCheckMcpBudget(
    trx: OwnerTransaction,
    grantId: string,
    ownerId: number,
  ): Promise<{ allowed: boolean }> {
    const grant = await sql<{
      mode: string;
      max_points_per_generation: number;
      max_points_per_day: number;
    }>`
      SELECT mode, max_points_per_generation, max_points_per_day
      FROM auth.oauth_grants WHERE id = ${grantId} AND owner_id = ${ownerId} AND revoked_at IS NULL AND suspended_at IS NULL
      FOR UPDATE
    `.execute(trx);
    const row = grant.rows[0];
    if (!row)
      throw new AppError("OAUTH_INVALID_GRANT", "MCP 授权已暂停或撤销", 401);
    const spent = await sql<{ points: string }>`
      SELECT coalesce(sum(
        CASE WHEN status = 'settled'
          THEN coalesce(actual_points, estimated_points)
          ELSE estimated_points
        END
      ), 0)::text AS points
      FROM app.mcp_spend_reservations
      WHERE owner_id = ${ownerId} AND grant_id = ${grantId}
        AND status IN ('reserved', 'settled')
        AND reserved_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    `.execute(trx);
    return {
      allowed:
        row.mode === "auto_with_limits" &&
        row.max_points_per_generation >= MCP_ESTIMATED_POINTS &&
        row.max_points_per_day >=
          Number(spent.rows[0]?.points ?? 0) + MCP_ESTIMATED_POINTS,
    };
  }

  private approvalToken(
    ownerId: number,
    runId: string,
    grantId: string,
  ): string {
    return createHmac("sha256", this.approvalSecret)
      .update("musefold-cloud-approval\0")
      .update(String(ownerId))
      .update("\0")
      .update(runId)
      .update("\0")
      .update(grantId)
      .digest("base64url");
  }

  private async appendEvent(
    trx: OwnerTransaction,
    ownerId: number,
    runId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await sql`INSERT INTO app.generation_events(owner_id, run_id, event_type, payload) VALUES (${ownerId}, ${runId}, ${eventType}, ${JSON.stringify(payload)})`.execute(
      trx,
    );
  }

  private toJob(run: RunRow, assets: AssetRow[]): GenerationJob {
    return generationJobSchema.parse({
      id: run.id,
      sessionId: run.session_id,
      parentRunId: run.parent_run_id,
      promptId: run.prompt_id,
      actorType: run.actor_type,
      approvalStatus: run.approval_status,
      status: run.status,
      progress: run.progress,
      request: cloudGenerationRequestSchema.parse(run.request),
      providerModel: run.provider_model,
      costPoints: run.cost_points,
      assets: assets.map((asset) => ({
        id: asset.id,
        url: `/api/musefold/v1/assets/${encodeURIComponent(asset.id)}/url`,
        mimeType: asset.mime_type,
        width: asset.width,
        height: asset.height,
        byteSize: Number(asset.byte_size),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      })),
      error: run.error_code
        ? {
            code: mapGenerationError(run.error_code),
            message: run.error_detail_safe ?? "生成失败",
          }
        : null,
      createdAt: toIso(run.created_at),
      startedAt: toIsoOrNull(run.started_at),
      finishedAt: toIsoOrNull(run.finished_at),
      deletedAt: toIsoOrNull(run.deleted_at),
    });
  }
}

function mapGenerationError(
  code: string,
): GenerationJob["error"] extends infer T
  ? T extends { code: infer C }
    ? C
    : never
  : never {
  const allowed = new Set([
    "ACCOUNT_QUOTA_INSUFFICIENT",
    "GENERATION_UPSTREAM_REJECTED",
    "GENERATION_UPSTREAM_UNKNOWN",
    "GENERATION_STORAGE_FAILED",
    "INTERNAL_ERROR",
  ] as const);
  return (allowed.has(code as never) ? code : "INTERNAL_ERROR") as never;
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function encodeCursor(value: { id: string; createdAt: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { id: string; createdAt: string } {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { id?: unknown; createdAt?: unknown };
    if (typeof parsed.id !== "string" || typeof parsed.createdAt !== "string")
      throw new Error("invalid");
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    throw new AppError("VALIDATION_FAILED", "生成历史分页游标无效", 400);
  }
}
