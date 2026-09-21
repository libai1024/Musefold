import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { OpenAPIHono } from '@hono/zod-openapi';
import { serve } from '@hono/node-server';
import sharp from 'sharp';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase } from '@musefold/db';
import {
  importDesignSchemeResultSchema,
  designSchemePackageRecoveryPageSchema,
  designSchemePackageRecoverySchema,
  prepareDesignSchemeRunInputSchema,
} from '@musefold/contracts';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../auth/middleware.js';
import { AppError, toErrorBody } from '../../lib/errors.js';
import { DesignSchemePackageService } from '../../modules/design-scheme-packages/service.js';
import { designSchemePackageRoutes } from '../../modules/design-scheme-packages/routes.js';
import { DesignSchemePackageImportService } from '../../modules/design-scheme-packages/import-service.js';
import { DesignSchemeAssetService } from '../../modules/design-scheme-assets/service.js';
import { DesignSchemeService } from '../../modules/design-schemes/service.js';
import { designSchemeRoutes } from '../../modules/design-schemes/routes.js';
import { DesignSchemeRunService } from '../../modules/design-scheme-runs/service.js';
import { GenerationService } from '../../modules/generation/service.js';
import { startS3Fixture } from '../../modules/design-scheme-assets/__tests__/s3-fixture.js';
import {
  importFixture,
  legacyImportFixture,
  FULL_PROMPT,
} from '../../modules/design-scheme-packages/__tests__/import-fixture.js';
import { packageHash } from '../../modules/design-scheme-packages/bytes.js';
import {
  generationAuthSession,
  seedGenerationAuthority,
  GENERATION_TEST_ISSUERS,
} from '../fixtures/generation-authority.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const OWNER = 'package-import-owner';
const OTHER = 'package-import-other';
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describeDb('confirmed cloud package import: real PG, HTTP and S3 SDK', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let s3: Awaited<ReturnType<typeof startS3Fixture>>;
  let staging: DesignSchemePackageService;
  let importer: DesignSchemePackageImportService;
  let schemes: DesignSchemeService;
  let assets: DesignSchemeAssetService;
  let server: ReturnType<typeof serve>;
  let base: string;
  let gate:
    | {
        point: 'read' | 'put';
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
    staging = new DesignSchemePackageService(database.db, s3.storage);
    assets = new DesignSchemeAssetService(database.db, {
      put: (...args) => s3.storage.put(...args),
      read: (key, budget) => s3.storage.read(key, budget ?? 20 * 1024 * 1024),
    });
    importer = new DesignSchemePackageImportService(
      database.db,
      {
        async read(key) {
          const bytes = await s3.storage.read(key);
          if (gate?.point === 'read') {
            gate.reached.resolve();
            await gate.release.promise;
          }
          return bytes;
        },
        async put(key, bytes, mime) {
          // Every actual outgoing PUT must already be discoverable by the shared cleanup worker.
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
      assets,
    );
    schemes = new DesignSchemeService(database.db, assets, undefined, undefined, importer);
    const app = new OpenAPIHono<AuthedEnv>();
    app.use('*', async (c, next) => {
      // Explicit fixture session resolution; import locks actual PG user/identity/session/authorization.
      const user = c.req.header('x-test-owner');
      if (![OWNER, OTHER].includes(user ?? '')) return c.json({ error: 'unauthorized' }, 401);
      c.set('userId', user ?? '');
      c.set('sessionId', generationAuthSession(user ?? ''));
      await next();
    });
    app.onError((error, c) => {
      if (error instanceof AppError)
        return c.json(toErrorBody(error, 'import-test'), error.status as 400);
      throw error;
    });
    app.route('/', designSchemePackageRoutes(staging));
    app.route('/', designSchemeRoutes(schemes));
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    base = `http://127.0.0.1:${address.port}`;
  }, 180_000);
  beforeEach(async () => {
    gate = undefined;
    await database.pool.query('TRUNCATE "user" CASCADE');
    await database.pool.query('TRUNCATE object_cleanup_queue');
    for (const user of [OWNER, OTHER]) {
      await database.pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [
        user,
        `${user}@example.test`,
      ]);
      await seedGenerationAuthority(database.db, { principalId: user, ownerId: user });
    }
    s3.objects.clear();
    s3.writes.length = 0;
    s3.state.failPutAfterWrite = false;
  });
  afterAll(async () => {
    gate?.release.resolve();
    if (server) {
      if ('closeAllConnections' in server) server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await s3?.close();
    await database?.pool.end();
    await container?.stop();
  });
  async function recovery(id: string, owner = OWNER) {
    return fetch(`${base}/design-schemes/packages/${id}/recovery`, {
      headers: { 'x-test-owner': owner },
    });
  }
  async function recovered(id: string) {
    const response = await recovery(id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return designSchemePackageRecoverySchema.parse(await response.json());
  }

  it('discovers a lost begin response from a fresh service via read-only owner-scoped history', async () => {
    const original = await staging.begin(OWNER, generationAuthSession(OWNER), {
      requestId: randomUUID(),
      packageHash: 'a'.repeat(64),
      sizeBytes: 3,
      formatVersion: 2,
    });
    const fresh = new DesignSchemePackageService(database.db, s3.storage);
    const page = await fresh.listRecovery(OWNER, generationAuthSession(OWNER), { limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      stage: original,
      execution: 'not_started',
      canContinue: true,
      receipt: null,
    });
    const response = await fetch(`${base}/design-schemes/packages`, {
      headers: { 'x-test-owner': OWNER },
    });
    expect(response.status).toBe(200);
    expect(designSchemePackageRecoveryPageSchema.parse(await response.json())).toEqual(page);
    expect(await recovered(original.stagedPackageId)).toEqual(page.items[0]);
    expect((await recovery(original.stagedPackageId, OTHER)).status).toBe(404);
    expect((await fetch(`${base}/design-schemes/packages`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/design-schemes/packages?cursor=${original.stagedPackageId}`, {
          headers: { 'x-test-owner': OTHER },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/design-schemes/packages?limit=51`, {
          headers: { 'x-test-owner': OWNER },
        })
      ).status,
    ).toBe(400);
    expect(
      (await database.pool.query('SELECT * FROM design_scheme_package_imports')).rows,
    ).toHaveLength(0);
    expect(await count()).toBe(0);
    expect(s3.writes).toHaveLength(0);
    const serialized = JSON.stringify(page);
    for (const privateField of [
      'authorityHash',
      'objectKey',
      'requestHash',
      'provenance',
      'attemptId',
      'seed',
    ])
      expect(serialized).not.toContain(privateField);
  });

  it('paginates equal microsecond timestamps without skipping history or exposing another owner', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const stage = await staging.begin(OWNER, generationAuthSession(OWNER), {
        requestId: randomUUID(),
        packageHash: 'a'.repeat(64),
        sizeBytes: 3,
        formatVersion: 2,
      });
      ids.push(stage.stagedPackageId);
      await staging.cancel(OWNER, generationAuthSession(OWNER), stage.stagedPackageId);
    }
    await database.pool.query(
      "UPDATE design_scheme_package_stages SET created_at='2026-09-01 01:01:01.123456+00'",
    );
    const first = await staging.listRecovery(OWNER, generationAuthSession(OWNER), { limit: 2 });
    expect(first.nextCursor).toBeTruthy();
    const second = await staging.listRecovery(OWNER, generationAuthSession(OWNER), {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const third = await staging.listRecovery(OWNER, generationAuthSession(OWNER), {
      limit: 2,
      cursor: second.nextCursor ?? undefined,
    });
    expect(
      [...first.items, ...second.items, ...third.items].map((item) => item.stage.stagedPackageId),
    ).toEqual(ids.sort().reverse());
    expect(third.nextCursor).toBeNull();
    expect(
      (await staging.listRecovery(OTHER, generationAuthSession(OTHER), { limit: 20 })).items,
    ).toEqual([]);
  });

  it('observes the real in-flight import separately from confirmed content without a second claim', async () => {
    const input = await confirmed();
    expect(await recovered(input.stagedPackageId)).toMatchObject({
      execution: 'not_started',
      canContinue: true,
    });
    gate = { point: 'put', reached: deferred(), release: deferred() };
    const running = post(input);
    await gate.reached.promise;
    try {
      const item = await recovered(input.stagedPackageId);
      expect(item).toMatchObject({
        stage: { status: 'confirmed' },
        execution: 'running',
        canContinue: false,
        blockedReason: 'import_in_progress',
        receipt: null,
      });
      expect((await post(input)).status).toBe(409);
      expect((await row(input.stagedPackageId)).epoch).toBe(1);
      expect(await count()).toBe(0);
    } finally {
      gate.release.resolve();
    }
    expect((await running).status).toBe(200);
    expect(await recovered(input.stagedPackageId)).toMatchObject({
      execution: 'completed',
      canContinue: false,
      blockedReason: null,
    });
    expect(await count()).toBe(1);
  });

  it('preserves completed receipts beyond upload expiry and deletion without storage IO or resurrection', async () => {
    const input = await confirmed();
    const receipt = await imported(input);
    const writes = s3.writes.length;
    await database.pool.query(
      "UPDATE design_scheme_package_stages SET expires_at=now()-interval '1 day'",
    );
    await database.pool.query('UPDATE design_schemes SET deleted_at=now() WHERE id=$1', [
      receipt.scheme.id,
    ]);
    await database.pool.query(
      'UPDATE account_session_authorizations SET revision=revision+1 WHERE user_id=$1',
      [OWNER],
    );
    const item = await recovered(input.stagedPackageId);
    expect(item).toMatchObject({
      execution: 'completed',
      receipt,
      canContinue: false,
      blockedReason: null,
    });
    const history = await staging.listRecovery(OWNER, generationAuthSession(OWNER), { limit: 20 });
    expect(history.items[0]).toEqual(item);
    expect(await count()).toBe(1);
    expect(
      (
        await database.pool.query('SELECT deleted_at FROM design_schemes WHERE id=$1', [
          receipt.scheme.id,
        ])
      ).rows[0].deleted_at,
    ).toBeTruthy();
    expect(s3.writes).toHaveLength(writes);
  });

  it('reports revoked continuation and denies recovery-only or expired sessions on every read', async () => {
    const input = await confirmed();
    await database.pool.query(
      'UPDATE account_session_authorizations SET revision=revision+1 WHERE user_id=$1',
      [OWNER],
    );
    expect(await recovered(input.stagedPackageId)).toMatchObject({
      canContinue: false,
      blockedReason: 'session_changed',
      receipt: null,
    });
    expect((await post(input)).status).toBe(409);
    await database.pool.query(
      "UPDATE account_session_authorizations SET mode='recovery_only' WHERE user_id=$1",
      [OWNER],
    );
    expect((await recovery(input.stagedPackageId)).status).toBe(401);
    await expect(
      staging.listRecovery(OWNER, generationAuthSession(OWNER), { limit: 20 }),
    ).rejects.toMatchObject({ status: 401 });
    await database.pool.query(
      "UPDATE account_session_authorizations SET mode='normal' WHERE user_id=$1",
      [OWNER],
    );
    await database.pool.query(
      "UPDATE session SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [OWNER],
    );
    expect((await recovery(input.stagedPackageId)).status).toBe(401);
  });

  it('exposes a real failed import as retryable but refuses attempts past the existing admission policy', async () => {
    const input = await confirmed();
    s3.state.failPutAfterWrite = true;
    expect((await post(input)).status).toBe(503);
    s3.state.failPutAfterWrite = false;
    expect(await recovered(input.stagedPackageId)).toMatchObject({
      execution: 'retryable',
      canContinue: true,
    });
    await database.pool.query(
      'UPDATE design_scheme_package_imports SET epoch=16 WHERE stage_id=$1',
      [input.stagedPackageId],
    );
    expect(await recovered(input.stagedPackageId)).toMatchObject({
      execution: 'retryable',
      canContinue: false,
      blockedReason: 'retry_limit',
    });
    expect((await post(input)).status).toBe(409);
    await database.pool.query(
      "UPDATE design_scheme_package_stages SET expires_at=now()-interval '1 second' WHERE id=$1",
      [input.stagedPackageId],
    );
    expect(await recovered(input.stagedPackageId)).toMatchObject({
      stage: { status: 'expired' },
      canContinue: false,
      blockedReason: 'stage_unavailable',
    });
    expect(await count()).toBe(0);
  });

  async function confirmed(version: 1 | 2 = 2, imageSlot = false, packageBytes?: Buffer) {
    const fixture = version === 1 ? await legacyImportFixture() : await importFixture();
    if (imageSlot) {
      const document = 'document' in fixture ? fixture.document : fixture.manifest.document;
      document.inputs.push({
        id: 'reference',
        label: '参考图',
        kind: 'image',
        required: false,
        imageRole: 'style-reference',
      });
    }
    const bytes = packageBytes ?? (await fixture.encode());
    const stage = await staging.begin(OWNER, generationAuthSession(OWNER), {
      requestId: randomUUID(),
      formatVersion: version,
      packageHash: packageHash(bytes),
      sizeBytes: bytes.length,
    });
    const ready = await staging.upload(
      OWNER,
      generationAuthSession(OWNER),
      stage.stagedPackageId,
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
    );
    if (!ready.confirmationHash) throw new Error('No confirmation hash');
    await staging.decide(OWNER, generationAuthSession(OWNER), stage.stagedPackageId, {
      packageHash: ready.packageHash,
      formatVersion: version,
      parserVersion: ready.parserVersion,
      confirmationHash: ready.confirmationHash,
      decision: 'confirm',
    });
    return {
      stagedPackageId: stage.stagedPackageId,
      packageHash: ready.packageHash,
      formatVersion: version,
    };
  }
  async function post(input: unknown, owner = OWNER) {
    return fetch(`${base}/design-schemes/import-package`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-owner': owner },
      body: JSON.stringify(input),
    });
  }
  async function imported(input: Awaited<ReturnType<typeof confirmed>>) {
    const response = await post(input);
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return importDesignSchemeResultSchema.parse(body);
  }
  async function row(id: string) {
    return (
      await database.pool.query('SELECT * FROM design_scheme_package_imports WHERE stage_id=$1', [
        id,
      ])
    ).rows[0];
  }
  const count = async () =>
    Number((await database.pool.query('SELECT count(*) FROM design_schemes')).rows[0].count);

  it.each([1, 2] as const)(
    'imports v%s through actual HTTP into one complete owned draft with full source bytes and readable assets',
    async (version) => {
      const input = await confirmed(version);
      const result = await imported(input);
      expect(await count()).toBe(1);
      const detail = await schemes.get(OWNER, {
        id: result.scheme.id,
        revision: { kind: 'current' },
      });
      expect(detail.summary).toEqual(result.scheme);
      expect(detail.document).toMatchObject({ createdBy: 'import', parentRevisionId: null });
      expect(detail.summary).toMatchObject({
        status: 'draft',
        hasSuccessfulTrial: false,
        coverAssetId: null,
      });
      const files = (
        await database.pool.query(
          "SELECT object_key,relative_path FROM design_scheme_source_files WHERE kind='text'",
        )
      ).rows;
      expect(Buffer.from(await s3.storage.read(files[0].object_key)).toString()).toBe(FULL_PROMPT);
      for (const asset of detail.assets) {
        expect(packageHash(Buffer.from((await assets.content(OWNER, asset.id)).bytes))).toBe(
          asset.contentHash,
        );
        await expect(assets.content(OTHER, asset.id)).rejects.toMatchObject({ status: 404 });
      }
      if (version === 2)
        expect(
          detail.sourceSnapshots.find((snapshot) => snapshot.kind === 'history')?.historyItems?.[0]
            .prompt,
        ).toBe(FULL_PROMPT);
      else expect(detail.sourceSnapshots[0]).not.toHaveProperty('historyItems');
      expect((await staging.get(OWNER, input.stagedPackageId)).status).toBe('imported');
      expect((await row(input.stagedPackageId)).result).toEqual(result);
      await expect(
        staging.cancel(OWNER, generationAuthSession(OWNER), input.stagedPackageId),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it('replays the fixed receipt without more PUTs or recreating an edited/deleted scheme', async () => {
    const input = await confirmed();
    const first = await imported(input);
    const writes = s3.writes.length;
    await database.pool.query('UPDATE design_schemes SET name=$1,deleted_at=now() WHERE id=$2', [
      'Later edit',
      first.scheme.id,
    ]);
    expect(
      await imported({ ...input, packageHash: `sha256:${input.packageHash.toUpperCase()}` }),
    ).toEqual(first);
    expect(s3.writes).toHaveLength(writes);
    expect(await count()).toBe(1);
    const wrong = await post({ ...input, packageHash: 'f'.repeat(64) });
    expect(wrong.status).toBe(409);
  });

  it('requires current normal owner authority on replay but does not require the expired original session', async () => {
    const input = await confirmed();
    const first = await imported(input);
    await database.pool.query(
      "INSERT INTO session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
      ['new-session', OWNER, randomUUID()],
    );
    await database.pool.query(
      "INSERT INTO account_session_authorizations(session_id,user_id,mode,revision) VALUES ($1,$2,'normal',1)",
      ['new-session', OWNER],
    );
    await database.pool.query(
      "UPDATE session SET expires_at=now()-interval '1 second' WHERE id=$1",
      [generationAuthSession(OWNER)],
    );
    expect(await importer.execute(OWNER, 'new-session', input)).toEqual(first);
    await database.pool.query(
      "UPDATE account_session_authorizations SET mode='recovery_only' WHERE session_id='new-session'",
    );
    await expect(importer.execute(OWNER, 'new-session', input)).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each([
    'owner',
    'hash',
    'format',
    'unconfirmed',
    'expired',
    'cancelled',
    'confirmation',
    'parser',
    'authorization',
  ] as const)('rejects %s mismatch without a partial draft', async (kind) => {
    const input = await confirmed();
    if (kind === 'hash') input.packageHash = 'f'.repeat(64);
    if (kind === 'format') input.formatVersion = 1;
    if (kind === 'unconfirmed')
      await database.pool.query("UPDATE design_scheme_package_stages SET status='ready'");
    if (kind === 'expired')
      await database.pool.query(
        "UPDATE design_scheme_package_stages SET expires_at=now()-interval '1 second'",
      );
    if (kind === 'cancelled')
      await staging.cancel(OWNER, generationAuthSession(OWNER), input.stagedPackageId);
    if (kind === 'confirmation')
      await database.pool.query(
        "UPDATE design_scheme_package_stages SET confirmation_hash=repeat('f',64)",
      );
    if (kind === 'parser')
      await database.pool.query('UPDATE design_scheme_package_stages SET parser_version=2');
    if (kind === 'authorization')
      await database.pool.query('UPDATE account_session_authorizations SET revision=revision+1');
    expect((await post(input, kind === 'owner' ? OTHER : OWNER)).status).toBe(
      kind === 'owner' ? 404 : 409,
    );
    expect(await count()).toBe(0);
    expect(s3.writes).toHaveLength(1);
  });

  it('rejects a concurrently claimed import; later cancellation defeats a completed but late PUT', async () => {
    const input = await confirmed();
    gate = { point: 'put', reached: deferred(), release: deferred() };
    const pending = post(input);
    await gate.reached.promise;
    expect((await post(input)).status).toBe(409);
    await staging.cancel(OWNER, generationAuthSession(OWNER), input.stagedPackageId);
    gate.release.resolve();
    gate = undefined;
    expect((await pending).status).toBe(409);
    expect(await count()).toBe(0);
    expect(
      (
        await database.pool.query(
          "SELECT * FROM object_cleanup_queue WHERE object_key LIKE 'scheme-imports/%'",
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('fences an old epoch and gives its successor independent objects but identical scheme identities', async () => {
    const input = await confirmed();
    gate = { point: 'put', reached: deferred(), release: deferred() };
    const stale = post(input);
    await gate.reached.promise;
    const held = gate;
    gate = undefined;
    const first = await row(input.stagedPackageId);
    await database.pool.query(
      "UPDATE design_scheme_package_imports SET lease_until=now()-interval '1 second'",
    );
    const result = await imported(input);
    const second = await row(input.stagedPackageId);
    expect(second.seed).toBe(first.seed);
    expect(second.epoch).toBe(first.epoch + 1);
    expect(second.attempt_id).not.toBe(first.attempt_id);
    held.release.resolve();
    expect((await stale).status).toBe(409);
    expect(await count()).toBe(1);
    expect((await row(input.stagedPackageId)).result).toEqual(result);
    const objects = (await database.pool.query('SELECT object_key FROM design_scheme_assets')).rows;
    expect(objects.every((item) => item.object_key.includes(second.attempt_id))).toBe(true);
  });

  it.each(['authorization', 'expiry', 'account-delete'] as const)(
    'rechecks %s after actual PUT and leaves registered cleanup instead of a half draft',
    async (change) => {
      const input = await confirmed();
      gate = { point: 'put', reached: deferred(), release: deferred() };
      const pending = post(input);
      await gate.reached.promise;
      if (change === 'authorization')
        await database.pool.query('UPDATE account_session_authorizations SET revision=revision+1');
      if (change === 'expiry')
        await database.pool.query(
          "UPDATE design_scheme_package_stages SET expires_at=now()-interval '1 second'",
        );
      if (change === 'account-delete')
        await database.pool.query('DELETE FROM "user" WHERE id=$1', [OWNER]);
      gate.release.resolve();
      gate = undefined;
      expect((await pending).status).toBe(change === 'account-delete' ? 401 : 409);
      expect(await count()).toBe(0);
      expect(
        (
          await database.pool.query(
            "SELECT * FROM object_cleanup_queue WHERE object_key LIKE 'scheme-imports/%'",
          )
        ).rows,
      ).toHaveLength(1);
    },
  );

  it('can explicitly retry after an ambiguous S3 write using fresh object paths without duplicating the draft', async () => {
    const input = await confirmed();
    s3.state.failPutAfterWrite = true;
    expect((await post(input)).status).toBe(503);
    const first = await row(input.stagedPackageId);
    expect(first.status).toBe('retryable');
    expect(await count()).toBe(0);
    s3.state.failPutAfterWrite = false;
    await imported(input);
    const second = await row(input.stagedPackageId);
    expect(second.seed).toBe(first.seed);
    expect(second.attempt_id).not.toBe(first.attempt_id);
    expect(s3.writes.some((write) => write.path.includes(first.attempt_id))).toBe(true);
    expect(await count()).toBe(1);
  });

  it('retains full imported source and asset facts across an ordinary immutable revision edit', async () => {
    const input = await confirmed();
    const first = await imported(input);
    const detail = await schemes.get(OWNER, { id: first.scheme.id, revision: { kind: 'current' } });
    const document = {
      ...detail.document,
      revisionId: randomUUID(),
      parentRevisionId: first.revisionId,
      createdBy: 'user' as const,
      name: 'Edited imported scheme',
    };
    const update = await schemes.update(OWNER, {
      schemeId: first.scheme.id,
      baseRevisionId: first.revisionId,
      expectedVersion: first.scheme.version,
      document,
    });
    const edited = await schemes.get(OWNER, { id: first.scheme.id, revision: { kind: 'current' } });
    expect(edited.document.assetIds).toEqual(detail.document.assetIds);
    expect(edited.sourceSnapshots).toEqual(detail.sourceSnapshots);
    expect(edited.document.repositoryImages).toEqual(detail.document.repositoryImages);
    expect(edited.document.revisionId).toBe(update.document.revisionId);
    expect(await imported(input)).toEqual(first); // immutable original import receipt.
  });

  it('rolls back sources/assets/draft and receipt together, then retries with the same fixed identity', async () => {
    const input = await confirmed();
    await database.pool.query(
      "CREATE FUNCTION fail_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$",
    );
    await database.pool.query(
      'CREATE TRIGGER fail_import BEFORE INSERT ON design_scheme_assets FOR EACH ROW EXECUTE FUNCTION fail_import()',
    );
    try {
      expect((await post(input)).status).toBe(503);
    } finally {
      await database.pool.query('DROP TRIGGER fail_import ON design_scheme_assets');
      await database.pool.query('DROP FUNCTION fail_import()');
    }
    const failed = await row(input.stagedPackageId);
    expect(failed.status).toBe('retryable');
    expect(failed.result).toBeNull();
    expect(await count()).toBe(0);
    expect(
      (await database.pool.query('SELECT * FROM design_scheme_source_files')).rows,
    ).toHaveLength(0);
    const result = await imported(input);
    expect((await row(input.stagedPackageId)).seed).toBe(failed.seed);
    expect(result.status).toBe('draft');
    expect(await count()).toBe(1);
  });

  it('uses actual imported history/repository assets in the existing fixed trial preparation without model execution', async () => {
    const input = await confirmed(2, true);
    const result = await imported(input);
    const detail = await schemes.get(OWNER, {
      id: result.scheme.id,
      revision: { kind: 'current' },
    });
    const generation = new GenerationService(
      database.db,
      {
        urlTtlSeconds: 60,
        async sign() {
          throw new Error('No signing');
        },
        async readObject() {
          throw new Error('No read');
        },
        async putObject() {
          throw new Error('No write');
        },
        async removeObjects() {
          throw new Error('No remove');
        },
      },
      GENERATION_TEST_ISSUERS,
    );
    const prepared = await new DesignSchemeRunService(database.db, assets, generation).prepare(
      OWNER,
      prepareDesignSchemeRunInputSchema.parse({
        executionId: randomUUID(),
        schemeId: result.scheme.id,
        revisionId: result.revisionId,
        mode: 'trial',
        brief: '',
        inputValues: {},
        executionSettings: {
          providerId: 'cloud-default',
          size: '1024x1024',
          quality: 'high',
          outputCount: 1,
          referenceAssetIds: [detail.document.assetIds[1]],
          promptReferenceSelections: [],
        },
      }),
      generationAuthSession(OWNER),
    );
    expect(prepared.schemeId).toBe(result.scheme.id);
    expect((await database.pool.query('SELECT count(*) FROM generation_runs')).rows[0].count).toBe(
      '0',
    );
  });

  it('reads a valid imported image above the ordinary 20MiB upload budget through the actual S3 SDK and content decoder', async () => {
    const fixture = await importFixture();
    const bytes = await sharp({
      create: { width: 4096, height: 1800, channels: 3, background: '#cc3366' },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(bytes.length).toBeGreaterThan(20 * 1024 * 1024);
    fixture.content.set('assets/cover-asset.png', bytes);
    Object.assign(fixture.manifest.assets[2], {
      width: 4096,
      height: 1800,
      byteSize: bytes.length,
      contentHash: packageHash(bytes),
    });
    const input = await confirmed(2, false, await fixture.encode());
    const result = await imported(input);
    const detail = await schemes.get(OWNER, {
      id: result.scheme.id,
      revision: { kind: 'current' },
    });
    const asset = detail.assets.find((item) => item.byteSize === bytes.length);
    if (!asset) throw new Error('Missing imported large asset');
    expect(Buffer.from((await assets.content(OWNER, asset.id)).bytes).equals(bytes)).toBe(true);
  }, 30_000);

  it.each(['pixel-metadata', 'stored-bytes'] as const)(
    'rejects %s corruption before publishing a draft',
    async (mode) => {
      const fixture = await importFixture();
      if (mode === 'pixel-metadata') fixture.manifest.assets[2].width = 999;
      const input = await confirmed(2, false, await fixture.encode());
      if (mode === 'stored-bytes') {
        const stored = (
          await database.pool.query('SELECT object_key FROM design_scheme_package_stages')
        ).rows[0];
        s3.objects.set(stored.object_key, Buffer.from('tampered'));
      }
      expect((await post(input)).status).toBe(400);
      expect(await count()).toBe(0);
      expect(s3.writes).toHaveLength(1);
    },
  );

  it.each(['hold-read', 'hold-put', 'hold-result'])(
    'recovers from a real SIGKILL at %s in a new Node PID',
    async (mode) => {
      const input = await confirmed();
      const helper = fileURLToPath(
        new URL('../fixtures/package-import-process.ts', import.meta.url),
      );
      const env = {
        ...process.env,
        DATABASE_URL: container.getConnectionUri(),
        NODE_ENV: 'test',
        BETTER_AUTH_SECRET: 'synthetic-auth-secret',
        CREDENTIAL_ENCRYPTION_KEY: 'synthetic-encryption-key',
        NEW_API_BASE_URL: GENERATION_TEST_ISSUERS.upstreamIssuer,
        S3_ENDPOINT: s3.endpoint,
        S3_REGION: 'us-east-1',
        S3_BUCKET: 'test-scheme-assets',
        S3_ACCESS_KEY_ID: 'synthetic-key',
        S3_SECRET_ACCESS_KEY: 'synthetic-secret',
      };
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          helper,
          mode,
          OWNER,
          generationAuthSession(OWNER),
          JSON.stringify(input),
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let output = '';
      let errors = '';
      child.stderr.on('data', (chunk) => {
        errors += String(chunk);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`Import process did not pause: ${errors}`)),
            10_000,
          );
          child.stdout.on('data', (chunk) => {
            output += String(chunk);
            if (output.includes('IMPORT_POINT=')) {
              clearTimeout(timeout);
              resolve();
            }
          });
          child.once('exit', (code) => {
            clearTimeout(timeout);
            reject(new Error(`Import exited early ${code}: ${errors}`));
          });
        });
        const firstPid = child.pid;
        expect(output).toContain(`IMPORT_PID=${firstPid}`);
        const original = await row(input.stagedPackageId);
        const writes = s3.writes.length;
        const exit = new Promise<NodeJS.Signals | null>((resolve) =>
          child.once('exit', (_code, signal) => resolve(signal)),
        );
        child.kill('SIGKILL');
        expect(await exit).toBe('SIGKILL');
        if (mode !== 'hold-result') {
          expect(original.status).toBe('running');
          expect(await count()).toBe(0);
          expect((await post(input)).status).toBe(409);
          await database.pool.query(
            "UPDATE design_scheme_package_imports SET lease_until=now()-interval '1 second'",
          );
        } else {
          expect(original.status).toBe('completed');
          expect(await count()).toBe(1);
        }
        const resumed = await promisify(execFile)(
          process.execPath,
          [
            '--import',
            'tsx',
            helper,
            'resume',
            OWNER,
            generationAuthSession(OWNER),
            JSON.stringify(input),
          ],
          { env, timeout: 15_000, maxBuffer: 1024 * 1024 },
        );
        const secondPid = Number(/IMPORT_PID=(\d+)/.exec(resumed.stdout)?.[1]);
        expect(secondPid).toBeGreaterThan(0);
        expect(secondPid).not.toBe(firstPid);
        const match = /IMPORT_RESULT=(.+)/.exec(resumed.stdout);
        if (!match) throw new Error(resumed.stdout);
        const result = importDesignSchemeResultSchema.parse(JSON.parse(match[1]));
        const current = await row(input.stagedPackageId);
        expect(current.seed).toBe(original.seed);
        expect(current.result).toEqual(result);
        expect(await count()).toBe(1);
        if (mode === 'hold-result') expect(s3.writes).toHaveLength(writes);
        else expect(current.attempt_id).not.toBe(original.attempt_id);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    },
    30_000,
  );
});
