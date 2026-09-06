// v2.5 桌面 workbench/generation 域桥:contracts 形状 ↔ core SQLite。
// 会话正文在 workbench_sessions/generation_runs/generated_assets 三表;
// 草稿在受管表 workbench_drafts(desktop-db 0001 增量;M4b 的 userData JSON
// 旁存文件由 importLegacyDraftsFile 一次性并入后删除)。
// 生成走 core generate()(与旧 IPC 同一编排):桥内发起后立即返回 queued run,
// 渲染层轮询终态 —— 进度事件流等 M4e IPC 收口时统一补。

import type {
  GenerationAsset,
  GenerationJob,
  GenerationReferenceImage,
  GenerationStatus,
  PromptReferenceSelection,
  ResolvedPromptReferenceSnapshot,
  ProviderOption,
  WorkbenchDraft,
  WorkbenchSession,
} from '@musefold/contracts';
import {
  createGenerationInputSchema,
  createWorkbenchSessionSchema,
  entityIdSchema,
  generationHistoryQuerySchema,
  resolvedPromptReferenceSnapshotSchema,
  saveAssetInputSchema,
  updateWorkbenchSessionSchema,
  uploadReferenceImageInputSchema,
  workbenchDraftSchema,
  workbenchSessionListQuerySchema,
} from '@musefold/contracts';
import {
  composeGenerationPrompt,
  isValidUtf16SliceRange,
} from '@musefold/domain/generation-prompt';
import { getDb } from '@musefold/core/db';
import { resolveLocalContentWorkspace } from '@musefold/core/db/workspaces';
import { LocalImageError, stageLocalImageBytes } from '@musefold/core/providers/local-image';
import { getPaths } from '@musefold/core/runtime';
import type Database from 'better-sqlite3';
import type { GenerationParamsSnapshot } from '@musefold/desktop-contracts/workbench';
import type {
  GenerateImageRequest,
  LocalImageReference,
} from '@musefold/desktop-contracts/providers';
import { cancelGeneration, generate } from '@musefold/core/services/generation';
import { app, dialog } from 'electron';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
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
  promptReferenceSelections: [],
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

/** 会话行状态点(§3.3)派生:每会话最近一次生成的状态与完成时刻。 */
interface LatestJobRow {
  session_id: string;
  status: RunRow['status'];
  finished_at: number | null;
}

function readLatestJobMap(sessionIds: string[]): Map<string, LatestJobRow> {
  if (sessionIds.length === 0) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT r.workbench_session_id AS session_id, r.status, r.finished_at
       FROM generation_runs r
       JOIN (
         SELECT workbench_session_id AS sid, MAX(created_at) AS latest_created
         FROM generation_runs
         WHERE workbench_session_id IN (${sessionIds.map(() => '?').join(', ')})
           AND deleted_at IS NULL
         GROUP BY workbench_session_id
       ) latest ON latest.sid = r.workbench_session_id AND latest.latest_created = r.created_at
       WHERE r.deleted_at IS NULL`,
    )
    .all(...sessionIds) as LatestJobRow[];
  return new Map(rows.map((row) => [row.session_id, row]));
}

function sessionRowToDocument(
  row: SessionRow,
  draft: WorkbenchDraft,
  latest?: LatestJobRow,
): WorkbenchSession {
  return {
    id: row.id,
    title: row.title,
    draft,
    version: SYNTHETIC_VERSION,
    createdAt: epochMsToIso(row.created_at),
    updatedAt: epochMsToIso(row.updated_at),
    archivedAt: epochMsToIsoOrNull(row.archived_at),
    deletedAt: epochMsToIsoOrNull(row.deleted_at),
    latestJobStatus: latest ? RUN_STATUS_TO_JOB[latest.status] : null,
    latestJobFinishedAt: epochMsToIsoOrNull(latest?.finished_at),
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
  return sessionRowToDocument(row, readDraft(row.id), readLatestJobMap([row.id]).get(row.id));
}

// ---------- 生成 run → 契约 job ----------

interface RunRow {
  id: string;
  run_kind: string;
  workbench_session_id: string | null;
  parent_run_id: string | null;
  prompt_id: string | null;
  provider_id: string;
  model: string;
  user_prompt: string | null;
  base_prompt: string;
  final_prompt: string;
  negative_prompt: string | null;
  params_json: string;
  prompt_snapshot_json: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
  error_code: string | null;
  error_message: string | null;
  actual_cost: number | null;
  duration_ms: number | null;
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

/**
 * 解析 media://local/?p=<path> 为绝对路径并校验落在受管根目录内
 * (防目录穿越,与 media-protocol.ts 读盘通道同款约束;保存资产用)。
 */
function mediaUrlToManagedPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'media:') return null;
  const raw = parsed.searchParams.get('p');
  if (!raw) return null;
  const target = resolve(raw);
  const paths = getPaths();
  const roots = [paths.pictures, paths.previews, paths.userData].map((root) => resolve(root));
  return roots.some((root) => target === root || target.startsWith(root + sep)) ? target : null;
}

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

function parseStoredPromptSnapshot(raw: string | null | undefined): {
  userPrompt?: string;
  promptReferences: ResolvedPromptReferenceSnapshot[];
} {
  if (!raw) return { promptReferences: [] };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const userPrompt = typeof parsed.userPrompt === 'string' ? parsed.userPrompt : undefined;
    const promptReferences = Array.isArray(parsed.promptReferences)
      ? parsed.promptReferences.flatMap((reference) => {
          if (reference && typeof reference === 'object') {
            const value = reference as Record<string, unknown>;
            const normalized = {
              ...value,
              text: value.text ?? value.excerpt,
              sourceVersion:
                typeof value.sourceVersion === 'number' && value.sourceVersion > 0
                  ? value.sourceVersion
                  : 1,
            };
            const result = resolvedPromptReferenceSnapshotSchema.safeParse(normalized);
            return result.success ? [result.data] : [];
          }
          return [];
        })
      : [];
    return { userPrompt, promptReferences };
  } catch {
    return { promptReferences: [] };
  }
}

function userPromptForJob(
  row: RunRow,
  snapshot: ReturnType<typeof parseStoredPromptSnapshot>,
): string {
  return snapshot.userPrompt ?? (row.user_prompt?.trim() ? row.user_prompt : row.final_prompt);
}

/**
 * 终态用时:优先用 core 记录的 duration_ms(含上游耗时口径),
 * 缺列的旧行退回 finished-started 差值;两者都不可用即 null,不伪造 0。
 */
function runDurationMs(row: RunRow): number | null {
  if (row.duration_ms != null && row.duration_ms >= 0) return Math.round(row.duration_ms);
  if (row.started_at == null || row.finished_at == null) return null;
  const elapsed = row.finished_at - row.started_at;
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null;
}

/** Provider 回报的种子存在参数快照里(GenerationParamsSnapshot.seed);缺省即 null。 */
function runSeed(params: GenerationParamsSnapshot): number | null {
  return typeof params.seed === 'number' && Number.isInteger(params.seed) ? params.seed : null;
}

function runRowToJob(row: RunRow, assets: AssetRow[]): GenerationJob {
  const params = JSON.parse(row.params_json) as GenerationParamsSnapshot;
  const status = RUN_STATUS_TO_JOB[row.status];
  const snapshot = parseStoredPromptSnapshot(row.prompt_snapshot_json);
  return {
    id: row.id,
    sessionId: row.workbench_session_id,
    parentRunId: row.parent_run_id,
    promptId: row.prompt_id,
    userPrompt: userPromptForJob(row, snapshot),
    promptReferences: snapshot.promptReferences,
    actorType: 'desktop_local',
    approvalStatus: 'not_required',
    status,
    progress: status === 'succeeded' ? 100 : status === 'running' ? 50 : 0,
    request: {
      prompt: row.final_prompt,
      negative: row.negative_prompt ?? undefined,
      promptId: row.prompt_id ?? undefined,
      size: (params.size as GenerationJob['request']['size']) ?? 'auto',
      aspectRatio: params.aspectRatio,
      quality: (params.quality as GenerationJob['request']['quality']) ?? 'auto',
      count: 1,
      providerId: row.provider_id,
      referenceImages: (params.referenceImages ?? [])
        .map(stagedPathToContractReference)
        .filter((reference): reference is GenerationReferenceImage => reference !== null),
    },
    providerModel: row.model,
    costPoints: row.actual_cost != null ? Math.round(row.actual_cost) : null,
    durationMs: runDurationMs(row),
    seed: runSeed(params),
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

// ---------- 参考图(staging 目录 ↔ 契约引用) ----------

const REFERENCE_MIME_EXTENSION: Record<GenerationReferenceImage['mimeType'], string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const REFERENCE_EXTENSION_MIME: Record<string, GenerationReferenceImage['mimeType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function referenceUploadsDir(): string {
  return join(getPaths().previews, 'uploads');
}

function stagedPathToContractReference(
  reference: LocalImageReference,
): GenerationReferenceImage | null {
  const ext = extname(reference.path).toLowerCase();
  const mimeType = reference.mimeType ?? REFERENCE_EXTENSION_MIME[ext];
  if (!mimeType) return null;
  const stem = basename(reference.path, extname(reference.path));
  // 契约 id 只收 [0-9A-Za-z_-]{8,64}(staging 文件名是 ulid,天然满足);异常命名不回显。
  if (!/^[0-9A-Za-z_-]{8,64}$/.test(stem)) return null;
  return {
    id: stem,
    url: `media://local/?p=${encodeURIComponent(reference.path)}`,
    mimeType,
    name: reference.name?.trim() || `参考图${REFERENCE_MIME_EXTENSION[mimeType]}`,
    byteSize: reference.sizeBytes ?? 0,
  };
}

/**
 * 契约引用 → core LocalImageReference:路径由 staging 目录 + id + 扩展名重建,
 * 不信任渲染层自报 url;不存在的引用直接拒(core 侧 isManagedUploadPath 二次把关)。
 */
function contractReferenceToLocal(reference: GenerationReferenceImage): LocalImageReference {
  const path = join(
    referenceUploadsDir(),
    `${reference.id}${REFERENCE_MIME_EXTENSION[reference.mimeType]}`,
  );
  if (!existsSync(path)) {
    throw new BridgeError('VALIDATION_FAILED', `参考图「${reference.name}」已不可用,请重新添加`);
  }
  return { path, source: 'upload', name: reference.name };
}

/**
 * 按 staging id 找回 Composer 上传的参考图(设计方案运行复用生成上传通道):
 * 只在受管 uploads 目录内按已知扩展名探测,renderer 提交的是 id 不是路径;找不到返回 null。
 */
export function resolveUploadedReferenceById(id: string): LocalImageReference | null {
  if (!/^[0-9A-Za-z_-]{8,64}$/.test(id)) return null;
  const dir = referenceUploadsDir();
  for (const [mimeType, ext] of Object.entries(REFERENCE_MIME_EXTENSION)) {
    const path = join(dir, `${id}${ext}`);
    if (existsSync(path)) {
      return { path, source: 'upload', mimeType: mimeType as GenerationReferenceImage['mimeType'] };
    }
  }
  return null;
}

// ---------- 生成提交 ----------

interface PromptSourceRow {
  id: string;
  title: string;
  content: string;
  source_version: number;
}

export function resolvePromptReference(
  selection: PromptReferenceSelection,
  index: number,
  db: Database.Database = getDb(),
): ResolvedPromptReferenceSnapshot {
  let workspaceId: string;
  try {
    workspaceId = resolveLocalContentWorkspace(db);
  } catch {
    throw new BridgeError('VALIDATION_FAILED', '当前账号工作区尚未建立,无法读取提示词');
  }
  const row = db
    .prepare(
      `SELECT id, title, content FROM prompts
       WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(workspaceId, selection.promptId) as PromptSourceRow | undefined;
  if (!row) throw new BridgeError('NOT_FOUND', '引用的提示词不存在');
  if (selection.expectedVersion !== SYNTHETIC_VERSION) {
    throw new BridgeError('CONFLICT', '引用的提示词已更新,请重新选择');
  }

  const rawText =
    selection.scope === 'full'
      ? row.content
      : (() => {
          const { start, end } = selection.range;
          if (!isValidUtf16SliceRange(row.content, selection.range)) {
            throw new BridgeError('VALIDATION_FAILED', `第 ${index + 1} 条引用片段范围无效`);
          }
          return row.content.slice(start, end);
        })();
  const text = rawText.trim();
  if (!text) throw new BridgeError('VALIDATION_FAILED', `第 ${index + 1} 条引用片段不能为空`);
  try {
    return resolvedPromptReferenceSnapshotSchema.parse({
      promptId: row.id,
      title: row.title,
      text,
      scope: selection.scope,
      sourceVersion: SYNTHETIC_VERSION,
    });
  } catch {
    throw new BridgeError('VALIDATION_FAILED', `第 ${index + 1} 条引用片段无效`);
  }
}

export function resolvePromptReferences(
  selections: readonly PromptReferenceSelection[],
  db: Database.Database = getDb(),
): ResolvedPromptReferenceSnapshot[] {
  return selections.map((selection, index) => resolvePromptReference(selection, index, db));
}

function requireComposedPrompt(result: ReturnType<typeof composeGenerationPrompt>): {
  finalPrompt: string;
  promptReferences: ResolvedPromptReferenceSnapshot[];
} {
  if (result.ok) return result.data;
  throw new BridgeError('VALIDATION_FAILED', result.error.message);
}

function resolvedReferenceToCoreReference(
  reference: ResolvedPromptReferenceSnapshot,
): NonNullable<GenerateImageRequest['promptReferences']>[number] {
  return {
    promptId: reference.promptId ?? '',
    title: reference.title,
    text: reference.text,
    scope: reference.scope,
    sourceVersion: reference.sourceVersion,
  } as NonNullable<GenerateImageRequest['promptReferences']>[number];
}

function assertPromptAvailable(id: string | undefined): void {
  if (!id) return;
  let workspaceId: string;
  try {
    workspaceId = resolveLocalContentWorkspace(getDb());
  } catch {
    throw new BridgeError('VALIDATION_FAILED', '当前账号工作区尚未建立,无法读取提示词');
  }
  const row = getDb()
    .prepare(
      `SELECT id FROM prompts
       WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(workspaceId, id);
  if (!row) throw new BridgeError('NOT_FOUND', '提示词不存在');
}

function resolveProviderId(requested: string | undefined): string {
  const db = getDb();
  if (requested) {
    const row = db.prepare('SELECT id FROM providers WHERE id = ?').get(requested);
    if (!row) throw new BridgeError('VALIDATION_FAILED', '所选 AI 连接不存在,请重新选择');
    return requested;
  }
  // 未显式指定时跟随活跃连接(左下角账号区切换的落点),再按创建序兜底。
  const first = db
    .prepare('SELECT id FROM providers ORDER BY is_active DESC, created_at LIMIT 1')
    .get() as { id: string } | undefined;
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
function fireGeneration(
  req: GenerateImageRequest,
  retryOfRunId?: string,
  options: Parameters<typeof generate>[2] = {},
): void {
  generate(req, undefined, {
    ...options,
    ...(retryOfRunId ? { retryOfRunId } : {}),
  }).catch((error) => {
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
        if (query.archivedOnly) {
          conditions.push('archived_at IS NOT NULL');
          conditions.push('deleted_at IS NULL');
        } else {
          if (!query.includeDeleted) conditions.push('deleted_at IS NULL');
          if (!query.includeArchived) conditions.push('archived_at IS NULL');
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = db()
          .prepare(
            `SELECT * FROM workbench_sessions ${where}
             ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(query.limit + 1, offset) as SessionRow[];
        const page = rows.slice(0, query.limit);
        const drafts = readDraftMap(page.map((row) => row.id));
        const latest = readLatestJobMap(page.map((row) => row.id));
        return {
          items: page.map((row) =>
            sessionRowToDocument(row, drafts.get(row.id) ?? EMPTY_DRAFT, latest.get(row.id)),
          ),
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
      input: createGenerationInputSchema.strict(),
      handle: async (input) => {
        const parsed = input as z.output<typeof createGenerationInputSchema>;
        assertPromptAvailable(parsed.promptId);
        const promptReferences = resolvePromptReferences(parsed.promptReferenceSelections ?? []);
        const referenceImages = parsed.referenceImages.map(contractReferenceToLocal);
        const composed = requireComposedPrompt(
          composeGenerationPrompt({
            userPrompt: parsed.prompt,
            promptReferences,
            imageCount: referenceImages.length,
            ratioId: parsed.aspectRatio,
          }),
        );
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
        fireGeneration(
          {
            providerId,
            jobId,
            // The bridge owns the only live composition. Core receives the immutable
            // final prompt plus resolved snapshots and must not query Prompt rows.
            prompt: composed.finalPrompt,
            negative: parsed.negative,
            size: parsed.size === 'auto' ? 'auto' : parsed.size,
            aspectRatio: parsed.aspectRatio,
            quality: parsed.quality,
            n: 1,
            promptId: parsed.promptId,
            promptReferences: composed.promptReferences.map(resolvedReferenceToCoreReference),
            workbench,
            ...(referenceImages.length > 0 ? { referenceImages } : {}),
          },
          undefined,
          { promptAlreadyComposed: true, userPrompt: parsed.prompt },
        );
        return waitForRun(jobId);
      },
    },
    'generation.uploadReferenceImage': {
      input: uploadReferenceImageInputSchema,
      handle: async (input) => {
        const parsed = input as z.output<typeof uploadReferenceImageInputSchema>;
        try {
          const staged = await stageLocalImageBytes({ bytes: parsed.bytes, name: parsed.name });
          const reference = stagedPathToContractReference({ ...staged, name: parsed.name });
          if (!reference) throw new BridgeError('INTERNAL_ERROR', '参考图暂存结果异常');
          return reference;
        } catch (error) {
          if (error instanceof BridgeError) throw error;
          if (error instanceof LocalImageError) {
            throw new BridgeError('VALIDATION_FAILED', error.message);
          }
          throw error;
        }
      },
    },
    'generation.saveAsset': {
      input: saveAssetInputSchema,
      handle: async (input) => {
        const parsed = input as z.output<typeof saveAssetInputSchema>;
        const sourcePath = mediaUrlToManagedPath(parsed.url);
        if (!sourcePath || !existsSync(sourcePath)) {
          throw new BridgeError('VALIDATION_FAILED', '图片文件不存在或不可访问');
        }
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: join(app.getPath('downloads'), parsed.name),
        });
        if (canceled || !filePath) return 'cancelled';
        await copyFile(sourcePath, filePath);
        return 'saved';
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
        const current = getRunRow(id as string);
        if (current.status === 'cancelled') return getJob(id as string);
        if (current.status !== 'queued' && current.status !== 'running') {
          throw new BridgeError('CONFLICT', '生成任务已经结束');
        }
        cancelGeneration(id as string);
        return getJob(id as string);
      },
    },
    'generation.retry': {
      input: entityIdSchema,
      handle: async (id) => {
        const source = getRunRow(id as string);
        if (source.status !== 'failed' && source.status !== 'cancelled') {
          throw new BridgeError('CONFLICT', '只有失败或取消的任务可以重试');
        }
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
    'generation.purge': {
      input: entityIdSchema,
      handle: async (id) => {
        const row = getRunRow(id as string);
        if (row.deleted_at == null) {
          throw new BridgeError('VALIDATION_FAILED', '只能永久删除回收站中的记录');
        }
        if (row.status === 'queued' || row.status === 'running') {
          throw new BridgeError('VALIDATION_FAILED', '任务仍在进行中,请先取消');
        }
        const assets = db()
          .prepare('SELECT media_path FROM generated_assets WHERE run_id = ?')
          .all(id) as Array<{ media_path: string | null }>;
        // 先删行(assets 级联),后清磁盘:文件删除失败只留孤儿文件,不阻塞用户操作。
        db().prepare('DELETE FROM generation_runs WHERE id = ?').run(id);
        for (const asset of assets) {
          if (!asset.media_path) continue;
          try {
            rmSync(asset.media_path, { force: true });
          } catch (error) {
            logger.warn(
              '永久删除时清理资产文件失败',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        return undefined;
      },
    },
    'generation.listProviders': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        // 活跃连接置首:Composer 未显式选择时预选 providers[0],
        // 侧栏「更多连接」的切换(aiProviders.setActive)由此真正生效。
        const rows = db()
          .prepare(
            'SELECT id, name, model, type FROM providers ORDER BY is_active DESC, created_at',
          )
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
