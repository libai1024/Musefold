import { createHash } from 'node:crypto';
import type {
  LocalWorkspacePreview,
  LocalWorkspaceRecoveryStatus,
  PrepareLocalWorkspaceInput,
  PreviewLocalWorkspaceInput,
} from '@musefold/contracts';
import type Database from 'better-sqlite3';
import { copyLocalWorkspace, ensureAccountWorkspace, resolveAccountWorkspace } from './workspaces';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceReference = (workspaceId: string) => digest(['local-workspace', workspaceId]);

export class WorkspaceRecoveryError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

function sourceRows(db: Database.Database) {
  return db
    .prepare(`SELECT w.id, w.kind, w.created_at, a.username
    FROM local_workspaces w LEFT JOIN cloud_sync_accounts a ON a.owner_id = w.owner_id
    ORDER BY w.created_at, w.id`)
    .all() as Array<{
    id: string;
    kind: 'local_only' | 'account';
    created_at: number;
    username: string | null;
  }>;
}

/** Hash every copied column, including tombstones, usage and local cover references. */
function revision(db: Database.Database, workspaceId: string): string {
  const hash = createHash('sha256');
  for (const table of ['folders', 'prompts', 'tags', 'prompt_tags']) {
    hash.update(`table:${table}\n`);
    const rows = db.prepare(
      `SELECT * FROM ${table} WHERE workspace_id = ? ORDER BY ${table === 'prompt_tags' ? 'prompt_id, tag_id' : 'id'}`,
    );
    // JSON escapes embedded newlines, so one row per line is an unambiguous
    // frame. Only the current row is retained; preview never loads all bodies.
    for (const row of rows.iterate(workspaceId)) hash.update(`${JSON.stringify(row)}\n`);
    hash.update('end-table\n');
  }
  return hash.digest('hex');
}

function sourceFor(db: Database.Database, sourceId: string) {
  const source = sourceRows(db).find((row) => sourceReference(row.id) === sourceId);
  if (!source) throw new WorkspaceRecoveryError('NOT_FOUND', '这份本机数据已不可用,请刷新列表');
  return source;
}

export function listLocalWorkspaceRecovery(
  db: Database.Database,
  ownerId: string | null,
  verified: boolean,
): Omit<LocalWorkspaceRecoveryStatus, 'reviewRef' | 'targetAccount'> {
  const target = ownerId ? resolveAccountWorkspace(db, ownerId) : null;
  return {
    targetReady: !!target,
    canPrepare: verified && !!ownerId && !target,
    sources: sourceRows(db)
      .filter((row) => row.id !== target)
      .map((row) => ({
        sourceId: sourceReference(row.id),
        label:
          row.kind === 'local_only'
            ? '离线提示词库'
            : `本机账号提示词库${row.username ? ` · ${row.username}` : ''}`,
        kind: row.kind,
        createdAt: new Date(row.created_at).toISOString(),
        counts: Object.fromEntries(
          ['prompts', 'folders', 'tags'].map((table) => [
            table,
            (
              db
                .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`)
                .get(row.id) as { count: number }
            ).count,
          ]),
        ) as LocalWorkspaceRecoveryStatus['sources'][number]['counts'],
        revision: revision(db, row.id),
      })),
  };
}

export function previewLocalWorkspace(
  db: Database.Database,
  input: PreviewLocalWorkspaceInput,
): LocalWorkspacePreview {
  return db.transaction(() => {
    const source = sourceFor(db, input.sourceId);
    const offset = Number(input.cursor ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new WorkspaceRecoveryError('NOT_FOUND', '预览页码无效');
    const rows = db
      .prepare(`SELECT p.id, p.title, p.content, p.content_negative, p.deleted_at, f.name AS folder_name
      FROM prompts p LEFT JOIN folders f ON f.workspace_id = p.workspace_id AND f.id = p.folder_id
      WHERE p.workspace_id = ? ORDER BY p.id LIMIT 21 OFFSET ?`)
      .all(source.id, offset) as Array<{
      id: string;
      title: string;
      content: string;
      content_negative: string | null;
      deleted_at: number | null;
      folder_name: string | null;
    }>;
    const getTags =
      db.prepare(`SELECT t.name FROM prompt_tags pt JOIN tags t ON t.workspace_id = pt.workspace_id AND t.id = pt.tag_id
      WHERE pt.workspace_id = ? AND pt.prompt_id = ? ORDER BY t.id`);
    return {
      sourceId: input.sourceId,
      revision: revision(db, source.id),
      prompts: rows.slice(0, 20).map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        negative: row.content_negative,
        folderName: row.folder_name,
        isDeleted: row.deleted_at !== null,
        tags: (getTags.all(source.id, row.id) as Array<{ name: string }>).map((tag) => tag.name),
      })),
      folders: db
        .prepare(
          'SELECT id, name, parent_id AS parentId FROM folders WHERE workspace_id = ? ORDER BY id LIMIT 200',
        )
        .all(source.id) as LocalWorkspacePreview['folders'],
      tags: db
        .prepare('SELECT id, name FROM tags WHERE workspace_id = ? ORDER BY id LIMIT 200')
        .all(source.id) as LocalWorkspacePreview['tags'],
      nextCursor: rows.length > 20 ? String(offset + 20) : null,
    };
  })();
}

/** One SQLite transaction pins the viewed source and creates a new, separate target. */
export function prepareLocalWorkspace(
  db: Database.Database,
  ownerId: string,
  input: PrepareLocalWorkspaceInput,
): string {
  return db.transaction(() => {
    if (resolveAccountWorkspace(db, ownerId)) {
      throw new WorkspaceRecoveryError(
        'CONFLICT',
        '当前账号已有提示词库,可查看旧数据,不能覆盖或合并',
      );
    }
    if (input.mode === 'empty') return ensureAccountWorkspace(db, ownerId);
    const source = sourceFor(db, input.sourceId);
    if (revision(db, source.id) !== input.expectedRevision) {
      throw new WorkspaceRecoveryError('CONFLICT', '本机数据在查看后发生了变化,请重新查看后再复制');
    }
    return copyLocalWorkspace(db, source.id, ownerId).workspaceId;
  })();
}
