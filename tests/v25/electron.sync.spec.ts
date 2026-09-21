import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { clickRowAction, createPrompt } from './prompt-helpers';

interface SyncRequest {
  method: string;
  path: string;
  entity: string | null;
}

interface SyncApiState {
  requests: SyncRequest[];
  conflictedEntityIds: Set<string>;
  sessionToken: string;
}

interface SyncApiServer {
  baseUrl: string;
  state: SyncApiState;
  close(): Promise<void>;
}

const accountUsername = process.env.MUSEFOLD_E2E_USERNAME ?? 'sync-e2e-user';
const accountPassword = process.env.MUSEFOLD_E2E_PASSWORD ?? randomUUID();
const imageApiKey = process.env.MUSEFOLD_E2E_IMAGE_API_KEY;

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function promptSnapshot(
  entityId: string,
  payload: Record<string, unknown>,
  version: number,
  remote = false,
) {
  const now = '2026-08-29T00:00:00+00:00';
  return {
    id: entityId,
    title: remote ? '云端冲突版本' : String(payload.title ?? '同步提示词'),
    description: typeof payload.description === 'string' ? payload.description : null,
    content: remote ? 'cloud remote content' : String(payload.content ?? 'synced content'),
    negative: typeof payload.negative === 'string' ? payload.negative : null,
    folderId: null,
    tags: [],
    modelId: typeof payload.modelId === 'string' ? payload.modelId : null,
    params: payload.params && typeof payload.params === 'object' ? payload.params : null,
    rating: typeof payload.rating === 'number' ? payload.rating : 0,
    isPinned: payload.isPinned === true,
    pinOrder: typeof payload.pinOrder === 'number' ? payload.pinOrder : null,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    version,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

async function startSyncApi(): Promise<SyncApiServer> {
  const state: SyncApiState = {
    requests: [],
    conflictedEntityIds: new Set(),
    sessionToken: randomUUID(),
  };
  let signedIn = false;
  let baseUrl = '';

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const method = request.method ?? 'GET';
    const isSync = url.pathname.startsWith('/api/v1/sync/');
    if (isSync) {
      state.requests.push({ method, path: url.pathname, entity: url.searchParams.get('entity') });
    }

    try {
      if (method === 'POST' && url.pathname === '/api/auth/sign-in/new-api') {
        const body = await requestJson(request);
        if (body.email !== accountUsername || body.password !== accountPassword) {
          return json(
            response,
            { code: 'AUTH_CREDENTIALS_INVALID', message: '用户名或密码不正确' },
            401,
          );
        }
        signedIn = true;
        return json(response, { token: state.sessionToken });
      }
      if (method === 'POST' && url.pathname === '/api/auth/sign-out') {
        signedIn = false;
        return json(response, { success: true });
      }
      if (method === 'GET' && url.pathname === '/api/v1/account/status') {
        if (!signedIn || request.headers.authorization !== `Bearer ${state.sessionToken}`) {
          return json(response, { error: { code: 'AUTH_REQUIRED', message: '未登录' } }, 401);
        }
        return json(response, {
          id: 'owner-e2e-xiaomiao',
          username: accountUsername,
          displayName: null,
          quota: 3_140_000,
          quotaUnit: '点',
          canGenerate: true,
          identity: {
            apiIssuer: baseUrl,
            principalId: 'principal-e2e',
            status: 'active',
            identityVersion: 1,
          },
          recovery: null,
        });
      }
      if (!isSync || request.headers.authorization !== `Bearer ${state.sessionToken}`) {
        return json(response, { error: { code: 'NOT_FOUND', message: url.pathname } }, 404);
      }
      if (method === 'POST' && url.pathname === '/api/v1/sync/devices') {
        const body = await requestJson(request);
        return json(response, { ...body, revoked: false, lastPullCursor: '0' }, 201);
      }
      if (method === 'GET' && url.pathname === '/api/v1/sync/bootstrap') {
        return json(response, { snapshotCursor: '10', items: [], nextPage: null });
      }
      if (method === 'GET' && url.pathname === '/api/v1/sync/pull') {
        return json(response, { changes: [], nextCursor: '10', hasMore: false });
      }
      if (method === 'POST' && url.pathname === '/api/v1/sync/push') {
        const body = await requestJson(request);
        const mutations = Array.isArray(body.mutations)
          ? (body.mutations as Array<Record<string, unknown>>)
          : [];
        return json(response, {
          results: mutations.map((mutation) => {
            const entityId = String(mutation.entityId);
            const payload =
              mutation.payload && typeof mutation.payload === 'object'
                ? (mutation.payload as Record<string, unknown>)
                : {};
            const shouldConflict =
              payload.title === '暂停冲突提示词' && !state.conflictedEntityIds.has(entityId);
            if (shouldConflict) state.conflictedEntityIds.add(entityId);
            return {
              mutationId: mutation.mutationId,
              status: shouldConflict ? 'conflict' : 'applied',
              version: shouldConflict ? 2 : 1,
              snapshot: promptSnapshot(entityId, payload, shouldConflict ? 2 : 1, shouldConflict),
              errorCode: null,
            };
          }),
        });
      }
      if (method === 'POST' && url.pathname === '/api/v1/sync/usage') {
        const body = await requestJson(request);
        const events = Array.isArray(body.events)
          ? (body.events as Array<Record<string, unknown>>)
          : [];
        return json(response, {
          results: events.map((event) => ({
            eventId: event.eventId,
            status: 'applied',
            errorCode: null,
          })),
        });
      }
      return json(response, { error: { code: 'NOT_FOUND', message: url.pathname } }, 404);
    } catch (error) {
      return json(
        response,
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'error',
          },
        },
        500,
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback sync server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

type SettingsSection = 'account' | 'sync' | 'connections';

/** 设置屏为分区导航(V25-UI-SPEC §6.1):账号 / 云同步 / AI 连接各在自己的分区面板里。 */
async function openSettingsSection(page: Page, section: SettingsSection): Promise<void> {
  await page.getByTestId(`settings-nav-${section}`).click();
  await expect(page.getByTestId(`settings-section-${section}`)).toBeVisible();
}

async function openSettings(page: Page, section: SettingsSection): Promise<void> {
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await openSettingsSection(page, section);
}

async function login(page: Page): Promise<void> {
  await page.getByTestId('account-username').fill(accountUsername);
  await page.getByTestId('account-password').fill(accountPassword);
  await page.getByTestId('account-auth-submit').click();
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
}

async function waitForToastsToDismiss(page: Page): Promise<void> {
  await expect(page.locator('[data-sonner-toast][data-visible="true"]')).toHaveCount(0, {
    timeout: 10_000,
  });
}

function syncRequestCount(server: SyncApiServer): number {
  return server.state.requests.length;
}

function readSyncCounts(userDataDir: string) {
  const db = new Database(desktopDbPath(userDataDir), { readonly: true });
  try {
    return {
      mutations: (
        db.prepare('SELECT COUNT(*) AS count FROM cloud_sync_outbox').get() as { count: number }
      ).count,
      usage: (
        db.prepare('SELECT COUNT(*) AS count FROM cloud_sync_usage_outbox').get() as {
          count: number;
        }
      ).count,
      conflicts: (
        db
          .prepare('SELECT COUNT(*) AS count FROM cloud_sync_conflicts WHERE resolved_at IS NULL')
          .get() as { count: number }
      ).count,
    };
  } finally {
    db.close();
  }
}

function seedAccountWorkspace(userDataDir: string, ownerId: string): void {
  const db = new Database(desktopDbPath(userDataDir));
  try {
    const now = Date.now();
    db.prepare(
      `INSERT INTO local_workspaces (id, owner_id, kind, created_at, updated_at)
       VALUES (?, ?, 'account', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(`account:${ownerId}`, ownerId, now, now);
  } finally {
    db.close();
  }
}
function assertSecretsAbsent(root: string, secrets: string[]): void {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names) {
      const path = join(current, name);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (stat.isDirectory()) pending.push(path);
      else if (stat.isFile()) {
        let bytes: Buffer;
        try {
          bytes = readFileSync(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        for (const secret of secrets) {
          expect(bytes.includes(Buffer.from(secret)), `${path} contains plaintext secret`).toBe(
            false,
          );
        }
      }
    }
  }
}

test('Electron 云同步:unset 零请求 → 首轮顺序 → paused 积累 → conflict → 同账号恢复', async ({
  browserName: _browserName,
}, testInfo) => {
  const api = await startSyncApi();
  const workspaceOwner = createHash('sha256')
    .update(JSON.stringify(['principal', api.baseUrl, 'principal-e2e']))
    .digest('hex');
  let app: ElectronApplication | undefined;
  let userDataDir = '';
  try {
    const launched = await launchV25App('musefold-v25-sync-', {
      env: { MUSEFOLD_API_URL: api.baseUrl },
    });
    app = launched.app;
    userDataDir = launched.userDataDir;
    const page = await v25ShellPage(app);
    seedAccountWorkspace(userDataDir, workspaceOwner);
    await openSettings(page, 'account');
    await login(page);

    await openSettingsSection(page, 'sync');
    await expect(page.getByTestId('sync-consent-enable')).toBeVisible();
    await expect(page.getByTestId('sync-subtitle')).toHaveText(
      '开启后提示词、文件夹与标签将同步到云端',
    );
    expect(syncRequestCount(api)).toBe(0);
    const unsetShot = testInfo.outputPath('sync-unset.png');
    await page.getByTestId('settings-sync-card').screenshot({ path: unsetShot });
    await testInfo.attach('sync-unset', { path: unsetShot, contentType: 'image/png' });

    await page.getByTestId('nav-prompts').click();
    await createPrompt(page, '首次同步提示词', 'created before first consent');
    expect(readSyncCounts(launched.userDataDir).mutations).toBe(0);
    expect(syncRequestCount(api)).toBe(0);

    await openSettings(page, 'sync');
    await page.getByTestId('sync-consent-enable').click();
    await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15_000 });
    await expect(page.getByTestId('sync-consent-pause')).toBeVisible();
    expect(api.state.requests.slice(0, 8)).toEqual([
      { method: 'POST', path: '/api/v1/sync/devices', entity: null },
      { method: 'GET', path: '/api/v1/sync/bootstrap', entity: 'folder' },
      { method: 'GET', path: '/api/v1/sync/bootstrap', entity: 'tag' },
      { method: 'GET', path: '/api/v1/sync/bootstrap', entity: 'prompt' },
      { method: 'GET', path: '/api/v1/sync/pull', entity: null },
      { method: 'POST', path: '/api/v1/sync/push', entity: null },
      { method: 'GET', path: '/api/v1/sync/pull', entity: null },
    ]);
    expect(readSyncCounts(launched.userDataDir)).toEqual({ mutations: 0, usage: 0, conflicts: 0 });
    await waitForToastsToDismiss(page);
    const enabledShot = testInfo.outputPath('sync-enabled.png');
    await page.getByTestId('settings-sync-card').screenshot({ path: enabledShot });
    await testInfo.attach('sync-enabled', { path: enabledShot, contentType: 'image/png' });

    await page.getByTestId('sync-consent-pause').click();
    await expect(page.getByTestId('sync-phase')).toHaveText('已暂停');
    const pausedRequestCount = syncRequestCount(api);
    await page.getByTestId('nav-prompts').click();
    await createPrompt(page, '暂停冲突提示词', 'local paused content');
    await clickRowAction(page, '暂停冲突提示词', 'prompt-row-copy');
    await expect
      .poll(() => readSyncCounts(launched.userDataDir), { timeout: 5_000 })
      .toEqual({ mutations: 1, usage: 1, conflicts: 0 });
    await page.waitForTimeout(2_500);
    expect(syncRequestCount(api)).toBe(pausedRequestCount);

    await openSettings(page, 'sync');
    await expect(page.getByTestId('sync-phase')).toHaveText('已暂停');
    await waitForToastsToDismiss(page);
    const pausedShot = testInfo.outputPath('sync-paused.png');
    await page.getByTestId('settings-sync-card').screenshot({ path: pausedShot });
    await testInfo.attach('sync-paused', { path: pausedShot, contentType: 'image/png' });

    await page.getByTestId('sync-consent-resume').click();
    await expect(page.getByTestId('sync-phase')).toHaveText('有冲突', { timeout: 15_000 });
    const conflictList = page.getByTestId('sync-conflict-list');
    await expect(conflictList).toBeVisible();
    await expect(conflictList).toContainText('暂停冲突提示词');
    await expect(conflictList).toContainText('云端冲突版本');
    await expect(conflictList.getByRole('button', { name: '保留云端' })).toBeVisible();
    await expect(conflictList.getByRole('button', { name: '保留本地' })).toBeVisible();
    await expect(conflictList.getByRole('button', { name: '另存本地副本' })).toBeVisible();
    await waitForToastsToDismiss(page);
    const conflictShot = testInfo.outputPath('sync-conflict.png');
    await page.getByTestId('settings-sync-card').screenshot({ path: conflictShot });
    await testInfo.attach('sync-conflict', { path: conflictShot, contentType: 'image/png' });

    await conflictList.getByRole('button', { name: '另存本地副本' }).click();
    await expect(conflictList).toBeHidden();
    await expect.poll(() => readSyncCounts(launched.userDataDir).conflicts).toBe(0);
    const db = new Database(desktopDbPath(launched.userDataDir), { readonly: true });
    const beforeLogout = db
      .prepare(
        `SELECT consent_state, cursor, bootstrap_completed_at
         FROM cloud_sync_accounts WHERE owner_id = ?`,
      )
      .get(workspaceOwner) as {
      consent_state: string;
      cursor: string;
      bootstrap_completed_at: number;
    };
    expect(beforeLogout).toMatchObject({ consent_state: 'enabled', cursor: '10' });
    expect(beforeLogout.bootstrap_completed_at).toBeGreaterThan(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM prompts WHERE title LIKE '%本地副本%'").get(),
    ).toEqual({ count: 1 });
    db.close();

    await openSettingsSection(page, 'account');
    await page.getByTestId('account-logout').click();
    await page.getByTestId('account-logout-confirm').click();
    await expect(page.getByTestId('account-auth-form')).toBeVisible();
    await openSettingsSection(page, 'sync');
    await expect(page.getByTestId('sync-subtitle')).toHaveText('登录账号后可开启云同步');
    await openSettingsSection(page, 'account');
    await login(page);
    await openSettingsSection(page, 'sync');
    await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15_000 });

    const dbAfter = new Database(desktopDbPath(launched.userDataDir), { readonly: true });
    const afterRelogin = dbAfter
      .prepare(
        `SELECT active, consent_state, cursor, bootstrap_completed_at
         FROM cloud_sync_accounts WHERE owner_id = ?`,
      )
      .get(workspaceOwner);
    dbAfter.close();
    expect(afterRelogin).toEqual({ active: 1, ...beforeLogout });
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await api.close();
      } finally {
        if (userDataDir) {
          assertSecretsAbsent(userDataDir, [accountPassword, api.state.sessionToken]);
        }
      }
    }
  }
});

test('Electron AI 连接使用真实 TvT 生图 key 且只展示尾号', async ({
  browserName: _browserName,
}, testInfo) => {
  test.skip(!imageApiKey, '需要 MUSEFOLD_E2E_IMAGE_API_KEY 才执行真实中转站连接验证');
  if (!imageApiKey) return;

  let app: ElectronApplication | undefined;
  let userDataDir = '';
  try {
    ({ app, userDataDir } = await launchV25App('musefold-v25-tvt-provider-'));
    const page = await v25ShellPage(app);
    await openSettings(page, 'connections');
    await page.getByTestId('ai-provider-new').click();
    await page.getByTestId('ai-provider-name').fill('TvT 生图');
    await page.getByTestId('ai-provider-base-url').fill('https://ai.tvt.wiki/v1');
    await page.getByTestId('ai-provider-model').fill('gpt-image-2');
    await page.getByTestId('ai-provider-key').fill(imageApiKey);
    await page.getByTestId('ai-provider-save').click();

    const row = page.getByTestId('ai-providers-list').locator('li', { hasText: 'TvT 生图' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('gpt-image-2 · https://ai.tvt.wiki/v1');
    await expect(row).toContainText(`密钥 …${imageApiKey.slice(-4)}`);
    await expect(row).not.toContainText(imageApiKey);
    await row.getByTestId('ai-provider-test').click();
    await expect(row.getByTestId('ai-provider-test-result')).toContainText('连接正常', {
      timeout: 15_000,
    });

    const shot = testInfo.outputPath('tvt-image-provider-connected.png');
    await page.getByTestId('settings-ai-connections-card').screenshot({ path: shot });
    await testInfo.attach('tvt-image-provider-connected', { path: shot, contentType: 'image/png' });

    const db = new Database(desktopDbPath(userDataDir), { readonly: true });
    expect(
      db.prepare('SELECT name, base_url, model, has_key, key_suffix FROM providers').get(),
    ).toEqual({
      name: 'TvT 生图',
      base_url: 'https://ai.tvt.wiki/v1',
      model: 'gpt-image-2',
      has_key: 1,
      key_suffix: imageApiKey.slice(-4),
    });
    db.close();
  } finally {
    try {
      await app?.close();
    } finally {
      if (userDataDir) assertSecretsAbsent(userDataDir, [imageApiKey]);
    }
  }
});
