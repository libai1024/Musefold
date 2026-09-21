import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  workbenchSessionPageSchema,
  workbenchSessionSchema,
  workbenchSessionCleanupResultSchema,
} from '@musefold/contracts';
import Database from 'better-sqlite3';
import { configureTestCoreRuntime } from '@musefold/core/testing';
import { closeDb, getDb } from '@musefold/core/db';
import { WorkbenchRepository } from '@musefold/core/db/repositories/workbench';
import { WorkbenchSessionStore } from '@musefold/core/db/repositories/workbench-sessions';

const directory = mkdtempSync(join(tmpdir(), 'musefold-session-writes-'));
vi.mock('electron', () => ({
  app: { getPath: () => directory, getVersion: () => 'test' },
  dialog: {},
}));
vi.mock('../../../system/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@musefold/core/services/generation', () => ({
  generate: vi.fn(),
  cancelGeneration: vi.fn(),
}));
import { buildWorkbenchDomainMethods } from '../workbench-domain';

configureTestCoreRuntime(directory);
let methods: ReturnType<typeof buildWorkbenchDomainMethods>;
beforeEach(() => {
  getDb().exec('DELETE FROM workbench_sessions');
  methods = buildWorkbenchDomainMethods();
});
afterAll(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
});
async function call(name: string, input: unknown) {
  const method = methods[`workbench.${name}`];
  if (!method) throw new Error(`Missing method ${name}`);
  return workbenchSessionSchema.parse(await method.handle(method.input.parse(input)));
}
const facts = () => ({
  sessions: getDb().prepare('SELECT * FROM workbench_sessions ORDER BY id').all(),
  drafts: getDb().prepare('SELECT * FROM workbench_drafts ORDER BY session_id').all(),
});
const draft = { prompt: 'Replacement draft', negative: '', params: {} };

describe('real Session versions and atomic writes through desktop IPC', () => {
  it('exposes purge and whole-trash cleanup through validated IPC and preserves live Sessions', async () => {
    const live = await call('createSession', { title: 'Keep live' });
    const deleted = await call('createSession', { title: 'Purge' });
    const other = await call('createSession', { title: 'Clear' });
    await call('removeSession', deleted.id);
    await call('removeSession', other.id);
    const invokeCleanup = async (name: string, input: unknown) => {
      const method = methods[`workbench.${name}`];
      if (!method) throw new Error(`Missing ${name}`);
      return workbenchSessionCleanupResultSchema.parse(
        await method.handle(method.input.parse(input)),
      );
    };
    await expect(invokeCleanup('purgeSession', live.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await invokeCleanup('purgeSession', deleted.id)).toEqual({ purged: 1 });
    expect(await invokeCleanup('purgeSession', deleted.id)).toEqual({ purged: 0 });
    expect(await invokeCleanup('emptyTrash', undefined)).toEqual({ purged: 1 });
    expect(await invokeCleanup('emptyTrash', undefined)).toEqual({ purged: 0 });
    expect(await call('getSession', live.id)).toEqual(live);
  });

  it('lists a coherent version and draft when another connection commits between the two reads', async () => {
    const initial = await call('createSession', {
      title: 'Initial',
      draft: { prompt: 'Initial draft' },
    });
    const db = getDb();
    const external = new Database(db.name);
    const originalPrepare = db.prepare.bind(db);
    let interleaved = false;
    const prepare = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (!interleaved && sql.includes('SELECT session_id,draft_json')) {
        interleaved = true;
        new WorkbenchSessionStore(external).update(initial.id, {
          expectedVersion: initial.version,
          title: 'Concurrent writer',
          draft: { ...draft, promptReferenceSelections: [], promptReferenceIds: [] },
        });
      }
      return originalPrepare(sql);
    });
    try {
      const method = methods['workbench.listSessions'];
      if (!method) throw new Error('Missing list method');
      const page = workbenchSessionPageSchema.parse(await method.handle(method.input.parse({})));
      expect(interleaved).toBe(true);
      expect(page.items).toEqual([initial]);
      expect(await call('getSession', initial.id)).toMatchObject({
        version: initial.version + 1,
        title: 'Concurrent writer',
        draft,
      });
    } finally {
      prepare.mockRestore();
      external.close();
    }
  });

  it('increments one business version for a combined patch and rejects the stale whole patch without writes', async () => {
    const initial = await call('createSession', {
      title: 'Initial',
      draft: { prompt: 'Initial draft' },
    });
    const changed = await call('updateSession', {
      id: initial.id,
      patch: { expectedVersion: initial.version, title: 'Changed', archived: true, draft },
    });
    expect(changed.version).toBe(initial.version + 1);
    expect(changed).toMatchObject({ title: 'Changed', draft, archivedAt: expect.any(String) });
    const before = facts();
    await expect(
      call('updateSession', {
        id: initial.id,
        patch: {
          expectedVersion: initial.version,
          title: 'Stale',
          archived: false,
          draft: { ...draft, prompt: 'Stale draft' },
        },
      }),
    ).rejects.toMatchObject({ code: 'WORKBENCH_VERSION_CONFLICT' });
    expect(facts()).toEqual(before);
  });

  it('allows only one of two callers holding the same observed version to commit', async () => {
    const initial = await call('createSession', { title: 'Initial' });
    const outcomes = await Promise.allSettled(
      ['First', 'Second'].map((title) =>
        call('updateSession', {
          id: initial.id,
          patch: { expectedVersion: initial.version, title },
        }),
      ),
    );
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const failure = outcomes.find((item) => item.status === 'rejected');
    expect(failure).toMatchObject({ reason: { code: 'WORKBENCH_VERSION_CONFLICT' } });
    expect((await call('getSession', initial.id)).version).toBe(initial.version + 1);
  });

  it('rolls back title, archive, version and draft when the draft write fails', async () => {
    const initial = await call('createSession', {
      title: 'Initial',
      draft: { prompt: 'Initial draft' },
    });
    const before = facts();
    getDb().exec(
      "CREATE TRIGGER session_draft_fault BEFORE INSERT ON workbench_drafts BEGIN SELECT RAISE(ABORT,'owned draft fault'); END",
    );
    try {
      await expect(
        call('updateSession', {
          id: initial.id,
          patch: { expectedVersion: initial.version, title: 'Partial', archived: true, draft },
        }),
      ).rejects.toThrow('owned draft fault');
      expect(facts()).toEqual(before);
    } finally {
      getDb().exec('DROP TRIGGER session_draft_fault');
    }
    expect(
      (
        await call('updateSession', {
          id: initial.id,
          patch: { expectedVersion: initial.version, draft },
        })
      ).version,
    ).toBe(initial.version + 1);
  });

  it('does not leave a Session when creating its draft fails', async () => {
    const before = facts();
    getDb().exec(
      "CREATE TRIGGER session_draft_fault BEFORE INSERT ON workbench_drafts BEGIN SELECT RAISE(ABORT,'owned create fault'); END",
    );
    try {
      await expect(call('createSession', { title: 'Failed create', draft })).rejects.toThrow(
        'owned create fault',
      );
      expect(facts()).toEqual(before);
    } finally {
      getDb().exec('DROP TRIGGER session_draft_fault');
    }
  });

  it('rejects an empty patch and deleted edits without changing records', async () => {
    const initial = await call('createSession', { title: 'Initial' });
    const before = facts();
    await expect(
      call('updateSession', { id: initial.id, patch: { expectedVersion: initial.version } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(facts()).toEqual(before);
    const removed = await call('removeSession', initial.id);
    const deleted = facts();
    await expect(
      call('updateSession', {
        id: initial.id,
        patch: { expectedVersion: removed.version, title: 'Deleted edit' },
      }),
    ).rejects.toMatchObject({ code: 'WORKBENCH_VERSION_CONFLICT' });
    expect(facts()).toEqual(deleted);
  });

  it('increments versions on delete and restore, retaining the original archive state', async () => {
    const initial = await call('createSession', { title: 'Initial' });
    const archived = await call('updateSession', {
      id: initial.id,
      patch: { expectedVersion: initial.version, archived: true },
    });
    const removed = await call('removeSession', initial.id);
    const restored = await call('restoreSession', initial.id);
    expect([initial.version, archived.version, removed.version, restored.version]).toEqual([
      1, 2, 3, 4,
    ]);
    expect(restored.archivedAt).toBe(archived.archivedAt);
    expect(restored.deletedAt).toBeNull();
  });

  it.each(['rename', 'archive', 'softDelete'] as const)(
    'legacy %s invalidates a previously observed modern version',
    async (action) => {
      const initial = await call('createSession', { title: 'Initial' });
      const legacy = new WorkbenchRepository(getDb());
      if (action === 'rename') legacy.rename(initial.id, 'Legacy title');
      else if (action === 'archive') legacy.archive(initial.id);
      else legacy.softDelete(initial.id);
      const current = await call('getSession', initial.id);
      expect(current.version).toBe(initial.version + 1);
      const before = facts();
      await expect(
        call('updateSession', {
          id: initial.id,
          patch: { expectedVersion: initial.version, title: 'Stale modern write' },
        }),
      ).rejects.toMatchObject({ code: 'WORKBENCH_VERSION_CONFLICT' });
      expect(facts()).toEqual(before);
    },
  );

  it('activity touch does not invalidate an unchanged draft version and never moves time backward', async () => {
    const initial = await call('createSession', { title: 'Initial' });
    const legacy = new WorkbenchRepository(getDb());
    legacy.touch(initial.id, Date.parse(initial.updatedAt) + 1000);
    legacy.touch(initial.id, Date.parse(initial.updatedAt) - 1000);
    const touched = await call('getSession', initial.id);
    expect(touched.version).toBe(initial.version);
    expect(Date.parse(touched.updatedAt)).toBe(Date.parse(initial.updatedAt) + 1000);
    expect(
      (
        await call('updateSession', {
          id: initial.id,
          patch: { expectedVersion: initial.version, draft },
        })
      ).version,
    ).toBe(initial.version + 1);
  });
});
