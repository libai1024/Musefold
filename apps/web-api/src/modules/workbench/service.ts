import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import {
  createWorkbenchSessionSchema,
  updateWorkbenchSessionSchema,
  workbenchSessionListQuerySchema,
  type CreateWorkbenchSession,
  type ParsedWorkbenchSessionListQuery,
  type UpdateWorkbenchSession,
  type WorkbenchSession,
  type WorkbenchSessionPage,
} from '@musefold/contracts';
import {
  withOwnerTransaction,
  type OwnerTransaction,
} from '../../database/owner-context.js';
import type { MusefoldDatabase } from '../../database/types.js';
import { AppError } from '../../errors.js';

type WorkbenchRow = {
  id: string;
  title: string;
  draft_prompt: string;
  draft_negative: string;
  draft_params: WorkbenchSession['draft']['params'];
  prompt_reference_ids: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  deleted_at: Date | string | null;
};

export interface WorkbenchServicePort {
  list(
    ownerId: number,
    query: ParsedWorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionPage>;
  get(ownerId: number, id: string): Promise<WorkbenchSession>;
  create(
    ownerId: number,
    input: CreateWorkbenchSession,
  ): Promise<WorkbenchSession>;
  update(
    ownerId: number,
    id: string,
    input: UpdateWorkbenchSession,
  ): Promise<WorkbenchSession>;
  remove(
    ownerId: number,
    id: string,
    expectedVersion: number,
  ): Promise<WorkbenchSession>;
  restore(
    ownerId: number,
    id: string,
    expectedVersion: number,
  ): Promise<WorkbenchSession>;
}

export class WorkbenchService implements WorkbenchServicePort {
  constructor(private readonly db: Kysely<MusefoldDatabase>) {}

  async list(
    ownerId: number,
    rawQuery: ParsedWorkbenchSessionListQuery,
  ): Promise<WorkbenchSessionPage> {
    const query = workbenchSessionListQuerySchema.parse(rawQuery);
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const conditions = [
        query.includeDeleted ? sql`TRUE` : sql`deleted_at IS NULL`,
      ];
      if (!query.includeArchived) conditions.push(sql`archived_at IS NULL`);
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        conditions.push(
          sql`(updated_at, id) < (${new Date(cursor.updatedAt)}, ${cursor.id})`,
        );
      }
      const result = await sql<WorkbenchRow>`
        SELECT id, title, draft_prompt, draft_negative, draft_params,
          prompt_reference_ids, version, created_at, updated_at, archived_at, deleted_at
        FROM app.workbench_sessions
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY updated_at DESC, id DESC
        LIMIT ${query.limit + 1}
      `.execute(trx);
      const hasMore = result.rows.length > query.limit;
      const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const last = rows.at(-1);
      return {
        items: rows.map(toWorkbenchSession),
        nextCursor:
          hasMore && last
            ? encodeCursor({ id: last.id, updatedAt: toIso(last.updated_at) })
            : null,
      };
    });
  }

  async get(ownerId: number, id: string): Promise<WorkbenchSession> {
    return withOwnerTransaction(this.db, ownerId, async (trx) =>
      this.getTx(trx, id),
    );
  }

  async create(
    ownerId: number,
    rawInput: CreateWorkbenchSession,
  ): Promise<WorkbenchSession> {
    const input = createWorkbenchSessionSchema.parse(rawInput);
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const draft = {
        prompt: input.draft.prompt ?? '',
        negative: input.draft.negative ?? '',
        params: input.draft.params ?? {},
        promptReferenceIds: input.draft.promptReferenceIds ?? [],
      };
      await this.validatePromptReferences(trx, draft.promptReferenceIds);
      const id = randomUUID();
      await sql`
        INSERT INTO app.workbench_sessions(
          owner_id, id, title, draft_prompt, draft_negative, draft_params, prompt_reference_ids
        ) VALUES (
          ${ownerId}, ${id}, ${input.title}, ${draft.prompt}, ${draft.negative},
          ${JSON.stringify(draft.params)}, ${JSON.stringify(draft.promptReferenceIds)}
        )
      `.execute(trx);
      return this.getTx(trx, id);
    });
  }

  async update(
    ownerId: number,
    id: string,
    rawInput: UpdateWorkbenchSession,
  ): Promise<WorkbenchSession> {
    const input = updateWorkbenchSessionSchema.parse(rawInput);
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const current = await this.getTx(trx, id);
      if (current.version !== input.expectedVersion) throw conflict(current);
      if (input.draft)
        await this.validatePromptReferences(
          trx,
          input.draft.promptReferenceIds,
        );
      const sets = [sql`version = version + 1`, sql`updated_at = now()`];
      if (input.title !== undefined) sets.push(sql`title = ${input.title}`);
      if (input.draft !== undefined) {
        sets.push(sql`draft_prompt = ${input.draft.prompt}`);
        sets.push(sql`draft_negative = ${input.draft.negative}`);
        sets.push(sql`draft_params = ${JSON.stringify(input.draft.params)}`);
        sets.push(
          sql`prompt_reference_ids = ${JSON.stringify(input.draft.promptReferenceIds)}`,
        );
      }
      if (input.archived !== undefined)
        sets.push(
          sql`archived_at = ${input.archived ? sql`now()` : sql`NULL`}`,
        );
      if (sets.length === 2)
        throw new AppError('VALIDATION_FAILED', '没有可更新的工作台字段', 400);
      await sql`
        UPDATE app.workbench_sessions SET ${sql.join(sets, sql`, `)}
        WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${input.expectedVersion}
      `.execute(trx);
      return this.getTx(trx, id);
    });
  }

  async remove(
    ownerId: number,
    id: string,
    expectedVersion: number,
  ): Promise<WorkbenchSession> {
    return this.changeDeletedState(ownerId, id, expectedVersion, true);
  }

  async restore(
    ownerId: number,
    id: string,
    expectedVersion: number,
  ): Promise<WorkbenchSession> {
    return this.changeDeletedState(ownerId, id, expectedVersion, false);
  }

  private async changeDeletedState(
    ownerId: number,
    id: string,
    expectedVersion: number,
    deleted: boolean,
  ): Promise<WorkbenchSession> {
    return withOwnerTransaction(this.db, ownerId, async (trx) => {
      const current = await this.getTx(trx, id);
      if (current.version !== expectedVersion) throw conflict(current);
      await sql`
        UPDATE app.workbench_sessions
        SET deleted_at = ${deleted ? sql`now()` : sql`NULL`}, version = version + 1, updated_at = now()
        WHERE owner_id = ${ownerId} AND id = ${id} AND version = ${expectedVersion}
      `.execute(trx);
      return this.getTx(trx, id);
    });
  }

  private async getTx(
    trx: OwnerTransaction,
    id: string,
  ): Promise<WorkbenchSession> {
    const result = await sql<WorkbenchRow>`
      SELECT id, title, draft_prompt, draft_negative, draft_params,
        prompt_reference_ids, version, created_at, updated_at, archived_at, deleted_at
      FROM app.workbench_sessions WHERE id = ${id}
    `.execute(trx);
    const row = result.rows[0];
    if (!row)
      throw new AppError(
        'WORKBENCH_SESSION_NOT_FOUND',
        '工作台会话不存在',
        404,
      );
    return toWorkbenchSession(row);
  }

  private async validatePromptReferences(
    trx: OwnerTransaction,
    ids: string[],
  ): Promise<void> {
    if (!ids.length) return;
    const unique = [...new Set(ids)];
    const result = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM app.prompts
      WHERE id IN (${sql.join(
        unique.map((id) => sql`${id}`),
        sql`, `,
      )}) AND deleted_at IS NULL
    `.execute(trx);
    if (Number(result.rows[0]?.count ?? 0) !== unique.length)
      throw new AppError(
        'VALIDATION_FAILED',
        '工作台引用了不存在或已删除的提示词',
        400,
      );
  }
}

function toWorkbenchSession(row: WorkbenchRow): WorkbenchSession {
  return {
    id: row.id,
    title: row.title,
    draft: {
      prompt: row.draft_prompt,
      negative: row.draft_negative,
      params: row.draft_params,
      promptReferenceIds: row.prompt_reference_ids,
    },
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    archivedAt: toIsoOrNull(row.archived_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  };
}

function conflict(current: WorkbenchSession): AppError {
  return new AppError(
    'WORKBENCH_VERSION_CONFLICT',
    '工作台草稿已在其他设备更新',
    409,
    false,
    { current },
  );
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function encodeCursor(value: { id: string; updatedAt: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { id: string; updatedAt: string } {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { id?: unknown; updatedAt?: unknown };
    if (typeof parsed.id !== 'string' || typeof parsed.updatedAt !== 'string')
      throw new Error('invalid');
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    throw new AppError('VALIDATION_FAILED', '工作台分页游标无效', 400);
  }
}
