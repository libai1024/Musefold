import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { get as getHttp, type ClientRequest, type IncomingMessage } from 'node:http';
import { OpenAPIHono } from '@hono/zod-openapi';
import { serve } from '@hono/node-server';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase } from '@musefold/db';
import {
  designSchemePackageExportSchema,
  designSchemePackageExportHistorySchema,
  designSchemePackageExportRecoverySchema,
  type BeginDesignSchemePackageExport,
} from '@musefold/contracts';
import { readValidatedDesignSchemePackageBytes } from '@musefold/scheme-package';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { DesignSchemePackageService } from '../../modules/design-scheme-packages/service.js';
import { PackageOperationBudget } from '../../modules/design-scheme-packages/operation-budget.js';
import { DesignSchemePackageImportService } from '../../modules/design-scheme-packages/import-service.js';
import { DesignSchemePackageExportService } from '../../modules/design-scheme-packages/export-service.js';
import { designSchemePackageExportRoutes } from '../../modules/design-scheme-packages/export-routes.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import {
  importFixture,
  legacyImportFixture,
  FULL_PROMPT,
} from '../../modules/design-scheme-packages/__tests__/import-fixture.js';
import { preparePackageImportContent } from '../../modules/design-scheme-packages/import-content.js';
import { packageHash } from '../../modules/design-scheme-packages/bytes.js';
import {
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'package-export-owner';
const OTHER = 'package-export-other';
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describeDb('formal cloud package export: actual PG, Hono HTTP, S3 bytes and shared archive', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let importer: DesignSchemePackageImportService;
  let staging: DesignSchemePackageService;
  let exporter: DesignSchemePackageExportService;
  let schemes: DesignSchemeService;
  let server: ReturnType<typeof serve>;
  let base: string;
  let storageReads = 0;
  let gate:
    | {
        point: 'source-read' | 'export-read' | 'put';
        reached: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    | undefined;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 10 });
    await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
      cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
    });
    s3 = await startS3Fixture(256 * 1024 * 1024);
    const assets = new DesignSchemeAssetService(database.db, s3.storage);
    schemes = new DesignSchemeService(database.db, assets);
    const budget = new PackageOperationBudget();
    staging = new DesignSchemePackageService(database.db, s3.storage, budget);
    importer = new DesignSchemePackageImportService(database.db, s3.storage, assets, budget);
    exporter = new DesignSchemePackageExportService(
      database.db,
      {
        async read(key, budget) {
          storageReads++;
          const result = await s3.storage.read(key, budget);
          if (gate?.point === (key.startsWith('scheme-exports/') ? 'export-read' : 'source-read')) {
            gate.reached.resolve();
            await gate.release.promise;
          }
          return result;
        },
        async put(key, bytes, mime) {
          expect(
            (
              await database.pool.query(
                'SELECT 1 FROM generation_reference_uploads WHERE object_key=$1',
                [key],
              )
            ).rows,
          ).toHaveLength(1);
          expect(
            (
              await database.pool.query('SELECT 1 FROM object_cleanup_queue WHERE object_key=$1', [
                key,
              ])
            ).rows,
          ).toHaveLength(1);
          await s3.storage.put(key, bytes, mime);
          if (gate?.point === 'put') {
            gate.reached.resolve();
            await gate.release.promise;
          }
        },
      },
      schemes,
      assets,
      budget,
    );
    const app = new OpenAPIHono<AuthedEnv>();
    app.use('*', async (c, next) => {
      // Fixture authentication resolution; the service re-locks actual PG identity/session authority.
      const owner = c.req.header('x-test-owner');
      if (![OWNER, OTHER].includes(owner ?? '')) return c.json({ error: 'unauthorized' }, 401);
      c.set('userId', owner ?? '');
      c.set('sessionId', generationAuthSession(owner ?? ''));
      await next();
    });
    app.onError((e, c) => {
      if (e instanceof AppError) return c.json(toErrorBody(e, 'export-fixture'), e.status as 400);
      throw e;
    });
    app.route('/', designSchemePackageExportRoutes(exporter));
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => server.once('listening', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    base = `http://127.0.0.1:${address.port}`;
  }, 180_000);
  beforeEach(async () => {
    gate = undefined;
    storageReads = 0;
    await database.pool.query('TRUNCATE "user" CASCADE');
    await database.pool.query('TRUNCATE object_cleanup_queue');
    for (const owner of [OWNER, OTHER]) {
      await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [
        owner,
        `${owner}@example.test`,
      ]);
      await seedGenerationAuthority(database.db, { principalId: owner, ownerId: owner });
    }
    s3.objects.clear();
    s3.writes.length = 0;
    s3.state.failPutAfterWrite = false;
  });
  afterAll(async () => {
    gate?.release.resolve();
    if (server) {
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
    await s3?.close();
    await database?.pool.end();
    await container?.stop();
  });
  async function formal(version: 1 | 2 = 2, packageBytes?: Buffer) {
    const fixture = version === 1 ? await legacyImportFixture() : await importFixture();
    const bytes = packageBytes ?? (await fixture.encode());
    const begun = await staging.begin(OWNER, generationAuthSession(OWNER), {
      requestId: randomUUID(),
      packageHash: packageHash(bytes),
      sizeBytes: bytes.length,
      formatVersion: version,
    });
    const ready = await staging.upload(
      OWNER,
      generationAuthSession(OWNER),
      begun.stagedPackageId,
      new ReadableStream({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    if (!ready.confirmationHash) throw new Error('Not ready');
    await staging.decide(OWNER, generationAuthSession(OWNER), begun.stagedPackageId, {
      packageHash: ready.packageHash,
      formatVersion: version,
      parserVersion: ready.parserVersion,
      confirmationHash: ready.confirmationHash,
      decision: 'confirm',
    });
    const result = await importer.execute(OWNER, generationAuthSession(OWNER), {
      stagedPackageId: begun.stagedPackageId,
      packageHash: ready.packageHash,
      formatVersion: version,
    });
    const detail = await schemes.get(OWNER, {
      id: result.scheme.id,
      revision: { kind: 'current' },
    });
    // SQL trial fixture establishes existing service qualification, not a real paid provider run.
    await database.pool.query(
      `INSERT INTO design_scheme_runs (run_id,user_id,scheme_id,revision_id,mode,status,policy,completed_at)
      VALUES ($1,$2,$3,$4,'trial','completed','{}',now())`,
      [randomUUID(), OWNER, result.scheme.id, result.revisionId],
    );
    const covered = await schemes.selectCover(OWNER, {
      schemeId: result.scheme.id,
      assetId: detail.assets[0].id,
      expectedVersion: result.scheme.version,
    });
    const qualified = await schemes.formalize(OWNER, {
      schemeId: result.scheme.id,
      revisionId: result.revisionId,
      coverAssetId: detail.assets[0].id,
      expectedVersion: covered.scheme.version,
      confirmed: true,
    });
    return {
      requestId: randomUUID(),
      schemeId: qualified.scheme.id,
      revisionId: result.revisionId,
      expectedVersion: qualified.scheme.version,
      formatVersion: 2 as const,
    };
  }
  const request = (suffix: string, method = 'GET', body?: unknown, owner = OWNER) =>
    fetch(`${base}/design-schemes/package-exports${suffix}`, {
      method,
      headers: { 'x-test-owner': owner, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  async function ready(input: BeginDesignSchemePackageExport) {
    const response = await request('', 'POST', input);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    const result = designSchemePackageExportSchema.parse(body);
    expect(result.status).toBe('ready');
    return result;
  }
  const exportRow = async (id: string) =>
    (await database.pool.query('SELECT * FROM design_scheme_package_exports WHERE id=$1', [id]))
      .rows[0];

  it.each(['disconnect', 'idle'] as const)(
    'holds download admission while two actual HTTP clients stop reading and releases it on %s',
    async (releaseMode) => {
      const root = resolve(process.env.PACKAGE_CAPACITY_EVIDENCE_DIR ?? 'test-results');
      await mkdir(root, { recursive: true });
      const directory = await mkdtemp(resolve(root, 'capacity-download-'));
      await promisify(execFile)(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('../fixtures/package-capacity-process.ts', import.meta.url)),
          'generate',
          directory,
          'entry',
          'at',
        ],
        { env: { ...process.env, PACKAGE_CAPACITY_TEST: '1' }, timeout: 180000 },
      );
      const input = JSON.parse(await readFile(resolve(directory, 'entry-at.json'), 'utf8'));
      const bytes = await readFile(input.path);
      expect(packageHash(bytes)).toBe(input.sha256);
      const basis = await formal(2, bytes);
      const result = await ready(basis);
      expect(result.sizeBytes).toBeGreaterThan(64 * 1024 * 1024);
      const exported = s3.objects.get((await exportRow(result.exportId)).object_key);
      if (!exported) throw new Error('Prepared export bytes missing');
      expect(exported?.length).toBe(result.sizeBytes);
      expect(packageHash(exported)).toBe(result.packageHash);
      const exportPath = resolve(directory, 'export.musefold.design');
      await writeFile(exportPath, exported, { flag: 'wx' });
      const requests: ClientRequest[] = [];
      const responses: IncomingMessage[] = [];
      const startedAt = new Date().toISOString();
      let recoveryWaitMs: number | undefined;
      const observations: Array<{
        status: number | undefined;
        complete: boolean;
        readableBytes: number;
      }> = [];
      const paused = () =>
        new Promise<IncomingMessage>((resolveResponse, reject) => {
          const request = getHttp(
            `${base}/design-schemes/package-exports/${result.exportId}/content`,
            {
              headers: { 'x-test-owner': OWNER },
            },
            (response) => {
              // A server-side idle timeout can reset an intentionally paused client.
              response.on('error', () => {});
              response.pause();
              responses.push(response);
              observations.push({
                status: response.statusCode,
                complete: response.complete,
                readableBytes: response.readableLength,
              });
              resolveResponse(response);
            },
          );
          requests.push(request);
          request.on('error', reject);
        });
      try {
        const first = await paused();
        const second = await paused();
        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(200);
        expect(first.complete).toBe(false);
        expect(second.complete).toBe(false);
        const reads = storageReads;
        const overflow = await paused();
        expect(overflow.statusCode).toBe(429);
        expect(storageReads).toBe(reads);
        const preparation = await request('', 'POST', { ...basis, requestId: randomUUID() });
        expect(preparation.status).toBe(429);
        await preparation.json();
        let bodyCancelled = false;
        await expect(
          staging.upload(
            OWNER,
            generationAuthSession(OWNER),
            randomUUID(),
            new ReadableStream({
              cancel() {
                bodyCancelled = true;
              },
            }),
          ),
        ).rejects.toMatchObject({ status: 429, retryable: true });
        expect(bodyCancelled).toBe(true);
        expect(
          (await exporter.get(OWNER, generationAuthSession(OWNER), result.exportId)).status,
        ).toBe('ready');
        const recoveryStarted = performance.now();
        if (releaseMode === 'disconnect') {
          for (const response of responses) response.destroy();
          for (const request of requests) request.destroy();
        }
        await expect
          .poll(
            async () => {
              const retry = await request(`/${result.exportId}/content`);
              const status = retry.status;
              await retry.body?.cancel();
              return status;
            },
            { timeout: releaseMode === 'idle' ? 70000 : 10000, interval: 500 },
          )
          .toBe(200);
        recoveryWaitMs = performance.now() - recoveryStarted;
        if (releaseMode === 'idle') expect(recoveryWaitMs).toBeGreaterThan(55000);
        expect((await exportRow(result.exportId)).status).toBe('ready');
      } finally {
        for (const response of responses) response.destroy();
        for (const request of requests) request.destroy();
        await writeFile(
          resolve(directory, 'download.json'),
          JSON.stringify(
            {
              input,
              releaseMode,
              startedAt,
              finishedAt: new Date().toISOString(),
              recoveryWaitMs,
              exportId: result.exportId,
              sizeBytes: result.sizeBytes,
              exportPath,
              packageHash: result.packageHash,
              observations,
              scope:
                'Real Hono TCP/S3 bytes and paused HTTP clients. Existing SQL trial and header authentication fixtures establish service prerequisites; not a real provider trial or production identity test.',
            },
            null,
            2,
          ),
          { flag: 'wx' },
        );
      }
    },
    180000,
  );

  it('HEAD does not retain unread download leases before the next complete GET', async () => {
    const item = await ready(await formal());
    for (let i = 0; i < 3; i++) {
      const response = await request(`/${item.exportId}/content`, 'HEAD');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-length')).toBe(String(item.sizeBytes));
      expect((await response.arrayBuffer()).byteLength).toBe(0);
    }
    const response = await request(`/${item.exportId}/content`);
    expect(response.status).toBe(200);
    expect(packageHash(new Uint8Array(await response.arrayBuffer()))).toBe(item.packageHash);
  });

  it.each([1, 2] as const)(
    'exports actual imported v%s after service formalization, preserving full content through HTTP download and reimport mapping',
    async (version) => {
      const input = await formal(version);
      const result = await ready(input);
      expect(result).not.toHaveProperty('objectKey');
      expect(result).not.toHaveProperty('authorityHash');
      const response = await request(`/${result.exportId}/content`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('content-disposition')).toContain('.musefold.design');
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(packageHash(bytes)).toBe(result.packageHash);
      expect(bytes.length).toBe(result.sizeBytes);
      const archive = await readValidatedDesignSchemePackageBytes(bytes);
      expect(archive.formatVersion).toBe(2);
      if (archive.formatVersion !== 2) throw new Error('Wrong version');
      expect(archive.manifest.assets.filter((a) => a.role === 'cover')).toHaveLength(1);
      expect([...archive.entries.values()].some((b) => b.toString() === FULL_PROMPT)).toBe(true);
      const plan = await preparePackageImportContent(bytes, {
        seed: randomUUID(),
        createdAt: new Date().toISOString(),
      });
      expect(plan.document.schemeId).not.toBe(input.schemeId);
      expect(plan.assets.some((a) => a.metadata.role === 'cover')).toBe(false);
      const metadata = JSON.stringify(archive.manifest);
      expect(metadata).not.toContain('scheme-imports/');
      expect(metadata).not.toContain('objectKey');
      expect(metadata).not.toContain('authorityHash');
      expect((await request(`/${result.exportId}`, 'GET', undefined, OTHER)).status).toBe(404);
      expect((await request(`/${result.exportId}/content`, 'GET', undefined, OTHER)).status).toBe(
        404,
      );
    },
  );
  it('returns the same immutable export for an identical request without another S3 PUT', async () => {
    const input = await formal();
    const a = await ready(input);
    const writes = s3.writes.length;
    expect(await ready(input)).toEqual(a);
    expect(s3.writes.length).toBe(writes);
    expect(
      (await request('', 'POST', { ...input, expectedVersion: input.expectedVersion + 1 })).status,
    ).toBe(409);
    await request(`/${a.exportId}`, 'DELETE');
    expect((await request(`/${a.exportId}/content`)).status).toBe(409);
    expect((await request('', 'POST', input)).status).toBe(200);
    expect((await exporter.get(OWNER, generationAuthSession(OWNER), a.exportId)).status).toBe(
      'cancelled',
    );
    expect(s3.writes.length).toBe(writes);
  });
  it.each(['draft', 'trial', 'cover', 'revision', 'version', 'deleted', 'authority'] as const)(
    'rejects invalid %s qualification before export PUT',
    async (kind) => {
      const input = await formal();
      if (kind === 'draft') await database.pool.query("UPDATE design_schemes SET status='draft'");
      if (kind === 'trial')
        await database.pool.query("UPDATE design_scheme_runs SET status='failed'");
      if (kind === 'cover')
        await database.pool.query('UPDATE design_schemes SET cover_asset_id=NULL');
      if (kind === 'revision') input.revisionId = 'wrong-revision';
      if (kind === 'version') input.expectedVersion++;
      if (kind === 'deleted')
        await database.pool.query('UPDATE design_schemes SET deleted_at=now()');
      if (kind === 'authority')
        await database.pool.query("UPDATE account_session_authorizations SET mode='recovery_only'");
      const writes = s3.writes.length;
      expect((await request('', 'POST', input)).status).toBe(
        kind === 'authority' ? 401 : kind === 'deleted' ? 404 : 409,
      );
      expect(s3.writes.length).toBe(writes);
      expect(
        (await database.pool.query('SELECT * FROM design_scheme_package_exports')).rows,
      ).toHaveLength(0);
    },
  );
  it('does not include an unrelated working-draft asset belonging to the same scheme', async () => {
    const input = await formal();
    const detail = await schemes.get(OWNER, { id: input.schemeId, revision: { kind: 'current' } });
    const next = {
      ...detail.document,
      revisionId: randomUUID(),
      parentRevisionId: input.revisionId,
    };
    await schemes.update(OWNER, {
      schemeId: input.schemeId,
      document: next,
      baseRevisionId: input.revisionId,
      expectedVersion: input.expectedVersion,
    });
    input.expectedVersion++;
    await database.pool.query(
      `INSERT INTO design_scheme_assets SELECT 'excluded-draft',user_id,$1,object_key,role,origin,mime_type,width,height,byte_size,content_hash,license,created_at FROM design_scheme_assets LIMIT 1`,
      [next.revisionId],
    );
    const result = await ready(input);
    const bytes = Buffer.from(await (await request(`/${result.exportId}/content`)).arrayBuffer());
    const archive = await readValidatedDesignSchemePackageBytes(bytes);
    expect(JSON.stringify(archive.manifest)).not.toContain('excluded-draft');
  });
  it.each(['cancel', 'authority', 'expiry', 'version', 'delete'] as const)(
    'refuses final commit after %s changes while a real PUT is in flight',
    async (kind) => {
      const input = await formal();
      gate = { point: 'put', reached: deferred(), release: deferred() };
      const pending = request('', 'POST', input);
      await gate.reached.promise;
      const [row] = (await database.pool.query('SELECT * FROM design_scheme_package_exports')).rows;
      const replay = await request('', 'POST', input);
      expect(designSchemePackageExportSchema.parse(await replay.json()).status).toBe('preparing');
      if (kind === 'cancel') await request(`/${row.id}`, 'DELETE');
      if (kind === 'authority')
        await database.pool.query('UPDATE account_session_authorizations SET revision=revision+1');
      if (kind === 'expiry')
        await database.pool.query(
          "UPDATE design_scheme_package_exports SET expires_at=now()-interval '1 second'",
        );
      if (kind === 'version')
        await database.pool.query('UPDATE design_schemes SET version=version+1');
      if (kind === 'delete') await database.pool.query('DELETE FROM "user" WHERE id=$1', [OWNER]);
      gate.release.resolve();
      expect((await pending).status).toBe(kind === 'delete' ? 401 : 409);
      expect(s3.objects.has(row.object_key)).toBe(true);
      expect(
        (
          await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
            row.object_key,
          ])
        ).rows,
      ).toHaveLength(1);
      if (kind !== 'delete') expect((await exportRow(row.id)).status).not.toBe('ready');
    },
  );
  it('keeps a failed receipt after S3 stores the object but returns an error; a new request uses another object', async () => {
    const input = await formal();
    s3.state.failPutAfterWrite = true;
    expect((await request('', 'POST', input)).status).toBe(503);
    const [failed] = (await database.pool.query('SELECT * FROM design_scheme_package_exports'))
      .rows;
    expect(failed.status).toBe('failed');
    expect(s3.objects.has(failed.object_key)).toBe(true);
    const writes = s3.writes.length;
    const replay = await request('', 'POST', input);
    expect(designSchemePackageExportSchema.parse(await replay.json()).status).toBe('failed');
    expect(s3.writes.length).toBe(writes);
    s3.state.failPutAfterWrite = false;
    const next = await ready({ ...input, requestId: randomUUID() });
    expect(next.exportId).not.toBe(failed.id);
  });
  it('rolls back a failed ready transition and retains the exact object cleanup intent', async () => {
    const input = await formal();
    await database.pool.query(`CREATE FUNCTION reject_export_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ready' THEN RAISE EXCEPTION 'fixture-ready-failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_export_ready BEFORE UPDATE ON design_scheme_package_exports FOR EACH ROW EXECUTE FUNCTION reject_export_ready()`);
    try {
      expect((await request('', 'POST', input)).status).toBe(503);
    } finally {
      await database.pool.query(
        'DROP TRIGGER reject_export_ready ON design_scheme_package_exports; DROP FUNCTION reject_export_ready()',
      );
    }
    const [failed] = (await database.pool.query('SELECT * FROM design_scheme_package_exports'))
      .rows;
    expect(failed.status).toBe('failed');
    expect(failed.package_hash).toBeNull();
    expect(failed.size_bytes).toBeNull();
    expect(s3.objects.has(failed.object_key)).toBe(true);
    expect(
      (
        await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key=$1', [
          failed.object_key,
        ])
      ).rows,
    ).toHaveLength(1);
    await ready({ ...input, requestId: randomUUID() });
  });
  it.each(['cancel', 'authority', 'version', 'delete'] as const)(
    'refuses bytes when %s changes during the actual download read',
    async (kind) => {
      const result = await ready(await formal());
      gate = { point: 'export-read', reached: deferred(), release: deferred() };
      const pending = request(`/${result.exportId}/content`);
      await gate.reached.promise;
      if (kind === 'cancel') await request(`/${result.exportId}`, 'DELETE');
      if (kind === 'authority')
        await database.pool.query('UPDATE account_session_authorizations SET revision=revision+1');
      if (kind === 'version')
        await database.pool.query('UPDATE design_schemes SET version=version+1');
      if (kind === 'delete') await database.pool.query('DELETE FROM "user" WHERE id=$1', [OWNER]);
      gate.release.resolve();
      const response = await pending;
      expect(response.status).toBe(kind === 'delete' ? 401 : 409);
      expect(response.headers.get('content-type')).toContain('application/json');
    },
  );
  it('rejects corrupt source bytes before PUT and corrupt package bytes before download', async () => {
    const input = await formal();
    const [file] = (await database.pool.query('SELECT * FROM design_scheme_source_files LIMIT 1'))
      .rows;
    const original = s3.objects.get(file.object_key);
    if (!original) throw new Error('No source');
    s3.objects.set(file.object_key, Buffer.from('corrupt'));
    const writes = s3.writes.length;
    expect((await request('', 'POST', input)).status).toBe(409);
    expect(s3.writes.length).toBe(writes);
    s3.objects.set(file.object_key, original);
    const result = await ready({ ...input, requestId: randomUUID() });
    s3.objects.set((await exportRow(result.exportId)).object_key, Buffer.from('corrupt archive'));
    expect((await request(`/${result.exportId}/content`)).status).toBe(409);
  });
  it('rejects oversized JSON and unknown owner/path fields without registering an export', async () => {
    expect((await request('', 'POST', { padding: 'x'.repeat(9000) })).status).toBe(413);
    const input = await formal();
    expect((await request('', 'POST', { ...input, objectKey: '/private/path' })).status).toBe(400);
    expect(
      (await database.pool.query('SELECT * FROM design_scheme_package_exports')).rows,
    ).toHaveLength(0);
  });
  it.each(['hold-read', 'hold-put', 'hold-result'])(
    'observes the same request after actual SIGKILL at %s in a new PID, without rewriting its object',
    async (mode) => {
      const input = await formal();
      const helper = fileURLToPath(
        new URL('../fixtures/package-export-process.ts', import.meta.url),
      );
      const env = {
        ...process.env,
        DATABASE_URL: container.getConnectionUri(),
        NODE_ENV: 'test',
        BETTER_AUTH_SECRET: 'synthetic-auth-secret',
        CREDENTIAL_ENCRYPTION_KEY: 'synthetic-encryption-key',
        NEW_API_BASE_URL: 'http://127.0.0.1:1',
        S3_ENDPOINT: s3.endpoint,
        S3_REGION: 'us-east-1',
        S3_BUCKET: 'test-scheme-assets',
        S3_ACCESS_KEY_ID: 'synthetic-key',
        S3_SECRET_ACCESS_KEY: 'synthetic-secret',
      };
      const args = [
        '--import',
        'tsx',
        helper,
        mode,
        OWNER,
        generationAuthSession(OWNER),
        JSON.stringify(input),
      ];
      const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let errors = '';
      child.stderr.on('data', (chunk) => {
        errors += String(chunk);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`Export did not pause: ${errors}`)),
            10_000,
          );
          child.stdout.on('data', (chunk) => {
            output += String(chunk);
            if (output.includes('EXPORT_POINT=')) {
              clearTimeout(timeout);
              resolve();
            }
          });
          child.once('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`Export exited ${code}: ${errors}`));
          });
        });
        expect(output).toContain(`EXPORT_PID=${child.pid}`);
        const exit = new Promise<NodeJS.Signals | null>((resolve) =>
          child.once('exit', (_code, signal) => resolve(signal)),
        );
        child.kill('SIGKILL');
        expect(await exit).toBe('SIGKILL');
        const writes = s3.writes.length;
        if (mode !== 'hold-result')
          await database.pool.query(
            "UPDATE design_scheme_package_exports SET lease_until=now()-interval '1 second'",
          );
        const replayArgs = [...args];
        replayArgs[3] = 'observe';
        const replay = await promisify(execFile)(process.execPath, replayArgs, {
          env,
          timeout: 15_000,
        });
        expect(replay.stdout).not.toContain(`EXPORT_PID=${child.pid}\n`);
        const line = replay.stdout.split('\n').find((value) => value.startsWith('EXPORT_RESULT='));
        if (!line) throw new Error('Missing result');
        const result = designSchemePackageExportSchema.parse(
          JSON.parse(line.slice('EXPORT_RESULT='.length)),
        );
        expect(result.status).toBe(mode === 'hold-result' ? 'ready' : 'expired');
        expect(s3.writes.length).toBe(writes);
        if (mode === 'hold-result')
          expect((await request(`/${result.exportId}/content`)).status).toBe(200);
        else {
          expect((await request(`/${result.exportId}/content`)).status).toBe(409);
          await ready({ ...input, requestId: randomUUID() });
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const stopped = new Promise<void>((r) => child.once('exit', () => r()));
          child.kill('SIGKILL');
          await stopped;
        }
      }
    },
    30_000,
  );
  it.each(['repository', 'cloud-run'] as const)(
    'keeps %s source image roles when selected as cover by using an archive-only cover copy',
    async (origin) => {
      const input = await formal();
      const detail = await schemes.get(OWNER, {
        id: input.schemeId,
        revision: { kind: 'current' },
      });
      const historyIds = detail.sourceSnapshots.flatMap(
        (snapshot) => snapshot.historyItems?.map((item) => item.imageAssetId) ?? [],
      );
      const cover = detail.assets.find((a) =>
        origin === 'repository'
          ? detail.document.repositoryImages?.some((image) => image.assetId === a.id)
          : historyIds.includes(a.id),
      );
      if (!cover) throw new Error('No source image');
      const changed = await schemes.selectCover(OWNER, {
        schemeId: input.schemeId,
        assetId: cover.id,
        expectedVersion: input.expectedVersion,
      });
      input.expectedVersion = changed.scheme.version;
      const result = await ready(input);
      const bytes = Buffer.from(await (await request(`/${result.exportId}/content`)).arrayBuffer());
      const archive = await readValidatedDesignSchemePackageBytes(bytes);
      if (archive.formatVersion !== 2) throw new Error('Wrong version');
      expect(archive.manifest.assets.find((a) => a.id === cover.id)?.role).toBe(
        origin === 'repository' ? 'reference' : 'example',
      );
      const copy = archive.manifest.assets.find((a) => a.role === 'cover');
      expect(copy?.id).not.toBe(cover.id);
      expect(copy?.contentHash).toBe(cover.contentHash);
      expect(
        (await database.pool.query('SELECT * FROM design_scheme_assets WHERE id=$1', [copy?.id]))
          .rows,
      ).toHaveLength(0);
    },
  );
  it('rejects a cover from an older revision and never exports an expired prepared object', async () => {
    const input = await formal();
    const detail = await schemes.get(OWNER, { id: input.schemeId, revision: { kind: 'current' } });
    const oldRevision = { ...detail.document, revisionId: randomUUID() };
    await database.pool.query(
      `INSERT INTO design_scheme_revisions(revision_id,scheme_id,user_id,schema_version,document,created_by) VALUES($1,$2,$3,1,$4,'user')`,
      [oldRevision.revisionId, input.schemeId, OWNER, JSON.stringify(oldRevision)],
    );
    await database.pool.query('UPDATE design_scheme_assets SET revision_id=$1 WHERE id=$2', [
      oldRevision.revisionId,
      detail.summary.coverAssetId,
    ]);
    expect((await request('', 'POST', input)).status).toBe(409);
    await database.pool.query('UPDATE design_scheme_assets SET revision_id=$1 WHERE id=$2', [
      input.revisionId,
      detail.summary.coverAssetId,
    ]);
    const result = await ready(input);
    await database.pool.query(
      "UPDATE design_scheme_package_exports SET expires_at=now()-interval '1 second'",
    );
    expect(
      designSchemePackageExportSchema.parse(await (await request(`/${result.exportId}`)).json())
        .status,
    ).toBe('expired');
    expect((await request(`/${result.exportId}/content`)).status).toBe(409);
  });
  async function recovery(id: string) {
    const response = await request(`/${id}/recovery`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return designSchemePackageExportRecoverySchema.parse(await response.json());
  }
  it('discovers a committed export after lost response without archive IO, writes or renewal', async () => {
    const input = await formal();
    const exported = await ready(input);
    const before = await exportRow(exported.exportId);
    const reads = storageReads;
    const writes = s3.writes.length;
    const response = await request('');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const page = designSchemePackageExportHistorySchema.parse(await response.json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0].export).toEqual(exported);
    expect(page.items[0].expectedVersion).toBe(input.expectedVersion);
    expect(await recovery(exported.exportId)).toMatchObject({
      canDownload: true,
      blockedReason: null,
    });
    expect(await exportRow(exported.exportId)).toEqual(before);
    expect(storageReads).toBe(reads);
    expect(s3.writes).toHaveLength(writes);
    const text = JSON.stringify(page);
    for (const secret of ['objectKey', 'authorityHash', 'basisHash', 'requestHash', 'leaseUntil'])
      expect(text).not.toContain(secret);
    expect((await request(`/${exported.exportId}/recovery`, 'GET', undefined, OTHER)).status).toBe(
      404,
    );
    expect((await request(`?cursor=${exported.exportId}`, 'GET', undefined, OTHER)).status).toBe(
      400,
    );
    for (const q of ['?limit=0', '?limit=51', '?userId=other'])
      expect((await request(q)).status).toBe(400);
  });
  it('paginates exact PG timestamp ties once per owner without rebuilding exports', async () => {
    const input = await formal();
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      const item = await ready({ ...input, requestId: randomUUID() });
      ids.push(item.exportId);
      await request(`/${item.exportId}`, 'DELETE');
    }
    await database.pool.query(
      "UPDATE design_scheme_package_exports SET created_at='2026-09-09 00:00:00.123456+00' WHERE user_id=$1",
      [OWNER],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      const page = designSchemePackageExportHistorySchema.parse(await response.json());
      seen.push(...page.items.map((item) => item.export.exportId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(
      designSchemePackageExportHistorySchema.parse(
        await (await request('', 'GET', undefined, OTHER)).json(),
      ).items,
    ).toEqual([]);
  });
  it('reads a live preparing export without renewing its writer, then reads the original ready archive', async () => {
    const input = await formal();
    gate = { point: 'put', reached: deferred(), release: deferred() };
    const pending = request('', 'POST', input);
    try {
      await gate.reached.promise;
      const row = (
        await database.pool.query(
          'SELECT * FROM design_scheme_package_exports WHERE request_id=$1',
          [input.requestId],
        )
      ).rows[0];
      expect(await recovery(row.id)).toMatchObject({
        canDownload: false,
        blockedReason: 'export_in_progress',
      });
      expect(await exportRow(row.id)).toEqual(row);
    } finally {
      gate.release.resolve();
    }
    const completed = designSchemePackageExportSchema.parse(await (await pending).json());
    expect(await recovery(completed.exportId)).toMatchObject({
      canDownload: true,
      export: { exportId: completed.exportId },
    });
  });
  it.each(['cancel', 'expiry', 'session', 'version', 'delete'] as const)(
    'recovery cannot bypass %s and content independently refuses it',
    async (mode) => {
      const input = await formal();
      const exported = await ready(input);
      if (mode === 'cancel') await request(`/${exported.exportId}`, 'DELETE');
      if (mode === 'expiry')
        await database.pool.query(
          "UPDATE design_scheme_package_exports SET expires_at=now()+interval '10 seconds' WHERE id=$1",
          [exported.exportId],
        );
      if (mode === 'session')
        await database.pool.query(
          'UPDATE account_session_authorizations SET revision=revision+1 WHERE user_id=$1',
          [OWNER],
        );
      if (mode === 'version')
        await database.pool.query('UPDATE design_schemes SET version=version+1 WHERE id=$1', [
          input.schemeId,
        ]);
      if (mode === 'delete')
        await database.pool.query('UPDATE design_schemes SET deleted_at=now() WHERE id=$1', [
          input.schemeId,
        ]);
      const reads = storageReads;
      const writes = s3.writes.length;
      expect(await recovery(exported.exportId)).toMatchObject({
        canDownload: false,
        blockedReason:
          mode === 'session'
            ? 'session_changed'
            : ['version', 'delete'].includes(mode)
              ? 'basis_changed'
              : 'export_unavailable',
      });
      expect((await request(`/${exported.exportId}/content`)).status).toBe(
        mode === 'delete' ? 404 : 409,
      );
      expect(storageReads).toBe(reads);
      expect(s3.writes).toHaveLength(writes);
    },
  );
  it.each(['restricted', 'expired'] as const)(
    'requires a normal current session for %s history and recovery',
    async (mode) => {
      const exported = await ready(await formal());
      if (mode === 'restricted')
        await database.pool.query(
          "UPDATE account_session_authorizations SET mode='recovery_only' WHERE user_id=$1",
          [OWNER],
        );
      else
        await database.pool.query(
          "UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=$1",
          [OWNER],
        );
      expect((await request('')).status).toBe(401);
      expect((await request(`/${exported.exportId}/recovery`)).status).toBe(401);
    },
  );
  it('a new normal session can discover the old export but cannot inherit its download authority', async () => {
    const item = await ready(await formal());
    await database.pool.query(
      "INSERT INTO session(id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
      ['new-export-session', OWNER, randomUUID()],
    );
    await database.pool.query(
      "INSERT INTO account_session_authorizations(session_id,user_id,mode,revision) VALUES ($1,$2,'normal',1)",
      ['new-export-session', OWNER],
    );
    await database.pool.query(
      "UPDATE session SET expires_at=now()-interval '1 second' WHERE id=$1",
      [generationAuthSession(OWNER)],
    );
    expect(
      (await exporter.listRecovery(OWNER, 'new-export-session', { limit: 20 })).items[0].export
        .exportId,
    ).toBe(item.exportId);
    expect(await exporter.recovery(OWNER, 'new-export-session', item.exportId)).toMatchObject({
      canDownload: false,
      blockedReason: 'session_changed',
    });
    await expect(
      exporter.content(OWNER, 'new-export-session', item.exportId),
    ).rejects.toMatchObject({ status: 409 });
  });
});
