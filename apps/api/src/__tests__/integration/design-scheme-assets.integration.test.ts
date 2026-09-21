import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { OpenAPIHono } from '@hono/zod-openapi';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
  type ReferenceAssetMetadata,
  type StagedDesignSchemeAsset,
} from '@musefold/contracts';
import { createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import { designSchemeAssetRoutes } from '../../modules/design-scheme-assets/routes.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { designSchemeRoutes } from '../../modules/design-schemes/routes.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import {
  GENERATION_TEST_ISSUERS,
  generationAuthSession,
  seedGenerationAuthority,
} from '../fixtures/generation-authority.js';

const OWNER = 'scheme-assets-owner';
const FOREIGN = 'scheme-assets-foreign';
const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

function input(ids: string[] = [], claims: ReferenceAssetMetadata[] = []) {
  const schemeId = randomUUID();
  const document: DesignSchemeRevisionDocument = {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    schemeId,
    revisionId: randomUUID(),
    name: 'Reference image draft',
    summary: 'Cloud staging integration',
    fidelity: 'faithful',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'prompt_main',
        order: 0,
        kind: 'input-template',
        template: '{{subject}}',
        variables: ['subject'],
        sourceIds: [],
      },
    ],
    assetIds: ids,
    compilation: {
      compiledAt: '2026-09-01T00:00:00.000Z',
      model: { model: 'offline-fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    parentRevisionId: null,
    createdBy: 'user',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  return {
    executionId: randomUUID(),
    brief: 'Use my reference',
    sourceUris: [],
    sourceBindings: [],
    sourcePackages: [],
    sourceSnapshots: [],
    sourceAssetIds: ids,
    sourceAssets: claims,
    historySources: [],
    document,
  };
}

function appFor(userId: string, assets: DesignSchemeAssetService, schemes: DesignSchemeService) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('sessionId', 'asset-test-session');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.json(toErrorBody(error, 'asset-test-request'), error.status as 400);
    throw error;
  });
  app.route('/', designSchemeAssetRoutes(assets));
  app.route('/', designSchemeRoutes(schemes));
  return app;
}

function claim(metadata: StagedDesignSchemeAsset): ReferenceAssetMetadata {
  const { id, mimeType, width, height, byteSize, contentHash, createdAt } = metadata;
  return {
    id,
    mimeType,
    width,
    height,
    byteSize,
    contentHash,
    createdAt,
    origin: 'uploaded',
    role: 'reference',
    license: null,
  };
}

describeDb('scheme asset staging and promotion (real PostgreSQL + S3 HTTP transport)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let assets: DesignSchemeAssetService;
  let schemes: DesignSchemeService;
  let ownerApp: ReturnType<typeof appFor>;
  let foreignApp: ReturnType<typeof appFor>;
  let png: Buffer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    database = createDatabase(container.getConnectionUri(), { max: 10 });
    const migrationFolder = fileURLToPath(
      new URL('../../../../../packages/db/migrations', import.meta.url),
    );
    const previousMigrations = await mkdtemp(join(tmpdir(), 'musefold-scheme-expand-'));
    try {
      await cp(migrationFolder, previousMigrations, { recursive: true });
      const journalFile = join(previousMigrations, 'meta/_journal.json');
      const journal = JSON.parse(await readFile(journalFile, 'utf8'));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 7);
      await writeFile(journalFile, JSON.stringify(journal));
      await migrate(database.db, { migrationsFolder: previousMigrations });
    } finally {
      await rm(previousMigrations, { recursive: true, force: true });
    }
    await database.pool.query(
      'INSERT INTO "user" (id, name, email) VALUES ($1, $1, $2), ($3, $3, $4)',
      [OWNER, 'assets-owner@example.test', FOREIGN, 'assets-foreign@example.test'],
    );
    // Seed both existing origins under the real pre-0007 schema, then expand with the documented CLI.
    const legacyInput = input();
    await new DesignSchemeService(database.db).create(OWNER, legacyInput);
    for (const origin of ['repository', 'local-run']) {
      await database.pool.query(
        'INSERT INTO design_scheme_assets (id, user_id, revision_id, origin, role, object_key, mime_type, width, height, byte_size, content_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, 1, $8)',
        [
          `legacy-${origin}`,
          OWNER,
          legacyInput.document.revisionId,
          origin,
          'reference',
          `legacy/${origin}`,
          'image/png',
          'b'.repeat(64),
        ],
      );
    }
    const beforeExpand = (
      await database.pool.query('SELECT * FROM design_scheme_assets ORDER BY id')
    ).rows;
    await promisify(execFile)('pnpm', ['run', 'db:migrate'], {
      cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      timeout: 60_000,
    });
    expect(
      (await database.pool.query('SELECT * FROM design_scheme_assets ORDER BY id')).rows,
    ).toEqual(beforeExpand);
    await migrateDatabase(database.db); // Same journal replays after the CLI expanded uploaded origin.
    s3 = await startS3Fixture();
    assets = new DesignSchemeAssetService(database.db, s3.storage);
    schemes = new DesignSchemeService(database.db, assets);
    ownerApp = appFor(OWNER, assets, schemes);
    foreignApp = appFor(FOREIGN, assets, schemes);
    png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#aabbcc' } })
      .png()
      .toBuffer();
  }, 180_000);

  afterAll(async () => {
    await s3?.close();
    await database?.pool.end();
    await container?.stop();
  });
  const stage = () => assets.stage(OWNER, { name: 'reference.png', bytes: new Uint8Array(png) });
  async function registry(id: string) {
    return (
      await database.pool.query('SELECT * FROM generation_reference_uploads WHERE id = $1', [id])
    ).rows[0];
  }

  it('uploads bytes, ignores claimed MIME, returns opaque metadata and promotes once into owned uploaded assets', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(png)], 'reference.jpg', { type: 'text/html' }));
    const response = await ownerApp.request('/design-schemes/assets', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(201);
    const staged = (await response.json()) as StagedDesignSchemeAsset;
    expect(staged).toMatchObject({
      name: 'reference.jpg',
      mimeType: 'image/png',
      width: 3,
      height: 2,
      byteSize: png.length,
    });
    expect(staged).not.toHaveProperty('objectKey');
    const registered = await registry(staged.id);
    expect(registered).toMatchObject({ user_id: OWNER, status: 'available' });
    expect(s3.objects.get(registered.object_key)).toEqual(png);
    const request = input([staged.id], [claim(staged)]);
    const created = await ownerApp.request('/design-schemes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(created.status).toBe(201);
    expect(await registry(staged.id)).toBeUndefined();
    const detail = await schemes.get(OWNER, {
      id: request.document.schemeId,
      revision: { kind: 'current' },
    });
    expect(detail.assets).toEqual([claim(staged)]);
    expect(detail.summary.hasSuccessfulTrial).toBe(false);
    const content = await ownerApp.request(`/design-schemes/assets/${staged.id}/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('image/png');
    expect(content.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await content.arrayBuffer())).toEqual(png);
    expect((await foreignApp.request(`/design-schemes/assets/${staged.id}/content`)).status).toBe(
      404,
    );
    await expect(schemes.create(OWNER, input([staged.id]))).rejects.toMatchObject({ status: 404 });
    await schemes.selectCover(OWNER, {
      schemeId: request.document.schemeId,
      assetId: staged.id,
      expectedVersion: 1,
    });
    await expect(
      schemes.formalize(OWNER, {
        schemeId: request.document.schemeId,
        revisionId: request.document.revisionId,
        coverAssetId: staged.id,
        expectedVersion: 2,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects invalid/multipart remote inputs before any object or registry write', async () => {
    const before = s3.writes.length;
    const count = (
      await database.pool.query('SELECT count(*)::int AS count FROM generation_reference_uploads')
    ).rows[0].count;
    const invalid = new FormData();
    invalid.set('file', new File([Buffer.from('<svg/>')], 'image.png', { type: 'image/png' }));
    expect(
      (await ownerApp.request('/design-schemes/assets', { method: 'POST', body: invalid })).status,
    ).toBe(400);
    const remote = new FormData();
    remote.set('url', 'http://169.254.169.254/latest/meta-data');
    expect(
      (await ownerApp.request('/design-schemes/assets', { method: 'POST', body: remote })).status,
    ).toBe(400);
    const duplicate = new FormData();
    duplicate.append('file', new File([new Uint8Array(png)], 'a.png'));
    duplicate.append('file', new File([new Uint8Array(png)], 'b.png'));
    expect(
      (await ownerApp.request('/design-schemes/assets', { method: 'POST', body: duplicate }))
        .status,
    ).toBe(400);
    expect(s3.writes.length).toBe(before);
    expect(
      (await database.pool.query('SELECT count(*)::int AS count FROM generation_reference_uploads'))
        .rows[0].count,
    ).toBe(count);
  });

  it('enforces the actual multipart body limit even when Content-Length claims a small value', async () => {
    const before = s3.writes.length;
    const oversized = new FormData();
    oversized.set('file', new File([new Uint8Array(22 * 1024 * 1024)], 'too-large.png'));
    const response = await ownerApp.request('/design-schemes/assets', {
      method: 'POST',
      headers: { 'content-length': '1' },
      body: oversized,
    });
    expect(response.status).toBe(413);
    expect(s3.writes.length).toBe(before);
  });

  it('isolates staging metadata/content/discard and creation from another owner', async () => {
    const staged = await stage();
    for (const suffix of ['', '/content'])
      expect(
        (await foreignApp.request(`/design-schemes/assets/${staged.id}${suffix}`)).status,
      ).toBe(404);
    expect(
      (await foreignApp.request(`/design-schemes/assets/${staged.id}`, { method: 'DELETE' }))
        .status,
    ).toBe(404);
    const otherInput = input([staged.id]);
    await expect(schemes.create(FOREIGN, otherInput)).rejects.toMatchObject({ status: 404 });
    expect(await registry(staged.id)).toMatchObject({ status: 'available' });
    expect(
      (
        await database.pool.query('SELECT id FROM design_schemes WHERE id = $1', [
          otherInput.document.schemeId,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('rejects fabricated IDs, claimed hashes/origins and mismatched document lists, rolling back the whole create', async () => {
    const staged = await stage();
    const badClaims = [
      { ...claim(staged), contentHash: 'a'.repeat(64) },
      { ...claim(staged), origin: 'local-run' as const },
    ];
    for (const metadata of badClaims) {
      const request = input([staged.id], [metadata]);
      await expect(schemes.create(OWNER, request)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(
        (
          await database.pool.query('SELECT id FROM design_schemes WHERE id = $1', [
            request.document.schemeId,
          ])
        ).rowCount,
      ).toBe(0);
      expect(await registry(staged.id)).toMatchObject({ status: 'available' });
    }
    const mismatched = input([staged.id]);
    mismatched.document.assetIds = [];
    await expect(schemes.create(OWNER, mismatched)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(schemes.create(OWNER, input([randomUUID()]))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects expired and cleanup-pending staging, leaving durable discard cleanup intent', async () => {
    const expired = await stage();
    await database.pool.query(
      "UPDATE generation_reference_uploads SET expires_at = now() - interval '1 second' WHERE id = $1",
      [expired.id],
    );
    await expect(assets.getStage(OWNER, expired.id)).rejects.toMatchObject({ status: 404 });
    await expect(schemes.create(OWNER, input([expired.id]))).rejects.toMatchObject({ status: 404 });
    const discarded = await stage();
    const key = (await registry(discarded.id)).object_key;
    expect(
      (await ownerApp.request(`/design-schemes/assets/${discarded.id}`, { method: 'DELETE' }))
        .status,
    ).toBe(204);
    expect(await registry(discarded.id)).toMatchObject({ status: 'cleanup_pending' });
    expect(
      (await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key = $1', [key]))
        .rows,
    ).toMatchObject([
      { owner_id: OWNER, object_type: 'generation_reference', reason: 'reference_expired' },
    ]);
    await expect(schemes.create(OWNER, input([discarded.id]))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps an ambiguous S3 PUT discoverable and queues cleanup without exposing storage errors', async () => {
    s3.state.failPutAfterWrite = true;
    try {
      await expect(stage()).rejects.toMatchObject({
        status: 503,
        message: '方案图片存储暂时不可用，请重试',
      });
    } finally {
      s3.state.failPutAfterWrite = false;
    }
    const row = (
      await database.pool.query(
        "SELECT * FROM generation_reference_uploads WHERE status = 'cleanup_pending' AND id NOT IN (SELECT id FROM design_scheme_assets) ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    expect(s3.objects.has(row.object_key)).toBe(true);
    expect(
      (
        await database.pool.query('SELECT * FROM object_cleanup_queue WHERE object_key = $1', [
          row.object_key,
        ])
      ).rows,
    ).toMatchObject([{ reason: 'reference_upload_failed', owner_id: OWNER }]);
  });

  it('serializes concurrent consumers: only one scheme can own a stage', async () => {
    const staged = await stage();
    const requests = [input([staged.id]), input([staged.id])];
    const results = await Promise.allSettled(
      requests.map((request) => schemes.create(OWNER, request)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      (
        await database.pool.query('SELECT id FROM design_schemes WHERE id = ANY($1::varchar[])', [
          requests.map((request) => request.document.schemeId),
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (await database.pool.query('SELECT id FROM design_scheme_assets WHERE id = $1', [staged.id]))
        .rowCount,
    ).toBe(1);
    expect(await registry(staged.id)).toBeUndefined();
  });

  it('serializes discard against promotion so cleanup cannot be queued after consumption', async () => {
    const staged = await stage();
    const key = (await registry(staged.id)).object_key;
    const results = await Promise.allSettled([
      schemes.create(OWNER, input([staged.id])),
      assets.discard(OWNER, staged.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const assetCount =
      (await database.pool.query('SELECT id FROM design_scheme_assets WHERE id = $1', [staged.id]))
        .rowCount ?? 0;
    const cleanupCount =
      (
        await database.pool.query(
          'SELECT object_key FROM object_cleanup_queue WHERE object_key = $1',
          [key],
        )
      ).rowCount ?? 0;
    expect(assetCount + cleanupCount).toBe(1);
    expect(assetCount * cleanupCount).toBe(0);
    expect(s3.objects.has(key)).toBe(true);
  });

  it('rejects a scheme stage submitted as an ordinary generation reference before queue creation', async () => {
    const staged = await stage();
    const unexpected = async (): Promise<never> => {
      throw new Error('Signer should not be used');
    };
    await seedGenerationAuthority(database.db, {
      principalId: OWNER,
      ownerId: '42',
      replaceUnverifiedFixtureIdentity: true,
    });
    const generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        sign: unexpected,
        readObject: unexpected,
        putObject: unexpected,
        removeObjects: unexpected,
      },
      GENERATION_TEST_ISSUERS,
    );
    const idempotencyKey = randomUUID();
    await expect(
      generation.create(
        OWNER,
        {
          prompt: 'Test reference boundary',
          referenceImages: [
            {
              id: staged.id,
              url: `https://example.test/images/${staged.id}`,
              name: staged.name,
              mimeType: staged.mimeType,
              byteSize: staged.byteSize,
            },
          ],
        },
        idempotencyKey,
        generationAuthSession(OWNER),
      ),
    ).rejects.toMatchObject({ code: 'GENERATION_NOT_FOUND' });
    expect(await registry(staged.id)).toMatchObject({ status: 'available' });
    expect(
      (
        await database.pool.query('SELECT id FROM generation_runs WHERE idempotency_key = $1', [
          idempotencyKey,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('does not consume or discard a stage already linked by a generation run', async () => {
    const staged = await stage();
    const runId = randomUUID();
    await database.pool.query(
      'INSERT INTO generation_runs (id, user_id, request) VALUES ($1, $2, $3)',
      [runId, OWNER, '{}'],
    );
    await database.pool.query(
      'INSERT INTO generation_reference_links (run_id, reference_id, user_id) VALUES ($1, $2, $3)',
      [runId, staged.id, OWNER],
    );
    await expect(schemes.create(OWNER, input([staged.id]))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(assets.discard(OWNER, staged.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await registry(staged.id)).toMatchObject({ status: 'available' });
    expect(
      (
        await database.pool.query(
          'SELECT reference_id FROM generation_reference_links WHERE run_id = $1',
          [runId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('validates edited asset ownership and hides content when a scheme is soft-deleted', async () => {
    const staged = await stage();
    const request = input([staged.id]);
    await schemes.create(OWNER, request);
    const update = {
      schemeId: request.document.schemeId,
      baseRevisionId: request.document.revisionId,
      expectedVersion: 1,
      document: {
        ...request.document,
        revisionId: randomUUID(),
        parentRevisionId: request.document.revisionId,
      },
    };
    await schemes.update(OWNER, update);
    await expect(
      schemes.update(OWNER, {
        ...update,
        baseRevisionId: update.document.revisionId,
        expectedVersion: 2,
        document: {
          ...update.document,
          revisionId: randomUUID(),
          parentRevisionId: update.document.revisionId,
          assetIds: [randomUUID()],
        },
      }),
    ).rejects.toMatchObject({ status: 404 });
    await database.pool.query('UPDATE design_schemes SET deleted_at = now() WHERE id = $1', [
      request.document.schemeId,
    ]);
    expect((await ownerApp.request(`/design-schemes/assets/${staged.id}/content`)).status).toBe(
      404,
    );
    expect(
      (await database.pool.query('SELECT id FROM design_scheme_assets WHERE id = $1', [staged.id]))
        .rowCount,
    ).toBe(1);
  });

  it('rechecks actual stored bytes at promotion and hashes persisted content on read', async () => {
    const staged = await stage();
    const key = (await registry(staged.id)).object_key;
    s3.objects.set(key, Buffer.from('<svg/>'));
    await expect(schemes.create(OWNER, input([staged.id]))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(await registry(staged.id)).toMatchObject({ status: 'available' });
    s3.objects.set(key, png);
    await schemes.create(OWNER, input([staged.id]));
    s3.objects.set(
      key,
      await sharp({ create: { width: 3, height: 2, channels: 4, background: '#112233' } })
        .png()
        .toBuffer(),
    );
    await expect(assets.content(OWNER, staged.id)).rejects.toMatchObject({ status: 503 });
  });
});
