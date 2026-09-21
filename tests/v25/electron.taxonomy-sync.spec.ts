import { rmSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import {
  newPromptDocumentSchema,
  type PromptDocument,
  type PromptFolder,
  type PromptPage,
  type PromptTag,
} from '@musefold/contracts';
import { desktopDbPath, launchV25App, v25ShellPage, type V25App } from './electron-helpers';
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

const folders = (page: Page) => invoke<PromptFolder[]>(page, 'prompts.listFolders');
const tags = (page: Page) => invoke<PromptTag[]>(page, 'prompts.listTags');
const prompt = (page: Page, id: string) => invoke<PromptDocument>(page, 'prompts.get', { id });
const search = (page: Page, q: string) =>
  invoke<PromptPage>(page, 'prompts.list', { q, limit: 100 });

for (const history of ['retained-log', 'expired-log'] as const) {
  test(`two real desktop clients preserve taxonomy descendants, FTS and pending deletion across sync and restart (${history})`, async ({
    browserName: _browserName,
  }, info) => {
    test.skip(
      process.env.RUN_DATABASE_TESTS !== 'true',
      'Requires owned API/Better Auth/PostgreSQL',
    );
    test.setTimeout(180000);
    const service = new DesktopSyncProcess();
    const clients: V25App[] = [];
    let failure: unknown;
    const evidence: Record<string, unknown> = {
      provenance:
        'two independent Electron processes/userData/device IDs; production API bin/Better Auth/PG; controlled account upstream; owned SQLite DELETE trigger for one storage failure; no paid generation',
    };
    try {
      const ready = await service.ready;
      evidence.backend = ready;
      const start = async (reuseUserDataDir?: string) =>
        launchV25App('musefold-taxonomy-sync-', {
          reuseUserDataDir,
          env: { MUSEFOLD_API_URL: ready.baseUrl },
        });
      const first = await start();
      clients.push(first);
      const a = await v25ShellPage(first.app);
      const owner = await login(a, 'b67-alice');
      await emptyWorkspace(a);
      await enable(a);
      const createFolder = (name: string, parentId: string | null) =>
        invoke<PromptFolder>(a, 'prompts.createFolder', { name, parentId, sortOrder: 0 });
      const root = await createFolder('ParentFolder', null);
      const child = await createFolder('ChildFolder', root.id);
      const grandchild = await createFolder('GrandchildFolder', child.id);
      const oldTag = await invoke<PromptTag>(a, 'prompts.createTag', {
        name: 'Olduniquetag',
        group: null,
        color: null,
      });
      const keptTag = await invoke<PromptTag>(a, 'prompts.createTag', {
        name: 'Keptuniquetag',
        group: null,
        color: null,
      });
      const create = (title: string, folderId: string) =>
        invoke<PromptDocument>(
          a,
          'prompts.create',
          newPromptDocumentSchema.parse({
            title,
            content: 'Preservedbody',
            description: null,
            negative: null,
            folderId,
            tagIds: [oldTag.id, keptTag.id],
            modelId: null,
            params: null,
          }),
        );
      const live = await create('LivePrompt', root.id);
      const deleted = await create('DeletedPrompt', root.id);
      const nested = await create('NestedPrompt', grandchild.id);
      await sync(a);

      const second = await start();
      clients.push(second);
      let b = await v25ShellPage(second.app);
      expect(await login(b, 'b67-alice')).toBe(owner);
      await emptyWorkspace(b);
      await enable(b);
      expect(first.userDataDir).not.toBe(second.userDataDir);
      expect(first.app.process().pid).not.toBe(second.app.process().pid);
      const accountA = localFacts(first.userDataDir).accounts.find((row) => row.ownerId === owner);
      const accountB = localFacts(second.userDataDir).accounts.find((row) => row.ownerId === owner);
      expect(accountA?.deviceId).toBeTruthy();
      expect(accountB?.deviceId).toBeTruthy();
      expect(accountA?.deviceId).not.toBe(accountB?.deviceId);
      expect(await folders(b)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: child.id, parentId: root.id }),
          expect.objectContaining({ id: grandchild.id, parentId: child.id }),
        ]),
      );
      expect((await search(b, 'Olduniquetag')).items).toHaveLength(3);
      await invoke(b, 'prompts.updateTag', {
        id: oldTag.id,
        patch: { name: 'Newuniquetag', expectedVersion: 1 },
      });
      await invoke(b, 'prompts.updateFolder', {
        id: root.id,
        patch: { name: 'RenamedParent', expectedVersion: 1 },
      });
      await sync(b);
      await sync(a);
      expect((await search(a, 'Olduniquetag')).items).toHaveLength(0);
      expect((await search(a, 'Newuniquetag')).items).toHaveLength(3);
      expect(await folders(a)).toContainEqual(
        expect.objectContaining({ id: root.id, name: 'RenamedParent' }),
      );

      // Pause the other client too before comparing aggregate proxy counts: its queued
      // post-write debounce is legitimate traffic and must not be attributed to A.
      await settings(b, 'sync');
      await b.getByTestId('sync-consent-pause').click();
      await expect(b.getByTestId('sync-phase')).toHaveText('已暂停');

      await a.bringToFront();
      await settings(a, 'sync');
      await a.getByTestId('sync-consent-pause').click();
      await expect(a.getByTestId('sync-phase')).toHaveText('已暂停');
      const pausedRequests = (await service.snapshot()).requests.filter((r) =>
        r.path.startsWith('/api/v1/sync/'),
      ).length;
      const transient = await createFolder('NeverUploaded', null);
      await invoke(a, 'prompts.removeFolder', { id: transient.id });
      expect(
        localFacts(first.userDataDir).outbox.some((row) => row.entityId === transient.id),
      ).toBe(false);
      await invoke(a, 'prompts.remove', { id: deleted.id });
      const originalDeletion = localFacts(first.userDataDir).outbox.find(
        (row) => row.entityId === deleted.id,
      );
      expect(originalDeletion).toBeTruthy();
      await a.getByTestId('nav-prompts').click();
      await a.getByTestId('taxonomy-open').click();
      const removeRoot = a.getByRole('button', { name: '删除文件夹 RenamedParent', exact: true });
      await removeRoot.click();
      const dialog = a.getByTestId('taxonomy-delete-dialog');
      await expect(dialog).toContainText('提示词和子文件夹会保留');
      await dialog.screenshot({ path: info.outputPath('desktop-taxonomy-confirmation.png') });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(removeRoot).toBeFocused();
      expect(await folders(a)).toHaveLength(3);
      await removeRoot.click();
      await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(removeRoot).toHaveCount(0);

      // Fail the actual database mutation; the transaction must roll back and the UI must retain its target.
      const ownDb = new Database(desktopDbPath(first.userDataDir));
      try {
        ownDb.exec(
          "CREATE TRIGGER b74_delete_failure BEFORE DELETE ON tags BEGIN SELECT RAISE(ABORT, 'taxonomy_test_storage_failure'); END",
        );
        await a.getByTestId('taxonomy-tag-name').fill('UnsubmittedName');
        await a.getByRole('button', { name: '删除标签 Newuniquetag', exact: true }).click();
        await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
        await expect(a.locator('[data-sonner-toast][data-type="error"]')).toContainText(
          '主进程处理失败',
        );
        await expect(dialog).toBeVisible();
        expect(await tags(a)).toContainEqual(expect.objectContaining({ id: oldTag.id }));
        expect((await search(a, 'Newuniquetag')).items).toHaveLength(2);
      } finally {
        ownDb.exec('DROP TRIGGER IF EXISTS b74_delete_failure');
        ownDb.close();
      }
      await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(a.getByTestId('taxonomy-tag-name')).toHaveValue('UnsubmittedName');
      expect(
        localFacts(first.userDataDir).outbox.find((row) => row.entityId === deleted.id)?.mutationId,
      ).toBe(originalDeletion?.mutationId);
      await a.keyboard.press('Escape');
      await expect(invoke(a, 'sync.syncNow')).rejects.toThrow('VALIDATION_FAILED');
      expect(
        (await service.snapshot()).requests.filter((r) => r.path.startsWith('/api/v1/sync/'))
          .length,
      ).toBe(pausedRequests);
      expect(await folders(b)).toHaveLength(3);
      expect((await prompt(b, deleted.id)).deletedAt).toBeNull();
      await settings(a, 'sync');
      await a.getByTestId('sync-consent-resume').click();
      await expect(a.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
      await sync(a);
      if (history === 'expired-log') {
        const trim = await service.trimSyncHistory();
        expect(trim.counts.logs).toBe(0);
        expect(trim.counts.receipts).toBe(0);
        expect(trim.counts.markers).toBe(2);
        evidence.retention = trim;
      }
      await b.bringToFront();
      await settings(b, 'sync');
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
      await expect(b.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
      await sync(b);

      const assertFinal = async (page: Page) => {
        expect(await folders(page)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: child.id, parentId: null }),
            expect.objectContaining({ id: grandchild.id, parentId: child.id }),
          ]),
        );
        expect(await folders(page)).toHaveLength(2);
        expect(await tags(page)).toEqual([expect.objectContaining({ id: keptTag.id })]);
        expect(await prompt(page, live.id)).toMatchObject({
          folderId: null,
          content: 'Preservedbody',
          deletedAt: null,
          tags: [expect.objectContaining({ id: keptTag.id })],
        });
        expect(await prompt(page, nested.id)).toMatchObject({
          folderId: grandchild.id,
          deletedAt: null,
        });
        expect((await prompt(page, deleted.id)).deletedAt).not.toBeNull();
        expect((await search(page, 'Newuniquetag')).items).toHaveLength(0);
        expect((await search(page, 'Keptuniquetag')).items).toHaveLength(2);
        expect((await search(page, 'Preservedbody')).items).toHaveLength(2);
        expect(
          (await invoke<PromptPage>(page, 'prompts.list', { deletedOnly: true })).items.map(
            (p) => p.id,
          ),
        ).toEqual([deleted.id]);
      };
      await assertFinal(a);
      await assertFinal(b);
      const firstPid = second.app.process().pid;
      await second.app.close();
      const restarted = await start(second.userDataDir);
      clients[1] = restarted;
      b = await v25ShellPage(restarted.app);
      expect(restarted.app.process().pid).not.toBe(firstPid);
      await sync(b);
      await assertFinal(b);
      for (const client of clients) {
        const facts = localFacts(client.userDataDir);
        expect(facts.outbox).toEqual([]);
        expect(facts.integrity).toBe('ok');
        expect(facts.foreignKeys).toEqual([]);
      }
      evidence.devices = [accountA?.deviceId, accountB?.deviceId];
      evidence.restartPids = [firstPid, restarted.app.process().pid];
      evidence.finalFolders = await folders(b);
      evidence.finalTags = await tags(b);
      evidence.cloud = await assertIsolatedCloud(service);
    } catch (error) {
      failure = error;
    } finally {
      try {
        evidence.local = clients.map((c) => localFacts(c.userDataDir));
        evidence.conflicts = clients.map((c) => {
          const db = new Database(desktopDbPath(c.userDataDir), { readonly: true });
          try {
            return db
              .prepare(
                'SELECT entity_type,entity_id,base_version,local_snapshot_json,remote_snapshot_json FROM cloud_sync_conflicts WHERE resolved_at IS NULL',
              )
              .all();
          } finally {
            db.close();
          }
        });
        evidence.finalCloud = await service.snapshot();
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
      const path = info.outputPath('two-client-taxonomy.json');
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      await info.attach('two-client-taxonomy', { path, contentType: 'application/json' });
      for (const c of clients) rmSync(c.userDataDir, { recursive: true, force: true });
      for (const r of cleanup) if (r.status === 'rejected') failure ??= r.reason;
    }
    if (failure) throw failure;
  });
}
