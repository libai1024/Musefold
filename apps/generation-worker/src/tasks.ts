import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { openJson } from "@musefold/server-crypto";
import type { ParsedCloudGenerationRequest } from "@musefold/contracts";
import type { JobHelpers, TaskList } from "graphile-worker";
import type { WorkerConfig } from "./config.js";
import {
  generateImage,
  imageChecksum,
  type GeneratedImage,
  UpstreamImageError,
} from "./image-gateway.js";

interface GenerationPayload {
  ownerId: number;
  runId: string;
}
interface RunData {
  request: ParsedCloudGenerationRequest;
  status: string;
  upstream_request_sent: boolean;
  lease_expires_at: Date | string | null;
}
interface CredentialRow {
  credential_ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
}

type WorkerPgClient = Parameters<Parameters<JobHelpers["withPgClient"]>[0]>[0];

export type McpSpendOutcome = "settled" | "released" | "preserved";

export type LeaseRecoveryAction = "continue" | "mark_unknown" | "skip";

/**
 * A sent upstream request must never be retried blindly: the provider may
 * already have accepted and charged it while the worker was unavailable.
 */
export function decideLeaseRecovery(
  run: Pick<RunData, "status" | "upstream_request_sent" | "lease_expires_at">,
  now = Date.now(),
): LeaseRecoveryAction {
  if (!run.lease_expires_at || !isLeaseExpired(run.lease_expires_at, now)) {
    return "skip";
  }
  return run.upstream_request_sent ? "mark_unknown" : "continue";
}

export async function transitionMcpSpendReservation(
  client: WorkerPgClient,
  ownerId: number,
  runId: string,
  outcome: McpSpendOutcome,
): Promise<void> {
  if (outcome === "preserved") return;

  if (outcome === "settled") {
    await client.query(
      `UPDATE app.mcp_spend_reservations
       SET status = 'settled', actual_points = estimated_points,
         settled_at = now(), released_at = NULL
       WHERE owner_id = $2 AND generation_run_id = $1
         AND status = 'reserved'`,
      [runId, ownerId],
    );
    return;
  }

  await client.query(
    `UPDATE app.mcp_spend_reservations
     SET status = 'released', released_at = now()
     WHERE owner_id = $2 AND generation_run_id = $1
       AND status = 'reserved'`,
    [runId, ownerId],
  );
}

export function createTaskList(config: WorkerConfig, s3: S3Client): TaskList {
  return {
    "maintenance.cleanup_expired_sessions": async (_payload, helpers) => {
      await helpers.withPgClient(async (client) => {
        await client.query(`
          DELETE FROM auth.web_sessions
          WHERE revoked_at IS NOT NULL
             OR absolute_expires_at <= now()
             OR last_seen_at <= now() - interval '7 days'
        `);
        await client.query(`
          DELETE FROM ops.rate_limit_buckets
          WHERE expires_at <= now()
        `);
      });
    },
    "generation.generate": async (rawPayload, helpers) => {
      const payload = rawPayload as GenerationPayload;
      const acquired = await helpers.withPgClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query("SELECT set_config('app.owner_id', $1, true)", [
            String(payload.ownerId),
          ]);
          const result = await client.query<RunData & { id: string }>(
            `
            SELECT id, request, status, upstream_request_sent, lease_expires_at
            FROM app.generation_runs
            WHERE id = $1
              AND (
                status = 'queued'
                OR (
                  status IN ('running', 'cancelling')
                  AND lease_expires_at <= now()
                )
              )
            FOR UPDATE
          `,
            [payload.runId],
          );
          if (!result.rows[0]) {
            await client.query("COMMIT");
            return null;
          }
          if (result.rows[0].status !== "queued") {
            const recoveryAction = decideLeaseRecovery(result.rows[0]);
            if (recoveryAction === "mark_unknown") {
              await client.query(
                `UPDATE app.generation_runs
                 SET status = 'failed', progress = 100,
                   error_code = 'GENERATION_UPSTREAM_UNKNOWN',
                   error_detail_safe = 'worker 在上游请求完成前退出，结果无法确认',
                   finished_at = now(), lease_expires_at = NULL
                 WHERE id = $1 AND status IN ('running', 'cancelling')`,
                [payload.runId],
              );
              await client.query(
                `INSERT INTO app.generation_events(owner_id, run_id, event_type, payload)
                 VALUES ($1, $2, 'generation.failed', $3::jsonb)`,
                [
                  payload.ownerId,
                  payload.runId,
                  JSON.stringify({ code: "GENERATION_UPSTREAM_UNKNOWN" }),
                ],
              );
              await transitionMcpSpendReservation(
                client,
                payload.ownerId,
                payload.runId,
                "preserved",
              );
              await client.query("COMMIT");
              return null;
            }
            if (recoveryAction !== "continue") {
              await client.query("COMMIT");
              return null;
            }
            await client.query(
              `UPDATE app.generation_runs
               SET status = 'queued', lease_expires_at = NULL
               WHERE id = $1 AND status IN ('running', 'cancelling')`,
              [payload.runId],
            );
          }
          await client.query(
            `
            UPDATE app.generation_runs
            SET status = 'running', progress = 5, attempt_count = attempt_count + 1,
              upstream_request_sent = true, started_at = coalesce(started_at, now()),
              lease_expires_at = now() + interval '10 minutes'
            WHERE id = $1
          `,
            [payload.runId],
          );
          await client.query(
            `INSERT INTO app.generation_events(owner_id, run_id, event_type, payload) VALUES ($1, $2, 'generation.running', '{}'::jsonb)`,
            [payload.ownerId, payload.runId],
          );
          await client.query("COMMIT");
          return result.rows[0];
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });
      if (!acquired) return;

      try {
        const credential = await helpers.withPgClient(async (client) => {
          const result = await client.query<CredentialRow>(
            "SELECT * FROM auth.find_account_credential($1)",
            [payload.ownerId],
          );
          const row = result.rows[0];
          if (!row)
            throw new UpstreamImageError(
              "rejected",
              "账号生图凭据不存在，请重新登录",
            );
          return openJson<{ apiKey: string }>(
            {
              ciphertext: row.credential_ciphertext,
              nonce: row.nonce,
              authTag: row.auth_tag,
            },
            config.SESSION_ENCRYPTION_KEY,
          );
        });
        const images = await generateImage(
          config.NEW_API_BASE_URL,
          credential.apiKey,
          acquired.request,
        );
        const assets = await uploadImages(s3, config, payload, images);
        await helpers.withPgClient(async (client) => {
          await client.query("BEGIN");
          try {
            await client.query("SELECT set_config('app.owner_id', $1, true)", [
              String(payload.ownerId),
            ]);
            for (const asset of assets) {
              await client.query(
                `
                INSERT INTO app.generation_assets(owner_id, id, run_id, object_key, mime_type, width, height, byte_size, checksum_sha256)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `,
                [
                  payload.ownerId,
                  asset.id,
                  payload.runId,
                  asset.objectKey,
                  asset.mimeType,
                  asset.width,
                  asset.height,
                  asset.bytes.length,
                  asset.checksum,
                ],
              );
            }
            await client.query(
              `UPDATE app.generation_runs
               SET status = 'succeeded', progress = 100, finished_at = now(),
                 lease_expires_at = NULL,
                 cost_points = coalesce(
                   cost_points,
                   (SELECT estimated_points FROM app.mcp_spend_reservations
                    WHERE owner_id = $2 AND generation_run_id = $1)
                 )
               WHERE id = $1`,
              [payload.runId, payload.ownerId],
            );
            await transitionMcpSpendReservation(
              client,
              payload.ownerId,
              payload.runId,
              "settled",
            );
            await client.query(
              `INSERT INTO app.generation_events(owner_id, run_id, event_type, payload) VALUES ($1, $2, 'generation.succeeded', $3::jsonb)`,
              [
                payload.ownerId,
                payload.runId,
                JSON.stringify({ assetCount: assets.length }),
              ],
            );
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        });
      } catch (error) {
        const mapped =
          error instanceof UpstreamImageError
            ? error
            : new UpstreamImageError("unknown", "生成执行失败");
        const code =
          mapped.code === "quota"
            ? "ACCOUNT_QUOTA_INSUFFICIENT"
            : mapped.code === "rejected"
              ? "GENERATION_UPSTREAM_REJECTED"
              : "GENERATION_UPSTREAM_UNKNOWN";
        await withOwnerTransaction(helpers, payload.ownerId, async (client) => {
          await client.query(
            `
            UPDATE app.generation_runs
            SET status = 'failed', progress = 100, error_code = $2, error_detail_safe = $3, finished_at = now(), lease_expires_at = NULL
            WHERE id = $1 AND status IN ('running', 'cancelling')
          `,
            [payload.runId, code, mapped.message.slice(0, 500)],
          );
          await client.query(
            `
            INSERT INTO app.generation_events(owner_id, run_id, event_type, payload)
            VALUES ($1, $2, 'generation.failed', $3::jsonb)
          `,
            [payload.ownerId, payload.runId, JSON.stringify({ code })],
          );
          await transitionMcpSpendReservation(
            client,
            payload.ownerId,
            payload.runId,
            code === "GENERATION_UPSTREAM_UNKNOWN" ? "preserved" : "released",
          );
        });
      }
    },
  };
}

async function uploadImages(
  s3: S3Client,
  config: WorkerConfig,
  payload: GenerationPayload,
  images: GeneratedImage[],
) {
  const uploaded: Array<
    GeneratedImage & { id: string; objectKey: string; checksum: string }
  > = [];
  for (const image of images) {
    const id = randomUUID();
    const objectKey = `owners/${payload.ownerId}/generations/${payload.runId}/${id}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: objectKey,
        Body: image.bytes,
        ContentType: image.mimeType,
        Metadata: { runId: payload.runId },
      }),
    );
    uploaded.push({
      ...image,
      id,
      objectKey,
      checksum: imageChecksum(image.bytes),
    });
  }
  return uploaded;
}

function isLeaseExpired(value: Date | string, now: number): boolean {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now;
}

async function withOwnerTransaction<T>(
  helpers: JobHelpers,
  ownerId: number,
  callback: (client: WorkerPgClient) => Promise<T>,
): Promise<T> {
  return helpers.withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('app.owner_id', $1, true)", [
        String(ownerId),
      ]);
      const value = await callback(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
