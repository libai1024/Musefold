import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrateDatabase, user } from '@musefold/db';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchService } from '../../modules/workbench/service.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const owner = 'session-write-owner';
describeDb('Session write atomicity and deleted-state parity in real PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let service: WorkbenchService;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const connection = createDatabase(container.getConnectionUri(), { max: 4 });
    pool = connection.pool;
    await migrateDatabase(connection.db);
    service = new WorkbenchService(connection.db);
    await connection.db.insert(user).values([
      { id: owner, name: 'Owner', email: 'session-write@example.test' },
      { id: 'other-owner', name: 'Other', email: 'other-write@example.test' },
    ]);
  }, 180_000);
  beforeEach(async () => {
    await pool.query('DELETE FROM workbench_sessions');
  });
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });
  const facts = async () => (await pool.query('SELECT * FROM workbench_sessions ORDER BY id')).rows;

  it('rejects editing a deleted Session even with its current version and preserves its entire record', async () => {
    const initial = await service.create(owner, {
      title: 'Initial',
      draft: { prompt: 'Original' },
    });
    const removed = await service.remove(owner, initial.id, initial.version);
    const before = await facts();
    await expect(
      service.update(owner, initial.id, {
        expectedVersion: removed.version,
        title: 'Deleted edit',
        archived: true,
        draft: {
          prompt: 'Replacement',
          negative: '',
          params: {},
          promptReferenceSelections: [],
          promptReferenceIds: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'WORKBENCH_VERSION_CONFLICT' });
    expect(await facts()).toEqual(before);
  });

  it('commits one complete patch when independent transactions compete for the same version', async () => {
    const initial = await service.create(owner, { title: 'Initial' });
    const outcomes = await Promise.allSettled(
      ['First', 'Second'].map((title) =>
        service.update(owner, initial.id, {
          expectedVersion: initial.version,
          title,
          archived: true,
          draft: {
            prompt: title,
            negative: '',
            params: {},
            promptReferenceSelections: [],
            promptReferenceIds: [],
          },
        }),
      ),
    );
    const winners = outcomes.filter((value) => value.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    expect(outcomes.find((value) => value.status === 'rejected')).toMatchObject({
      reason: { code: 'WORKBENCH_VERSION_CONFLICT' },
    });
    const winner = await service.get(owner, initial.id);
    expect(winner.version).toBe(2);
    expect(winner.title).toBe(winner.draft.prompt);
    expect(winner.archivedAt).not.toBeNull();
    expect(winners[0]).toMatchObject({ value: winner });
  });

  it('does not commit partial fields or version when the database rejects a combined update', async () => {
    const initial = await service.create(owner, { title: 'Initial' });
    const before = await facts();
    await pool.query(`CREATE FUNCTION owned_session_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned Session fault'; END $$;
      CREATE TRIGGER owned_session_fault BEFORE UPDATE ON workbench_sessions FOR EACH ROW EXECUTE FUNCTION owned_session_fault()`);
    try {
      await expect(
        service.update(owner, initial.id, {
          expectedVersion: initial.version,
          title: 'Partial',
          archived: true,
        }),
      ).rejects.toThrow();
      expect(await facts()).toEqual(before);
    } finally {
      await pool.query(
        'DROP TRIGGER owned_session_fault ON workbench_sessions; DROP FUNCTION owned_session_fault()',
      );
    }
    expect(
      (
        await service.update(owner, initial.id, {
          expectedVersion: initial.version,
          title: 'Recovered',
        })
      ).version,
    ).toBe(2);
  });

  it('rejects empty patches and foreign-owner writes without changing state', async () => {
    const initial = await service.create(owner, { title: 'Initial' });
    const before = await facts();
    await expect(
      service.update(owner, initial.id, { expectedVersion: initial.version }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.update('other-owner', initial.id, {
        expectedVersion: initial.version,
        title: 'Foreign',
      }),
    ).rejects.toMatchObject({ code: 'WORKBENCH_SESSION_NOT_FOUND' });
    expect(await facts()).toEqual(before);
  });

  it('preserves archive and draft through versioned deletion and restoration', async () => {
    const initial = await service.create(owner, {
      title: 'Initial',
      draft: { prompt: 'Original' },
    });
    const archived = await service.update(owner, initial.id, {
      expectedVersion: 1,
      archived: true,
    });
    const removed = await service.remove(owner, initial.id, 2);
    const restored = await service.restore(owner, initial.id, 3);
    expect([initial.version, archived.version, removed.version, restored.version]).toEqual([
      1, 2, 3, 4,
    ]);
    expect(restored.archivedAt).toBe(archived.archivedAt);
    expect(restored.draft).toEqual(initial.draft);
    expect(restored.deletedAt).toBeNull();
  });
});
