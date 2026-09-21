import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { designSchemeAgentSessionSchema } from '@musefold/contracts';
import {
  type MusefoldDatabase,
  type MusefoldTransaction,
  designSchemeAgentSessions as sessions,
  designSchemeAgentEvents as events,
  designSchemeSourcePreparations as preparations,
} from '@musefold/db';
import { AppError } from '../../lib/errors.js';
export type Tx = MusefoldTransaction;
export type Row = typeof sessions.$inferSelect;
export type View = z.infer<typeof designSchemeAgentSessionSchema>;
export const ACTIVE = [
  'queued',
  'preparing',
  'confirmation-required',
  'authorization-required',
  'compiling',
];
/** Shared parent/event transitions; every caller holds the parent lock before source locks. */
export class AgentState {
  constructor(protected readonly db: MusefoldDatabase) {}
  identity(userId: string, executionId: string) {
    return and(eq(sessions.userId, userId), eq(sessions.executionId, executionId));
  }
  async row(tx: Tx, userId: string, executionId: string) {
    const [row] = await tx
      .select()
      .from(sessions)
      .where(this.identity(userId, executionId))
      .for('update');
    return row;
  }
  async requireRow(tx: Tx, userId: string, executionId: string) {
    const row = await this.row(tx, userId, executionId);
    if (!row) throw new AppError('VALIDATION_FAILED', '方案任务不存在', 404);
    return row;
  }
  async save(tx: Tx, row: Row, patch: Partial<View>): Promise<Row> {
    const view = designSchemeAgentSessionSchema.parse({
      ...row.view,
      ...patch,
      version: row.view.version + 1,
    });
    const [saved] = await tx
      .update(sessions)
      .set({ view, updatedAt: new Date() })
      .where(this.identity(row.userId, row.executionId))
      .returning();
    await tx.insert(events).values({
      userId: row.userId,
      executionId: row.executionId,
      seq: view.version,
      session: view,
    });
    return saved;
  }
  async expire(tx: Tx, row: Row) {
    if (ACTIVE.includes(row.view.status) && row.expiresAt.getTime() <= Date.now()) {
      await this.cancelSources(tx, row);
      return this.save(tx, row, { status: 'expired', pendingSource: null });
    }
    return row;
  }
  async lockSources(tx: Tx, row: Row) {
    if (!row.sourceExecutionIds.length) return;
    await tx
      .select({ id: preparations.executionId })
      .from(preparations)
      .where(
        and(
          eq(preparations.userId, row.userId),
          inArray(preparations.executionId, row.sourceExecutionIds),
        ),
      )
      .orderBy(asc(preparations.expiresAt), asc(preparations.executionId))
      .for('update');
  }
  async cancelSources(tx: Tx, row: Row) {
    if (!row.sourceExecutionIds.length) return;
    await this.lockSources(tx, row);
    await tx
      .update(preparations)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(preparations.userId, row.userId),
          inArray(preparations.executionId, row.sourceExecutionIds),
          inArray(preparations.status, ['queued', 'reading', 'ready', 'confirmed']),
        ),
      );
  }
}
