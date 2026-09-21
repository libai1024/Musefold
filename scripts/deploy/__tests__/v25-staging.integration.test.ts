import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import {
  generationJobSchema,
  promptDocumentSchema,
  promptPageSchema,
  syncPullResultSchema,
  syncPushResultSchema,
} from '@musefold/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedOnboardingCompleted } from '../../../tests/v25/onboarding-helpers';
import { createPrompt } from '../../../tests/v25/prompt-helpers';
import { startV25Staging } from './fixtures/v25-staging.js';
import { restoreStagingIntoFreshResources } from './fixtures/v25-recovery.js';

const describeStaging = process.env.RUN_V25_STAGING_TESTS === 'true' ? describe : describe.skip;

describeStaging(
  'isolated generated Compose with actual production images and restricted roles',
  () => {
    let staging: Awaited<ReturnType<typeof startV25Staging>>;
    let browser: Browser;
    let alice: BrowserContext;
    let bob: BrowserContext;
    const prompts: string[] = [];
    let retainedJobId: string;
    beforeAll(async () => {
      staging = await startV25Staging();
      browser = await chromium.launch({ headless: true });
    }, 180000);
    afterAll(async () => {
      try {
        await browser?.close();
      } finally {
        await staging?.close();
      }
    }, 60000);

    async function call(
      context: BrowserContext,
      path: string,
      method = 'GET',
      data?: unknown,
      headers?: Record<string, string>,
    ) {
      return context.request.fetch(`${staging.baseUrl}/api/${path}`, { method, data, headers });
    }
    async function waitJob(context: BrowserContext, id: string, status: string) {
      await expect
        .poll(
          async () =>
            generationJobSchema.parse(await (await call(context, `v1/generations/${id}`)).json())
              .status,
          { timeout: 30000 },
        )
        .toBe(status);
      return generationJobSchema.parse(await (await call(context, `v1/generations/${id}`)).json());
    }

    it('both restricted workers acknowledge real queue readiness jobs', async () => {
      const runtime = staging.databaseUrl('musefold_v25_api');
      await expect(
        staging.query('CREATE TABLE forbidden_runtime_ddl (id int)', undefined, runtime),
      ).rejects.toMatchObject({ code: '42501' });
      const ids: string[] = [];
      for (const task of ['generation/reconcile', 'design-scheme-agent/reconcile']) {
        const queued = await staging.query(
          'SELECT (graphile_worker.add_job($1, $2::json, max_attempts := 1)).id',
          [task, '{}'],
          runtime,
        );
        ids.push(String(queued.rows[0].id));
      }
      await expect
        .poll(
          async () =>
            (
              await staging.query(
                'SELECT id FROM graphile_worker.jobs WHERE id=ANY($1::bigint[])',
                [ids],
              )
            ).rowCount,
          { timeout: 30000 },
        )
        .toBe(0);
      await staging.assertRuntimeImages();
    }, 45000);

    it.each([
      { width: 1280, height: 800, username: 'staging-alice' },
      { width: 390, height: 844, username: 'staging-bob' },
    ])(
      'same-origin $width px production Web logs in, persists a prompt and reloads authenticated',
      async ({ width, height, username }) => {
        const context = await browser.newContext({
          baseURL: staging.baseUrl,
          viewport: { width, height },
        });
        if (username === 'staging-alice') alice = context;
        else bob = context;
        const page = await context.newPage();
        await seedOnboardingCompleted(page);
        await page.goto('/settings');
        await page.getByTestId('settings-nav-account').click();
        await page.getByTestId('account-username').fill(username);
        await page.getByTestId('account-password').fill('fixture-password');
        await page.getByTestId('account-auth-submit').click();
        await browserExpect(page.getByTestId('account-signed-in')).toContainText(username, {
          timeout: 20000,
        });
        await page.goto('/prompts');
        await browserExpect(page.getByTestId('prompt-library')).toBeVisible();
        const title = `production-container-${width}`;
        await createPrompt(
          page,
          title,
          'Created through the actual standalone production Web and API image.',
        );
        await page.reload();
        await browserExpect(page.getByText(title, { exact: true })).toBeVisible();
        const list = await call(context, 'v1/prompts');
        expect(list.status()).toBe(200);
        const prompt = promptPageSchema
          .parse(await list.json())
          .items.find((item) => item.title === title);
        expect(prompt).toBeDefined();
        prompts.push(prompt?.id ?? '');
        const evidence = process.env.V25_STAGING_EVIDENCE_DIR;
        if (evidence) {
          await mkdir(evidence, { recursive: true });
          await page.screenshot({ path: join(evidence, `prompt-${width}.png`) });
        }
        await page.close();
      },
      45000,
    );

    it('enforces owner isolation, update conflicts, push/pull and deletion through the same origin', async () => {
      const id = prompts[0];
      expect((await call(bob, `v1/prompts/${id}`)).status()).toBe(404);
      const update = await call(alice, `v1/prompts/${id}`, 'PATCH', {
        title: 'staging-updated',
        expectedVersion: 1,
      });
      expect(update.status()).toBe(200);
      expect(promptDocumentSchema.parse(await update.json()).version).toBe(2);
      expect(
        (
          await call(alice, `v1/prompts/${id}`, 'PATCH', {
            title: 'stale-update',
            expectedVersion: 1,
          })
        ).status(),
      ).toBe(409);
      const deviceId = randomUUID();
      expect(
        (
          await call(alice, 'v1/sync/devices', 'POST', {
            deviceId,
            name: 'staging-device',
            platform: 'macos',
            clientVersion: '2.5.0',
          })
        ).status(),
      ).toBe(201);
      const mutation = {
        mutationId: randomUUID(),
        entityType: 'prompt',
        entityId: id,
        operation: 'update',
        baseVersion: 2,
        payload: { title: 'staging-synced' },
      };
      const pushed = await call(alice, 'v1/sync/push', 'POST', { deviceId, mutations: [mutation] });
      expect(pushed.status()).toBe(200);
      expect(syncPushResultSchema.parse(await pushed.json()).results[0].status).toBe('applied');
      const replayed = await call(alice, 'v1/sync/push', 'POST', {
        deviceId,
        mutations: [mutation],
      });
      expect(syncPushResultSchema.parse(await replayed.json()).results[0].status).toBe('duplicate');
      const pulled = await call(alice, `v1/sync/pull?cursor=0&deviceId=${deviceId}`);
      expect(pulled.status()).toBe(200);
      expect(
        syncPullResultSchema
          .parse(await pulled.json())
          .changes.some((change) => change.entityId === id && change.version === 3),
      ).toBe(true);
      expect((await call(alice, `v1/prompts/${id}`, 'DELETE')).status()).toBe(200);
      expect(
        promptPageSchema
          .parse(await (await call(alice, 'v1/prompts')).json())
          .items.some((item) => item.id === id),
      ).toBe(false);
    });

    it('actually generates and reads image bytes, records failure, cancels queued work and cleans objects', async () => {
      const key = randomUUID();
      const input = { prompt: 'controlled staging image, no paid provider', count: 1 };
      const accepted = await call(alice, 'v1/generations', 'POST', input, {
        'idempotency-key': key,
      });
      expect(accepted.status()).toBe(201);
      const job = generationJobSchema.parse(await accepted.json());
      const result = await waitJob(alice, job.id, 'succeeded');
      expect(result.assets).toHaveLength(1);
      expect(staging.image.calls).toHaveLength(1);
      const stored = await staging.storage.client.send(
        new ListObjectsV2Command({ Bucket: staging.storage.bucket }),
      );
      expect(stored.IsTruncated).toBe(false);
      expect(stored.Contents?.length).toBeGreaterThan(0);
      const content = await call(alice, `v1/assets/${result.assets[0].id}/content`);
      expect(content.status()).toBe(200);
      expect(
        createHash('sha256')
          .update(await content.body())
          .digest('hex'),
      ).toBe(staging.image.output.hash);
      expect((await call(bob, `v1/assets/${result.assets[0].id}/content`)).status()).toBe(404);
      const replay = await call(alice, 'v1/generations', 'POST', input, { 'idempotency-key': key });
      expect(generationJobSchema.parse(await replay.json()).id).toBe(job.id);
      expect(staging.image.calls).toHaveLength(1);

      staging.image.state.mode = 'reject';
      const failed = generationJobSchema.parse(
        await (
          await call(
            alice,
            'v1/generations',
            'POST',
            { prompt: 'controlled rejection' },
            { 'idempotency-key': randomUUID() },
          )
        ).json(),
      );
      await waitJob(alice, failed.id, 'failed');
      expect(staging.image.calls).toHaveLength(2);
      staging.image.state.mode = 'normal';
      await staging.compose('stop', '--timeout', '10', 'worker');
      const queued = generationJobSchema.parse(
        await (
          await call(
            alice,
            'v1/generations',
            'POST',
            { prompt: 'cancel before consumption' },
            { 'idempotency-key': randomUUID() },
          )
        ).json(),
      );
      expect(queued.status).toBe('queued');
      expect((await call(alice, `v1/generations/${queued.id}/cancel`, 'POST')).status()).toBe(200);
      await staging.compose('start', 'worker');
      await waitJob(alice, queued.id, 'cancelled');
      expect(staging.image.calls).toHaveLength(2);
      expect((await call(alice, `v1/generations/${job.id}`, 'DELETE')).status()).toBe(200);
      const cleanup = await call(alice, 'v1/generations/cleanup', 'POST', { scope: 'empty-trash' });
      expect(cleanup.status()).toBe(200);
      const maintenance = await staging.query(
        "SELECT (graphile_worker.add_job('maintenance/cleanup', '{}'::json, max_attempts := 1)).id",
      );
      await expect
        .poll(
          async () =>
            (
              await staging.query('SELECT id FROM graphile_worker.jobs WHERE id=$1', [
                maintenance.rows[0].id,
              ])
            ).rowCount,
          { timeout: 30000 },
        )
        .toBe(0);
      expect((await call(alice, `v1/assets/${result.assets[0].id}/content`)).status()).toBe(404);
      expect(
        (await staging.query('SELECT count(*)::int AS n FROM object_cleanup_queue')).rows[0].n,
      ).toBe(0);
      const emptied = await staging.storage.client.send(
        new ListObjectsV2Command({ Bucket: staging.storage.bucket }),
      );
      expect(emptied.IsTruncated).toBe(false);
      expect(emptied.Contents ?? []).toEqual([]);
    }, 90000);

    it('restores a quiesced database and actual objects into fresh targets after an interrupted copy', async () => {
      const key = randomUUID();
      const input = { prompt: 'two retained recovery images from controlled upstream', count: 2 };
      const accepted = await call(alice, 'v1/generations', 'POST', input, {
        'idempotency-key': key,
      });
      expect(accepted.status()).toBe(201);
      const job = generationJobSchema.parse(await accepted.json());
      const original = await waitJob(alice, job.id, 'succeeded');
      retainedJobId = job.id;
      expect(original.assets).toHaveLength(2);
      const providerCalls = staging.image.calls.length;
      const recovery = await restoreStagingIntoFreshResources(staging);
      const restored = await waitJob(alice, job.id, 'succeeded');
      // Asset URL expiry is freshly projected on every read, not a persisted retention date.
      const persisted = (value: typeof original) => ({
        ...value,
        assets: value.assets.map(({ expiresAt: _expiry, ...asset }) => asset),
      });
      expect(persisted(restored)).toEqual(persisted(original));
      for (const asset of restored.assets)
        expect(Date.parse(asset.expiresAt)).toBeGreaterThan(Date.now());
      for (const asset of restored.assets) {
        const content = await call(alice, `v1/assets/${asset.id}/content`);
        expect(content.status()).toBe(200);
        expect(
          createHash('sha256')
            .update(await content.body())
            .digest('hex'),
        ).toBe(staging.image.output.hash);
        expect((await call(bob, `v1/assets/${asset.id}/content`)).status()).toBe(404);
      }
      const replay = await call(alice, 'v1/generations', 'POST', input, { 'idempotency-key': key });
      expect(generationJobSchema.parse(await replay.json()).id).toBe(job.id);
      expect(staging.image.calls).toHaveLength(providerCalls);
      const updated = await call(bob, `v1/prompts/${prompts[1]}`, 'PATCH', {
        title: 'restored-data-writable',
        expectedVersion: 1,
      });
      expect(updated.status()).toBe(200);
      expect(promptDocumentSchema.parse(await updated.json()).version).toBe(2);
      expect(
        (
          await staging.query(
            'SELECT version FROM prompts WHERE id=$1',
            [prompts[1]],
            staging.databaseUrl(undefined, false, 'v25_staging'),
          )
        ).rows[0].version,
      ).toBe(1);
      console.log(
        JSON.stringify({
          scope: 'offline-local-database-and-object-restore',
          archiveSha256: recovery.databaseArchiveSha256,
          tables: recovery.databaseTables,
          rows: recovery.databaseRows,
          objects: recovery.objects,
          elapsedMs: recovery.elapsedMs,
          interruptedCopyResumed: true,
          originalResourcesPreserved: true,
          pointInTimeRecovery: false,
          historicalImageRollback: false,
        }),
      );
    }, 120000);

    it.runIf(process.env.RUN_V25_ROLLBACK_TESTS === 'true')(
      'rolls three real image versions back on the expanded schema and returns without losing data',
      async () => {
        const previous = {
          api: process.env.V25_PREVIOUS_API_IMAGE ?? '',
          worker: process.env.V25_PREVIOUS_WORKER_IMAGE ?? '',
          web: process.env.V25_PREVIOUS_WEB_IMAGE ?? '',
        };
        const ledger = await staging.query(
          'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
        );
        const providerCalls = staging.image.calls.length;
        await staging.assertRuntimeImages();
        await staging.assertLogsSafe();
        await staging.rollbackToLocalImages(previous);
        await staging.assertRuntimeImages(previous);
        const retained = await waitJob(alice, retainedJobId, 'succeeded');
        expect(retained.assets).toHaveLength(2);
        for (const context of [alice, bob]) {
          const page = await context.newPage();
          await seedOnboardingCompleted(page);
          await page.goto(`${staging.baseUrl}/prompts`);
          await browserExpect(page.getByTestId('prompt-library')).toBeVisible();
          if (context === bob)
            await browserExpect(
              page.getByText('restored-data-writable', { exact: true }),
            ).toBeVisible();
          await page.close();
        }
        for (const asset of retained.assets) {
          const content = await call(alice, `v1/assets/${asset.id}/content`);
          expect(content.status()).toBe(200);
          expect(
            createHash('sha256')
              .update(await content.body())
              .digest('hex'),
          ).toBe(staging.image.output.hash);
        }
        expect(staging.image.calls).toHaveLength(providerCalls);
        const accepted = await call(
          alice,
          'v1/generations',
          'POST',
          { prompt: 'controlled image after version rollback', count: 1 },
          { 'idempotency-key': randomUUID() },
        );
        expect(accepted.status()).toBe(201);
        const created = generationJobSchema.parse(await accepted.json());
        await waitJob(alice, created.id, 'succeeded');
        expect(staging.image.calls).toHaveLength(providerCalls + 1);
        expect(
          (await staging.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows,
        ).toEqual(ledger.rows);
        await staging.assertLogsSafe();
        await staging.returnToCurrentImages();
        await staging.assertRuntimeImages();
        const returned = await waitJob(alice, created.id, 'succeeded');
        expect(returned.assets).toHaveLength(1);
        expect(staging.image.calls).toHaveLength(providerCalls + 1);
        console.log(
          JSON.stringify({
            scope: 'local-historical-image-reversal',
            previous,
            current: staging.images,
            databaseDown: false,
            sourceAttestation: false,
            releasedVersionUpgrade: false,
          }),
        );
      },
      120000,
    );

    it('keeps persisted data through runtime restarts and rejects the signed-out browser', async () => {
      await staging.compose('restart', 'api', 'worker', 'scheme-agent', 'web');
      await expect
        .poll(
          async () => {
            try {
              return (await call(bob, 'v1/prompts')).status();
            } catch {
              return 0;
            }
          },
          { timeout: 30000 },
        )
        .toBe(200);
      expect(
        promptPageSchema
          .parse(await (await call(bob, 'v1/prompts')).json())
          .items.some((item) => item.id === prompts[1]),
      ).toBe(true);
      // Missing origin must remain rejected; the actual browser supplies same-origin context.
      expect((await call(bob, 'auth/sign-out', 'POST', {})).status()).toBe(403);
      const page = await bob.newPage();
      await seedOnboardingCompleted(page);
      await page.goto(`${staging.baseUrl}/settings`);
      await page.getByTestId('settings-nav-account').click();
      await browserExpect(page.getByTestId('account-signed-in')).toContainText('staging-bob');
      await page.getByTestId('account-logout').click();
      await page.getByTestId('account-logout-confirm').click();
      await browserExpect(page.getByTestId('account-username')).toBeVisible();
      expect((await call(bob, 'v1/prompts')).status()).toBe(401);
      await page.close();
      await staging.assertLogsSafe();
      console.log(
        JSON.stringify({
          scope: 'isolated-loopback-generated-compose-business',
          images: staging.images,
          accountProvider: 'controlled-http',
          imageProvider: 'controlled-http',
          storage: 'actual-minio',
          releaseSourceAttestation: false,
          remoteTlsVerified: false,
        }),
      );
    }, 60000);
  },
);
