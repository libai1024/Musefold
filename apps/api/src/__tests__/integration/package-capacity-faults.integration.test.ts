import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, it } from 'vitest';
import { DESIGN_SCHEME_PACKAGE_LIMITS as limits } from '@musefold/contracts';
import type { CapacityCase } from '../fixtures/package-capacity-corpus.js';
import { startCapacityHttp } from '../fixtures/package-capacity-http.js';
import { GenerationBrowserWorker } from '../fixtures/generation-browser-worker.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

describeDb('actual maximum archive import failure and natural cleanup', () => {
  let directory: string;
  let item: CapacityCase;
  beforeAll(async () => {
    // Included in the existing CI apps/*/test-results artifact upload.
    const root = resolve(process.env.PACKAGE_CAPACITY_EVIDENCE_DIR ?? 'test-results');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(resolve(root, 'capacity-faults-'));
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

  it.for(['storage-error', 'user-cancel', 'client-disconnect'] as const)(
    '%s after a real 64MiB PUT leaves no draft and is cleaned by a new worker PID',
    { timeout: 210000 },
    async (mode, { expect }) => {
      expect(item.bytes).toBe(limits.archiveBytes);
      expect(hash(await readFile(item.path))).toBe(item.sha256);
      const client = await startCapacityHttp(expect);
      const { fixture } = client;
      let worker: GenerationBrowserWorker | undefined;
      let pending: Promise<Response | Error> | undefined;
      const evidence: Record<string, unknown> = {
        mode,
        input: item,
        startedAt: new Date().toISOString(),
        scope:
          'Actual TCP/auth/PG/AWS SDK and production worker bin; local S3 protocol fixture. No lease/date mutation. Whole test-process RSS includes API/client/in-memory S3.',
      };
      try {
        const input = await client.confirmed(item);
        const canonicalBefore = (await fixture.importSnapshot(false)).canonical;
        fixture.s3.holdNext('PUT', limits.entryBytes);
        const controller = new AbortController();
        pending = client
          .request('/api/v1/design-schemes/import-package', 'POST', input, controller.signal)
          .catch((error: Error) => error);
        await expect.poll(() => fixture.s3.barriers.length, { timeout: 30000 }).toBe(1);
        const row = async () =>
          (
            await fixture.database.pool.query(
              'SELECT status,lease_until,epoch,result FROM design_scheme_package_imports WHERE stage_id=$1',
              [input.stagedPackageId],
            )
          ).rows[0];
        const claimed = await row();
        let deadline = new Date(claimed.lease_until).getTime();
        expect(deadline).toBeGreaterThan(Date.now());
        const held = fixture.s3.barriers[0];
        const heldObject = [...fixture.s3.objects].find(([key]) => hash(key) === held.keyHash);
        expect(heldObject?.[1].length).toBe(limits.entryBytes);
        expect((await fixture.importSnapshot(false)).canonical).toEqual(canonicalBefore);
        evidence.claimed = claimed;
        evidence.held = {
          ...held,
          bytes: heldObject?.[1].length,
          observedAt: new Date().toISOString(),
        };
        if (mode === 'storage-error') fixture.s3.state.failPutAfterWrite = true;
        if (mode === 'user-cancel') {
          const cancel = await client.request(
            `/api/v1/design-schemes/packages/${input.stagedPackageId}`,
            'DELETE',
          );
          expect(cancel.status).toBe(200);
          await cancel.json();
        }
        if (mode === 'client-disconnect') {
          controller.abort();
          expect(await pending).toMatchObject({ name: 'AbortError' });
        }
        fixture.s3.releaseHolds();
        const response = await pending;
        if (mode !== 'client-disconnect') {
          if (!('status' in response)) throw response;
          expect(response.status).toBe(mode === 'storage-error' ? 503 : 409);
          evidence.response = { status: response.status, body: await response.json() };
        }
        await expect.poll(async () => (await row()).status, { timeout: 20000 }).toBe('retryable');
        expect((await row()).result).toBeNull();
        expect((await fixture.importSnapshot(false)).canonical).toEqual(canonicalBefore);
        const residue = [...fixture.s3.objects].filter(([key]) =>
          key.startsWith('scheme-imports/'),
        );
        expect(residue.some(([, bytes]) => bytes.length === limits.entryBytes)).toBe(true);
        evidence.residue = residue.map(([key, bytes]) => ({
          keyHash: hash(key),
          bytes: bytes.length,
          hash: hash(bytes),
        }));
        // Cancel the retained staging object explicitly; never rewrite its natural deadline.
        const cancelled = await client.request(
          `/api/v1/design-schemes/packages/${input.stagedPackageId}`,
          'DELETE',
        );
        expect(cancelled.status).toBe(200);
        await cancelled.json();
        // Disconnect propagation can arrive after the importer renews its lease for
        // another object/finalization. Wait for the persisted FINAL deadlines, not
        // the snapshot taken while the first PUT was held. Do not rewrite any date.
        const finalImport = await row();
        const scheduled = (
          await fixture.database.pool.query(
            'SELECT next_attempt_at FROM object_cleanup_queue ORDER BY next_attempt_at',
          )
        ).rows;
        deadline = Math.max(
          deadline,
          new Date(finalImport.lease_until).getTime(),
          ...scheduled.map((entry) => new Date(entry.next_attempt_at).getTime()),
        );
        evidence.finalImportBeforeMaintenance = finalImport;
        evidence.finalNaturalDeadline = new Date(deadline).toISOString();
        worker = new GenerationBrowserWorker(fixture.workerEnvironment);
        await worker.waitUntilReady();
        evidence.firstWorker = worker.snapshot();
        evidence.earlyMaintenance = await client.maintenance();
        expect(Date.now()).toBeLessThan(deadline);
        for (const [key] of residue) expect(fixture.s3.objects.has(key)).toBe(true);
        expect(fixture.s3.deleted).toHaveLength(0);
        expect((await worker.stop()).code).toBe(0);
        const firstPid = worker.snapshot().pid;
        worker = new GenerationBrowserWorker(fixture.workerEnvironment);
        await worker.waitUntilReady();
        expect(worker.snapshot().pid).not.toBe(firstPid);
        evidence.replacementWorker = worker.snapshot();
        await expect
          .poll(() => Date.now(), {
            timeout: Math.max(0, deadline - Date.now()) + 10000,
            interval: 1000,
          })
          .toBeGreaterThanOrEqual(deadline);
        evidence.afterDeadline = new Date().toISOString();
        evidence.finalLeaseBeforeCleanup = await row();
        evidence.cleanup = await client.maintenance();
        evidence.remainingObjects = [...fixture.s3.objects].map(([key, bytes]) => ({
          kind: key.startsWith('scheme-imports/') ? 'import' : 'stage',
          keyHash: hash(key),
          bytes: bytes.length,
        }));
        evidence.remainingIntents = (
          await fixture.database.pool.query(
            `SELECT reason,next_attempt_at,attempt_count,last_error,
          encode(sha256(convert_to(object_key,'UTF8')),'hex') AS key_hash
          FROM object_cleanup_queue ORDER BY next_attempt_at`,
          )
        ).rows;
        expect(fixture.s3.objects.size).toBe(0);
        const cleanupRows = await fixture.database.pool.query('SELECT * FROM object_cleanup_queue');
        expect(cleanupRows.rows).toHaveLength(0);
        expect((await fixture.importSnapshot(false)).canonical).toEqual(canonicalBefore);
        evidence.deleted = [...fixture.s3.deleted];
        evidence.final = {
          objects: fixture.s3.objects.size,
          cleanupRows: cleanupRows.rowCount,
          import: await row(),
        };
        evidence.status = 'passed';
      } catch (error) {
        evidence.status = 'failed';
        evidence.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        fixture.s3.releaseHolds();
        await pending;
        if (worker) await worker.stop();
        await client.close();
        evidence.finishedAt = new Date().toISOString();
        evidence.processPeakRssKiB = process.resourceUsage().maxRSS;
        await writeFile(
          resolve(directory, `${mode}.json`),
          `${JSON.stringify(evidence, null, 2)}\n`,
          { flag: 'wx' },
        );
        console.log(`Capacity fault evidence: ${resolve(directory, `${mode}.json`)}`);
      }
    },
  );
});
