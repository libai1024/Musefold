import { randomUUID } from 'node:crypto';
import {
  type CreateWorkbenchSession,
  type ParsedWorkbenchSessionListQuery,
  type UpdateWorkbenchSession,
  type WorkbenchDraft,
  type WorkbenchSession,
  type WorkbenchSessionPage,
  createWorkbenchSessionSchema,
  updateWorkbenchSessionSchema,
  workbenchSessionListQuerySchema,
} from '@musefold/contracts';
import { type MusefoldDatabase, prompts, workbenchSessions } from '@musefold/db';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
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

  async list(
    userId: string,
    rawQuery: ParsedWorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionPage> {
    const query = workbenchSessionListQuerySchema.parse(rawQuery);
    const conditions = [eq(workbenchSessions.userId, userId)];
    if (!query.includeDeleted) conditions.push(isNull(workbenchSessions.deletedAt));
    if (!query.includeArchived) conditions.push(isNull(workbenchSessions.archivedAt));
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      const cursorDate = new Date(cursor.updatedAt);
      const boundary = or(
        lt(workbenchSessions.updatedAt, cursorDate),
        and(eq(workbenchSessions.updatedAt, cursorDate), lt(workbenchSessions.id, cursor.id)),
      );
      if (boundary) conditions.push(boundary);
    }
    const rows = await this.db
      .select()
      .from(workbenchSessions)
      .where(and(...conditions))
      .orderBy(desc(workbenchSessions.updatedAt), desc(workbenchSessions.id))
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
          ? encodeCursor({ id: last.id, updatedAt: last.updatedAt.toISOString() })
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
        promptReferenceIds: input.draft.promptReferenceIds ?? [],
      };
      await this.validatePromptReferences(tx, userId, draft.promptReferenceIds);
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
      if (current.version !== input.expectedVersion) throw conflict(current);
      if (input.draft)
        await this.validatePromptReferences(tx, userId, input.draft.promptReferenceIds);
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
      await tx
        .update(workbenchSessions)
        .set(set)
        .where(
          and(
            eq(workbenchSessions.userId, userId),
            eq(workbenchSessions.id, id),
            eq(workbenchSessions.version, input.expectedVersion),
          ),
        );
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
      await tx
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
            eq(workbenchSessions.version, current.version),
          ),
        );
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

function encodeCursor(value: { id: string; updatedAt: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { id: string; updatedAt: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      id?: unknown;
      updatedAt?: unknown;
    };
    if (typeof parsed.id !== 'string' || typeof parsed.updatedAt !== 'string') {
      throw new Error('invalid');
    }
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    throw new AppError('VALIDATION_FAILED', '工作台分页游标无效');
  }
}
