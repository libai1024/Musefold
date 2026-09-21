import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  newPromptDocumentSchema,
  type PromptDocument,
  type PromptFolder,
  type PromptTag,
  type SyncConflictSummary,
} from '@musefold/contracts';
import { launchV25App, v25ShellPage, type V25App } from './electron-helpers';
import { DesktopSyncProcess } from './desktop-sync-process';
import {
  assertIsolatedCloud,
  emptyWorkspace,
  enable,
  invoke,
  localFacts,
  login,
  settings,
  sync,
} from './desktop-sync-helpers';

for (const history of ['retained-log', 'expired-log'] as const) {
  test(`cloud permanent deletion survives offline edits and restart; desktop rejects local resurrection and keeps Prompt content (${history})`, async ({
    browserName: _browserName,
  }, info) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires owned API/Better Auth/PostgreSQL',
    );
    test.setTimeout(180000);
    const service = new DesktopSyncProcess();
    const clients: V25App[] = [];
    const evidence: Record<string, unknown> = {
      provenance:
        'two independent Electron/userData/device IDs, real API bin/Better Auth/PostgreSQL, real local edits while sync paused and new PID; controlled identity upstream; no paid provider or injected conflict snapshots',
    };
    let failure: unknown;
    try {
      const ready = await service.ready;
      evidence.backend = ready;
      const start = (reuseUserDataDir?: string) =>
        launchV25App('musefold-taxonomy-conflict-', {
          reuseUserDataDir,
          env: { MUSEFOLD_API_URL: ready.baseUrl },
        });
      const first = await start();
      clients.push(first);
      const a = await v25ShellPage(first.app);
      const owner = await login(a, 'b67-alice');
      await emptyWorkspace(a);
      await enable(a);
      const folder = await invoke<PromptFolder>(a, 'prompts.createFolder', {
        name: 'CloudDeletedFolder',
        parentId: null,
        sortOrder: 0,
      });
      const tag = await invoke<PromptTag>(a, 'prompts.createTag', {
        name: 'CloudDeletedTag',
        group: null,
        color: null,
      });
      const prompt = await invoke<PromptDocument>(
        a,
        'prompts.create',
        newPromptDocumentSchema.parse({
          title: 'Retained work',
          content: 'Retained content across deletion',
          description: null,
          negative: null,
          modelId: null,
          params: null,
          folderId: folder.id,
          tagIds: [tag.id],
        }),
      );
      await sync(a);
      const second = await start();
      clients.push(second);
      let b = await v25ShellPage(second.app);
      expect(await login(b, 'b67-alice')).toBe(owner);
      await emptyWorkspace(b);
      await enable(b);
      const devices = clients.map((client) => localFacts(client.userDataDir).accounts[0]?.deviceId);
      expect(devices[0]).toBeTruthy();
      expect(devices[1]).toBeTruthy();
      expect(devices[0]).not.toBe(devices[1]);
      evidence.devices = devices;
      const pause = async (page: Page) => {
        await page.bringToFront();
        await settings(page, 'sync');
        await page.getByTestId('sync-consent-pause').click();
        await expect(page.getByTestId('sync-phase')).toHaveText('已暂停');
      };
      await pause(b);
      await invoke(b, 'prompts.updateFolder', {
        id: folder.id,
        patch: { name: 'Offline folder edit', expectedVersion: 1 },
      });
      await invoke(b, 'prompts.updateTag', {
        id: tag.id,
        patch: { name: 'Offline tag edit', expectedVersion: 1 },
      });
      evidence.offlineOutbox = localFacts(second.userDataDir).outbox;
      await invoke(a, 'prompts.removeFolder', { id: folder.id });
      await invoke(a, 'prompts.removeTag', { id: tag.id });
      await sync(a);
      await pause(a);
      const cloud = await assertIsolatedCloud(service);
      expect(cloud.classifications).toEqual([]);
      expect(cloud.taxonomyTombstones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'folder', id: folder.id, version: 2 }),
          expect.objectContaining({ kind: 'tag', id: tag.id, version: 2 }),
        ]),
      );
      evidence.cloudAfterDeletion = cloud;
      if (history === 'expired-log') {
        const trim = await service.trimSyncHistory();
        expect(trim.counts).toEqual({ logs: 0, receipts: 0, markers: 2 });
        expect(trim.pid).not.toBe(ready.apiPid);
        evidence.retention = trim;
      }

      await b.bringToFront();
      await b.getByTestId('sync-consent-resume').click();
      if (history === 'expired-log') {
        await expect(b.getByTestId('sync-phase')).toHaveText('出错', { timeout: 15000 });
        expect(
          (await service.snapshot()).requests.some(
            (r) => r.path === '/api/v1/sync/pull' && r.status === 410,
          ),
        ).toBe(true);
        await b.getByTestId('sync-now').click();
      }
      await expect(b.getByTestId('sync-phase')).toHaveText('有冲突', { timeout: 15000 });
      await pause(b);
      const beforeRestart = await invoke<SyncConflictSummary[]>(b, 'sync.listConflicts');
      expect(beforeRestart.map((c) => c.entityType).sort()).toEqual(['folder', 'tag']);
      expect(beforeRestart.every((c) => c.remoteSnapshot.deletedAt != null)).toBe(true);
      const oldPid = second.app.process().pid;
      await second.app.close();
      const restarted = await start(second.userDataDir);
      clients[1] = restarted;
      b = await v25ShellPage(restarted.app);
      expect(restarted.app.process().pid).not.toBe(oldPid);
      evidence.restartPids = [oldPid, restarted.app.process().pid];
      await settings(b, 'sync');
      await expect(b.getByTestId('sync-phase')).toHaveText('已暂停');
      const conflicts = await invoke<SyncConflictSummary[]>(b, 'sync.listConflicts');
      expect(conflicts).toEqual(beforeRestart);
      const beforeReject = localFacts(restarted.userDataDir);
      const syncRequests = (await service.snapshot()).requests.filter((r) =>
        r.path.startsWith('/api/v1/sync/'),
      ).length;
      for (const conflict of conflicts) {
        const row = b.getByTestId(`sync-conflict-row-${conflict.id}`);
        await expect(row.getByRole('button', { name: '保留本地', exact: true })).toBeDisabled();
        await expect(row).toContainText('此分类已在云端永久删除，无法恢复。');
        await expect(row.getByRole('button', { name: '另存本地副本' })).toHaveCount(0);
        await row.screenshot({
          path: info.outputPath(`${conflict.entityType}-permanent-conflict.png`),
        });
        await expect(
          invoke(b, 'sync.resolveConflict', {
            conflictId: conflict.id,
            resolution: 'local',
          }),
        ).rejects.toThrow('VALIDATION_FAILED');
      }
      expect(localFacts(restarted.userDataDir)).toEqual(beforeReject);
      expect(await invoke(b, 'sync.listConflicts')).toEqual(conflicts);
      expect(
        (await service.snapshot()).requests.filter((r) => r.path.startsWith('/api/v1/sync/'))
          .length,
      ).toBe(syncRequests);
      for (const conflict of conflicts) {
        const row = b.getByTestId(`sync-conflict-row-${conflict.id}`);
        await row.getByRole('button', { name: '保留云端', exact: true }).click();
        await expect(row).toHaveCount(0);
      }
      expect(await invoke(b, 'prompts.listFolders')).toEqual([]);
      expect(await invoke(b, 'prompts.listTags')).toEqual([]);
      expect(await invoke(b, 'prompts.get', { id: prompt.id })).toMatchObject({
        content: prompt.content,
        folderId: null,
        tags: [],
        deletedAt: null,
      });
      await b.getByTestId('sync-consent-resume').click();
      await expect(b.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
      await sync(b);
      expect(localFacts(restarted.userDataDir).outbox).toEqual([]);
      expect(await invoke(b, 'sync.listConflicts')).toEqual([]);
      evidence.finalCloud = await assertIsolatedCloud(service);
      expect((await service.snapshot()).classifications).toEqual([]);
      for (const client of clients) {
        expect(localFacts(client.userDataDir).integrity).toBe('ok');
        expect(localFacts(client.userDataDir).foreignKeys).toEqual([]);
      }
    } catch (error) {
      failure = error;
    } finally {
      try {
        evidence.local = clients.map((client) => localFacts(client.userDataDir));
        evidence.cloudAtCleanup = await service.snapshot();
      } catch (error) {
        failure ??= error;
      }
      const cleanup = await Promise.allSettled([
        ...clients.map((c) => c.app.close()),
        service.dispose(),
      ]);
      evidence.cleanup = cleanup.map((r) =>
        r.status === 'fulfilled' ? { status: r.status, result: r.value } : { status: r.status },
      );
      const path = info.outputPath('permanent-taxonomy-conflicts.json');
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      await info.attach('permanent-taxonomy-conflicts', { path, contentType: 'application/json' });
      for (const c of clients) rmSync(c.userDataDir, { recursive: true, force: true });
      for (const result of cleanup) if (result.status === 'rejected') failure ??= result.reason;
    }
    if (failure) throw failure;
  });
}
