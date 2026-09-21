import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { expect } from 'vitest';
import {
  DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS,
  designSchemeDetailSchema,
  designSchemePackageExportSchema,
  designSchemePackageStageSchema,
  importDesignSchemeResultSchema,
  formalizeDesignSchemeResultSchema,
  selectCoverResultSchema,
} from '@musefold/contracts';
import { sha256 } from '@musefold/scheme-package';
import { saveCapacityCase } from './package-capacity-corpus.js';
import { startCapacityHttp } from './package-capacity-http.js';
import { GenerationBrowserWorker } from './generation-browser-worker.js';

/** Actual HTTP/auth/PG/S3 and production worker. Only export qualification uses an explicit trial fixture. */
export async function startPackageLifetime(label: string) {
  const root = resolve(process.env.PACKAGE_LIFETIME_EVIDENCE_DIR ?? 'test-results');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, `package-lifetime-${label}-`));
  const evidence: Record<string, unknown> = {
    label,
    startedAt: new Date().toISOString(),
    status: 'running',
    scope:
      'Real original deadlines, no clock/date/lease mutation. Actual Better Auth/Hono/PG/S3 and worker bin. SQL trial fixture establishes formal export prerequisites only; no paid-provider claim.',
  };
  const client = await startCapacityHttp(expect);
  const { fixture } = client;
  let worker: GenerationBrowserWorker | undefined;
  let lock: PoolClient | undefined;
  const pending: Promise<Response>[] = [];
  async function mark(phase: string, details: Record<string, unknown> = {}) {
    Object.assign(evidence, details, { phase, observedAt: new Date().toISOString() });
    await writeFile(resolve(directory, 'progress.json'), JSON.stringify(evidence, null, 2));
  }
  async function json(path: string, method = 'GET', body?: unknown) {
    const response = await client.request(`/api/v1/design-schemes${path}`, method, body);
    const value: unknown = await response.json();
    expect(response.status, JSON.stringify(value)).toBe(200);
    return value;
  }
  async function close() {
    fixture.s3.releaseHolds();
    if (lock) {
      await lock.query('ROLLBACK');
      lock.release();
      lock = undefined;
    }
    await Promise.allSettled(pending);
    if (worker) {
      evidence.workerExit = await worker.stop();
      worker = undefined;
    }
    await client.close();
    evidence.finishedAt = new Date().toISOString();
    await writeFile(resolve(directory, 'result.json'), JSON.stringify(evidence, null, 2), {
      flag: 'wx',
    });
  }
  try {
    // Small real shared archive; capacity limits were independently verified in B63.
    const item = await saveCapacityCase(directory, 'entries', 'at');
    const bytes = await readFile(item.path);
    expect(sha256(bytes)).toBe(item.sha256);
    const preparationStartedAt = Date.now();
    const retainedInput = await client.confirmed(item);
    const retained = importDesignSchemeResultSchema.parse(
      await json('/import-package', 'POST', retainedInput),
    );
    const deletedInput = await client.confirmed(item);
    const deleted = importDesignSchemeResultSchema.parse(
      await json('/import-package', 'POST', deletedInput),
    );
    await json('/remove', 'POST', {
      schemeId: deleted.scheme.id,
      expectedVersion: deleted.scheme.version,
    });
    const detail = designSchemeDetailSchema.parse(await json(`/${retained.scheme.id}`));
    await fixture.seedTrial(retained.scheme.id);
    const covered = selectCoverResultSchema.parse(
      await json('/select-cover', 'POST', {
        schemeId: retained.scheme.id,
        assetId: detail.assets[0].id,
        expectedVersion: retained.scheme.version,
      }),
    );
    const formal = formalizeDesignSchemeResultSchema.parse(
      await json('/formalize', 'POST', {
        schemeId: retained.scheme.id,
        revisionId: retained.revisionId,
        coverAssetId: detail.assets[0].id,
        expectedVersion: covered.scheme.version,
        confirmed: true,
      }),
    );
    const exported = designSchemePackageExportSchema.parse(
      await json('/package-exports', 'POST', {
        requestId: randomUUID(),
        schemeId: retained.scheme.id,
        revisionId: retained.revisionId,
        expectedVersion: formal.scheme.version,
        formatVersion: 2,
      }),
    );
    const exportRow = (
      await fixture.database.pool.query('SELECT * FROM design_scheme_package_exports WHERE id=$1', [
        exported.exportId,
      ])
    ).rows[0];
    const download = await client.request(
      `/api/v1/design-schemes/package-exports/${exported.exportId}/content`,
    );
    expect(download.status).toBe(200);
    const exportBytes = Buffer.from(await download.arrayBuffer());
    expect(sha256(exportBytes)).toBe(exported.packageHash);
    await writeFile(resolve(directory, 'export.musefold.design'), exportBytes, { flag: 'wx' });
    const confirmedInput = await client.confirmed(item);
    const lateInput = await client.confirmed(item);
    const awaiting = await client.begin(item);
    const stages = (
      await fixture.database.pool.query(
        'SELECT * FROM design_scheme_package_stages ORDER BY created_at',
      )
    ).rows;
    for (const row of [...stages, exportRow]) {
      // PG created_at uses transaction start; the application computes expiry after authority locks.
      // Bound the actual expiry by the observed HTTP preparation window, without altering either clock.
      expect(new Date(row.expires_at).getTime()).toBeGreaterThanOrEqual(
        preparationStartedAt + DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS,
      );
      expect(new Date(row.expires_at).getTime()).toBeLessThanOrEqual(
        Date.now() + DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS,
      );
    }
    const deadlines = [...stages, exportRow].map((row) => new Date(row.expires_at).getTime());
    const canonical = await fixture.importSnapshot(false);
    const canonicalKeys = (
      await fixture.database.pool.query(
        'SELECT object_key FROM design_scheme_source_files UNION SELECT object_key FROM design_scheme_assets',
      )
    ).rows.map((row) => String(row.object_key));
    const canonicalHashes = Object.fromEntries(
      canonicalKeys.map((key) => {
        const value = fixture.s3.objects.get(key);
        if (!value) throw new Error('Canonical object missing');
        return [key, sha256(value)];
      }),
    );
    worker = new GenerationBrowserWorker(fixture.workerEnvironment);
    await worker.waitUntilReady();
    evidence.initialWorker = worker.snapshot();
    evidence.earlyMaintenance = await client.maintenance();
    expect(fixture.s3.objects.has(exportRow.object_key)).toBe(true);
    for (const input of [confirmedInput, lateInput]) {
      const stage = stages.find((row) => row.id === input.stagedPackageId);
      expect(fixture.s3.objects.has(stage.object_key)).toBe(true);
    }
    await mark('prepared', { item, exported, deadlines, canonicalHashes });
    return {
      client,
      fixture,
      directory,
      evidence,
      json,
      mark,
      close,
      item,
      bytes,
      stages,
      exported,
      exportRow,
      retainedInput,
      retained,
      deletedInput,
      deleted,
      confirmedInput,
      lateInput,
      awaiting,
      canonical,
      canonicalHashes,
      firstDeadline: Math.min(...deadlines),
      lastDeadline: Math.max(...deadlines),
      async waitUntil(deadline: number, phase: string) {
        while (Date.now() < deadline) {
          await mark(phase, { waitingUntil: new Date(deadline).toISOString() });
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(30_000, deadline - Date.now())),
          );
        }
      },
      assertCanonicalObjects() {
        for (const [key, hash] of Object.entries(canonicalHashes)) {
          const value = fixture.s3.objects.get(key);
          expect(value, key).toBeDefined();
          if (value) expect(sha256(value)).toBe(hash);
        }
      },
      async lockInFlight() {
        fixture.s3.holdNext('PUT');
        const importing = client.request(
          '/api/v1/design-schemes/import-package',
          'POST',
          lateInput,
        );
        pending.push(importing);
        await expect.poll(() => fixture.s3.barriers.length, { timeout: 15000 }).toBe(1);
        lock = await fixture.database.pool.connect();
        await lock.query('BEGIN');
        const lockerPid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await lock.query('SELECT id FROM design_scheme_package_stages WHERE id=$1 FOR UPDATE', [
          lateInput.stagedPackageId,
        ]);
        fixture.s3.releaseHolds();
        const blocked = async () =>
          (
            await fixture.database.pool.query(
              'SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
              [lockerPid],
            )
          ).rowCount;
        await expect.poll(blocked, { timeout: 15000 }).toBe(1);
        fixture.s3.holdNext('GET');
        const downloading = client.request(
          `/api/v1/design-schemes/package-exports/${exported.exportId}/content`,
        );
        pending.push(downloading);
        await expect.poll(() => fixture.s3.barriers.length, { timeout: 15000 }).toBe(2);
        await lock.query('SELECT id FROM design_scheme_package_exports WHERE id=$1 FOR UPDATE', [
          exported.exportId,
        ]);
        fixture.s3.releaseHolds();
        await expect.poll(blocked, { timeout: 15000 }).toBe(2);
        const row = (
          await fixture.database.pool.query(
            'SELECT * FROM design_scheme_package_imports WHERE stage_id=$1',
            [lateInput.stagedPackageId],
          )
        ).rows[0];
        const prefix = `scheme-imports/${row.stage_id}/${row.attempt_id}/`;
        const partial = [...fixture.s3.objects.keys()].filter((key) => key.startsWith(prefix));
        expect(partial.length).toBeGreaterThan(0);
        expect(row.status).toBe('running');
        expect((await fixture.importSnapshot(false)).canonical).toEqual(canonical.canonical);
        await mark('actual-requests-blocked', {
          lockerPid,
          partial,
          importLease: row.lease_until,
          barriers: fixture.s3.barriers,
        });
        return { importing, downloading, partial, blocked };
      },
      async unlock() {
        if (!lock) throw new Error('No lifetime lock held');
        await lock.query('ROLLBACK');
        lock.release();
        lock = undefined;
      },
      async restartWorker() {
        if (!worker) throw new Error('Missing worker');
        const first = worker.snapshot();
        expect(await worker.stop()).toEqual({ code: 0, signal: null });
        worker = new GenerationBrowserWorker(fixture.workerEnvironment);
        await worker.waitUntilReady();
        expect(worker.snapshot().pid).not.toBe(first.pid);
        await mark('new-worker-ready', { previousWorker: first, currentWorker: worker.snapshot() });
      },
      async stage(id: string) {
        return designSchemePackageStageSchema.parse(await json(`/packages/${id}`));
      },
    };
  } catch (error) {
    evidence.status = 'setup-failed';
    evidence.error = error instanceof Error ? error.message : String(error);
    await close();
    throw error;
  }
}
