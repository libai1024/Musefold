import { describe, expect, it } from 'vitest';
import {
  DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS,
  designSchemePackageRecoverySchema,
  designSchemePackageExportRecoverySchema,
  importDesignSchemeResultSchema,
} from '@musefold/contracts';
import { sha256 } from '@musefold/scheme-package';
import { startPackageLifetime } from '../fixtures/package-lifetime.js';

const describeDb = process.env.RUN_DATABASE_TESTS === 'true' ? describe : describe.skip;

describeDb('package original deadlines and cleanup races', () => {
  it('preflights actual in-flight locks, release and archive integrity before expiry', async () => {
    const run = await startPackageLifetime('preflight');
    try {
      const pending = await run.lockInFlight();
      await run.restartWorker();
      expect(Date.now()).toBeLessThan(run.firstDeadline);
      await run.unlock();
      const imported = await pending.importing;
      expect(imported.status).toBe(200);
      expect(importDesignSchemeResultSchema.parse(await imported.json()).status).toBe('draft');
      const download = await pending.downloading;
      expect(download.status).toBe(200);
      expect(sha256(Buffer.from(await download.arrayBuffer()))).toBe(run.exported.packageHash);
      run.assertCanonicalObjects();
      await run.mark('preflight-passed', { status: 'passed', provesNaturalExpiry: false });
    } catch (error) {
      await run.mark('preflight-failed', { status: 'failed', error: String(error) });
      throw error;
    } finally {
      await run.close();
    }
  }, 120000);

  // One real hour exceeds normal PR/Main integration timeouts. Explicit long-running release check.
  it.skipIf(process.env.RUN_PACKAGE_LIFETIME_TESTS !== 'true')(
    'naturally expires original one-hour stages and exports while preserving receipts and adopted assets',
    async () => {
      const run = await startPackageLifetime('natural');
      try {
        expect(DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS).toBe(60 * 60_000);
        await run.waitUntil(run.firstDeadline - 55_000, 'waiting-for-original-deadline');
        const pending = await run.lockInFlight();
        await run.restartWorker();
        await run.client.maintenance();
        expect(Date.now()).toBeLessThan(run.firstDeadline);
        for (const key of pending.partial) expect(run.fixture.s3.objects.has(key)).toBe(true);
        expect(run.fixture.s3.objects.has(run.exportRow.object_key)).toBe(true);
        run.assertCanonicalObjects();
        await run.waitUntil(run.lastDeadline + 250, 'waiting-with-actual-requests-blocked');
        expect(await pending.blocked()).toBe(2);
        // Keep both actual API requests blocked while a new production worker deletes expired bytes.
        await run.mark('original-deadlines-passed', { cleanup: await run.client.maintenance() });
        for (const key of pending.partial) expect(run.fixture.s3.objects.has(key)).toBe(false);
        expect(run.fixture.s3.objects.has(run.exportRow.object_key)).toBe(false);
        run.assertCanonicalObjects();
        expect((await run.fixture.importSnapshot(false)).canonical).toEqual(
          run.canonical.canonical,
        );
        await run.unlock();
        const imported = await pending.importing;
        expect(imported.status).toBe(409);
        await imported.json();
        const download = await pending.downloading;
        expect(download.status).toBe(409);
        expect(download.headers.get('x-musefold-package-sha256')).toBeNull();
        await download.json();
        const writes = run.fixture.s3.writes.length;
        for (const [input, receipt] of [
          [run.retainedInput, run.retained],
          [run.deletedInput, run.deleted],
        ] as const) {
          const recovery = designSchemePackageRecoverySchema.parse(
            await run.json(`/packages/${input.stagedPackageId}/recovery`),
          );
          expect(recovery).toMatchObject({ execution: 'completed', receipt, canContinue: false });
          expect(
            importDesignSchemeResultSchema.parse(await run.json('/import-package', 'POST', input)),
          ).toEqual(receipt);
          const stage = run.stages.find((row) => row.id === input.stagedPackageId);
          expect(run.fixture.s3.objects.has(stage.object_key)).toBe(false);
        }
        const removed = await run.client.request(`/api/v1/design-schemes/${run.deleted.scheme.id}`);
        expect(removed.status).toBe(404);
        await removed.json();
        const unavailable = designSchemePackageExportRecoverySchema.parse(
          await run.json(`/package-exports/${run.exported.exportId}/recovery`),
        );
        expect(unavailable).toMatchObject({
          canDownload: false,
          blockedReason: 'export_unavailable',
          export: { status: 'expired' },
        });
        expect((await run.stage(run.confirmedInput.stagedPackageId)).status).toBe('expired');
        expect((await run.stage(run.awaiting.stagedPackageId)).status).toBe('expired');
        for (const input of [run.confirmedInput, run.lateInput]) {
          const denied = await run.client.request(
            '/api/v1/design-schemes/import-package',
            'POST',
            input,
          );
          expect(denied.status).toBe(409);
          await denied.json();
        }
        const upload = await run.client.request(
          `/api/v1/design-schemes/packages/${run.awaiting.stagedPackageId}/content`,
          'PUT',
          run.bytes,
        );
        expect(upload.status).toBe(409);
        await upload.json();
        const unavailableDownload = await run.client.request(
          `/api/v1/design-schemes/package-exports/${run.exported.exportId}/content`,
        );
        expect(unavailableDownload.status).toBe(409);
        await unavailableDownload.json();
        expect(run.fixture.s3.writes.length).toBe(writes);
        expect((await run.fixture.importSnapshot(false)).canonical).toEqual(
          run.canonical.canonical,
        );
        await run.client.maintenance();
        run.assertCanonicalObjects();
        for (const row of run.stages) {
          expect((await run.stage(row.id)).expiresAt).toBe(new Date(row.expires_at).toISOString());
        }
        await run.mark('natural-expiry-passed', {
          status: 'passed',
          provesNaturalExpiry: true,
          deletedObjectHashes: run.fixture.s3.deleted,
          preservedObjectCount: Object.keys(run.canonicalHashes).length,
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        await run.mark('natural-expiry-failed', { status: 'failed', error: String(error) });
        throw error;
      } finally {
        await run.close();
      }
    },
    DESIGN_SCHEME_PACKAGE_STAGE_TTL_MS + 5 * 60_000,
  );
});
