import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  designSchemeAgentHistoryQuerySchema,
  designSchemeAgentHistoryPageSchema,
  type DesignSchemeAgentHistoryQuery,
  type DesignSchemeAgentHistoryRecord,
} from '@musefold/contracts';
import {
  designSchemeAgentSessions as sessions,
  designSchemes,
  type MusefoldDatabase,
} from '@musefold/db';
import { lockNormalAccountAuthority } from '../../lib/normal-account-authority.js';
import { AppError } from '../../lib/errors.js';

const schemeId = sql<string | null>`CASE WHEN ${sessions.view}->>'operation' = 'create'
  THEN ${sessions.view}->'result'->'scheme'->>'id'
  ELSE ${sessions.request}->'input'->>'schemeId' END`;

/** Bounded discovery. No expiry transition, source confirmation, lease renewal, or model/object IO. */
export async function listDesignSchemeAgentExecutions(
  db: MusefoldDatabase,
  userId: string,
  sessionId: string,
  raw: DesignSchemeAgentHistoryQuery,
) {
  const query = designSchemeAgentHistoryQuerySchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockNormalAccountAuthority(tx, userId, sessionId);
    if (query.cursor) {
      const [cursor] = await tx
        .select({ executionId: sessions.executionId })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), eq(sessions.executionId, query.cursor)));
      if (!cursor) throw new AppError('VALIDATION_FAILED', '方案任务游标已失效，请刷新列表', 400);
    }
    // Resolve the cursor in PostgreSQL: JS Date would discard microseconds and skip tied records.
    const before = query.cursor
      ? sql`(${sessions.createdAt}, ${sessions.executionId}) < (
      SELECT created_at, execution_id FROM design_scheme_agent_sessions
      WHERE user_id=${userId} AND execution_id=${query.cursor})`
      : undefined;
    const rows = await tx
      .select({
        executionId: sessions.executionId,
        operation: sql<DesignSchemeAgentHistoryRecord['operation']>`${sessions.view}->>'operation'`,
        status: sql<DesignSchemeAgentHistoryRecord['status']>`${sessions.view}->>'status'`,
        version: sql<number>`(${sessions.view}->>'version')::integer`,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        schemeId,
        schemeName: designSchemes.name,
      })
      .from(sessions)
      .leftJoin(
        designSchemes,
        and(
          eq(designSchemes.id, schemeId),
          eq(designSchemes.userId, userId),
          isNull(designSchemes.deletedAt),
        ),
      )
      .where(and(eq(sessions.userId, userId), before))
      .orderBy(desc(sessions.createdAt), desc(sessions.executionId))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return designSchemeAgentHistoryPageSchema.parse({
      items: page.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)?.executionId : null,
    });
  });
}
