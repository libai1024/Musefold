import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  EnsureWorkbenchSessionCommand,
  GeneratedAsset,
  GeneratedAssetStatus,
  GenerationParamsSnapshot,
  GenerationRun,
  GenerationRunKind,
  PromptSnapshot,
  WorkbenchSession,
  WorkbenchSessionDocument,
  WorkbenchSessionListQuery,
  WorkbenchSessionListResult,
} from '@musefold/desktop-contracts/workbench';
import { getDb } from '../index';
import { parseJsonColumn } from '../json';

type RunRow = {
  id: string; run_kind: GenerationRunKind; workbench_session_id: string | null;
  workbench_turn_id: string | null; turn_index: number | null; result_index: number | null;
  parent_run_id: string | null; retry_of_run_id: string | null; source_asset_id: string | null;
  provider_id: string; model: string; user_prompt: string; base_prompt: string;
  refinement_instruction: string | null; final_prompt: string; negative_prompt: string | null;
  params_json: string; prompt_snapshot_json: string; status: GenerationRun['status'];
  error_code: string | null; error_message: string | null; request_id: string | null;
  estimated_cost: number | null; actual_cost: number | null; duration_ms: number | null;
  created_at: number; started_at: number | null; finished_at: number | null; deleted_at: number | null;
};

type SessionRow = {
  id: string; title: string; created_at: number; updated_at: number;
  archived_at: number | null; deleted_at: number | null;
};

type AssetRow = {
  id: string; run_id: string; position: number; status: GeneratedAssetStatus;
  media_path: string | null; mime_type: string | null; width: number | null; height: number | null;
  file_size: number | null; checksum: string | null; created_at: number;
};

export interface CreateGenerationRunInput {
  id?: string;
  runKind?: GenerationRunKind;
  workbenchSessionId?: string | null;
  workbenchTurnId?: string | null;
  turnIndex?: number | null;
  resultIndex?: number | null;
  parentRunId?: string | null;
  retryOfRunId?: string | null;
  sourceAssetId?: string | null;
  providerId: string;
  model: string;
  userPrompt?: string;
  basePrompt: string;
  refinementInstruction?: string | null;
  finalPrompt: string;
  negativePrompt?: string | null;
  params: GenerationParamsSnapshot;
  promptSnapshot?: PromptSnapshot;
  createdAt?: number;
}

export interface CompleteGenerationRunInput {
  assets: Array<Partial<Omit<GeneratedAsset, 'runId'>> & { mediaPath: string }>;
  actualCost?: number | null;
  durationMs?: number | null;
  finishedAt?: number;
}

function rowToRun(row: RunRow): GenerationRun {
  const fallback: PromptSnapshot = {
    schemaVersion: 1,
    userPrompt: row.user_prompt,
    basePrompt: row.base_prompt,
    refinementInstruction: row.refinement_instruction,
    finalPrompt: row.final_prompt,
    negativePrompt: row.negative_prompt,
  };
  return {
    id: row.id,
    runKind: row.run_kind,
    workbenchSessionId: row.workbench_session_id,
    workbenchTurnId: row.workbench_turn_id,
    turnIndex: row.turn_index,
    resultIndex: row.result_index,
    parentRunId: row.parent_run_id,
    retryOfRunId: row.retry_of_run_id,
    sourceAssetId: row.source_asset_id,
    providerId: row.provider_id,
    model: row.model,
    userPrompt: row.user_prompt,
    basePrompt: row.base_prompt,
    refinementInstruction: row.refinement_instruction,
    finalPrompt: row.final_prompt,
    negativePrompt: row.negative_prompt,
    params: parseJsonColumn(row.params_json, { schemaVersion: 1 }),
    promptSnapshot: parseJsonColumn(row.prompt_snapshot_json, fallback),
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    requestId: row.request_id,
    estimatedCost: row.estimated_cost,
    actualCost: row.actual_cost,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    deletedAt: row.deleted_at,
  };
}

function rowToSession(row: SessionRow): WorkbenchSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  };
}

function rowToAsset(row: AssetRow): GeneratedAsset {
  return {
    id: row.id,
    runId: row.run_id,
    position: row.position,
    status: row.status,
    mediaPath: row.media_path,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    checksum: row.checksum,
    createdAt: row.created_at,
  };
}

export class WorkbenchRepository {
  constructor(private readonly db: Database.Database = getDb()) {}

  ensure(input: EnsureWorkbenchSessionCommand): WorkbenchSession {
    const id = input.id.trim();
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!id || !title) throw new Error('对话 ID 和标题不能为空');
    const existing = this.get(id, true);
    if (existing) {
      if (existing.deletedAt) throw new Error('已删除的对话不能继续生成');
      return existing;
    }
    const now = input.createdAt ?? Date.now();
    this.db.prepare(
      `INSERT INTO workbench_sessions (id, title, created_at, updated_at, archived_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
    ).run(id, title, now, now);
    return this.get(id)!;
  }

  touch(id: string, updatedAt = Date.now()): WorkbenchSession {
    if (!this.get(id)) throw new Error('对话不存在');
    this.db.prepare(
      'UPDATE workbench_sessions SET updated_at = MAX(updated_at, ?) WHERE id = ? AND deleted_at IS NULL',
    ).run(updatedAt, id);
    return this.get(id)!;
  }

  get(id: string, includeDeleted = false): WorkbenchSession | null {
    const row = this.db.prepare(
      `SELECT * FROM workbench_sessions WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
    ).get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  list(query: WorkbenchSessionListQuery = {}): WorkbenchSessionListResult {
    const limit = Math.min(Math.max(query.limit ?? 60, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const archived = Boolean(query.archived);
    const where = `deleted_at IS NULL AND archived_at IS ${archived ? 'NOT ' : ''}NULL`;
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS value FROM workbench_sessions WHERE ${where}`).get() as { value: number }).value);
    const rows = this.db.prepare(
      `SELECT ws.*,
          COUNT(gr.id) AS run_count,
          COUNT(DISTINCT gr.workbench_turn_id) AS turn_count,
          CASE WHEN MAX(CASE WHEN json_extract(gr.params_json, '$.sourceKind') = 'prompt' THEN 1 ELSE 0 END) = 1
            THEN 'prompt' ELSE 'chat' END AS conversation_kind,
          (SELECT ga.media_path FROM generation_runs latest
             JOIN generated_assets ga ON ga.run_id = latest.id AND ga.status = 'available'
            WHERE latest.workbench_session_id = ws.id AND latest.deleted_at IS NULL
            ORDER BY latest.created_at DESC, ga.position ASC LIMIT 1) AS latest_asset_path,
          (SELECT latest.status FROM generation_runs latest
            WHERE latest.workbench_session_id = ws.id AND latest.deleted_at IS NULL
            ORDER BY latest.created_at DESC, latest.result_index DESC LIMIT 1) AS latest_status
       FROM workbench_sessions ws
       LEFT JOIN generation_runs gr ON gr.workbench_session_id = ws.id AND gr.deleted_at IS NULL
       WHERE ws.${where}
       GROUP BY ws.id ORDER BY ws.updated_at DESC, ws.id DESC LIMIT ? OFFSET ?`,
    ).all(limit, offset) as Array<SessionRow & {
      run_count: number; turn_count: number; conversation_kind: 'chat' | 'prompt';
      latest_asset_path: string | null; latest_status: GenerationRun['status'] | null;
    }>;
    return {
      items: rows.map((row) => ({
        ...rowToSession(row),
        runCount: Number(row.run_count),
        turnCount: Number(row.turn_count),
        latestAssetPath: row.latest_asset_path,
        conversationKind: row.conversation_kind,
        latestStatus: row.latest_status,
      })),
      total,
      limit,
      offset,
    };
  }

  getDocument(id: string): WorkbenchSessionDocument | null {
    const session = this.get(id);
    if (!session) return null;
    const runs = (this.db.prepare(
      `SELECT * FROM generation_runs WHERE workbench_session_id = ? AND deleted_at IS NULL
       ORDER BY turn_index, result_index, created_at, id`,
    ).all(id) as RunRow[]).map(rowToRun);
    const assets = this.db.prepare(
      `SELECT ga.* FROM generated_assets ga JOIN generation_runs gr ON gr.id = ga.run_id
       WHERE gr.workbench_session_id = ? ORDER BY ga.run_id, ga.position`,
    ).all(id) as AssetRow[];
    return {
      session,
      runs: runs.map((run) => ({
        run,
        assets: assets.filter((asset) => asset.run_id === run.id).map(rowToAsset),
        promptReferences: [],
      })),
    };
  }

  rename(id: string, title: string): WorkbenchSession {
    const normalized = title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!normalized || !this.get(id)) throw new Error('对话不存在或标题为空');
    this.db.prepare('UPDATE workbench_sessions SET title = ?, updated_at = ? WHERE id = ?').run(normalized, Date.now(), id);
    return this.get(id)!;
  }

  archive(id: string, archived = true): WorkbenchSession {
    if (!this.get(id)) throw new Error('对话不存在');
    const now = Date.now();
    this.db.prepare('UPDATE workbench_sessions SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now : null, now, id);
    return this.get(id)!;
  }

  softDelete(id: string): WorkbenchSession {
    if (!this.get(id)) throw new Error('对话不存在');
    const now = Date.now();
    this.db.prepare('UPDATE workbench_sessions SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
    return this.get(id, true)!;
  }
}

export class GenerationRunRepository {
  constructor(private readonly db: Database.Database = getDb()) {}

  get(id: string): GenerationRun | null {
    const row = this.db.prepare('SELECT * FROM generation_runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  create(input: CreateGenerationRunInput): GenerationRun {
    const id = input.id ?? ulid();
    const createdAt = input.createdAt ?? Date.now();
    const promptSnapshot = input.promptSnapshot ?? {
      schemaVersion: 1 as const,
      userPrompt: input.userPrompt ?? '',
      basePrompt: input.basePrompt,
      refinementInstruction: input.refinementInstruction ?? null,
      finalPrompt: input.finalPrompt,
      negativePrompt: input.negativePrompt ?? null,
    };
    this.db.prepare(
      `INSERT INTO generation_runs
        (id, run_kind, workbench_session_id, workbench_turn_id, turn_index, result_index,
         parent_run_id, retry_of_run_id, source_asset_id, provider_id, model, user_prompt,
         base_prompt, refinement_instruction, final_prompt, negative_prompt, params_json,
         prompt_snapshot_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(
      id, input.runKind ?? 'free_generation', input.workbenchSessionId ?? null,
      input.workbenchTurnId ?? null, input.turnIndex ?? null, input.resultIndex ?? null,
      input.parentRunId ?? null, input.retryOfRunId ?? null, input.sourceAssetId ?? null,
      input.providerId, input.model, input.userPrompt ?? '', input.basePrompt,
      input.refinementInstruction ?? null, input.finalPrompt, input.negativePrompt ?? null,
      JSON.stringify(input.params), JSON.stringify(promptSnapshot), createdAt,
    );
    return this.get(id)!;
  }

  start(id: string, requestId?: string | null, startedAt = Date.now()): GenerationRun {
    this.db.prepare(
      `UPDATE generation_runs SET status = 'running', request_id = ?, started_at = ? WHERE id = ? AND status = 'queued'`,
    ).run(requestId ?? null, startedAt, id);
    return this.get(id)!;
  }

  complete(id: string, input: CompleteGenerationRunInput): GenerationRun {
    const finishedAt = input.finishedAt ?? Date.now();
    this.db.transaction(() => {
      input.assets.forEach((asset, position) => {
        this.db.prepare(
          `INSERT INTO generated_assets
            (id, run_id, position, status, media_path, mime_type, width, height, file_size, checksum, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          asset.id ?? (position === 0 ? id : `${id}-${position + 1}`), id,
          asset.position ?? position, asset.status ?? 'available', asset.mediaPath,
          asset.mimeType ?? null, asset.width ?? null, asset.height ?? null,
          asset.fileSize ?? null, asset.checksum ?? null, asset.createdAt ?? finishedAt,
        );
      });
      this.db.prepare(
        `UPDATE generation_runs SET status = 'success', actual_cost = ?, duration_ms = ?, finished_at = ? WHERE id = ?`,
      ).run(input.actualCost ?? null, input.durationMs ?? null, finishedAt, id);
    })();
    return this.get(id)!;
  }

  fail(id: string, errorCode: string, errorMessage: string, finishedAt = Date.now()): GenerationRun {
    this.db.prepare(
      `UPDATE generation_runs SET status = 'failed', error_code = ?, error_message = ?, finished_at = ? WHERE id = ?`,
    ).run(errorCode, errorMessage, finishedAt, id);
    return this.get(id)!;
  }

  cancel(id: string, finishedAt = Date.now()): GenerationRun {
    this.db.prepare(`UPDATE generation_runs SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(finishedAt, id);
    return this.get(id)!;
  }

  softDelete(ids: string[], deletedAt = Date.now()): number {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return 0;
    return this.db.prepare(
      `UPDATE generation_runs SET deleted_at = COALESCE(deleted_at, ?)
       WHERE id IN (${unique.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
    ).run(deletedAt, ...unique).changes;
  }

  getAsset(id: string): GeneratedAsset | null {
    const row = this.db.prepare('SELECT * FROM generated_assets WHERE id = ?').get(id) as AssetRow | undefined;
    return row ? rowToAsset(row) : null;
  }
}

export function createWorkbenchRepositories(db: Database.Database = getDb()) {
  return {
    sessions: new WorkbenchRepository(db),
    runs: new GenerationRunRepository(db),
  };
}
