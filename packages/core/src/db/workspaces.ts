import type Database from 'better-sqlite3';
import { tokenizeForFts } from './fts';

export const LEGACY_WORKSPACE_ID = 'local-only-legacy';
export const LEGACY_WORKSPACE_KIND = 'local_only' as const;
export const ACCOUNT_WORKSPACE_KIND = 'account' as const;

export type WorkspaceKind = typeof LEGACY_WORKSPACE_KIND | typeof ACCOUNT_WORKSPACE_KIND;

export type WorkspaceScope = {
  workspaceId: string;
  kind: WorkspaceKind;
  ownerId: string | null;
};

export type ActiveWorkspaceResolution =
  | {
      status: 'legacy';
      workspaceId: typeof LEGACY_WORKSPACE_ID;
      kind: typeof LEGACY_WORKSPACE_KIND;
      ownerId: null;
    }
  | {
      status: 'account';
      workspaceId: string;
      kind: typeof ACCOUNT_WORKSPACE_KIND;
      ownerId: string;
    }
  | {
      status: 'missing-account-workspace';
      workspaceId: null;
      kind: null;
      ownerId: string;
    };

export function accountWorkspaceId(ownerId: string): string {
  if (!ownerId.trim()) throw new Error('workspace ownerId 不能为空');
  return `account:${ownerId}`;
}

export interface LocalWorkspace {
  id: string;
  ownerId: string | null;
  kind: WorkspaceKind;
  createdAt: number;
  updatedAt: number;
}

export function ensureLegacyWorkspace(db: Database.Database, now = Date.now()): string {
  db.prepare(
    `INSERT INTO local_workspaces (id, owner_id, kind, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(LEGACY_WORKSPACE_ID, LEGACY_WORKSPACE_KIND, now, now);
  return LEGACY_WORKSPACE_ID;
}

/**
 * Explicit account-workspace establishment seam. Login and sync activation must
 * not call this implicitly: an account workspace is a separate data container.
 */
export function ensureAccountWorkspace(
  db: Database.Database,
  ownerId: string,
  now = Date.now(),
): string {
  return db.transaction(() => ensureAccountWorkspaceRecord(db, ownerId, now))();
}

function ensureAccountWorkspaceRecord(db: Database.Database, ownerId: string, now: number): string {
  const id = accountWorkspaceId(ownerId);
  const existing = db
    .prepare('SELECT id, owner_id, kind FROM local_workspaces WHERE id = ?')
    .get(id) as { id: string; owner_id: string | null; kind: string } | undefined;
  if (existing && (existing.kind !== ACCOUNT_WORKSPACE_KIND || existing.owner_id !== ownerId)) {
    throw new Error(`account workspace ${id} has an invalid kind or owner`);
  }

  const ownerRow = db
    .prepare('SELECT id, owner_id, kind FROM local_workspaces WHERE owner_id = ?')
    .get(ownerId) as { id: string; owner_id: string | null; kind: string } | undefined;
  if (ownerRow && ownerRow.id !== id) {
    throw new Error(`owner ${ownerId} already has workspace ${ownerRow.id}`);
  }

  db.prepare(
    `INSERT INTO local_workspaces (id, owner_id, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at
     WHERE local_workspaces.kind = excluded.kind
       AND local_workspaces.owner_id = excluded.owner_id`,
  ).run(id, ownerId, ACCOUNT_WORKSPACE_KIND, now, now);
  return id;
}

export function resolveAccountWorkspace(db: Database.Database, ownerId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM local_workspaces
       WHERE owner_id = ? AND kind = ? LIMIT 1`,
    )
    .get(ownerId, ACCOUNT_WORKSPACE_KIND) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Read-only resolution of the workspace selected by local account state.
 * An active account without an explicitly established workspace is a distinct
 * failure and must never fall through to legacy data, regardless of consent.
 */
export function resolveActiveWorkspaceScope(db: Database.Database): ActiveWorkspaceResolution {
  const account = db
    .prepare(
      `SELECT owner_id FROM cloud_sync_accounts
       WHERE active = 1
       ORDER BY updated_at DESC, owner_id LIMIT 1`,
    )
    .get() as { owner_id: string } | undefined;
  if (!account) {
    return {
      status: 'legacy',
      workspaceId: LEGACY_WORKSPACE_ID,
      kind: LEGACY_WORKSPACE_KIND,
      ownerId: null,
    };
  }
  const workspaceId = resolveAccountWorkspace(db, account.owner_id);
  if (!workspaceId) {
    return {
      status: 'missing-account-workspace',
      workspaceId: null,
      kind: null,
      ownerId: account.owner_id,
    };
  }
  return {
    status: 'account',
    workspaceId,
    kind: ACCOUNT_WORKSPACE_KIND,
    ownerId: account.owner_id,
  };
}

/**
 * Stable strict helper for workspace-scoped reads/writes. Callers that need to
 * distinguish missing account setup should use resolveActiveWorkspaceScope.
 */
export function resolveActiveWorkspace(db: Database.Database): string {
  const scope = resolveActiveWorkspaceScope(db);
  if (scope.status === 'missing-account-workspace') {
    throw new Error(`active account ${scope.ownerId} has no explicit workspace`);
  }
  return scope.workspaceId;
}

/**
 * Local content scope for interactive Desktop reads/writes. Login does not
 * establish an account workspace, so an unadopted owner continues using the
 * preserved offline workspace without creating account rows or sync state.
 * This helper is intentionally not used for sync ownership or cloud reads.
 */
export function resolveLocalContentWorkspace(db: Database.Database): string {
  const scope = resolveActiveWorkspaceScope(db);
  return scope.status === 'missing-account-workspace' ? LEGACY_WORKSPACE_ID : scope.workspaceId;
}

/** Stable query seam for prompt-reference and other host-owned validation. */
export function promptExistsInWorkspace(
  db: Database.Database,
  promptId: string,
  workspaceId = resolveActiveWorkspace(db),
): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM prompts WHERE workspace_id = ? AND id = ? LIMIT 1')
      .get(workspaceId, promptId),
  );
}

function rowsMatchAcrossWorkspaces(
  db: Database.Database,
  table: string,
  columns: string,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
): boolean {
  const sourceRows = db
    .prepare(
      `SELECT ${columns} FROM ${table}
       WHERE workspace_id = ? ORDER BY ${table === 'prompt_tags' ? 'prompt_id, tag_id' : 'id'}`,
    )
    .all(sourceWorkspaceId);
  const targetRows = db
    .prepare(
      `SELECT ${columns} FROM ${table}
       WHERE workspace_id = ? ORDER BY ${table === 'prompt_tags' ? 'prompt_id, tag_id' : 'id'}`,
    )
    .all(targetWorkspaceId);
  return JSON.stringify(sourceRows) === JSON.stringify(targetRows);
}

function hasCloudRows(db: Database.Database, workspaceId: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM cloud_entity_state WHERE workspace_id = ?
         UNION ALL SELECT 1 FROM cloud_sync_outbox WHERE workspace_id = ?
         UNION ALL SELECT 1 FROM cloud_sync_usage_outbox WHERE workspace_id = ?
         UNION ALL SELECT 1 FROM cloud_sync_conflicts WHERE workspace_id = ?
         LIMIT 1`,
      )
      .get(workspaceId, workspaceId, workspaceId, workspaceId),
  );
}

function isWorkspaceCopyOfSource(
  db: Database.Database,
  sourceWorkspaceId: string,
  targetWorkspaceId: string,
): boolean {
  return (
    rowsMatchAcrossWorkspaces(
      db,
      'folders',
      'id, name, parent_id, sort_order, created_at',
      sourceWorkspaceId,
      targetWorkspaceId,
    ) &&
    rowsMatchAcrossWorkspaces(
      db,
      'tags',
      'id, name, tag_group, color, created_at',
      sourceWorkspaceId,
      targetWorkspaceId,
    ) &&
    rowsMatchAcrossWorkspaces(
      db,
      'prompts',
      `id, title, description, content, content_negative, folder_id, model_id,
       params, preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at,
       source, source_url, created_at, updated_at, deleted_at`,
      sourceWorkspaceId,
      targetWorkspaceId,
    ) &&
    rowsMatchAcrossWorkspaces(
      db,
      'prompt_tags',
      'prompt_id, tag_id',
      sourceWorkspaceId,
      targetWorkspaceId,
    )
  );
}

function rebuildWorkspaceFts(db: Database.Database, workspaceId: string): void {
  const prompts = db
    .prepare('SELECT rowid, title, description, content, id FROM prompts WHERE workspace_id = ?')
    .all(workspaceId) as Array<Record<string, unknown> & { rowid: number; id: string }>;
  const tags = db
    .prepare('SELECT id, name FROM tags WHERE workspace_id = ?')
    .all(workspaceId) as Array<{ id: string; name: string }>;
  const links = db
    .prepare('SELECT prompt_id, tag_id FROM prompt_tags WHERE workspace_id = ?')
    .all(workspaceId) as Array<{ prompt_id: string; tag_id: string }>;
  const tagNames = new Map(tags.map((row) => [row.id, row.name]));
  db.prepare(
    'DELETE FROM prompts_fts WHERE rowid IN (SELECT rowid FROM prompts WHERE workspace_id = ?)',
  ).run(workspaceId);
  const insertFts = db.prepare(
    `INSERT INTO prompts_fts (rowid, title, description, content, tags_index)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of prompts) {
    const promptTags = links
      .filter((link) => link.prompt_id === row.id)
      .map((link) => tagNames.get(link.tag_id) ?? '')
      .filter(Boolean);
    insertFts.run(
      row.rowid,
      row.title,
      row.description ?? '',
      row.content,
      tokenizeForFts(
        String(row.title ?? ''),
        typeof row.description === 'string' ? row.description : null,
        String(row.content ?? ''),
        promptTags,
      ),
    );
  }
}

/**
 * Explicit adoption only. Legacy rows are copied into an account workspace and
 * remain intact in local-only-legacy. No login or sync path calls this function.
 */
export function adoptLegacyWorkspace(
  db: Database.Database,
  ownerId: string,
  now = Date.now(),
): {
  workspaceId: string;
  sourceWorkspaceId: typeof LEGACY_WORKSPACE_ID;
  folders: number;
  prompts: number;
  tags: number;
  promptTags: number;
  copiedUsage: number;
  copiedEntityState: 0;
  copiedOutbox: 0;
  copiedUsageOutbox: 0;
} {
  const source: typeof LEGACY_WORKSPACE_ID = LEGACY_WORKSPACE_ID;
  return db.transaction(() => {
    const workspaceId = ensureAccountWorkspaceRecord(db, ownerId, now);
    const folders = db
      .prepare(
        'SELECT id, name, parent_id, sort_order, created_at FROM folders WHERE workspace_id = ?',
      )
      .all(source) as Array<Record<string, unknown>>;
    const prompts = db
      .prepare('SELECT * FROM prompts WHERE workspace_id = ? ORDER BY rowid')
      .all(source) as Array<Record<string, unknown>>;
    const tags = db
      .prepare('SELECT id, name, tag_group, color, created_at FROM tags WHERE workspace_id = ?')
      .all(source) as Array<Record<string, unknown>>;
    const links = db
      .prepare('SELECT prompt_id, tag_id FROM prompt_tags WHERE workspace_id = ?')
      .all(source) as Array<{ prompt_id: string; tag_id: string }>;

    if (hasCloudRows(db, workspaceId)) {
      throw new Error(`account workspace ${workspaceId} has cloud sync state`);
    }
    const targetHasRows = Boolean(
      db
        .prepare(
          `SELECT 1 FROM folders WHERE workspace_id = ?
           UNION ALL SELECT 1 FROM prompts WHERE workspace_id = ?
           UNION ALL SELECT 1 FROM tags WHERE workspace_id = ?
           UNION ALL SELECT 1 FROM prompt_tags WHERE workspace_id = ?
           LIMIT 1`,
        )
        .get(workspaceId, workspaceId, workspaceId, workspaceId),
    );
    if (targetHasRows) {
      if (!isWorkspaceCopyOfSource(db, source, workspaceId)) {
        throw new Error(`account workspace ${workspaceId} is not an exact legacy copy`);
      }
      rebuildWorkspaceFts(db, workspaceId);
      return {
        workspaceId,
        sourceWorkspaceId: source,
        folders: folders.length,
        prompts: prompts.length,
        tags: tags.length,
        promptTags: links.length,
        copiedUsage: prompts.reduce((total, row) => total + Number(row.usage_count ?? 0), 0),
        copiedEntityState: 0 as const,
        copiedOutbox: 0 as const,
        copiedUsageOutbox: 0 as const,
      };
    }

    // Insert roots first so a composite self-FK cannot depend on source row order.
    const insertFolder = db.prepare(
      `INSERT INTO folders (workspace_id, id, name, parent_id, sort_order, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    );
    for (const row of folders) {
      insertFolder.run(workspaceId, row.id, row.name, row.sort_order, row.created_at);
    }
    const restoreParent = db.prepare(
      `UPDATE folders SET parent_id = ?
       WHERE workspace_id = ? AND id = ?
         AND EXISTS (SELECT 1 FROM folders WHERE workspace_id = ? AND id = ?)`,
    );
    for (const row of folders) {
      if (typeof row.parent_id === 'string') {
        restoreParent.run(row.parent_id, workspaceId, row.id, workspaceId, row.parent_id);
      }
    }

    const insertTag = db.prepare(
      `INSERT INTO tags (workspace_id, id, name, tag_group, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const row of tags) {
      insertTag.run(workspaceId, row.id, row.name, row.tag_group, row.color, row.created_at);
    }

    const insertPrompt = db.prepare(
      `INSERT INTO prompts (
         workspace_id, id, title, description, content, content_negative, folder_id, model_id,
         params, preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at,
         source, source_url, created_at, updated_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tagNames = new Map(tags.map((row) => [String(row.id), String(row.name)]));
    let copiedUsage = 0;
    for (const row of prompts) {
      insertPrompt.run(
        workspaceId,
        row.id,
        row.title,
        row.description,
        row.content,
        row.content_negative,
        row.folder_id,
        row.model_id,
        row.params,
        row.preview_image_path,
        row.rating,
        row.is_pinned,
        row.pin_order,
        row.usage_count,
        row.last_used_at,
        row.source,
        row.source_url,
        row.created_at,
        row.updated_at,
        row.deleted_at,
      );
      copiedUsage += Number(row.usage_count ?? 0);
    }

    const insertLink = db.prepare(
      'INSERT INTO prompt_tags (workspace_id, prompt_id, tag_id) VALUES (?, ?, ?) ',
    );
    for (const link of links) insertLink.run(workspaceId, link.prompt_id, link.tag_id);

    // FTS rowids are local to the copied prompt rows; rebuild from source text and copied tags.
    const insertFts = db.prepare(
      `INSERT INTO prompts_fts (rowid, title, description, content, tags_index)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const row of prompts) {
      const target = db
        .prepare('SELECT rowid FROM prompts WHERE workspace_id = ? AND id = ?')
        .get(workspaceId, row.id) as { rowid: number };
      const promptTags = links
        .filter((link) => link.prompt_id === row.id)
        .map((link) => tagNames.get(link.tag_id) ?? '')
        .filter(Boolean);
      insertFts.run(
        target.rowid,
        row.title,
        row.description ?? '',
        row.content,
        tokenizeForFts(
          String(row.title ?? ''),
          typeof row.description === 'string' ? row.description : null,
          String(row.content ?? ''),
          promptTags,
        ),
      );
    }

    return {
      workspaceId,
      sourceWorkspaceId: source,
      folders: folders.length,
      prompts: prompts.length,
      tags: tags.length,
      promptTags: links.length,
      copiedUsage,
      // Cloud state/outbox contains owner/device/version identity. It must be
      // recreated for the target owner by seedUnsyncedEntities, never copied.
      copiedEntityState: 0 as const,
      copiedOutbox: 0 as const,
      copiedUsageOutbox: 0 as const,
    };
  })();
}
