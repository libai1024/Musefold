import type Database from 'better-sqlite3';
import type { WorkbenchSessionRow } from './workbench-sessions';
import {
  getWorkbenchSessionFilter,
  workbenchSessionCursorSchema,
  workbenchSessionListQuerySchema,
  type WorkbenchSessionListQuery,
} from '@musefold/contracts';

export class InvalidWorkbenchSessionCursorError extends Error {
  constructor() {
    super('工作台分页游标无效或已过期，请刷新列表');
  }
}

function decodeCursor(cursor: string, filter: ReturnType<typeof getWorkbenchSessionFilter>) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error('Invalid encoding');
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor)
      throw new Error('Invalid encoding');
    const parsed = workbenchSessionCursorSchema.parse(JSON.parse(decoded));
    if (parsed.store !== 'sqlite' || parsed.filter !== filter || !parsed.updatedAt.endsWith('000Z'))
      throw new Error('Changed scope or precision');
    return { id: parsed.id, updatedAt: Date.parse(parsed.updatedAt) };
  } catch {
    throw new InvalidWorkbenchSessionCursorError();
  }
}

/** Session-only keyset query. Legacy generation history retains its own paging contract. */
export function queryWorkbenchSessions(db: Database.Database, input: WorkbenchSessionListQuery) {
  const query = workbenchSessionListQuerySchema.parse(input);
  const filter = getWorkbenchSessionFilter(query);
  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (filter === 'trash') conditions.push('deleted_at IS NOT NULL');
  if (filter === 'active' || filter === 'live' || filter === 'archived')
    conditions.push('deleted_at IS NULL');
  if (filter === 'archived') conditions.push('archived_at IS NOT NULL');
  if (filter === 'active' || filter === 'unarchived') conditions.push('archived_at IS NULL');
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor, filter);
    conditions.push('(updated_at < ? OR (updated_at = ? AND id COLLATE BINARY < ?))');
    values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT id,title,version,created_at,updated_at,archived_at,deleted_at
    FROM workbench_sessions ${where} ORDER BY updated_at DESC, id COLLATE BINARY DESC LIMIT ?`)
    .all(...values, query.limit + 1) as WorkbenchSessionRow[];
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify(
              workbenchSessionCursorSchema.parse({
                version: 1,
                store: 'sqlite',
                filter,
                id: last.id,
                updatedAt: new Date(last.updated_at).toISOString().replace('Z', '000Z'),
              }),
            ),
            'utf8',
          ).toString('base64url')
        : null,
  };
}
