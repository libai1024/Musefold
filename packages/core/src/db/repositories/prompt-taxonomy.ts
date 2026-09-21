import { ulid } from 'ulid';
import type {
  NewPromptFolder,
  UpdatePromptFolder,
  NewPromptTag,
  UpdatePromptTag,
  PromptFolder,
  PromptTag,
} from '@musefold/contracts';
import { getDb } from '../index';
import { resolveLocalContentWorkspace } from '../workspaces';
import { enqueueActiveAccountMutation } from '../../sync/repository';
import { promptsRepo } from './prompts';

export class PromptTaxonomyError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'VALIDATION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'PromptTaxonomyError';
  }
}

function scopeFor(workspaceId?: string): string {
  return workspaceId ?? resolveLocalContentWorkspace(getDb());
}
function requireFolder(
  id: string,
  scope: string,
): Pick<PromptFolder, 'id' | 'parentId' | 'name' | 'sortOrder'> {
  const row = getDb()
    .prepare(
      'SELECT id, parent_id AS parentId, name, sort_order AS sortOrder FROM folders WHERE workspace_id = ? AND id = ?',
    )
    .get(scope, id) as Pick<PromptFolder, 'id' | 'parentId' | 'name' | 'sortOrder'> | undefined;
  if (!row) throw new PromptTaxonomyError('NOT_FOUND', '文件夹不存在');
  return row;
}
function validateParent(scope: string, id: string, parentId: string | null): void {
  const seen = new Set([id]);
  let next = parentId;
  while (next) {
    if (seen.has(next))
      throw new PromptTaxonomyError('VALIDATION_FAILED', '文件夹不能移动到自身或子文件夹中');
    seen.add(next);
    next = requireFolder(next, scope).parentId;
  }
}
function refreshPromptRelation(id: string, scope: string): void {
  const db = getDb();
  const row = db
    .prepare('SELECT deleted_at FROM prompts WHERE workspace_id = ? AND id = ?')
    .get(scope, id) as { deleted_at: number | null } | undefined;
  if (!row) return;
  promptsRepo.refreshSearchIndex(id, scope);
  // Preserve an existing local delete intent instead of compacting it into an update.
  enqueueActiveAccountMutation(
    db,
    'prompt',
    id,
    row.deleted_at === null ? 'update' : 'delete',
    scope,
  );
}
function linkedPrompts(scope: string, tagId: string): Array<{ id: string }> {
  return getDb()
    .prepare(
      'SELECT prompt_id AS id FROM prompt_tags WHERE workspace_id = ? AND tag_id = ? ORDER BY prompt_id',
    )
    .all(scope, tagId) as Array<{ id: string }>;
}
function requireTag(id: string, scope: string): Pick<PromptTag, 'name' | 'group' | 'color'> {
  const row = getDb()
    .prepare('SELECT name, tag_group AS "group", color FROM tags WHERE workspace_id = ? AND id = ?')
    .get(scope, id) as Pick<PromptTag, 'name' | 'group' | 'color'> | undefined;
  if (!row) throw new PromptTaxonomyError('NOT_FOUND', '标签不存在');
  return row;
}

function validateTagName(name: string, scope: string, excludingId?: string): void {
  const found = getDb()
    .prepare('SELECT id FROM tags WHERE workspace_id = ? AND name = ?')
    .get(scope, name) as Pick<PromptTag, 'id'> | undefined;
  if (found && found.id !== excludingId)
    throw new PromptTaxonomyError('VALIDATION_FAILED', '已存在同名标签');
}

export const promptTaxonomyRepo = {
  createFolder(input: NewPromptFolder, workspaceId?: string): string {
    const db = getDb(),
      scope = scopeFor(workspaceId),
      id = ulid();
    return db.transaction(() => {
      validateParent(scope, id, input.parentId);
      db.prepare(
        'INSERT INTO folders (workspace_id,id,name,parent_id,sort_order,created_at) VALUES (?,?,?,?,?,?)',
      ).run(scope, id, input.name, input.parentId, input.sortOrder, Date.now());
      enqueueActiveAccountMutation(db, 'folder', id, 'create', scope);
      return id;
    })();
  },
  updateFolder(id: string, patch: UpdatePromptFolder, workspaceId?: string): void {
    const db = getDb(),
      scope = scopeFor(workspaceId);
    db.transaction(() => {
      const current = requireFolder(id, scope);
      const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
      validateParent(scope, id, parentId);
      db.prepare(
        'UPDATE folders SET name=?,parent_id=?,sort_order=? WHERE workspace_id=? AND id=?',
      ).run(patch.name ?? current.name, parentId, patch.sortOrder ?? current.sortOrder, scope, id);
      enqueueActiveAccountMutation(db, 'folder', id, 'update', scope);
    })();
  },
  removeFolder(id: string, workspaceId?: string): void {
    const db = getDb(),
      scope = scopeFor(workspaceId);
    db.transaction(() => {
      requireFolder(id, scope);
      const children = db
        .prepare('SELECT id FROM folders WHERE workspace_id=? AND parent_id=? ORDER BY id')
        .all(scope, id) as Array<{ id: string }>;
      const prompts = db
        .prepare('SELECT id FROM prompts WHERE workspace_id=? AND folder_id=? ORDER BY id')
        .all(scope, id) as Array<{ id: string }>;
      // Explicitly detach before DELETE: composite SET NULL must never clear workspace_id.
      db.prepare('UPDATE folders SET parent_id=NULL WHERE workspace_id=? AND parent_id=?').run(
        scope,
        id,
      );
      db.prepare(
        'UPDATE prompts SET folder_id=NULL,updated_at=? WHERE workspace_id=? AND folder_id=?',
      ).run(Date.now(), scope, id);
      for (const child of children)
        enqueueActiveAccountMutation(db, 'folder', child.id, 'update', scope);
      for (const prompt of prompts) refreshPromptRelation(prompt.id, scope);
      db.prepare('DELETE FROM folders WHERE workspace_id=? AND id=?').run(scope, id);
      enqueueActiveAccountMutation(db, 'folder', id, 'delete', scope);
    })();
  },
  createTag(input: NewPromptTag, workspaceId?: string): string {
    const db = getDb(),
      scope = scopeFor(workspaceId),
      id = ulid();
    return db.transaction(() => {
      validateTagName(input.name, scope);
      db.prepare(
        'INSERT INTO tags (workspace_id,id,name,tag_group,color,created_at) VALUES (?,?,?,?,?,?)',
      ).run(scope, id, input.name, input.group, input.color, Date.now());
      enqueueActiveAccountMutation(db, 'tag', id, 'create', scope);
      return id;
    })();
  },
  updateTag(id: string, patch: UpdatePromptTag, workspaceId?: string): void {
    const db = getDb(),
      scope = scopeFor(workspaceId);
    db.transaction(() => {
      const current = requireTag(id, scope);
      validateTagName(patch.name ?? current.name, scope, id);
      const prompts = linkedPrompts(scope, id);
      db.prepare('UPDATE tags SET name=?,tag_group=?,color=? WHERE workspace_id=? AND id=?').run(
        patch.name ?? current.name,
        patch.group === undefined ? current.group : patch.group,
        patch.color === undefined ? current.color : patch.color,
        scope,
        id,
      );
      for (const prompt of prompts) promptsRepo.refreshSearchIndex(prompt.id, scope);
      enqueueActiveAccountMutation(db, 'tag', id, 'update', scope);
    })();
  },
  removeTag(id: string, workspaceId?: string): void {
    const db = getDb(),
      scope = scopeFor(workspaceId);
    db.transaction(() => {
      requireTag(id, scope);
      const prompts = linkedPrompts(scope, id);
      db.prepare('DELETE FROM prompt_tags WHERE workspace_id=? AND tag_id=?').run(scope, id);
      db.prepare('DELETE FROM tags WHERE workspace_id=? AND id=?').run(scope, id);
      for (const prompt of prompts) refreshPromptRelation(prompt.id, scope);
      enqueueActiveAccountMutation(db, 'tag', id, 'delete', scope);
    })();
  },
};
