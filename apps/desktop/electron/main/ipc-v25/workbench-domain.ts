// v2.5 桌面 workbench/generation 域桥:contracts 形状 ↔ core SQLite。
// 会话正文在 workbench_sessions/generation_runs/generated_assets 三表;
// 草稿在受管表 workbench_drafts(desktop-db 0001 增量;M4b 的 userData JSON
// 旁存文件由 importLegacyDraftsFile 一次性并入后删除)。
// 生成走 core generate()(与旧 IPC 同一编排):桥内发起后立即返回 queued run,
// 渲染层轮询终态 —— 进度事件流等 M4e IPC 收口时统一补。

import type {
  GenerationAsset,
  GenerationJob,
  GenerationStatus,
  ProviderOption,
  WorkbenchDraft,
  WorkbenchSession,
} from '@musefold/contracts';
import {
  createGenerationInputSchema,
  createWorkbenchSessionSchema,
  entityIdSchema,
  generationHistoryQuerySchema,
  updateWorkbenchSessionSchema,
  workbenchDraftSchema,
  workbenchSessionListQuerySchema,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import type { GenerationParamsSnapshot } from '@musefold/desktop-contracts/workbench';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';
import { cancelGeneration, generate } from '@musefold/core/services/generation';
import { app } from 'electron';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'path';
import { ulid } from 'ulid';
import { z } from 'zod';
import { createLogger } from '../../system/logger';
import { BridgeError, type MethodDef } from './envelope';

const logger = createLogger('ipc-v25:workbench');

/** 桌面表无 version 列;合成乐观锁,写回丢弃。 */
const SYNTHETIC_VERSION = 1;
/** 本地资产不过期;契约要求 expiresAt,给远期占位。 */
const LOCAL_ASSET_EXPIRES_AT = '2099-12-31T00:00:00+00:00';

function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '+00:00');
}

function epochMsToIsoOrNull(ms: number | null | undefined): string | null {
  return ms == null ? null : epochMsToIso(ms);
}

function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

// ---------- 草稿(workbench_drafts 受管表) ----------

const LEGACY_DRAFTS_FILE = 'v25-workbench-drafts.json';
const draftsFileSchema = z.record(z.string(), workbenchDraftSchema);

const EMPTY_DRAFT: WorkbenchDraft = {
  prompt: '',
  negative: '',
  params: {},
  promptReferenceIds: [],
};

function parseDraftJson(raw: string | undefined): WorkbenchDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const parsed = workbenchDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

function readDraft(sessionId: string): WorkbenchDraft {
  const row = getDb()
    .prepare('SELECT draft_json FROM workbench_drafts WHERE session_id = ?')
    .get(sessionId) as { draft_json: string } | undefined;
  return parseDraftJson(row?.draft_json);
}

function readDraftMap(sessionIds: string[]): Map<string, WorkbenchDraft> {
  if (sessionIds.length === 0) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT session_id, draft_json FROM workbench_drafts
       WHERE session_id IN (${sessionIds.map(() => '?').join(', ')})`,
    )
    .all(...sessionIds) as Array<{ session_id: string; draft_json: string }>;
  return new Map(rows.map((row) => [row.session_id, parseDraftJson(row.draft_json)]));
}

function writeDraft(sessionId: string, draft: WorkbenchDraft | null): void {
  if (draft) {
    getDb()
      .prepare(
        `INSERT INTO workbench_drafts (session_id, draft_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
      )
      .run(sessionId, JSON.stringify(draft), Date.now());
  } else {
    getDb().prepare('DELETE FROM workbench_drafts WHERE session_id = ?').run(sessionId);
  }
}

/** M4b 旁存 JSON 一次性并入受管表(幂等;导入后删文件,失败只告警不阻断)。 */
function importLegacyDraftsFile(): void {
  const path = join(app.getPath('userData'), LEGACY_DRAFTS_FILE);
  if (!existsSync(path)) return;
  try {
    const parsed = draftsFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (parsed.success) {
      const db = getDb();
      const sessionExists = db.prepare('SELECT 1 FROM workbench_sessions WHERE id = ?');
      const insert = db.prepare(
        `INSERT INTO workbench_drafts (session_id, draft_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO NOTHING`,
      );
      db.transaction(() => {
        for (const [sessionId, draft] of Object.entries(parsed.data)) {
          if (sessionExists.get(sessionId))
            insert.run(sessionId, JSON.stringify(draft), Date.now());
        }
      })();
    }
    rmSync(path, { force: true });
  } catch (error) {
    logger.warn('旁存草稿导入失败', error instanceof Error ? error.message : String(error));
  }
}

// ---------- 会话 ----------

interface SessionRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  deleted_at: number | null;
}

function sessionRowToDocument(row: SessionRow, draft: WorkbenchDraft): WorkbenchSession {
  return {
    id: row.id,
    title: row.title,
    draft,
    version: SYNTHETIC_VERSION,
    createdAt: epochMsToIso(row.created_at),
    updatedAt: epochMsToIso(row.updated_at),
    archivedAt: epochMsToIsoOrNull(row.archived_at),
    deletedAt: epochMsToIsoOrNull(row.deleted_at),
  };
}

function getSessionRow(id: string): SessionRow {
  const row = getDb().prepare('SELECT * FROM workbench_sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined;
  if (!row) throw new BridgeError('NOT_FOUND', '会话不存在');
  return row;
}

async function getSession(id: string): Promise<WorkbenchSession> {
  const row = getSessionRow(id);
  return sessionRowToDocument(row, readDraft(row.id));
}

// ---------- 生成 run → 契约 job ----------

interface RunRow {
  id: string;
  run_kind: string;
  workbench_session_id: string | null;
  parent_run_id: string | null;
  provider_id: string;
  model: string;
  final_prompt: string;
  negative_prompt: string | null;
  params_json: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  error_code: string | null;
  error_message: string | null;
  actual_cost: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  deleted_at: number | null;
}

interface AssetRow {
  id: string;
  run_id: string;
  position: number;
  status: string;
  media_path: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  file_size: number | null;
}

const RUN_STATUS_TO_JOB: Record<RunRow['status'], GenerationStatus> = {
  queued: 'queued',
  running: 'running',
  success: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
};

const MIME_FALLBACK = 'image/png';
const CONTRACT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function assetRowToContract(row: AssetRow): GenerationAsset | null {
  if (row.status !== 'available' || !row.media_path) return null;
  const mime = row.mime_type && CONTRACT_MIMES.has(row.mime_type) ? row.mime_type : MIME_FALLBACK;
  return {
    id: row.id,
    // 渲染层直接可用的本地读盘协议(media-protocol.ts)。
    url: `media://local/?p=${encodeURIComponent(row.media_path)}`,
    mimeType: mime as GenerationAsset['mimeType'],
    width: row.width ?? 1,
    height: row.height ?? 1,
    byteSize: row.file_size ?? 0,
    expiresAt: LOCAL_ASSET_EXPIRES_AT,
  };
}

function runRowToJob(row: RunRow, assets: AssetRow[]): GenerationJob {
  const params = JSON.parse(row.params_json) as GenerationParamsSnapshot;
  const status = RUN_STATUS_TO_JOB[row.status];
  return {
    id: row.id,
    sessionId: row.workbench_session_id,
    parentRunId: row.parent_run_id,
    promptId: null,
    actorType: 'desktop_local',
    approvalStatus: 'not_required',
    status,
    progress: status === 'succeeded' ? 100 : status === 'running' ? 50 : 0,
    request: {
      prompt: row.final_prompt,
      negative: row.negative_prompt ?? undefined,
      size: (params.size as GenerationJob['request']['size']) ?? 'auto',
      aspectRatio: params.aspectRatio,
      quality: (params.quality as GenerationJob['request']['quality']) ?? 'auto',
      count: 1,
      providerId: row.provider_id,
    },
    providerModel: row.model,
    costPoints: row.actual_cost != null ? Math.round(row.actual_cost) : null,
    assets: assets
      .filter((asset) => asset.run_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map(assetRowToContract)
      .filter((asset): asset is GenerationAsset => asset !== null),
    error:
      row.status === 'failed'
        ? {
            // 桌面本地错误码是自由字符串;契约码收敛为「上游拒绝」,细节在 message。
            code: 'GENERATION_UPSTREAM_REJECTED' as const,
            message: row.error_message ?? row.error_code ?? '生成失败',
          }
        : null,
    createdAt: epochMsToIso(row.created_at),
    startedAt: epochMsToIsoOrNull(row.started_at),
    finishedAt: epochMsToIsoOrNull(row.finished_at),
    deletedAt: epochMsToIsoOrNull(row.deleted_at),
  };
}

function getRunRow(id: string): RunRow {
  const row = getDb().prepare('SELECT * FROM generation_runs WHERE id = ?').get(id) as
    | RunRow
    | undefined;
  if (!row) throw new BridgeError('NOT_FOUND', '生成记录不存在');
  return row;
}

function getJob(id: string): GenerationJob {
  const row = getRunRow(id);
  const assets = getDb()
    .prepare('SELECT * FROM generated_assets WHERE run_id = ?')
    .all(id) as AssetRow[];
  return runRowToJob(row, assets);
}

// ---------- 生成提交 ----------

function resolveProviderId(requested: string | undefined): string {
  const db = getDb();
  if (requested) {
    const row = db.prepare('SELECT id FROM providers WHERE id = ?').get(requested);
    if (!row) throw new BridgeError('VALIDATION_FAILED', '所选 AI 连接不存在,请重新选择');
    return requested;
  }
  const first = db.prepare('SELECT id FROM providers ORDER BY created_at LIMIT 1').get() as
    | { id: string }
    | undefined;
  if (!first) {
    throw new BridgeError('VALIDATION_FAILED', '尚未配置 AI 连接,请先在设置中添加');
  }
  return first.id;
}

function nextTurnIndex(sessionId: string): number {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next FROM generation_runs WHERE workbench_session_id = ?',
    )
    .get(sessionId) as { next: number };
  return row.next;
}

/** 发起本地生图(不 await 完成),失败静默留给 run 状态呈现。 */
function fireGeneration(req: GenerateImageRequest, retryOfRunId?: string): void {
  generate(req, undefined, retryOfRunId ? { retryOfRunId } : {}).catch((error) => {
    logger.error('v25 生成异常', error instanceof Error ? error.message : String(error));
  });
}

/** 等 run 行出现(createRunContext 同步于 generate 开头,通常一拍即中)。 */
async function waitForRun(id: string, attempts = 20): Promise<GenerationJob> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return getJob(id);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return getJob(id);
}

// ---------- 方法表 ----------

export function buildWorkbenchDomainMethods(): Record<string, MethodDef> {
  const db = () => getDb();
  importLegacyDraftsFile();

  return {
    'workbench.listSessions': {
      input: workbenchSessionListQuerySchema,
      handle: async (input) => {
        const query = input as z.output<typeof workbenchSessionListQuerySchema>;
        const offset = parseOffsetCursor(query.cursor);
        const conditions: string[] = [];
        if (!query.includeDeleted) conditions.push('deleted_at IS NULL');
        if (!query.includeArchived) conditions.push('archived_at IS NULL');
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = db()
          .prepare(
            `SELECT * FROM workbench_sessions ${where}
             ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(query.limit + 1, offset) as SessionRow[];
        const page = rows.slice(0, query.limit);
        const drafts = readDraftMap(page.map((row) => row.id));
        return {
          items: page.map((row) => sessionRowToDocument(row, drafts.get(row.id) ?? EMPTY_DRAFT)),
          nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
        };
      },
    },
    'workbench.createSession': {
      input: createWorkbenchSessionSchema,
      handle: async (input) => {
        const parsed = input as z.output<typeof createWorkbenchSessionSchema>;
        const id = ulid();
        const now = Date.now();
        db()
          .prepare(
            `INSERT INTO workbench_sessions (id, title, created_at, updated_at, archived_at, deleted_at)
             VALUES (?, ?, ?, ?, NULL, NULL)`,
          )
          .run(id, parsed.title, now, now);
        const draft = workbenchDraftSchema.parse({ ...EMPTY_DRAFT, ...parsed.draft });
        writeDraft(id, draft);
        return getSession(id);
      },
    },
    'workbench.getSession': {
      input: entityIdSchema,
      handle: async (id) => getSession(id as string),
    },
    'workbench.updateSession': {
      input: z.object({ id: entityIdSchema, patch: updateWorkbenchSessionSchema }),
      handle: async (input) => {
        const { id, patch } = input as {
          id: string;
          patch: z.output<typeof updateWorkbenchSessionSchema>;
        };
        const row = getSessionRow(id);
        if (row.deleted_at != null) throw new BridgeError('CONFLICT', '会话已删除,请先恢复');
        const now = Date.now();
        if (patch.title !== undefined) {
          db()
            .prepare('UPDATE workbench_sessions SET title = ?, updated_at = ? WHERE id = ?')
            .run(patch.title, now, id);
        }
        if (patch.archived !== undefined) {
          db()
            .prepare('UPDATE workbench_sessions SET archived_at = ?, updated_at = ? WHERE id = ?')
            .run(patch.archived ? now : null, now, id);
        }
        if (patch.draft !== undefined) {
          writeDraft(id, patch.draft);
          db().prepare('UPDATE workbench_sessions SET updated_at = ? WHERE id = ?').run(now, id);
        }
        return getSession(id);
      },
    },
    'workbench.removeSession': {
      input: entityIdSchema,
      handle: async (id) => {
        getSessionRow(id as string);
        const now = Date.now();
        db()
          .prepare('UPDATE workbench_sessions SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, id);
        return getSession(id as string);
      },
    },
    'workbench.restoreSession': {
      input: entityIdSchema,
      handle: async (id) => {
        getSessionRow(id as string);
        db()
          .prepare('UPDATE workbench_sessions SET deleted_at = NULL, updated_at = ? WHERE id = ?')
          .run(Date.now(), id);
        return getSession(id as string);
      },
    },

    'generation.create': {
      input: createGenerationInputSchema,
      handle: async (input) => {
        const parsed = input as z.output<typeof createGenerationInputSchema>;
        const providerId = resolveProviderId(parsed.providerId);
        const jobId = ulid();
        let workbench: GenerateImageRequest['workbench'];
        if (parsed.sessionId) {
          const session = getSessionRow(parsed.sessionId);
          if (session.deleted_at != null) {
            throw new BridgeError('CONFLICT', '会话已删除,不能继续生成');
          }
          workbench = {
            sessionId: session.id,
            sessionTitle: session.title,
            turnId: ulid(),
            turnIndex: nextTurnIndex(session.id),
            resultIndex: 0,
            userPrompt: parsed.prompt,
          };
        }
        fireGeneration({
          providerId,
          jobId,
          prompt: parsed.prompt,
          negative: parsed.negative,
          size: parsed.size === 'auto' ? 'auto' : parsed.size,
          aspectRatio: parsed.aspectRatio,
          quality: parsed.quality,
          n: 1,
          promptId: parsed.promptId,
          workbench,
        });
        return waitForRun(jobId);
      },
    },
    'generation.list': {
      input: generationHistoryQuerySchema,
      handle: async (input) => {
        const query = input as z.output<typeof generationHistoryQuerySchema>;
        const offset = parseOffsetCursor(query.cursor);
        const conditions: string[] = [];
        const args: unknown[] = [];
        if (query.deletedOnly) conditions.push('r.deleted_at IS NOT NULL');
        else if (!query.includeDeleted) conditions.push('r.deleted_at IS NULL');
        if (query.sessionId) {
          conditions.push('r.workbench_session_id = ?');
          args.push(query.sessionId);
        }
        if (query.status) {
          const desktopStatus = Object.entries(RUN_STATUS_TO_JOB).find(
            ([, jobStatus]) => jobStatus === query.status,
          )?.[0];
          // 契约状态(如 pending_approval)在桌面无对应行,直接空集。
          if (!desktopStatus) return { items: [], nextCursor: null };
          conditions.push('r.status = ?');
          args.push(desktopStatus);
        }
        if (query.providerModel) {
          conditions.push('r.model = ?');
          args.push(query.providerModel);
        }
        if (query.search) {
          conditions.push('(r.final_prompt LIKE ? OR r.user_prompt LIKE ?)');
          const like = `%${query.search}%`;
          args.push(like, like);
        }
        if (query.from) {
          conditions.push('r.created_at >= ?');
          args.push(Date.parse(query.from));
        }
        if (query.to) {
          conditions.push('r.created_at <= ?');
          args.push(Date.parse(query.to));
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = db()
          .prepare(
            `SELECT r.* FROM generation_runs r ${where}
             ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
          )
          .all(...args, query.limit + 1, offset) as RunRow[];
        const page = rows.slice(0, query.limit);
        const ids = page.map((row) => row.id);
        const assets =
          ids.length > 0
            ? (db()
                .prepare(
                  `SELECT * FROM generated_assets WHERE run_id IN (${ids.map(() => '?').join(', ')})`,
                )
                .all(...ids) as AssetRow[])
            : [];
        return {
          items: page.map((row) => runRowToJob(row, assets)),
          nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
        };
      },
    },
    'generation.get': {
      input: entityIdSchema,
      handle: async (id) => getJob(id as string),
    },
    'generation.cancel': {
      input: entityIdSchema,
      handle: async (id) => {
        // 幂等:in-flight 时 abort 生效,generate 会把 run 写成 cancelled;
        // 已终态时无 controller,原样返回当前状态。
        cancelGeneration(id as string);
        return getJob(id as string);
      },
    },
    'generation.retry': {
      input: entityIdSchema,
      handle: async (id) => {
        const source = getRunRow(id as string);
        const params = JSON.parse(source.params_json) as GenerationParamsSnapshot;
        const jobId = ulid();
        fireGeneration(
          {
            providerId: source.provider_id,
            jobId,
            model: source.model,
            prompt: source.final_prompt,
            negative: source.negative_prompt ?? undefined,
            size: (params.size as GenerateImageRequest['size']) ?? 'auto',
            aspectRatio: params.aspectRatio,
            quality: (params.quality as GenerateImageRequest['quality']) ?? 'auto',
            n: 1,
            referenceImages: params.referenceImages,
          },
          source.id,
        );
        return waitForRun(jobId);
      },
    },
    'generation.remove': {
      input: entityIdSchema,
      handle: async (id) => {
        getRunRow(id as string);
        db()
          .prepare('UPDATE generation_runs SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?')
          .run(Date.now(), id);
        return getJob(id as string);
      },
    },
    'generation.restore': {
      input: entityIdSchema,
      handle: async (id) => {
        getRunRow(id as string);
        db().prepare('UPDATE generation_runs SET deleted_at = NULL WHERE id = ?').run(id);
        return getJob(id as string);
      },
    },
    'generation.listProviders': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const rows = db()
          .prepare('SELECT id, name, model, type FROM providers ORDER BY created_at')
          .all() as Array<{ id: string; name: string; model: string | null; type: string }>;
        return rows.map(
          (row): ProviderOption => ({
            id: row.id,
            label: row.name,
            model: row.model,
            kind: 'local',
            available: true,
          }),
        );
      },
    },
  };
}
