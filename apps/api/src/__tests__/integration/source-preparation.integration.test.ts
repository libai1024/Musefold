import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, retireDesignSchemeSourcePreparations } from '@musefold/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DesignSchemeSourcePreparationService } from '../../modules/design-schemes/source-preparation.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import { sourceGithubFixture } from '../fixtures/source-github.js';

const owner = 'source-owner';
const foreign = 'source-foreign';
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('durable GitHub source preparation: real PG, reader HTTP and S3 SDK', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let github: Awaited<ReturnType<typeof sourceGithubFixture>>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let service: DesignSchemeSourcePreparationService;
  const input = () => ({
    executionId: randomUUID(),
    repositoryUrl: 'https://github.com/example/design',
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri());
    const path = await mkdtemp(join(tmpdir(), 'source-expand-'));
    try {
      await cp(
        fileURLToPath(new URL('../../../../../packages/db/migrations', import.meta.url)),
        path,
        { recursive: true },
      );
      const journalPath = join(path, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8'));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 12);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(database.db, { migrationsFolder: path });
      await database.pool.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$2),($3,$3,$4)', [
        owner,
        'source-owner@example.test',
        foreign,
        'source-foreign@example.test',
      ]);
      await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
        cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
        env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
        timeout: 60_000,
      });
      expect(
        (await database.pool.query('SELECT id FROM "user" WHERE id=$1', [owner])).rows,
      ).toHaveLength(1);
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  }, 180_000);
  beforeEach(async () => {
    github = await sourceGithubFixture();
    s3 = await startS3Fixture();
    service = new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader);
  });
  afterEach(async () => {
    await github?.close();
    await s3?.close();
  });
  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
  });

  it('persists full frozen text; service reconstruction and branch movement never reread GitHub', async () => {
    const request = input();
    const prepared = await service.prepare(owner, request);
    expect(prepared).toMatchObject({
      status: 'ready',
      source: { commitHash: 'a'.repeat(40), license: null },
    });
    await expect(service.readConfirmed(owner, request.executionId)).rejects.toMatchObject({
      status: 409,
    });
    const expected = Buffer.from(github.state.content);
    github.state.commit = 'c'.repeat(40);
    github.state.content = Buffer.from('changed branch');
    const restarted = new DesignSchemeSourcePreparationService(
      database.db,
      s3.storage,
      github.reader,
    );
    const decision = {
      executionId: request.executionId,
      confirmationId: prepared.confirmationId,
      decision: 'install' as const,
    };
    const confirmed = await restarted.decide(owner, decision);
    expect(await restarted.decide(owner, decision)).toEqual(confirmed);
    expect(await restarted.prepare(owner, request)).toEqual(confirmed);
    const read = await restarted.readConfirmed(owner, request.executionId);
    expect(
      Buffer.from(read.files.find((f) => f.metadata.relativePath === 'README.md')?.bytes ?? []),
    ).toEqual(expected);
    expect(
      read.snapshot.files.find((f) => f.relativePath === 'README.md')?.textExcerpt?.length,
    ).toBeLessThan(expected.length);
    expect(github.requests).toHaveLength(3);
    expect(s3.writes).toHaveLength(2);
    expect(JSON.stringify(confirmed)).not.toContain('scheme-sources/');
  });

  it('claims one preparation across concurrent services and rejects altered input', async () => {
    const request = input();
    const other = new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader);
    const results = await Promise.all([
      service.prepare(owner, request),
      other.prepare(owner, request),
    ]);
    expect(results.map((r) => r.confirmationId)[0]).toBe(results[1].confirmationId);
    expect(github.requests).toHaveLength(3);
    expect(s3.writes).toHaveLength(2);
    await expect(
      other.prepare(owner, { ...request, requestedRef: 'another' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(github.requests).toHaveLength(3);
  });

  it('a new actual Node process reuses the confirmed persisted snapshot without fetching the moved branch', async () => {
    const request = input();
    const invoke = async () => {
      const { stdout } = await promisify(execFile)(
        'pnpm',
        [
          'exec',
          'tsx',
          'src/__tests__/fixtures/source-preparation-process.ts',
          JSON.stringify(request),
        ],
        {
          cwd: fileURLToPath(new URL('../../..', import.meta.url)),
          timeout: 30_000,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_URL: container.getConnectionUri(),
            SOURCE_GITHUB_FIXTURE_URL: github.endpoint,
            S3_ENDPOINT: s3.endpoint,
            BETTER_AUTH_SECRET: 'fixture-auth-secret',
            NEW_API_BASE_URL: 'http://127.0.0.1:1',
            CREDENTIAL_ENCRYPTION_KEY: 'fixture-encryption-key',
            S3_REGION: 'us-east-1',
            S3_BUCKET: 'test-scheme-assets',
            S3_ACCESS_KEY_ID: 'fixture-key',
            S3_SECRET_ACCESS_KEY: 'fixture-secret',
          },
        },
      );
      return JSON.parse(stdout);
    };
    const first = await invoke();
    await service.decide(owner, {
      executionId: request.executionId,
      confirmationId: first.prepared.confirmationId,
      decision: 'install',
    });
    github.state.commit = 'd'.repeat(40);
    github.state.content = Buffer.from('new branch');
    const second = await invoke();
    expect(second.pid).not.toBe(first.pid);
    expect(second.prepared.snapshotId).toBe(first.prepared.snapshotId);
    expect(second.prepared.contentHash).toBe(first.prepared.contentHash);
    expect(second.files).toHaveLength(2);
    expect(github.received).toHaveLength(3);
    expect(s3.writes).toHaveLength(2);
  });

  it('expired upload lease fences a late writer and recreates cleanup after a prior acknowledgement', async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const slow = new DesignSchemeSourcePreparationService(
      database.db,
      {
        read: (key) => s3.storage.read(key),
        put: async (key, bytes, mime) => {
          await s3.storage.put(key, bytes, mime);
          entered();
          await held;
        },
      },
      github.reader,
    );
    const request = input();
    const preparing = slow.prepare(owner, request);
    const rejected = expect(preparing).rejects.toMatchObject({ status: 409 });
    try {
      await started;
      await database.pool.query(
        "UPDATE design_scheme_source_preparations SET upload_lease_until=now()-interval '1 second' WHERE execution_id=$1",
        [request.executionId],
      );
      await retireDesignSchemeSourcePreparations(database.db);
      const key = [...s3.objects.keys()][0];
      await database.pool.query('DELETE FROM object_cleanup_queue WHERE object_key=$1', [key]);
    } finally {
      release();
    }
    await rejected;
    expect((await service.get(owner, request.executionId)).status).toBe('expired');
    expect(s3.writes).toHaveLength(1);
    expect(
      (
        await database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key=$1',
          [[...s3.objects.keys()][0]],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('isolates owners and binds decisions to the original confirmation', async () => {
    const request = input();
    const prepared = await service.prepare(owner, request);
    await expect(service.get(foreign, request.executionId)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.decide(foreign, {
        executionId: request.executionId,
        confirmationId: prepared.confirmationId,
        decision: 'install',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.cancel(foreign, request.executionId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.readConfirmed(foreign, request.executionId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.decide(owner, {
        executionId: request.executionId,
        confirmationId: randomUUID(),
        decision: 'install',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.get(owner, request.executionId)).status).toBe('ready');
  });

  it('the migrated database rejects cross-owner snapshot association', async () => {
    const prepared = await service.prepare(owner, input());
    await expect(
      database.pool.query(
        `INSERT INTO design_scheme_source_preparations
      (user_id,execution_id,confirmation_id,request_hash,request,status,snapshot_id,content_hash,confirmation,expires_at)
      VALUES ($1,$2,$3,$4,'{}','ready',$5,$4,'{}',now()+interval '1 hour')`,
        [foreign, randomUUID(), randomUUID(), 'a'.repeat(64), prepared.snapshotId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('concurrent opposing decisions select exactly one terminal decision', async () => {
    const request = input();
    const prepared = await service.prepare(owner, request);
    const other = new DesignSchemeSourcePreparationService(database.db, s3.storage, github.reader);
    const results = await Promise.allSettled([
      service.decide(owner, {
        executionId: request.executionId,
        confirmationId: prepared.confirmationId,
        decision: 'install',
      }),
      other.decide(owner, {
        executionId: request.executionId,
        confirmationId: prepared.confirmationId,
        decision: 'cancel',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(['confirmed', 'rejected']).toContain(
      (await service.get(owner, request.executionId)).status,
    );
    expect(github.requests).toHaveLength(3);
  });

  it('reject is idempotent, cannot later install, and retains cleanup intent for all bytes', async () => {
    const request = input();
    const prepared = await service.prepare(owner, request);
    const decision = {
      executionId: request.executionId,
      confirmationId: prepared.confirmationId,
      decision: 'cancel' as const,
    };
    expect((await service.decide(owner, decision)).status).toBe('rejected');
    expect((await service.decide(owner, decision)).status).toBe('rejected');
    await expect(service.decide(owner, { ...decision, decision: 'install' })).rejects.toMatchObject(
      { status: 409 },
    );
    const keys = [...s3.objects.keys()];
    expect(
      (
        await database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key=ANY($1)',
          [keys],
        )
      ).rows,
    ).toHaveLength(2);
    expect(
      (
        await database.pool.query(
          'SELECT object_key FROM design_scheme_source_files WHERE snapshot_id=$1',
          [prepared.snapshotId],
        )
      ).rows.every((r) => r.object_key === null),
    ).toBe(true);
  });

  it('a PUT with an ambiguous failure is registered and queued before it can become orphaned', async () => {
    s3.state.failPutAfterWrite = true;
    const request = input();
    await expect(service.prepare(owner, request)).rejects.toMatchObject({ status: 502 });
    expect(s3.objects.size).toBe(1);
    expect((await service.get(owner, request.executionId)).status).toBe('failed');
    const key = [...s3.objects.keys()][0];
    expect(
      (
        await database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key=$1',
          [key],
        )
      ).rows,
    ).toHaveLength(1);
    await service.prepare(owner, request); // Failed intent is replayed, never resubmitted.
    expect(github.requests).toHaveLength(3);
  });

  it('cancel during PUT keeps its lease until the writer finishes, then prevents publication', async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const slow = new DesignSchemeSourcePreparationService(
      database.db,
      {
        read: (key) => s3.storage.read(key),
        put: async (key, bytes, mime) => {
          await s3.storage.put(key, bytes, mime);
          entered();
          await held;
        },
      },
      github.reader,
    );
    const request = input();
    const preparing = slow.prepare(owner, request);
    const rejected = expect(preparing).rejects.toMatchObject({ status: 409 });
    try {
      await started;
      expect((await service.cancel(owner, request.executionId)).status).toBe('cancelled');
      await retireDesignSchemeSourcePreparations(database.db);
      const row = (
        await database.pool.query(
          'SELECT retired_at FROM design_scheme_source_preparations WHERE execution_id=$1',
          [request.executionId],
        )
      ).rows[0];
      expect(row.retired_at).toBeNull();
    } finally {
      release();
    }
    await rejected;
    expect(s3.writes).toHaveLength(1);
    await expect(service.readConfirmed(owner, request.executionId)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('expiry is durable, retires once and does not restart source IO', async () => {
    const request = input();
    const prepared = await service.prepare(owner, request);
    await database.pool.query(
      "UPDATE design_scheme_source_preparations SET expires_at=now()-interval '1 second' WHERE execution_id=$1",
      [request.executionId],
    );
    expect((await service.get(owner, request.executionId)).status).toBe('expired');
    await expect(
      service.decide(owner, {
        executionId: request.executionId,
        confirmationId: prepared.confirmationId,
        decision: 'install',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await retireDesignSchemeSourcePreparations(database.db);
    expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(0);
    expect((await service.prepare(owner, request)).status).toBe('expired');
    expect(github.requests).toHaveLength(3);
  });

  it('rejects corrupted stored bytes before returning input to the Agent', async () => {
    const request = input();
    const prepared = await service.prepare(owner, request);
    await service.decide(owner, {
      executionId: request.executionId,
      confirmationId: prepared.confirmationId,
      decision: 'install',
    });
    const key = [...s3.objects.keys()][0];
    s3.objects.set(key, Buffer.from('altered'));
    await expect(service.readConfirmed(owner, request.executionId)).rejects.toMatchObject({
      details: { sourceError: 'SOURCE_BYTES_CHANGED' },
    });
    expect(github.requests).toHaveLength(3);
  });

  it.each(['ids', 'sources'])(
    'deterministic create cannot bypass %s confirmation; bound revision protects bytes past expiry',
    async (shape) => {
      const request = input();
      const prepared = await service.prepare(owner, request);
      const schemeId = randomUUID();
      const revisionId = randomUUID();
      const document = {
        schemaVersion: 1,
        schemeId,
        revisionId,
        name: 'Frozen source',
        summary: 'fixture',
        fidelity: 'faithful',
        sources:
          shape === 'sources'
            ? [
                {
                  id: 'source',
                  kind: 'github-readme',
                  role: 'reference',
                  snapshotId: prepared.snapshotId,
                },
              ]
            : [],
        sourceSnapshotIds: shape === 'ids' ? [prepared.snapshotId] : [],
        inputs: [],
        parameters: [],
        constraints: [],
        promptProgram: [
          {
            id: 'main',
            order: 0,
            kind: 'input-template',
            template: 'synthetic',
            variables: [],
            sourceIds: [],
          },
        ],
        assetIds: [],
        compilation: {
          compiledAt: new Date().toISOString(),
          model: { model: 'fixture' },
          adopted: [],
          omitted: [],
          warnings: [],
          trace: [],
        },
        parentRevisionId: null,
        createdBy: 'user',
        createdAt: new Date().toISOString(),
      };
      const create = {
        executionId: randomUUID(),
        brief: 'fixture',
        sourceUris: [],
        sourceBindings: [],
        sourcePackages: [],
        sourceSnapshots: [],
        sourceAssetIds: [],
        sourceAssets: [],
        historySources: [],
        document,
      };
      const schemes = new DesignSchemeService(database.db);
      // Parse through the canonical input before entering production service.
      const { createDesignSchemeInputSchema } = await import('@musefold/contracts');
      const body = createDesignSchemeInputSchema.parse(create);
      await expect(schemes.create(owner, body)).rejects.toMatchObject({ status: 409 });
      await service.decide(owner, {
        executionId: request.executionId,
        confirmationId: prepared.confirmationId,
        decision: 'install',
      });
      expect((await schemes.create(owner, body)).scheme.id).toBe(schemeId);
      await database.pool.query(
        "UPDATE design_scheme_source_preparations SET expires_at=now()-interval '1 second' WHERE execution_id=$1",
        [request.executionId],
      );
      await retireDesignSchemeSourcePreparations(database.db);
      expect(
        (
          await database.pool.query(
            'SELECT object_key FROM design_scheme_source_files WHERE snapshot_id=$1',
            [prepared.snapshotId],
          )
        ).rows.every((r) => r.object_key !== null),
      ).toBe(true);
      await database.pool.query('DELETE FROM design_schemes WHERE user_id=$1 AND id=$2', [
        owner,
        schemeId,
      ]);
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(1);
      expect(
        (
          await database.pool.query(
            'SELECT object_key FROM design_scheme_source_files WHERE snapshot_id=$1',
            [prepared.snapshotId],
          )
        ).rows.every((r) => r.object_key === null),
      ).toBe(true);
      expect(await retireDesignSchemeSourcePreparations(database.db)).toBe(0);
    },
  );
});
