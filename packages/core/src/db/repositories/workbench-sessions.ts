import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import {
  createWorkbenchSessionSchema,
  updateWorkbenchSessionSchema,
  workbenchDraftSchema,
  type CreateWorkbenchSession,
  type UpdateWorkbenchSession,
  type WorkbenchDraft,
  type WorkbenchSessionCleanupResult,
} from '@musefold/contracts';

export type WorkbenchSessionRow = {
  id: string;
  title: string;
  version: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  deleted_at: number | null;
};
export type WorkbenchSessionRecord = { row: WorkbenchSessionRow; draft: WorkbenchDraft };

export class WorkbenchSessionStoreError extends Error {
  constructor(
    readonly code:
      | 'WORKBENCH_SESSION_NOT_FOUND'
      | 'WORKBENCH_VERSION_CONFLICT'
      | 'VALIDATION_FAILED',
    message: string,
  ) {
    super(message);
  }
}

function parseDraft(raw?: string): WorkbenchDraft {
  if (raw) {
    try {
      const value = workbenchDraftSchema.safeParse(JSON.parse(raw));
      if (value.success) return value.data;
    } catch {
      /* Preserve the existing malformed legacy draft fallback. */
    }
  }
  return workbenchDraftSchema.parse({ prompt: '', negative: '', params: {} });
}

export function readWorkbenchDraftMap(
  db: Database.Database,
  ids: string[],
): Map<string, WorkbenchDraft> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(`SELECT session_id,draft_json FROM workbench_drafts
    WHERE session_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Array<{ session_id: string; draft_json: string }>;
  return new Map(rows.map((row) => [row.session_id, parseDraft(row.draft_json)]));
}

/** All mutations and their returned version/draft snapshot share a SQLite transaction. */
export class WorkbenchSessionStore {
  constructor(private readonly db: Database.Database) {}

  purge(id: string): WorkbenchSessionCleanupResult {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare('SELECT deleted_at FROM workbench_sessions WHERE id=?')
          .get(id) as { deleted_at: number | null } | undefined;
        if (!row) return { purged: 0 };
        if (row.deleted_at === null)
          throw new WorkbenchSessionStoreError('VALIDATION_FAILED', '只能永久删除回收站中的会话');
        this.deleteLocked(id);
        return { purged: 1 };
      })
      .immediate();
  }

  emptyTrash(): WorkbenchSessionCleanupResult {
    return this.db
      .transaction(() => {
        const rows = this.db
          .prepare('SELECT id FROM workbench_sessions WHERE deleted_at IS NOT NULL ORDER BY id')
          .all() as Array<{ id: string }>;
        for (const row of rows) this.deleteLocked(row.id);
        return { purged: rows.length };
      })
      .immediate();
  }

  private deleteLocked(id: string): void {
    this.db
      .prepare(
        'INSERT INTO workbench_session_deletions(id,purged_at) VALUES (?,?) ON CONFLICT(id) DO NOTHING',
      )
      .run(id, Date.now());
    // Keep generation/asset/cost rows. Explicit detachment is safe even on a connection with FK enforcement disabled.
    this.db
      .prepare('UPDATE generation_runs SET workbench_session_id=NULL WHERE workbench_session_id=?')
      .run(id);
    this.db.prepare('DELETE FROM workbench_drafts WHERE session_id=?').run(id);
    this.db.prepare('DELETE FROM workbench_sessions WHERE id=? AND deleted_at IS NOT NULL').run(id);
  }

  private read(id: string): WorkbenchSessionRecord {
    const row = this.db.prepare('SELECT * FROM workbench_sessions WHERE id=?').get(id) as
      | WorkbenchSessionRow
      | undefined;
    if (!row) throw new WorkbenchSessionStoreError('WORKBENCH_SESSION_NOT_FOUND', '会话不存在');
    const draft = this.db
      .prepare('SELECT draft_json FROM workbench_drafts WHERE session_id=?')
      .get(id) as { draft_json: string } | undefined;
    return { row, draft: parseDraft(draft?.draft_json) };
  }

  get(id: string): WorkbenchSessionRecord {
    return this.db.transaction(() => this.read(id))();
  }

  private writeDraft(id: string, draft: WorkbenchDraft, now: number): void {
    this.db
      .prepare(`INSERT INTO workbench_drafts(session_id,draft_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET draft_json=excluded.draft_json,updated_at=excluded.updated_at`)
      .run(id, JSON.stringify(draft), now);
  }

  create(raw: CreateWorkbenchSession): WorkbenchSessionRecord {
    const input = createWorkbenchSessionSchema.parse(raw);
    const draft = workbenchDraftSchema.parse({
      prompt: '',
      negative: '',
      params: {},
      ...input.draft,
    });
    return this.db
      .transaction(() => {
        const id = ulid();
        const now = Date.now();
        this.db
          .prepare(`INSERT INTO workbench_sessions(id,title,version,created_at,updated_at,archived_at,deleted_at)
        VALUES (?,?,1,?,?,NULL,NULL)`)
          .run(id, input.title, now, now);
        this.writeDraft(id, draft, now);
        return this.read(id);
      })
      .immediate();
  }

  update(id: string, raw: UpdateWorkbenchSession): WorkbenchSessionRecord {
    const input = updateWorkbenchSessionSchema.parse(raw);
    if (input.title === undefined && input.draft === undefined && input.archived === undefined)
      throw new WorkbenchSessionStoreError('VALIDATION_FAILED', '没有可更新的工作台字段');
    return this.db
      .transaction(() => {
        const current = this.read(id);
        if (current.row.deleted_at !== null || current.row.version !== input.expectedVersion)
          throw new WorkbenchSessionStoreError(
            'WORKBENCH_VERSION_CONFLICT',
            '会话已删除或草稿已更新，请刷新后重试',
          );
        const now = Date.now();
        const archivedAt =
          input.archived === undefined ? current.row.archived_at : input.archived ? now : null;
        const result = this.db
          .prepare(`UPDATE workbench_sessions
        SET title=?,archived_at=?,updated_at=MAX(updated_at,?),version=version+1
        WHERE id=? AND version=? AND deleted_at IS NULL`)
          .run(input.title ?? current.row.title, archivedAt, now, id, input.expectedVersion);
        if (result.changes !== 1)
          throw new WorkbenchSessionStoreError(
            'WORKBENCH_VERSION_CONFLICT',
            '工作台草稿已更新，请刷新后重试',
          );
        if (input.draft !== undefined) this.writeDraft(id, input.draft, now);
        return this.read(id);
      })
      .immediate();
  }

  changeDeleted(id: string, deleted: boolean, expectedVersion?: number): WorkbenchSessionRecord {
    return this.db
      .transaction(() => {
        const current = this.read(id);
        if (expectedVersion !== undefined && current.row.version !== expectedVersion)
          throw new WorkbenchSessionStoreError(
            'WORKBENCH_VERSION_CONFLICT',
            '工作台草稿已更新，请刷新后重试',
          );
        const now = Date.now();
        this.db
          .prepare(
            'UPDATE workbench_sessions SET deleted_at=?,updated_at=MAX(updated_at,?),version=version+1 WHERE id=?',
          )
          .run(deleted ? now : null, now, id);
        return this.read(id);
      })
      .immediate();
  }

  /** Startup-only import: absent drafts may be adopted; current drafts are never overwritten. */
  importLegacyDrafts(drafts: Record<string, WorkbenchDraft>): number {
    return this.db
      .transaction(() => {
        const exists = this.db.prepare('SELECT 1 FROM workbench_sessions WHERE id=?');
        const insert =
          this.db.prepare(`INSERT INTO workbench_drafts(session_id,draft_json,updated_at) VALUES (?,?,?)
        ON CONFLICT(session_id) DO NOTHING`);
        const increment = this.db.prepare(
          'UPDATE workbench_sessions SET version=version+1 WHERE id=?',
        );
        let imported = 0;
        for (const [id, value] of Object.entries(drafts)) {
          if (!exists.get(id)) continue;
          const result = insert.run(
            id,
            JSON.stringify(workbenchDraftSchema.parse(value)),
            Date.now(),
          );
          if (result.changes === 1) {
            increment.run(id);
            imported++;
          }
        }
        return imported;
      })
      .immediate();
  }
}
