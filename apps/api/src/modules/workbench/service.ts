import { randomUUID } from 'node:crypto';
import {
  type CreateWorkbenchSession,
  type ParsedWorkbenchSessionListQuery,
  type UpdateWorkbenchSession,
  type WorkbenchDraft,
  type WorkbenchSession,
  type WorkbenchSessionPage,
  type WorkbenchSessionCleanupResult,
  createWorkbenchSessionSchema,
  updateWorkbenchSessionSchema,
  workbenchSessionListQuerySchema,
  workbenchSessionCursorSchema,
  getWorkbenchSessionFilter,
} from '@musefold/contracts';
import { type MusefoldDatabase, prompts, workbenchSessions, generationRuns } from '@musefold/db';
import { and, desc, eq, inArray, isNull, isNotNull, getTableColumns, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import type { DbLike } from '../sync/change-log.js';

type Tx = DbLike;

/** 会话行状态点(§3.3)的派生数据:每会话最近一次生成的状态与完成时刻。 */
interface LatestJob {
  status: WorkbenchSession['latestJobStatus'];
  finishedAt: string | null;
}

export class WorkbenchService {
  constructor(private readonly db: MusefoldDatabase) {}

  async purge(userId: string, id: string): Promise<WorkbenchSessionCleanupResult> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: workbenchSessions.id, deletedAt: workbenchSessions.deletedAt })
        .from(workbenchSessions)
        .where(and(eq(workbenchSessions.userId, userId), eq(workbenchSessions.id, id)))
        .for('update');
      if (!row) return { purged: 0 };
      if (row.deletedAt === null)
        throw new AppError('VALIDATION_FAILED', '只能永久删除回收站中的会话');
      await this.deleteLockedSessions(tx, userId, [id]);
      return { purged: 1 };
    });
  }

  async emptyTrash(userId: string): Promise<WorkbenchSessionCleanupResult> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: workbenchSessions.id })
        .from(workbenchSessions)
        .where(and(eq(workbenchSessions.userId, userId), isNotNull(workbenchSessions.deletedAt)))
        .orderBy(workbenchSessions.id)
        .for('update');
      await this.deleteLockedSessions(
        tx,
        userId,
        rows.map((row) => row.id),
      );
      return { purged: rows.length };
    });
  }

  private async deleteLockedSessions(tx: Tx, userId: string, ids: string[]): Promise<void> {
    // Bound SQL parameters, while keeping the entire selected trash set atomic.
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      await tx
        .update(generationRuns)
        .set({ sessionId: null })
        .where(and(eq(generationRuns.userId, userId), inArray(generationRuns.sessionId, chunk)));
      await tx
        .delete(workbenchSessions)
        .where(
          and(
            eq(workbenchSessions.userId, userId),
            inArray(workbenchSessions.id, chunk),
            isNotNull(workbenchSessions.deletedAt),
          ),
        );
    }
  }

  async list(
    userId: string,
    rawQuery: ParsedWorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionPage> {
    const query = workbenchSessionListQuerySchema.parse(rawQuery);
    const filter = getWorkbenchSessionFilter(query);
    const conditions = [eq(workbenchSessions.userId, userId)];
    if (filter === 'trash') conditions.push(isNotNull(workbenchSessions.deletedAt));
    if (filter === 'active' || filter === 'live' || filter === 'archived')
      conditions.push(isNull(workbenchSessions.deletedAt));
    if (filter === 'archived') conditions.push(isNotNull(workbenchSessions.archivedAt));
    if (filter === 'active' || filter === 'unarchived')
      conditions.push(isNull(workbenchSessions.archivedAt));
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor, filter);
      // Bind the exact PG timestamp text instead of truncating through JavaScript Date.
      conditions.push(sql`(${workbenchSessions.updatedAt}, ${workbenchSessions.id} COLLATE "C")
        < (${cursor.updatedAt}::timestamptz, ${cursor.id}::text COLLATE "C")`);
    }
    const rows = await this.db
      .select({
        ...getTableColumns(workbenchSessions),
        cursorUpdatedAt: sql<string>`to_char(${workbenchSessions.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(workbenchSessions)
      .where(and(...conditions))
      .orderBy(desc(workbenchSessions.updatedAt), sql`${workbenchSessions.id} COLLATE "C" DESC`)
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    const latest = await this.latestJobBySession(
      this.db,
      userId,
      page.map((row) => row.id),
    );
    return {
      items: page.map((row) => toWorkbenchSession(row, latest.get(row.id))),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify(
                workbenchSessionCursorSchema.parse({
                  version: 1,
                  store: 'postgres',
                  filter,
                  id: last.id,
                  updatedAt: last.cursorUpdatedAt,
                }),
              ),
              'utf8',
            ).toString('base64url')
          : null,
    };
  }

  async get(userId: string, id: string): Promise<WorkbenchSession> {
    return this.getTx(this.db, userId, id);
  }

  async create(userId: string, rawInput: CreateWorkbenchSession): Promise<WorkbenchSession> {
    const input = createWorkbenchSessionSchema.parse(rawInput);
    return this.db.transaction(async (tx) => {
      const draft: WorkbenchDraft = {
        prompt: input.draft.prompt ?? '',
        negative: input.draft.negative ?? '',
        params: input.draft.params ?? {},
        promptReferenceSelections: input.draft.promptReferenceSelections ?? [],
        promptReferenceIds: input.draft.promptReferenceIds ?? [],
      };
      await this.validatePromptReferences(tx, userId, [
        ...draft.promptReferenceIds,
        ...draft.promptReferenceSelections.map((selection) => selection.promptId),
      ]);
      const id = randomUUID();
      await tx.insert(workbenchSessions).values({
        id,
        userId,
        title: input.title,
        draft: draft as unknown as Record<string, unknown>,
      });
      return this.getTx(tx, userId, id);
    });
  }

  async update(
    userId: string,
    id: string,
    rawInput: UpdateWorkbenchSession,
  ): Promise<WorkbenchSession> {
    const input = updateWorkbenchSessionSchema.parse(rawInput);
    return this.db.transaction(async (tx) => {
      const current = await this.getTx(tx, userId, id);
      if (current.deletedAt !== null || current.version !== input.expectedVersion) {
        throw conflict(current);
      }
      if (input.draft)
        await this.validatePromptReferences(tx, userId, [
          ...input.draft.promptReferenceIds,
          ...input.draft.promptReferenceSelections.map((selection) => selection.promptId),
        ]);
      const set: Record<string, unknown> = {
        version: sql`${workbenchSessions.version} + 1`,
        updatedAt: new Date(),
      };
      if (input.title !== undefined) set.title = input.title;
      if (input.draft !== undefined) set.draft = input.draft;
      if (input.archived !== undefined) set.archivedAt = input.archived ? new Date() : null;
      if (Object.keys(set).length === 2) {
        throw new AppError('VALIDATION_FAILED', '没有可更新的工作台字段');
      }
      const updated = await tx
        .update(workbenchSessions)
        .set(set)
        .where(
          and(
            eq(workbenchSessions.userId, userId),
            eq(workbenchSessions.id, id),
            eq(workbenchSessions.version, input.expectedVersion),
            isNull(workbenchSessions.deletedAt),
          ),
        )
        .returning({ id: workbenchSessions.id });
      // 乐观锁以受影响行数裁决:0 行说明预检通过后、落库前有并发提交,输掉竞态。
      // 抛稳定 CONFLICT,而不是把胜者状态当本次写入的成功结果返回。
      if (updated.length === 0) {
        throw conflict(await this.getTx(tx, userId, id));
      }
      return this.getTx(tx, userId, id);
    });
  }

  async remove(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
  ): Promise<WorkbenchSession> {
    return this.changeDeletedState(userId, id, expectedVersion, true);
  }

  async restore(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
  ): Promise<WorkbenchSession> {
    return this.changeDeletedState(userId, id, expectedVersion, false);
  }

  private async changeDeletedState(
    userId: string,
    id: string,
    expectedVersion: number | undefined,
    deleted: boolean,
  ): Promise<WorkbenchSession> {
    return this.db.transaction(async (tx) => {
      const current = await this.getTx(tx, userId, id);
      // 缺省 expectedVersion 视为无条件执行(api-client remove/restore 不携带版本)。
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw conflict(current);
      }
      const updated = await tx
        .update(workbenchSessions)
        .set({
          deletedAt: deleted ? new Date() : null,
          version: sql`${workbenchSessions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workbenchSessions.userId, userId),
            eq(workbenchSessions.id, id),
            // 无条件路径不设版本谓词,靠 version = version + 1 原子自增,删除/恢复必然落库;
            // 显式版本路径由谓词 + 受影响行数做乐观锁裁决。
            expectedVersion !== undefined
              ? eq(workbenchSessions.version, expectedVersion)
              : undefined,
          ),
        )
        .returning({ id: workbenchSessions.id });
      // 0 行 = 显式版本输给并发提交:抛稳定 CONFLICT,不把胜者状态当成功返回。
      if (updated.length === 0) {
        throw conflict(await this.getTx(tx, userId, id));
      }
      return this.getTx(tx, userId, id);
    });
  }

  private async getTx(tx: Tx, userId: string, id: string): Promise<WorkbenchSession> {
    const rows = await tx
      .select()
      .from(workbenchSessions)
      .where(and(eq(workbenchSessions.userId, userId), eq(workbenchSessions.id, id)));
    if (!rows[0]) throw new AppError('WORKBENCH_SESSION_NOT_FOUND', '工作台会话不存在');
    const latest = await this.latestJobBySession(tx, userId, [id]);
    return toWorkbenchSession(rows[0], latest.get(id));
  }

  private async latestJobBySession(
    tx: Tx,
    userId: string,
    sessionIds: string[],
  ): Promise<Map<string, LatestJob>> {
    if (sessionIds.length === 0) return new Map();
    const result = await tx.execute(sql`
      SELECT DISTINCT ON (session_id) session_id, status, finished_at
      FROM generation_runs
      WHERE user_id = ${userId}
        AND session_id IN (${sql.join(
          sessionIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND deleted_at IS NULL
      ORDER BY session_id, created_at DESC, id DESC
    `);
    const map = new Map<string, LatestJob>();
    for (const raw of result.rows as unknown as Array<Record<string, unknown>>) {
      map.set(String(raw.session_id), {
        status: raw.status as LatestJob['status'],
        finishedAt:
          raw.finished_at == null ? null : new Date(String(raw.finished_at)).toISOString(),
      });
    }
    return map;
  }

  private async validatePromptReferences(tx: Tx, userId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const rows = await tx
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(eq(prompts.userId, userId), inArray(prompts.id, unique), isNull(prompts.deletedAt)),
      );
    if (rows.length !== unique.length) {
      throw new AppError('VALIDATION_FAILED', '工作台引用了不存在或已删除的提示词');
    }
  }
}

function toWorkbenchSession(
  row: typeof workbenchSessions.$inferSelect,
  latest?: LatestJob,
): WorkbenchSession {
  const draft = row.draft as unknown as WorkbenchDraft;
  return {
    id: row.id,
    title: row.title,
    draft: {
      prompt: draft.prompt ?? '',
      negative: draft.negative ?? '',
      params: draft.params ?? {},
      promptReferenceSelections: draft.promptReferenceSelections ?? [],
      promptReferenceIds: draft.promptReferenceIds ?? [],
    },
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    latestJobStatus: latest?.status ?? null,
    latestJobFinishedAt: latest?.finishedAt ?? null,
  };
}

function conflict(current: WorkbenchSession): AppError {
  return new AppError('WORKBENCH_VERSION_CONFLICT', '工作台草稿已在其他设备更新', 409, false, {
    current,
  });
}

function decodeCursor(cursor: string, filter: ReturnType<typeof getWorkbenchSessionFilter>) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid encoding');
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor)
      throw new Error('Invalid encoding');
    const parsed = workbenchSessionCursorSchema.parse(JSON.parse(decoded));
    if (parsed.store !== 'postgres' || parsed.filter !== filter) throw new Error('Changed scope');
    return parsed;
  } catch {
    throw new AppError('VALIDATION_FAILED', '工作台分页游标无效或已过期，请刷新列表');
  }
}
