import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, vi } from 'vitest';
import {
  DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS,
  importDesignSchemeResultSchema,
} from '@musefold/contracts';
import { sha256 } from '@musefold/scheme-package';
import { saveCapacityCase } from '../fixtures/package-capacity-corpus.js';
import { startCapacityHttp } from '../fixtures/package-capacity-http.js';
import { GenerationBrowserWorker } from '../fixtures/generation-browser-worker.js';
import { S3DesignSchemeAssetStorage } from '../../modules/design-scheme-assets/storage.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;
const keyHash = (value: string) => createHash('sha256').update(value).digest('hex');

describeDb('natural import lease replacement and cleanup adoption', () => {
  it.for(['cleanup-before-replacement', 'cleanup-in-flight-during-replacement'] as const)(
    '%s preserves the new attempt when the old HTTP request finally resumes',
    { timeout: 300000 },
    async (order, { expect }) => {
      const root = resolve(process.env.PACKAGE_LEASE_RACE_EVIDENCE_DIR ?? 'test-results');
      await mkdir(root, { recursive: true });
      const directory = await mkdtemp(resolve(root, `package-lease-${order}-`));
      const evidence: Record<string, unknown> = {
        order,
        startedAt: new Date().toISOString(),
        status: 'running',
        scope:
          'Actual HTTP/Better Auth/PG/S3 and production worker; original two-minute leases, no date or lease mutation. A test barrier after the real SDK PUT completes models stalled API execution; this is not an OS process pause. No canonical SQL fixtures or model calls.',
      };
      const item = await saveCapacityCase(directory, 'entries', 'at');
      evidence.item = item;
      const client = await startCapacityHttp(expect);
      const { fixture } = client;
      let worker: GenerationBrowserWorker | undefined;
      let pending: Promise<Response> | undefined;
      let cleaning: Promise<unknown> | undefined;
      let releaseOld = () => {};
      const oldBarrier = new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      let heldKey: string | undefined;
      const realPut = S3DesignSchemeAssetStorage.prototype.put;
      // Keep the real 30-second S3 timeout intact. Pause after successful IO, not its response.
      const put = vi
        .spyOn(S3DesignSchemeAssetStorage.prototype, 'put')
        .mockImplementation(async function (this: S3DesignSchemeAssetStorage, ...args) {
          await realPut.apply(this, args);
          if (!heldKey && args[0].startsWith('scheme-imports/')) {
            heldKey = args[0];
            await oldBarrier;
          }
        });
      async function mark(phase: string, details: Record<string, unknown> = {}) {
        Object.assign(evidence, details, { phase, observedAt: new Date().toISOString() });
        await writeFile(resolve(directory, 'progress.json'), JSON.stringify(evidence, null, 2));
      }
      async function waitUntil(deadline: number, phase: string) {
        while (Date.now() < deadline) {
          await mark(phase, { waitingUntil: new Date(deadline).toISOString() });
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(30000, deadline - Date.now())),
          );
        }
      }
      try {
        expect(DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS).toBe(120000);
        const input = await client.confirmed(item);
        const stage = (
          await fixture.database.pool.query(
            'SELECT * FROM design_scheme_package_stages WHERE id=$1',
            [input.stagedPackageId],
          )
        ).rows[0];
        const row = async () =>
          (
            await fixture.database.pool.query(
              'SELECT * FROM design_scheme_package_imports WHERE stage_id=$1',
              [input.stagedPackageId],
            )
          ).rows[0];
        const before = (await fixture.importSnapshot(false)).canonical;
        const sentAt = Date.now();
        pending = client.request('/api/v1/design-schemes/import-package', 'POST', input);
        await expect.poll(() => heldKey, { timeout: 15000 }).toBeDefined();
        const original = await row();
        const deadline = new Date(original.lease_until).getTime();
        expect(deadline).toBeGreaterThanOrEqual(sentAt + DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS);
        expect(deadline).toBeLessThanOrEqual(Date.now() + DESIGN_SCHEME_PACKAGE_UPLOAD_LEASE_MS);
        const oldKeys = [...fixture.s3.objects.keys()].filter((key) =>
          key.startsWith(`scheme-imports/${original.stage_id}/${original.attempt_id}/`),
        );
        expect(oldKeys).toEqual([heldKey]);
        expect((await fixture.importSnapshot(false)).canonical).toEqual(before);
        worker = new GenerationBrowserWorker(fixture.workerEnvironment);
        await worker.waitUntilReady();
        const firstWorker = worker.snapshot();
        await client.maintenance();
        expect(fixture.s3.objects.has(oldKeys[0])).toBe(true);
        expect(Date.now()).toBeLessThan(deadline);
        expect(await worker.stop()).toEqual({ code: 0, signal: null });
        worker = new GenerationBrowserWorker(fixture.workerEnvironment);
        await worker.waitUntilReady();
        expect(worker.snapshot().pid).not.toBe(firstWorker.pid);
        await mark('old-put-held', {
          original,
          oldKeys,
          firstWorker,
          replacementWorker: worker.snapshot(),
        });
        await waitUntil(deadline + 250, 'waiting-for-original-import-lease');
        if (order === 'cleanup-in-flight-during-replacement') {
          fixture.s3.holdNext('DELETE');
          cleaning = client.maintenance();
          await expect.poll(() => fixture.s3.barriers.length, { timeout: 15000 }).toBe(1);
          expect(fixture.s3.barriers[0]).toMatchObject({
            method: 'DELETE',
            keyHash: keyHash(oldKeys[0]),
            released: false,
          });
          expect(fixture.s3.objects.has(oldKeys[0])).toBe(true);
        } else {
          await client.maintenance();
          expect(fixture.s3.objects.has(oldKeys[0])).toBe(false);
        }
        const replacing = await client.request(
          '/api/v1/design-schemes/import-package',
          'POST',
          input,
        );
        expect(replacing.status).toBe(200);
        const receipt = importDesignSchemeResultSchema.parse(await replacing.json());
        const replacement = await row();
        expect(replacement.epoch).toBe(original.epoch + 1);
        expect(replacement.attempt_id).not.toBe(original.attempt_id);
        expect(replacement.seed).toBe(original.seed);
        expect(replacement.status).toBe('completed');
        const canonical = await fixture.importSnapshot(false);
        const keys = (
          await fixture.database.pool.query(
            'SELECT object_key FROM design_scheme_source_files UNION SELECT object_key FROM design_scheme_assets',
          )
        ).rows.map((entry) => String(entry.object_key));
        expect(keys.length).toBeGreaterThan(0);
        const hashes = Object.fromEntries(
          keys.map((key) => {
            expect(key).toContain(`/${replacement.attempt_id}/`);
            const bytes = fixture.s3.objects.get(key);
            if (!bytes) throw new Error('Missing adopted object');
            return [key, sha256(bytes)];
          }),
        );
        const writes = fixture.s3.writes.length;
        await mark('replacement-committed-before-old-response', {
          replacement,
          receipt,
          hashes,
          barriers: fixture.s3.barriers,
        });
        fixture.s3.releaseHolds();
        await cleaning;
        releaseOld();
        const late = await pending;
        expect(late.status).toBe(409);
        await late.json();
        expect(fixture.s3.writes).toHaveLength(writes);
        expect((await row()).result).toEqual(receipt);
        expect((await fixture.importSnapshot(false)).canonical).toEqual(canonical.canonical);
        // Observe the successor's original cleanup deadlines too, so protection is tested
        // when its objects are actually eligible for maintenance, not only before they are due.
        const due = (
          await fixture.database.pool.query(
            'SELECT max(next_attempt_at) AS deadline FROM object_cleanup_queue WHERE object_key = ANY($1::text[])',
            [keys],
          )
        ).rows[0].deadline;
        expect(due).not.toBeNull();
        await waitUntil(
          new Date(due).getTime() + 250,
          'waiting-for-adopted-object-cleanup-deadline',
        );
        await client.maintenance();
        for (const key of oldKeys) {
          expect(fixture.s3.objects.has(key)).toBe(false);
          expect(fixture.s3.deleted).toContain(keyHash(key));
        }
        for (const [key, hash] of Object.entries(hashes)) {
          const bytes = fixture.s3.objects.get(key);
          expect(bytes).toBeDefined();
          if (bytes) expect(sha256(bytes)).toBe(hash);
          expect(fixture.s3.deleted).not.toContain(keyHash(key));
        }
        const replay = await client.request('/api/v1/design-schemes/import-package', 'POST', input);
        expect(replay.status).toBe(200);
        expect(importDesignSchemeResultSchema.parse(await replay.json())).toEqual(receipt);
        expect(fixture.s3.writes).toHaveLength(writes);
        expect((await fixture.importSnapshot(false)).canonical).toEqual(canonical.canonical);
        const finalStage = (
          await fixture.database.pool.query(
            'SELECT expires_at FROM design_scheme_package_stages WHERE id=$1',
            [input.stagedPackageId],
          )
        ).rows[0];
        expect(finalStage.expires_at).toEqual(stage.expires_at);
        await mark('natural-lease-race-passed', {
          status: 'passed',
          cleanupDue: due,
          deleted: fixture.s3.deleted,
        });
      } catch (error) {
        await mark('natural-lease-race-failed', { status: 'failed', error: String(error) });
        throw error;
      } finally {
        fixture.s3.releaseHolds();
        releaseOld();
        await Promise.allSettled([pending, cleaning]);
        put.mockRestore();
        if (worker) evidence.workerExit = await worker.stop();
        await client.close();
        evidence.finishedAt = new Date().toISOString();
        await writeFile(resolve(directory, 'result.json'), JSON.stringify(evidence, null, 2), {
          flag: 'wx',
        });
      }
    },
  );
});
