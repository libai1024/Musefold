import { rmSync, writeFileSync } from 'node:fs';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { newPromptDocumentSchema, type DesktopSyncStatus } from '@musefold/contracts';
import { launchV25App, v25ShellPage } from './electron-helpers';
import { createPrompt, clickRowAction } from './prompt-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';
import { DesktopSyncProcess } from './desktop-sync-process';
import {
  assertIsolatedCloud,
  emptyWorkspace,
  enable,
  invoke,
  localFacts,
  login,
  schemeFacts,
  settings,
  sync,
} from './desktop-sync-helpers';

const ownerRows = (facts: ReturnType<typeof localFacts>, owner: string) =>
  facts.prompts.filter((p) => p.workspaceId === `account:${owner}`);
const account = (facts: ReturnType<typeof localFacts>, owner: string) =>
  facts.accounts.find((a) => a.ownerId === owner);
const outbox = (facts: ReturnType<typeof localFacts>, owner: string) =>
  facts.outbox.filter((o) => o.ownerId === owner);
const syncCalls = (facts: Awaited<ReturnType<DesktopSyncProcess['snapshot']>>) =>
  facts.requests.filter((r) => r.path.startsWith('/api/v1/sync/'));

test.describe('D03.6 real Electron identity and sync isolation', () => {
  test.skip(
    process.env.RUN_DATABASE_TESTS !== 'true',
    'requires isolated PostgreSQL and production API process',
  );
  test.setTimeout(180000);
  let service: DesktopSyncProcess;
  let app: ElectronApplication | undefined;
  let directory: string;
  let baseUrl: string;
  let evidence: Record<string, unknown>;
  test.beforeEach(async () => {
    directory = '';
    evidence = {
      startedAt: new Date().toISOString(),
      provenance:
        'synthetic local data, real Electron/main/core/production API bin/Better Auth/PG; controlled New API; no paid generation',
    };
    service = new DesktopSyncProcess();
    const ready = await service.ready;
    baseUrl = ready.baseUrl;
    evidence.backend = ready;
    const launched = await launchV25App('musefold-real-sync-', {
      env: { MUSEFOLD_API_URL: baseUrl },
    });
    app = launched.app;
    directory = launched.userDataDir;
    await v25ShellPage(app);
    expect(app.process().pid).not.toBe(ready.apiPid);
    evidence.firstElectronPid = app.process().pid;
  });
  test.afterEach(async ({ browserName: _browserName }, info) => {
    let observationError: unknown;
    try {
      evidence.finishedAt = new Date().toISOString();
      evidence.test = info.title;
      if (directory) evidence.finalLocal = localFacts(directory);
      evidence.finalCloud = await service.snapshot();
    } catch (error) {
      observationError = error;
    }
    {
      const cleanup = await Promise.allSettled([app?.close(), service?.dispose()]);
      app = undefined;
      evidence.cleanup = cleanup.map((r) =>
        r.status === 'fulfilled' ? { status: r.status, result: r.value } : { status: r.status },
      );
      const path = info.outputPath('real-sync-identity.json');
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      await info.attach('real-sync-identity', { path, contentType: 'application/json' });
      if (directory) rmSync(directory, { recursive: true, force: true });
      for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
      if (observationError) throw observationError;
    }
  });

  test('A→B→A keeps explicit copy, paused outbox and machine-local schemes isolated across restart', async () => {
    if (!app) throw new Error('Electron missing');
    let page = await v25ShellPage(app);
    await page.getByTestId('nav-prompts').click();
    await createPrompt(page, '原本机庭院', '本机旧正文🌱');
    await app.close();
    app = undefined;
    seedFormalTextScheme(directory);
    const originalScheme = schemeFacts(directory);
    const sourcePrompts = localFacts(directory).prompts.filter(
      (p) => p.workspaceId === 'local-only-legacy',
    );
    const sourceContents = sourcePrompts.map((p) => p.content).sort();
    ({ app } = await launchV25App('musefold-real-sync-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: baseUrl },
    }));
    page = await v25ShellPage(app);
    const a = await login(page, 'b67-alice');
    expect(ownerRows(localFacts(directory), a)).toEqual([]);
    expect(localFacts(directory).workspaces.some((w) => w.ownerId === a)).toBe(false);
    await settings(page, 'sync');
    await expect(page.getByTestId('sync-consent-enable')).toHaveCount(0);
    expect(syncCalls(await service.snapshot())).toEqual([]);
    await page.getByRole('button', { name: '查看 离线提示词库', exact: true }).click();
    await expect(page.getByText('本机旧正文🌱', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '复制这份库到当前账号' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('不会删除原库');
    await page.getByRole('button', { name: '确认并在本机保存' }).click();
    await expect(page.getByTestId('sync-consent-enable')).toBeVisible();
    const copied = localFacts(directory);
    expect(
      ownerRows(copied, a)
        .map((p) => p.content)
        .sort(),
    ).toEqual(sourceContents);
    expect(copied.prompts.filter((p) => p.workspaceId === 'local-only-legacy')).toEqual(
      sourcePrompts,
    );
    expect(account(copied, a)?.consent).toBe('unset');
    expect(outbox(copied, a)).toEqual([]);
    expect(syncCalls(await service.snapshot())).toEqual([]);
    await enable(page);
    await page.getByTestId('sync-consent-pause').click();
    await expect(page.getByTestId('sync-phase')).toHaveText('已暂停');
    const callsPaused = syncCalls(await service.snapshot()).length;
    await page.getByTestId('nav-prompts').click();
    await clickRowAction(page, '原本机庭院', 'prompt-row-edit');
    await page.getByTestId('prompt-editor-content').fill('A暂停期间修改');
    await page.getByTestId('prompt-editor-submit').click();
    await expect(page.getByTestId('prompt-editor')).toBeHidden();
    await createPrompt(page, 'A待推送新内容', '只属于A');
    const paused = localFacts(directory);
    expect(outbox(paused, a)).toHaveLength(2);
    await page.waitForTimeout(2300);
    expect(syncCalls(await service.snapshot())).toHaveLength(callsPaused);
    const b = await login(page, 'b67-bob');
    expect(b).not.toBe(a);
    expect(ownerRows(localFacts(directory), b)).toEqual([]);
    expect(localFacts(directory).workspaces.some((w) => w.ownerId === b)).toBe(false);
    expect(account(localFacts(directory), b)?.consent).toBe('unset');
    expect(outbox(localFacts(directory), a)).toEqual(outbox(paused, a));
    expect(syncCalls(await service.snapshot())).toHaveLength(callsPaused);
    await emptyWorkspace(page);
    await enable(page);
    await page.getByTestId('nav-prompts').click();
    await expect(page.getByText('原本机庭院', { exact: true })).toHaveCount(0);
    await createPrompt(page, 'B自己的提示词', '只属于B');
    await sync(page);
    const beforeReturn = await assertIsolatedCloud(service);
    const cloudA = beforeReturn.owners.find((o) => o.upstreamOwner === '42')?.id;
    const cloudB = beforeReturn.owners.find((o) => o.upstreamOwner === '43')?.id;
    expect(
      beforeReturn.prompts
        .filter((p) => p.ownerId === cloudA)
        .map((p) => p.content)
        .sort(),
    ).toEqual(sourceContents);
    expect(beforeReturn.prompts.filter((p) => p.ownerId === cloudB).map((p) => p.content)).toEqual([
      '只属于B',
    ]);
    expect(await login(page, 'b67-alice')).toBe(a);
    await settings(page, 'sync');
    await expect(page.getByTestId('sync-phase')).toHaveText('已暂停');
    expect(account(localFacts(directory), a)).toEqual({ ...account(paused, a), active: 1 });
    expect(outbox(localFacts(directory), a)).toEqual(outbox(paused, a));
    await page.getByTestId('sync-consent-resume').click();
    await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
    expect(outbox(localFacts(directory), a)).toEqual([]);
    const final = await assertIsolatedCloud(service);
    expect(
      final.prompts
        .filter((p) => p.ownerId === cloudA)
        .map((p) => p.content)
        .sort(),
    ).toEqual(
      [
        ...sourcePrompts.filter((p) => p.title !== '原本机庭院').map((p) => p.content),
        'A暂停期间修改',
        '只属于A',
      ].sort(),
    );
    expect(final.prompts.filter((p) => p.ownerId === cloudB)).toEqual(
      beforeReturn.prompts.filter((p) => p.ownerId === cloudB),
    );
    expect(schemeFacts(directory)).toEqual(originalScheme);
    const beforeRestart = localFacts(directory);
    const previousPid = app.process().pid;
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-real-sync-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: baseUrl },
    }));
    expect(app.process().pid).not.toBe(previousPid);
    page = await v25ShellPage(app);
    await settings(page, 'sync');
    await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
    const restarted = localFacts(directory);
    expect(account(restarted, a)).toEqual(account(beforeRestart, a));
    expect(restarted.prompts).toEqual(beforeRestart.prompts);
    expect(restarted.integrity).toBe('ok');
    expect(restarted.foreignKeys).toEqual([]);
    expect(schemeFacts(directory)).toEqual(originalScheme);
    await page.getByTestId('nav-design-schemes').click();
    await expect(page.getByText('E2E 文本海报方案', { exact: true })).toBeVisible();
    evidence.flow = {
      a,
      b,
      copied,
      paused,
      beforeReturn,
      final,
      beforeRestart,
      restarted,
      previousPid,
      newPid: app.process().pid,
      originalScheme,
    };
  });

  test('an actual expired server session blocks sync without losing the local queue; real login recovers it', async () => {
    if (!app) throw new Error('Electron missing');
    const page = await v25ShellPage(app);
    const owner = await login(page, 'b67-alice');
    await emptyWorkspace(page);
    await enable(page);
    const before = account(localFacts(directory), owner);
    expect((await service.expireSession('42')).expired).toBe(1);
    // Keep the account query mounted and invoke actual IPC to observe auth_blocked
    // before an unrelated account refresh may deliberately sign the user out.
    await invoke(
      page,
      'prompts.create',
      newPromptDocumentSchema.parse({
        title: '过期期间保留',
        content: '重新登录后继续',
        description: null,
        negative: null,
        folderId: null,
        modelId: null,
        params: null,
        sourceUrl: null,
      }),
    );
    const blocked = await invoke<DesktopSyncStatus>(page, 'sync.syncNow');
    expect(blocked).toMatchObject({
      phase: 'auth_blocked',
      consent: 'enabled',
      pendingMutations: 1,
    });
    await expect(page.getByTestId('sync-phase')).toHaveText('登录失效', { timeout: 10000 });
    const pending = outbox(localFacts(directory), owner);
    expect(pending).toHaveLength(1);
    expect((await service.snapshot()).prompts).toEqual([]);
    expect(
      (await service.snapshot()).requests.some(
        (r) => r.path.startsWith('/api/v1/sync/') && r.status === 401,
      ),
    ).toBe(true);
    expect(await login(page, 'b67-alice')).toBe(owner);
    await settings(page, 'sync');
    await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
    expect(outbox(localFacts(directory), owner)).toEqual([]);
    expect(account(localFacts(directory), owner)?.deviceId).toBe(before?.deviceId);
    const cloud = await assertIsolatedCloud(service);
    expect(cloud.prompts.map((p) => p.content)).toEqual(['重新登录后继续']);
    expect(cloud.receipts.map((r) => r.mutationId)).toEqual(pending.map((m) => m.mutationId));
    evidence.recovery = { owner, before, blocked, pending, cloud };
  });

  test('an A push committed before account switch cannot deliver its late result into B', async () => {
    if (!app) throw new Error('Electron missing');
    const page = await v25ShellPage(app);
    const a = await login(page, 'b67-alice');
    await emptyWorkspace(page);
    await enable(page);
    await service.holdPush();
    await page.getByTestId('nav-prompts').click();
    await createPrompt(page, 'A已提交但回包未到', '迟到结果只属于A');
    await expect
      .poll(async () => (await service.snapshot()).heldResponses.length, { timeout: 15000 })
      .toBe(1);
    const committed = await service.snapshot();
    expect(committed.prompts).toHaveLength(1);
    const pendingA = outbox(localFacts(directory), a);
    expect(pendingA).toHaveLength(1);
    const b = await login(page, 'b67-bob');
    expect(outbox(localFacts(directory), a)).toEqual(pendingA);
    await emptyWorkspace(page);
    await enable(page);
    await page.getByTestId('nav-prompts').click();
    await createPrompt(page, 'B在迟到期间的新内容', 'B独立内容');
    await sync(page);
    const beforeRelease = localFacts(directory);
    const cloudBeforeRelease = await service.snapshot();
    await service.releasePush();
    await page.waitForTimeout(2300);
    expect(ownerRows(localFacts(directory), b)).toEqual(ownerRows(beforeRelease, b));
    expect(outbox(localFacts(directory), a)).toEqual(pendingA);
    expect((await service.snapshot()).prompts).toEqual(cloudBeforeRelease.prompts);
    expect(await login(page, 'b67-alice')).toBe(a);
    await settings(page, 'sync');
    await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
    expect(outbox(localFacts(directory), a)).toEqual([]);
    const cloud = await assertIsolatedCloud(service);
    expect(cloud.prompts).toEqual(cloudBeforeRelease.prompts);
    expect(cloud.receipts.filter((r) => r.mutationId === pendingA[0].mutationId)).toHaveLength(1);
    expect(cloud.heldResponses).toEqual([{ released: true }]);
    evidence.lateResponse = { a, b, committed, pendingA, beforeRelease, cloudBeforeRelease, cloud };
  });
});
