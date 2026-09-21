import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { CloudServiceProcess } from '../../apps/desktop/electron/system/__tests__/fixtures/cloud-service-process';
import {
  armCloudCrash,
  cloudAnchor,
  cloudInvoke,
  cloudLocalState,
  type CloudCrashPhase,
  connectCloud,
  decodeCloudAnchor,
  killCloudProcess,
} from './cloud-crash-helpers';
import { launchV25App, v25ShellPage } from './electron-helpers';

type Snapshot = {
  runs: Array<{ id: string; status: string }>;
  receipts: Array<{ cost_provenance: string; cost_points: number | null; idempotency_key: string }>;
  calls: Array<{ method: string; path: string; key: string | null }>;
  providerCalls: unknown[];
  assets: unknown[];
};

const scenarios: Array<{ phase: CloudCrashPhase; claimedCancel?: boolean }> = [
  { phase: 'before-claim' },
  { phase: 'claim-committed' },
  { phase: 'before-submit' },
  { phase: 'after-submit' },
  { phase: 'after-cancel' },
  { phase: 'after-cancel', claimedCancel: true },
  { phase: 'during-download' },
  { phase: 'before-file' },
  { phase: 'after-file' },
];

for (const { phase, claimedCancel = false } of scenarios) {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  test(`真实 Electron SIGKILL ${phase}${claimedCancel ? ' claimed' : ''}，新 PID 原 key 恢复不重发`, async ({}, testInfo) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires isolated Docker PostgreSQL services',
    );
    test.skip(
      process.platform === 'win32',
      'POSIX SIGSTOP/SIGKILL; Windows needs its own native crash matrix',
    );
    test.setTimeout(180000);
    const service = new CloudServiceProcess();
    let app: ElectronApplication | undefined;
    let userData = '';
    try {
      const info = await service.ready;
      const snapshot = () => service.request<Snapshot>('snapshot');
      const isCancel = phase === 'after-cancel';
      const noPost =
        phase === 'before-claim' || phase === 'before-submit' || phase === 'claim-committed';
      const hasImages = !noPost && !isCancel;
      if (claimedCancel) await service.request('configure', { holdProvider: true });
      if (claimedCancel || phase.includes('file') || phase === 'during-download')
        await service.request('startWorker');
      const launched = await launchV25App('musefold-cloud-crash-', {
        env: { MUSEFOLD_API_URL: info.baseUrl },
      });
      app = launched.app;
      userData = launched.userDataDir;
      let page = await v25ShellPage(app);
      await connectCloud(page);
      const initialAnchor = await cloudAnchor(app, userData);
      const marker = await armCloudCrash(app, userData, info.baseUrl, phase);
      const oldPid = app.process().pid;
      await page.getByTestId('nav-workbench').click();
      await page.getByTestId('composer-settings').click();
      await page.getByTestId('composer-count-4').click();
      await page.keyboard.press('Escape');
      await page.getByTestId('composer-prompt').fill('synthetic crash window four distinct images');
      // The target process can stop before Playwright finishes its click protocol roundtrip.
      const sending = page
        .getByTestId('composer-submit')
        .click()
        .catch((error: Error) => error.message);
      let cancelling: Promise<unknown> | undefined;
      if (isCancel) {
        await expect.poll(async () => (await snapshot()).runs.length).toBe(1);
        if (claimedCancel)
          await expect.poll(async () => (await snapshot()).providerCalls.length).toBe(1);
        const requestId = cloudLocalState(userData).records[0].requestId;
        cancelling = cloudInvoke(page, 'accountCloud.cancel', { requestId }).catch(
          (error: Error) => error.message,
        );
      }
      await expect.poll(() => existsSync(marker), { timeout: 20000 }).toBe(true);
      const hit = JSON.parse(readFileSync(marker, 'utf8'));
      expect(hit).toMatchObject({ phase, pid: oldPid });
      const encodedBefore = readFileSync(join(userData, 'managed-execution.anchor')).toString(
        'base64',
      );
      const before = cloudLocalState(userData);
      const remoteBefore = await snapshot();
      expect(before.records).toHaveLength(1);
      const original = before.records[0];
      if (phase === 'claim-committed') {
        expect(before.checkpoint).toEqual([
          expect.objectContaining({
            revision: hit.detail.committed.revision,
            head_hash: hit.detail.committed.headHash,
          }),
        ]);
      }
      expect(original.submissionState).toBe(phase === 'before-claim' ? 'unclaimed' : 'query_only');
      expect(before.assets).toHaveLength(0);
      expect(remoteBefore.runs).toHaveLength(noPost ? 0 : 1);
      if (isCancel) {
        expect(original.cancelRequestedAt).not.toBeNull();
        expect(original.cancelAcknowledgedAt).toBeNull();
        expect(hit.detail.status).toBe(200);
      }
      if (phase === 'after-submit') expect(hit.detail.status).toBe(201);
      const pictures = join(userData, 'Pictures');
      const diskBefore = existsSync(pictures)
        ? readdirSync(pictures).filter((name) => name.startsWith('cloud-'))
        : [];
      expect(diskBefore).toHaveLength(phase === 'after-file' ? 1 : 0);
      const exit = await killCloudProcess(app);
      app = undefined;
      await sending;
      await cancelling;
      if (phase === 'after-submit') {
        await service.request('startWorker');
        await expect
          .poll(async () => (await snapshot()).runs[0].status, { timeout: 20000 })
          .toBe('succeeded');
      }
      if (claimedCancel) await service.request('release');
      ({ app } = await launchV25App('unused-', {
        reuseUserDataDir: userData,
        env: { MUSEFOLD_API_URL: info.baseUrl },
      }));
      expect(app.process().pid).not.toBe(oldPid);
      page = await v25ShellPage(app);
      const anchorBefore = await decodeCloudAnchor(app, encodedBefore);
      if (phase === 'claim-committed') {
        expect(anchorBefore.pending).toMatchObject({ kind: 'submit', to: hit.detail.committed });
        expect(anchorBefore.committed.revision).toBe(hit.detail.committed.revision - 1);
      }
      const method = phase === 'before-claim' ? 'accountCloud.cancel' : 'accountCloud.reconcile';
      expect(await cloudInvoke(page, method, { requestId: original.requestId })).toMatchObject({
        ok: true,
      });
      if (hasImages) {
        await expect.poll(() => cloudLocalState(userData).assets.length).toBe(4);
        for (const [index, asset] of cloudLocalState(userData).assets.entries())
          expect(readFileSync(asset.media_path)).toEqual(Buffer.from(info.pngs[index], 'base64'));
      }
      const after = cloudLocalState(userData);
      const anchor = await cloudAnchor(app, userData);
      expect(anchor).toMatchObject({ mode: 'active', pending: null });
      expect(anchor.committed.namespace).toBe(initialAnchor.committed.namespace);
      expect(after.records[0]).toMatchObject({
        requestId: original.requestId,
        remoteKey: original.remoteKey,
        binding: original.binding,
      });
      expect(after.runs).toEqual([
        expect.objectContaining({
          status:
            phase === 'before-submit' || phase === 'claim-committed'
              ? 'running'
              : hasImages
                ? 'success'
                : 'cancelled',
          actual_cost: phase === 'before-claim' || (isCancel && !claimedCancel) ? 0 : null,
        }),
      ]);
      if (phase === 'before-submit') expect(after.records[0].receipt).toBeNull();
      const remote = await snapshot();
      expect(
        remote.calls.filter(
          (call) => call.method === 'POST' && call.path === '/api/v1/generations',
        ),
      ).toHaveLength(noPost ? 0 : 1);
      expect(remote.providerCalls).toHaveLength(hasImages || claimedCancel ? 1 : 0);
      expect(remote.assets).toHaveLength(hasImages ? 4 : 0);
      if (!noPost)
        expect(remote.receipts[0]).toMatchObject({
          idempotency_key: original.remoteKey,
          cost_provenance: isCancel && !claimedCancel ? 'not_sent' : 'unknown',
          cost_points: isCancel && !claimedCancel ? 0 : null,
        });
      // A second explicit recovery must reuse records and files as well as the remote request.
      expect(
        (await cloudInvoke(page, 'accountCloud.reconcile', { requestId: original.requestId })).ok,
      ).toBe(true);
      expect(cloudLocalState(userData).assets).toEqual(after.assets);
      expect(cloudLocalState(userData).runs).toEqual(after.runs);
      let afterProjection: unknown;
      if (hasImages) {
        const projectedPid = app.process().pid;
        const projectedExit = await killCloudProcess(app);
        app = undefined;
        ({ app } = await launchV25App('unused-', {
          reuseUserDataDir: userData,
          env: { MUSEFOLD_API_URL: info.baseUrl },
        }));
        expect(app.process().pid).not.toBe(projectedPid);
        page = await v25ShellPage(app);
        expect(
          (await cloudInvoke(page, 'accountCloud.reconcile', { requestId: original.requestId })).ok,
        ).toBe(true);
        expect(cloudLocalState(userData).assets).toEqual(after.assets);
        expect(cloudLocalState(userData).runs).toEqual(after.runs);
        expect((await snapshot()).providerCalls).toHaveLength(1);
        expect(
          (await snapshot()).calls.filter(
            (call) => call.method === 'POST' && call.path === '/api/v1/generations',
          ),
        ).toHaveLength(1);
        afterProjection = {
          observedAssetRows: 4,
          projectedPid,
          newPid: app.process().pid,
          exit: projectedExit,
        };
      }
      await testInfo.attach('cloud-crash-evidence.json', {
        body: JSON.stringify(
          {
            phase,
            claimedCancel,
            hit,
            oldPid,
            newPid: app.process().pid,
            exit,
            before,
            anchorBefore,
            after,
            anchor,
            diskBefore,
            remote,
            afterProjection,
            boundary:
              'Real macOS Electron/OS cipher/SQLite/Hono/PG/queue/worker. Synthetic identity, Provider/S3. Main test hooks pause exact window; parent SIGKILL. No paid upstream.',
          },
          (_key, value) =>
            typeof value === 'string' ? value.replaceAll(userData, '<test-userData>') : value,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      if (app) {
        // Kill only the original paused child if a pre-kill assertion failed.
        const marker = join(userData, 'test-crash-window.json');
        if (
          existsSync(marker) &&
          JSON.parse(readFileSync(marker, 'utf8')).pid === app.process().pid
        ) {
          await killCloudProcess(app);
          await app.close().catch(() => undefined);
        } else await app.close();
      }
      await service.stop();
      if (userData) rmSync(userData, { recursive: true, force: true });
    }
  });
}
