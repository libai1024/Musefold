import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptDocument } from '@musefold/contracts';
import { closeDb, getDb } from '@musefold/core/db';
import { ensureAccountWorkspace } from '@musefold/core/db/workspaces';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { DesktopSyncRepository } from '@musefold/core/sync';
import { buildPromptsDomainMethods } from '../prompts-domain';
import { scheduleV25CloudSync } from '../sync-domain';

vi.mock('../sync-domain', () => ({ scheduleV25CloudSync: vi.fn() }));

let directory: string;
let workspace: string;
let sync: DesktopSyncRepository;
const owner = '7';
const now = '2026-09-01T00:00:00.000Z';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'musefold-empty-trash-'));
  configureCoreRuntime({
    getPaths: () => ({
      userData: directory,
      db: join(directory, 'test.db'),
      backups: directory,
      previews: directory,
      pictures: directory,
      logs: directory,
    }),
    loadApiKey: () => null,
    createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
    estimateProviderCost: () => null,
  });
  workspace = ensureAccountWorkspace(getDb(), owner);
  sync = new DesktopSyncRepository(getDb());
  sync.activateAccount({
    ownerId: owner,
    username: 'fixture',
    deviceId: 'fixture-device',
    deviceName: 'Test',
    platform: 'macos',
    clientVersion: 'test',
  });
  sync.setEnabled(owner, true);
  vi.clearAllMocks();
});
afterEach(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});

function seed(id: string, deleted = true, scope = workspace, ownerId = owner) {
  const tag = {
    id: 'fixture_tag',
    name: 'Synthetic tag',
    group: null,
    color: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  sync.applyBootstrapSnapshot(ownerId, scope, 'tag', tag);
  const doc: PromptDocument = {
    id,
    title: `Synthetic ${id}`,
    content: 'retained fixture',
    description: null,
    negative: null,
    folderId: null,
    tags: [tag],
    modelId: null,
    params: null,
    rating: 0,
    isPinned: false,
    pinOrder: 0,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  sync.applyBootstrapSnapshot(ownerId, scope, 'prompt', doc);
  if (deleted)
    sync.applyBootstrapSnapshot(ownerId, scope, 'prompt', { ...doc, version: 2, deletedAt: now });
}
function snapshot() {
  const db = getDb();
  return {
    prompts: db.prepare('SELECT rowid, * FROM prompts ORDER BY workspace_id, id').all(),
    fts: db.prepare('SELECT rowid, * FROM prompts_fts ORDER BY rowid').all(),
    links: db.prepare('SELECT * FROM prompt_tags ORDER BY workspace_id, prompt_id, tag_id').all(),
    outbox: db.prepare('SELECT * FROM cloud_sync_outbox ORDER BY mutation_id').all(),
    states: db
      .prepare('SELECT * FROM cloud_entity_state ORDER BY owner_id, workspace_id, local_id')
      .all(),
  };
}
function empty() {
  return buildPromptsDomainMethods()['prompts.emptyTrash'].handle(undefined);
}

describe('Desktop empty trash uses the entire workspace in one transaction', () => {
  it('clears 501 rows, preserves live/foreign rows and queues all remote deletes once', async () => {
    const db = getDb();
    const foreign = ensureAccountWorkspace(db, '8');
    sync.activateAccount({
      ownerId: '8',
      username: 'foreign',
      deviceId: 'foreign-device',
      deviceName: 'Other',
      platform: 'macos',
      clientVersion: 'test',
    });
    sync.activateAccount({
      ownerId: owner,
      username: 'fixture',
      deviceId: 'fixture-device',
      deviceName: 'Test',
      platform: 'macos',
      clientVersion: 'test',
    });
    db.transaction(() => {
      for (let i = 0; i < 501; i++) seed(`trash_${String(i).padStart(4, '0')}`);
      seed('live_prompt', false);
      seed('trash_0000', true, foreign, '8');
    })();
    const before = snapshot();
    await expect(empty()).resolves.toEqual({ purged: 501 });
    const after = snapshot();
    const kept = before.prompts.filter(
      (r) =>
        (r as { workspace_id: string; id: string }).workspace_id !== workspace ||
        (r as { id: string }).id === 'live_prompt',
    );
    expect(after.prompts).toEqual(kept);
    expect(after.fts).toEqual(
      before.fts.filter((row) =>
        kept.some((p) => (p as { rowid: number }).rowid === (row as { rowid: number }).rowid),
      ),
    );
    expect(after.links).toEqual(
      before.links.filter(
        (r) =>
          (r as { workspace_id: string; prompt_id: string }).workspace_id !== workspace ||
          (r as { prompt_id: string }).prompt_id === 'live_prompt',
      ),
    );
    expect(after.outbox).toHaveLength(501);
    expect(
      after.outbox.every((r) => {
        const row = r as {
          owner_id: string;
          workspace_id: string;
          operation: string;
          base_version: number;
        };
        return (
          row.owner_id === owner &&
          row.workspace_id === workspace &&
          row.operation === 'delete' &&
          row.base_version === 2
        );
      }),
    ).toBe(true);
    expect(scheduleV25CloudSync).toHaveBeenCalledTimes(1);
    await expect(empty()).resolves.toEqual({ purged: 0 });
    expect(snapshot()).toEqual(after);
    expect(scheduleV25CloudSync).toHaveBeenCalledTimes(1);
  }, 15000);

  it('rolls back earlier deletions, FTS and outbox when a later SQLite deletion fails', async () => {
    seed('trash_first');
    seed('trash_second');
    const db = getDb();
    const before = snapshot();
    db.exec(`CREATE TEMP TRIGGER fail_second_purge BEFORE DELETE ON prompts
      WHEN OLD.deleted_at IS NOT NULL AND (SELECT count(*) FROM prompts WHERE deleted_at IS NOT NULL)=1
      BEGIN SELECT RAISE(ABORT, 'synthetic delete failure'); END`);
    await expect(empty()).rejects.toThrow('synthetic delete failure');
    expect(snapshot()).toEqual(before);
    expect(scheduleV25CloudSync).not.toHaveBeenCalled();
    db.exec('DROP TRIGGER fail_second_purge');
    await expect(empty()).resolves.toEqual({ purged: 2 });
    expect(snapshot().outbox).toHaveLength(2);
    await expect(empty()).resolves.toEqual({ purged: 0 });
  });
});
