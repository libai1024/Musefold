import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../../testing';
import { closeDb, getDb } from '../../index';
import { ensureAccountWorkspace } from '../../workspaces';
import { DesktopSyncRepository } from '../../../sync/repository';
import { promptsRepo } from '../prompts';

let directory: string;
let active: string;
let target: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'musefold-prompt-workspace-'));
  configureTestCoreRuntime(directory);
  const db = getDb();
  active = ensureAccountWorkspace(db, 'active-owner');
  target = ensureAccountWorkspace(db, 'inactive-owner');
  new DesktopSyncRepository(db).activateAccount({
    ownerId: 'active-owner',
    username: 'Synthetic',
    deviceId: 'owned-device',
    deviceName: 'Fixture',
    platform: 'macos',
    clientVersion: 'test',
  });
});
afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

function activeState() {
  const db = getDb();
  return {
    rows: db.prepare('SELECT rowid,* FROM prompts WHERE workspace_id=? ORDER BY id').all(active),
    fts: db
      .prepare(
        'SELECT rowid,* FROM prompts_fts WHERE rowid IN (SELECT rowid FROM prompts WHERE workspace_id=?) ORDER BY rowid',
      )
      .all(active),
    outbox: db.prepare('SELECT * FROM cloud_sync_outbox ORDER BY mutation_id').all(),
  };
}

describe('explicit prompt workspace survives write and readback', () => {
  it('returns a newly created inactive-workspace prompt without changing the active workspace', () => {
    promptsRepo.create({ title: 'Active fixture', content: 'Keep active' }, active);
    const before = activeState();
    const result = promptsRepo.create({ title: 'Target fixture', content: 'Owned target' }, target);
    expect(result).toMatchObject({ title: 'Target fixture', content: 'Owned target' });
    expect(promptsRepo.get(result.id, target)).toEqual(result);
    expect(promptsRepo.get(result.id, active)).toBeNull();
    expect(activeState()).toEqual(before);
    expect(promptsRepo.list({ search: 'Target' }, target).map((p) => p.id)).toEqual([result.id]);
  });
  it('returns the updated target when another workspace has the same id, preserving its row and FTS', () => {
    const current = promptsRepo.create({ title: 'Active fixture', content: 'Keep active' }, active);
    getDb()
      .prepare(
        'INSERT INTO prompts (workspace_id,id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      )
      .run(target, current.id, 'Target fixture', 'Target old', 1, 1);
    const before = activeState();
    const result = promptsRepo.update(
      current.id,
      { title: 'Target changed', content: 'Target new' },
      target,
    );
    expect(result).toMatchObject({
      id: current.id,
      title: 'Target changed',
      content: 'Target new',
    });
    expect(promptsRepo.get(current.id, target)).toEqual(result);
    expect(promptsRepo.get(current.id, active)).toEqual(current);
    expect(activeState()).toEqual(before);
    expect(promptsRepo.list({ search: 'changed' }, target).map((p) => p.id)).toEqual([current.id]);
    expect(promptsRepo.list({ search: 'changed' }, active)).toEqual([]);
  });
});
