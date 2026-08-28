import { sql, type RawBuilder } from "kysely";
import type { ParsedGenerationHistoryQuery } from "@musefold/contracts";

export type GenerationHistoryCursor = {
  id: string;
  createdAt: string;
};

export function buildGenerationHistoryConditions(
  query: ParsedGenerationHistoryQuery,
  cursor?: GenerationHistoryCursor,
): RawBuilder<unknown>[] {
  const conditions: RawBuilder<unknown>[] = [
    query.includeDeleted ? sql`TRUE` : sql`r.deleted_at IS NULL`,
  ];
  if (query.sessionId)
    conditions.push(sql`r.session_id = ${query.sessionId}`);
  if (query.status) conditions.push(sql`r.status = ${query.status}`);
  if (query.from)
    conditions.push(sql`r.created_at >= ${new Date(query.from)}`);
  if (query.to) conditions.push(sql`r.created_at <= ${new Date(query.to)}`);
  if (query.providerModel)
    conditions.push(sql`r.provider_model = ${query.providerModel}`);
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(sql`(
      COALESCE(r.request->>'prompt', '') ILIKE ${pattern}
      OR COALESCE(r.request->>'negative', '') ILIKE ${pattern}
      OR COALESCE(r.provider_model, '') ILIKE ${pattern}
      OR COALESCE(r.error_detail_safe, '') ILIKE ${pattern}
    )`);
  }
  if (cursor) {
    conditions.push(
      sql`(r.created_at, r.id) < (${new Date(cursor.createdAt)}, ${cursor.id})`,
    );
  }
  return conditions;
}
