import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import type { BridgeEnvelope } from '../../apps/desktop/electron/main/ipc-v25/envelope';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

/** First-party loopback transport. Records routes only, never credentials or prompt bodies. */
async function apiFixture() {
  let baseUrl = '';
  const syncRequests: string[] = [];
  const sessions = new Map<string, { username: string; principalId: string }>();
  let sequence = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : {};
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    response.setHeader('content-type', 'application/json');
    const send = (value: unknown) => response.end(JSON.stringify(value));
    if (path === '/api/auth/sign-in/new-api') {
      const token = `workspace-fixture-session-${++sequence}`;
      sessions.set(`Bearer ${token}`, {
        username: body.email,
        principalId: body.email === 'second-creator' ? 'second-principal' : 'verified-principal',
      });
      return send({ token });
    }
    const session = sessions.get(request.headers.authorization ?? '');
    if (!session) {
      response.statusCode = 401;
      return send({ error: { code: 'AUTH_REQUIRED', message: 'fixture session required' } });
    }
    if (path === '/api/v1/account/status')
      return send({
        id: 'old-upstream-id',
        username: session.username,
        displayName: '已验证账号',
        quota: 500_000,
        quotaUnit: '点',
        canGenerate: true,
        identity: {
          apiIssuer: baseUrl,
          principalId: session.principalId,
          status: 'active',
          identityVersion: 1,
        },
        recovery: null,
      });
    if (path.startsWith('/api/v1/sync/')) syncRequests.push(path);
    if (path === '/api/v1/sync/devices')
      return send({ ...body, revoked: false, lastPullCursor: '0' });
    if (path === '/api/v1/sync/bootstrap')
      return send({ snapshotCursor: '1', items: [], nextPage: null });
    if (path === '/api/v1/sync/pull') return send({ changes: [], nextCursor: '1', hasMore: false });
    if (path === '/api/v1/sync/push')
      return send({
        results: body.mutations.map((mutation: { mutationId: string }) => ({
          mutationId: mutation.mutationId,
          status: 'applied',
          version: 1,
          snapshot: null,
          errorCode: null,
        })),
      });
    if (path === '/api/v1/sync/usage')
      return send({
        results: body.events.map((event: { eventId: string }) => ({
          eventId: event.eventId,
          status: 'applied',
          errorCode: null,
        })),
      });
    response.statusCode = 404;
    return send({ error: { code: 'NOT_FOUND', message: 'fixture route unavailable' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    syncRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const OLD_SCOPE = 'account:old-upstream-id';
function seedHistoricalContainer(directory: string) {
  const db = new Database(desktopDbPath(directory));
  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO local_workspaces (id,owner_id,kind,created_at,updated_at) VALUES (?, 'old-upstream-id', 'account', 1, 1)`,
      ).run(OLD_SCOPE);
      db.prepare(`INSERT INTO cloud_sync_accounts (owner_id,username,device_id,device_name,platform,client_version,active,enabled,consent_state,created_at,updated_at)
        VALUES ('old-upstream-id','历史账号名称','old-device','旧设备','macos','2.1',0,1,'enabled',1,1)`).run();
      db.prepare(
        `INSERT INTO folders (workspace_id,id,name,created_at) VALUES (?, 'old-folder','旧收藏',1)`,
      ).run(OLD_SCOPE);
      db.prepare(
        `INSERT INTO tags (workspace_id,id,name,created_at) VALUES (?, 'old-tag','旧标签',1)`,
      ).run(OLD_SCOPE);
      db.prepare(`INSERT INTO prompts (workspace_id,id,title,content,folder_id,usage_count,last_used_at,created_at,updated_at)
        VALUES (?, 'old-prompt','保留的旧庭院','旧库真实内容：庭院与薄雾','old-folder',7,5,1,2)`).run(
        OLD_SCOPE,
      );
      db.prepare(
        `INSERT INTO prompt_tags (workspace_id,prompt_id,tag_id) VALUES (?, 'old-prompt','old-tag')`,
      ).run(OLD_SCOPE);
      db.prepare(`INSERT INTO cloud_sync_outbox (mutation_id,owner_id,workspace_id,entity_type,entity_id,operation,payload_json,created_at)
        VALUES ('old-mutation','old-upstream-id',?,'prompt','old-prompt','update','{}',1)`).run(
        OLD_SCOPE,
      );
    })();
  } finally {
    db.close();
  }
}
function readLocalFacts(directory: string, owner: string) {
  const db = new Database(desktopDbPath(directory), { readonly: true });
  try {
    return {
      source: db
        .prepare('SELECT title,content,usage_count FROM prompts WHERE workspace_id = ?')
        .all(OLD_SCOPE),
      target: db
        .prepare('SELECT title,content,usage_count FROM prompts WHERE workspace_id = ?')
        .all(`account:${owner}`),
      oldConsent: db
        .prepare('SELECT consent_state,active FROM cloud_sync_accounts WHERE owner_id = ?')
        .get('old-upstream-id'),
      targetConsent: db
        .prepare('SELECT consent_state FROM cloud_sync_accounts WHERE owner_id = ?')
        .get(owner),
      oldOutbox: db
        .prepare('SELECT COUNT(*) AS count FROM cloud_sync_outbox WHERE workspace_id = ?')
        .get(OLD_SCOPE),
      targetOutbox: db
        .prepare('SELECT COUNT(*) AS count FROM cloud_sync_outbox WHERE workspace_id = ?')
        .get(`account:${owner}`),
    };
  } finally {
    db.close();
  }
}
async function settings(page: Page, section: 'account' | 'sync') {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId(`settings-nav-${section}`).click();
}

test('旧 SQLite 账号容器可查看并明确复制到验证后的新主体，重启后仍需首次同步同意', async () => {
  const api = await apiFixture();
  let app: ElectronApplication | undefined;
  let directory: string | undefined;
  try {
    const first = await launchV25App('musefold-local-workspace-', {
      env: { MUSEFOLD_API_URL: api.baseUrl },
    });
    app = first.app;
    directory = first.userDataDir;
    await v25ShellPage(app);
    await app.close();
    app = undefined;
    seedHistoricalContainer(directory);
    ({ app } = await launchV25App('musefold-local-workspace-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: api.baseUrl },
    }));
    let page = await v25ShellPage(app);
    await settings(page, 'account');
    await page.getByTestId('account-username').fill('verified-creator');
    await page.getByTestId('account-password').fill('synthetic-password');
    await page.getByTestId('account-auth-submit').click();
    await expect(page.getByTestId('account-signed-in')).toBeVisible();
    const owner = createHash('sha256')
      .update(JSON.stringify(['principal', api.baseUrl, 'verified-principal']))
      .digest('hex');
    expect(readLocalFacts(directory, owner).target).toEqual([]);
    await settings(page, 'sync');
    await page.getByRole('button', { name: '查看 本机账号提示词库 · 历史账号名称' }).click();
    await expect(page.getByText('旧库真实内容：庭院与薄雾', { exact: true })).toBeVisible();
    expect(api.syncRequests).toEqual([]);
    await page.getByRole('button', { name: '复制这份库到当前账号' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('不会删除原库');
    expect(readLocalFacts(directory, owner).target).toEqual([]);
    await page.getByRole('button', { name: '确认并在本机保存' }).click();
    await expect(page.getByTestId('sync-consent-enable')).toBeVisible();
    const copied = readLocalFacts(directory, owner);
    expect(copied.target).toEqual(copied.source);
    expect(copied.target).toHaveLength(1);
    expect(copied.oldConsent).toEqual({ consent_state: 'enabled', active: 0 });
    expect(copied.targetConsent).toEqual({ consent_state: 'unset' });
    expect(copied.oldOutbox).toEqual({ count: 1 });
    expect(copied.targetOutbox).toEqual({ count: 0 });
    expect(api.syncRequests).toEqual([]);
    await page.getByTestId('nav-prompts').click();
    await expect(page.getByText('保留的旧庭院', { exact: true })).toBeVisible();
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-local-workspace-', {
      reuseUserDataDir: directory,
      env: { MUSEFOLD_API_URL: api.baseUrl },
    }));
    page = await v25ShellPage(app);
    await settings(page, 'sync');
    await expect(page.getByTestId('sync-consent-enable')).toBeVisible();
    expect(api.syncRequests).toEqual([]);
    await page.getByTestId('sync-consent-enable').click();
    await expect(page.getByTestId('sync-phase')).toHaveText('已是最新');
    expect(api.syncRequests).toContain('/api/v1/sync/push');
    const synced = readLocalFacts(directory, owner);
    expect(synced.oldOutbox).toEqual({ count: 1 });
    expect(synced.source).toEqual(copied.source);
    expect(synced.targetConsent).toEqual({ consent_state: 'enabled' });
  } finally {
    await app?.close();
    await api.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

for (const nextUsername of ['second-creator', 'verified-creator']) {
  test(`真实 IPC 拒绝换号或重登后的旧复制/同步确认：${nextUsername}`, async () => {
    const api = await apiFixture();
    let app: ElectronApplication | undefined;
    let directory: string | undefined;
    try {
      const first = await launchV25App('musefold-workspace-review-', {
        env: { MUSEFOLD_API_URL: api.baseUrl },
      });
      app = first.app;
      directory = first.userDataDir;
      await v25ShellPage(app);
      await app.close();
      app = undefined;
      seedHistoricalContainer(directory);
      ({ app } = await launchV25App('musefold-workspace-review-', {
        reuseUserDataDir: directory,
        env: { MUSEFOLD_API_URL: api.baseUrl },
      }));
      const page = await v25ShellPage(app);
      await settings(page, 'account');
      await page.getByTestId('account-username').fill('verified-creator');
      await page.getByTestId('account-password').fill('synthetic-password');
      await page.getByTestId('account-auth-submit').click();
      await expect(page.getByTestId('account-signed-in')).toBeVisible();
      await settings(page, 'sync');
      await page.getByRole('button', { name: '查看 本机账号提示词库 · 历史账号名称' }).click();
      await page.getByRole('button', { name: '复制这份库到当前账号' }).click();
      await expect(page.getByRole('alertdialog')).toContainText('verified-creator');
      // Dispatch the already-reviewed inputs through real preload IPC after a
      // separate account operation commits. Renderer refresh timing cannot hide
      // a missing host-side comparison in this deterministic race.
      const evidence = await page.evaluate(async (username) => {
        const bridge = (
          window as unknown as {
            musefoldV25: {
              invoke(method: string, payload?: unknown): Promise<BridgeEnvelope<unknown>>;
            };
          }
        ).musefoldV25;
        const listed = await bridge.invoke('sync.listLocalWorkspaces');
        if (!listed.ok) throw new Error('list failed');
        const old = listed.data as {
          reviewRef: string;
          sources: Array<{ sourceId: string; revision: string; kind: string }>;
        };
        const source = old.sources.find((item) => item.kind === 'account');
        if (!source) throw new Error('source missing');
        const signedIn = await bridge.invoke('account.login', {
          username,
          password: 'synthetic-password',
        });
        if (!signedIn.ok) throw new Error('second login failed');
        const copy = await bridge.invoke('sync.prepareLocalWorkspace', {
          mode: 'copy',
          sourceId: source.sourceId,
          expectedRevision: source.revision,
          reviewRef: old.reviewRef,
        });
        const consent = await bridge.invoke('sync.setConsent', {
          consent: 'enabled',
          reviewRef: old.reviewRef,
        });
        const alias = await bridge.invoke('sync.setEnabled', {
          enabled: true,
          reviewRef: old.reviewRef,
        });
        const current = await bridge.invoke('sync.listLocalWorkspaces');
        return { copy, consent, alias, oldReview: old.reviewRef, current };
      }, nextUsername);
      for (const result of [evidence.copy, evidence.consent, evidence.alias]) {
        expect(result).toEqual({
          ok: false,
          code: 'CONFLICT',
          message: '确认的账号已变化,请刷新账号状态并重新确认',
        });
      }
      expect(evidence.current).toMatchObject({
        ok: true,
        data: { targetReady: false, canPrepare: true, targetAccount: { username: nextUsername } },
      });
      if (!evidence.current.ok) throw new Error('Current account review was not returned');
      expect((evidence.current.data as { reviewRef: string }).reviewRef).not.toBe(
        evidence.oldReview,
      );
      const principal =
        nextUsername === 'second-creator' ? 'second-principal' : 'verified-principal';
      const owner = createHash('sha256')
        .update(JSON.stringify(['principal', api.baseUrl, principal]))
        .digest('hex');
      const facts = readLocalFacts(directory, owner);
      expect(facts.target).toEqual([]);
      expect(facts.targetConsent).toEqual({ consent_state: 'unset' });
      expect(facts.oldOutbox).toEqual({ count: 1 });
      expect(api.syncRequests).toEqual([]);
    } finally {
      await app?.close();
      await api.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  });
}
