import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_PACKAGE_LIMITS as limits,
  designSchemePackageStageSchema,
  importDesignSchemeResultSchema,
} from '@musefold/contracts';
import { sha256 } from '@musefold/scheme-package';
import type { CapacityCase } from '../fixtures/package-capacity-corpus.js';
import { startCapacityHttp } from '../fixtures/package-capacity-http.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('actual maximum package concurrency admission and slot release', () => {
  let item: CapacityCase;
  let directory: string;
  beforeAll(async () => {
    const root = resolve(process.env.PACKAGE_CAPACITY_EVIDENCE_DIR ?? 'test-results');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(resolve(root, 'capacity-concurrency-'));
    await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('../fixtures/package-capacity-process.ts', import.meta.url)),
        'generate',
        directory,
        'archive',
        'at',
      ],
      { env: { ...process.env, PACKAGE_CAPACITY_TEST: '1' }, timeout: 180000 },
    );
    item = JSON.parse(await readFile(resolve(directory, 'archive-at.json'), 'utf8'));
  }, 180000);

  it('mixed upload and import share one API admission budget and cancel remains available', async () => {
    const client = await startCapacityHttp(expect);
    const { fixture } = client;
    const pending: Promise<Response>[] = [];
    const evidence: Record<string, unknown> = { item, startedAt: new Date().toISOString() };
    try {
      const input = await client.confirmed(item);
      const uploads = [await client.begin(item), await client.begin(item)];
      const before = (await fixture.importSnapshot(false)).canonical;
      fixture.s3.holdNext('PUT', limits.archiveBytes, 2);
      const bytes = await readFile(item.path);
      expect(bytes.length).toBe(limits.archiveBytes);
      expect(sha256(bytes)).toBe(item.sha256);
      for (const stage of uploads)
        pending.push(
          client.request(
            `/api/v1/design-schemes/packages/${stage.stagedPackageId}/content`,
            'PUT',
            bytes,
          ),
        );
      await expect.poll(() => fixture.s3.barriers.length, { timeout: 40000 }).toBe(2);
      expect(
        (
          await fixture.database.pool.query(
            "SELECT id FROM design_scheme_package_stages WHERE status='uploading'",
          )
        ).rowCount,
      ).toBe(2);
      const rejected = await client.request('/api/v1/design-schemes/import-package', 'POST', input);
      evidence.busyStatus = rejected.status;
      await rejected.json();
      expect(rejected.status).toBe(429);
      // Export reads must share the production app's pool, before any object lookup.
      const missingExport = randomUUID();
      const download = await client.request(
        `/api/v1/design-schemes/package-exports/${missingExport}/content`,
      );
      expect(download.status).toBe(429);
      await download.json();
      const status = await client.request(
        `/api/v1/design-schemes/packages/${uploads[1].stagedPackageId}`,
      );
      expect(status.status).toBe(200);
      expect(designSchemePackageStageSchema.parse(await status.json()).status).toBe('uploading');
      expect((await fixture.importSnapshot(false)).canonical).toEqual(before);
      expect(
        (await fixture.database.pool.query('SELECT stage_id FROM design_scheme_package_imports'))
          .rowCount,
      ).toBe(0);
      const cancelled = await client.request(
        `/api/v1/design-schemes/packages/${uploads[0].stagedPackageId}`,
        'DELETE',
      );
      expect(cancelled.status).toBe(200);
      await cancelled.json();
      fixture.s3.releaseHolds();
      const [first, second] = await Promise.all(pending);
      expect(first.status).toBe(409);
      expect(second.status).toBe(200);
      await Promise.all([first.json(), second.json()]);
      const releasedDownload = await client.request(
        `/api/v1/design-schemes/package-exports/${missingExport}/content`,
      );
      expect(releasedDownload.status).toBe(404);
      await releasedDownload.json();
      const retry = await client.request('/api/v1/design-schemes/import-package', 'POST', input);
      expect(retry.status).toBe(200);
      const value = importDesignSchemeResultSchema.parse(await retry.json());
      expect(value.status).toBe('draft');
      const after = await fixture.importSnapshot(false);
      expect(after.canonical.design_schemes).toHaveLength(1);
      expect(after.canonical.design_scheme_runs).toHaveLength(0);
      for (const source of after.content) expect(source.hash).toBe(source.expectedHash);
      evidence.status = 'passed';
      evidence.result = value;
      evidence.sources = after.content;
    } catch (error) {
      evidence.status = 'failed';
      evidence.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      fixture.s3.releaseHolds();
      await Promise.allSettled(pending);
      await client.close();
      evidence.finishedAt = new Date().toISOString();
      evidence.scope =
        'Same real API/auth/PG/S3 process, two actual maximum uploads held while a confirmed different stage requests import. Cancellation remains ungated. Fixture teardown is not GC evidence.';
      await writeFile(resolve(directory, 'mixed.json'), JSON.stringify(evidence, null, 2), {
        flag: 'wx',
      });
    }
  }, 180000);

  it.for(['upload', 'import'] as const)(
    '%s admits two real maximum requests, rejects a third and reopens after cancellation',
    { timeout: 180000 },
    async (phase, { expect }) => {
      const client = await startCapacityHttp(expect);
      const { fixture } = client;
      const pending: Promise<Response>[] = [];
      const evidence: Record<string, unknown> = {
        phase,
        item,
        startedAt: new Date().toISOString(),
        scope:
          'Actual TCP/auth/PG/S3 and real simultaneous requests in one API process. RSS includes client/API/in-memory S3; not an API-only deployment memory budget. Fixture teardown is not physical GC evidence.',
      };
      try {
        const bytes = await readFile(item.path);
        expect(bytes.length).toBe(limits.archiveBytes);
        expect(sha256(bytes)).toBe(item.sha256);
        const inputs: Awaited<ReturnType<typeof client.confirmed>>[] = [];
        for (let i = 0; i < 3; i++)
          inputs.push(await (phase === 'upload' ? client.begin(item) : client.confirmed(item)));
        const overflow = await client.request('/api/v1/design-schemes/packages', 'POST', {
          requestId: randomUUID(),
          packageHash: item.sha256,
          sizeBytes: item.bytes,
          formatVersion: item.formatVersion,
        });
        expect(overflow.status).toBe(429);
        await overflow.json();
        expect(
          (await fixture.database.pool.query('SELECT id FROM design_scheme_package_stages'))
            .rowCount,
        ).toBe(3);
        const before = (await fixture.importSnapshot(false)).canonical;
        const path = (index: number) =>
          `/api/v1/design-schemes/packages/${inputs[index].stagedPackageId}`;
        const send = (index: number) =>
          phase === 'upload'
            ? client.request(`${path(index)}/content`, 'PUT', bytes)
            : client.request('/api/v1/design-schemes/import-package', 'POST', {
                stagedPackageId: inputs[index].stagedPackageId,
                packageHash: item.sha256,
                formatVersion: item.formatVersion,
              });
        fixture.s3.holdNext(phase === 'upload' ? 'PUT' : 'GET', limits.archiveBytes, 2);
        pending.push(send(0), send(1));
        await expect.poll(() => fixture.s3.barriers.length, { timeout: 40000 }).toBe(2);
        const activeSql =
          phase === 'upload'
            ? "SELECT id FROM design_scheme_package_stages WHERE status='uploading'"
            : "SELECT stage_id FROM design_scheme_package_imports WHERE status='running'";
        expect((await fixture.database.pool.query(activeSql)).rowCount).toBe(2);
        const writes = fixture.s3.writes.length;
        const start = performance.now();
        const busy = await send(2);
        const busyMs = performance.now() - start;
        expect(busy.status).toBe(429);
        evidence.busy = {
          status: busy.status,
          elapsedMs: busyMs,
          body: await busy.json(),
          active: 2,
        };
        expect(fixture.s3.writes.length).toBe(writes);
        const third = await fixture.database.pool.query(
          'SELECT status FROM design_scheme_package_stages WHERE id=$1',
          [inputs[2].stagedPackageId],
        );
        expect(third.rows[0].status).toBe(phase === 'upload' ? 'awaiting_upload' : 'confirmed');
        expect((await fixture.importSnapshot(false)).canonical).toEqual(before);
        const cancelled = await client.request(path(0), 'DELETE');
        expect(cancelled.status).toBe(200);
        expect(designSchemePackageStageSchema.parse(await cancelled.json()).status).toBe(
          'cancelled',
        );
        fixture.s3.releaseHolds();
        const [first, second] = await Promise.all(pending);
        expect(first.status).toBe(409);
        await first.json();
        expect(second.status).toBe(200);
        const successful = await second.json();
        const retry = await send(2);
        expect(retry.status).toBe(200);
        const retried = await retry.json();
        if (phase === 'upload') {
          expect(designSchemePackageStageSchema.parse(successful).status).toBe('ready');
          expect(designSchemePackageStageSchema.parse(retried).status).toBe('ready');
          expect((await fixture.importSnapshot(false)).canonical).toEqual(before);
        } else {
          const firstDraft = importDesignSchemeResultSchema.parse(successful);
          const secondDraft = importDesignSchemeResultSchema.parse(retried);
          expect(firstDraft.scheme.id).not.toBe(secondDraft.scheme.id);
          expect(firstDraft.status).toBe('draft');
          expect(secondDraft.status).toBe('draft');
          const after = await fixture.importSnapshot(false);
          expect(after.canonical.design_schemes).toHaveLength(2);
          expect(after.canonical.design_scheme_runs).toHaveLength(0);
          for (const source of after.content) expect(source.hash).toBe(source.expectedHash);
          evidence.sources = after.content;
        }
        expect((await fixture.database.pool.query(activeSql)).rowCount).toBe(0);
        evidence.result = {
          cancelledStatus: first.status,
          second: successful,
          explicitRetry: retried,
          active: 0,
        };
        evidence.barriers = fixture.s3.barriers;
        evidence.status = 'passed';
      } catch (error) {
        evidence.status = 'failed';
        evidence.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        fixture.s3.releaseHolds();
        await Promise.allSettled(pending);
        await client.close();
        evidence.finishedAt = new Date().toISOString();
        evidence.processPeakRssKiB = process.resourceUsage().maxRSS;
        await writeFile(
          resolve(directory, `${phase}.json`),
          `${JSON.stringify(evidence, null, 2)}\n`,
          { flag: 'wx' },
        );
        console.log(`Capacity concurrency evidence: ${resolve(directory, `${phase}.json`)}`);
      }
    },
  );
});
