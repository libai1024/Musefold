import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import { accountModelCatalogSchema } from '@musefold/contracts';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Local account/API fixture only; no paid upstream or test-only product IPC. */
async function accountServer(purged = false) {
  let baseUrl = '';
  let phase: 'queued' | 'succeeded' = 'queued';
  let lostReply = true;
  let key = '';
  let frozen: Record<string, unknown> = {};
  const calls: Array<{ method: string; path: string }> = [];
  const binding = () => ({
    apiIssuer: baseUrl,
    principalId: 'cloud-e2e-principal',
    payer: { issuer: 'https://payer.example.invalid', ownerId: 'cloud-e2e-owner' },
    credential: { ref: 'cloud-e2e-credential', version: 1 },
    providerId: 'cloud-default',
    model: 'musefold-image-pro',
    capabilities: { image: true, text: false },
  });
  const job = () => ({
    id: 'cloud-e2e-remote-run',
    sessionId: null,
    parentRunId: null,
    promptId: null,
    actorType: 'desktop_local',
    approvalStatus: 'not_required',
    status: phase,
    progress: phase === 'succeeded' ? 100 : 0,
    request: frozen,
    providerModel: 'musefold-image-pro',
    costPoints: phase === 'succeeded' ? 4 : null,
    assets:
      phase === 'succeeded'
        ? [
            {
              id: 'cloud-e2e-asset',
              url: 'https://untrusted.invalid/never-fetch',
              mimeType: 'image/png',
              width: 1,
              height: 1,
              byteSize: png.length,
              expiresAt: '2030-01-01T00:00:00Z',
            },
          ]
        : [],
    error: null,
    createdAt: '2026-09-08T01:00:00Z',
    startedAt: null,
    finishedAt: phase === 'succeeded' ? '2026-09-08T02:00:00Z' : null,
  });
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const path = request.url ?? '/';
    calls.push({ method: request.method ?? '', path });
    response.setHeader('content-type', 'application/json');
    const send = (value: unknown) => response.end(JSON.stringify(value));
    if (path === '/api/auth/sign-in/new-api') return send({ token: 'synthetic-cloud-e2e-bearer' });
    if (request.headers.authorization !== 'Bearer synthetic-cloud-e2e-bearer') {
      response.statusCode = 401;
      return send({});
    }
    if (path === '/api/v1/account/status')
      return send({
        id: 'cloud-e2e-owner',
        username: 'cloud-creator',
        displayName: null,
        quota: 500000,
        quotaUnit: '点',
        canGenerate: true,
        identity: {
          apiIssuer: baseUrl,
          principalId: 'cloud-e2e-principal',
          status: 'active',
          identityVersion: 1,
        },
        recovery: null,
      });
    if (path === '/api/v1/account/execution-binding')
      return send({ ...binding(), status: 'available', verifiedAt: '2026-09-08T01:00:00Z' });
    if (path === '/api/v1/account/models') {
      const { apiIssuer, principalId, payer, credential } = binding();
      return send(
        accountModelCatalogSchema.parse({
          identity: { apiIssuer, principalId, payer, credential },
          group: 'default',
          checkedAt: new Date().toISOString(),
          models: [
            {
              model: 'musefold-image-pro',
              supportedEndpointTypes: ['image-generation'],
              imageGeneration: true,
              pricing: {
                kind: 'per_call',
                baseUsd: 0.04,
                groupRatio: 3,
                quotaPerCall: 60000,
              },
            },
          ],
        }),
      );
    }
    if (path === '/api/v1/generations' && request.method === 'POST') {
      frozen = JSON.parse(raw);
      key = String(request.headers['idempotency-key']);
      response.statusCode = 201;
      if (lostReply) return response.end('{');
      return send(job());
    }
    if (path.startsWith('/api/v1/generations/receipts/by-key')) {
      if (!key || new URL(path, baseUrl).searchParams.get('key') !== key) {
        response.statusCode = 404;
        return send({});
      }
      return send({
        id: 'cloud-e2e-receipt',
        principalId: 'cloud-e2e-principal',
        idempotencyKey: key,
        operation: 'ordinary_create',
        originalRunId: 'cloud-e2e-remote-run',
        sourceRunId: null,
        bindingState: 'bound',
        binding: binding(),
        status: phase,
        dispatch: phase === 'succeeded' ? 'claimed' : 'not_started',
        costProvenance: phase === 'succeeded' ? 'provider_reported' : 'not_sent',
        costPoints: phase === 'succeeded' ? 4 : 0,
        revision: phase === 'succeeded' ? 2 : 1,
        createdAt: '2026-09-08T01:00:00Z',
        updatedAt: '2026-09-08T02:00:00Z',
        terminalAt: phase === 'succeeded' ? '2026-09-08T02:00:00Z' : null,
        purgedAt: purged && phase === 'succeeded' ? '2026-09-08T03:00:00Z' : null,
      });
    }
    if (path === '/api/v1/generations/cloud-e2e-remote-run') return send(job());
    if (path === '/api/v1/assets/cloud-e2e-asset/content') {
      response.setHeader('content-type', 'image/png');
      return response.end(png);
    }
    response.statusCode = 404;
    return send({});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    calls,
    submittedRequest: () => ({ ...frozen }),
    finish: () => {
      phase = 'succeeded';
      lostReply = false;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

for (const purged of [false, true]) {
  test(`账号云连接发送一次，丢回包后真实重启${purged ? '解释已清理素材' : '落盘并恢复本机缺失图片'}`, async () => {
    const api = await accountServer(purged);
    let app: ElectronApplication | undefined;
    let userData = '';
    try {
      const first = await launchV25App('musefold-account-cloud-', {
        env: { MUSEFOLD_API_URL: api.baseUrl },
      });
      app = first.app;
      userData = first.userDataDir;
      let page = await v25ShellPage(app);
      await page.getByTestId('nav-settings').click();
      await page.getByTestId('settings-nav-account').click();
      await page.getByTestId('account-username').fill('cloud-creator');
      await page.getByTestId('account-password').fill('synthetic-password');
      await page.getByTestId('account-auth-submit').click();
      await expect(page.getByTestId('account-points')).toBeVisible();
      await page.getByTestId('settings-nav-connections').click();
      await page.getByTestId('account-cloud-review').click();
      await expect(page.getByRole('alertdialog')).toContainText('cloud-creator');
      expect(api.calls.filter((call) => call.path === '/api/v1/generations')).toHaveLength(0);
      await page.getByTestId('account-cloud-confirm').click();
      await expect(page.getByTestId('account-cloud-default')).toHaveText('当前默认连接');
      await page.getByTestId('nav-workbench').click();
      await page.getByTestId('composer-prompt').fill('真实重启核对猫咪原任务');
      await expect(page.getByRole('combobox', { name: '账号模型' })).toHaveText(
        'musefold-image-pro',
      );
      await expect(page.getByTestId('composer-model-price')).toContainText('1.2 积分');
      await expect(page.getByTestId('composer-submit')).toBeEnabled();
      await page.getByTestId('composer-submit').click();
      await expect
        .poll(() => api.calls.filter((call) => call.path === '/api/v1/generations').length)
        .toBe(1);
      expect(api.submittedRequest()).toMatchObject({ model: 'musefold-image-pro' });
      await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'running');
      const oldPid = app.process().pid;
      await app.close();
      app = undefined;
      api.finish();
      ({ app } = await launchV25App('musefold-account-cloud-', {
        reuseUserDataDir: userData,
        env: { MUSEFOLD_API_URL: api.baseUrl },
      }));
      expect(app.process().pid).not.toBe(oldPid);
      page = await v25ShellPage(app);
      await page.getByTestId('nav-settings').click();
      await page.getByTestId('settings-nav-connections').click();
      await expect(page.getByTestId('account-cloud-status')).toContainText('使用当前账号');
      // Connection status resolves before the independently loaded recovery list.
      // Await the real action; a one-shot isVisible() can skip reconciliation entirely.
      // Completed records remain listed, so querying again is also valid after startup recovery.
      await page.getByRole('button', { name: '核对原任务' }).click();
      const db = new Database(desktopDbPath(userData), { readonly: true });
      try {
        await expect
          .poll(() => db.prepare('SELECT status FROM generation_runs').get())
          .toEqual({ status: 'success' });
        if (purged) {
          expect(db.prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 0 });
          await expect(page.getByTestId('account-cloud-recovery')).toContainText('云端素材已清理');
          expect(api.calls.some((call) => call.path.startsWith('/api/v1/assets/'))).toBe(false);
        } else {
          // Remote completion precedes local delivery; wait on assets independently.
          await expect
            .poll(() => db.prepare('SELECT count(*) AS n FROM generated_assets').get())
            .toEqual({ n: 1 });
          const asset = db.prepare('SELECT * FROM generated_assets').get() as {
            media_path: string;
            mime_type: string;
            file_size: number;
          };
          expect(readFileSync(asset.media_path)).toEqual(png);
          expect(asset).toMatchObject({ mime_type: 'image/png', file_size: png.length });
          rmSync(asset.media_path);
          await page.getByTestId('account-cloud-check').click();
          await expect(page.getByTestId('account-cloud-recovery')).toContainText('本机图片缺失');
          await page.getByRole('button', { name: '核对原任务' }).click();
          await expect
            .poll(() => {
              try {
                return readFileSync(asset.media_path).equals(png);
              } catch {
                return false;
              }
            })
            .toBe(true);
          expect(db.prepare('SELECT * FROM generated_assets').get()).toEqual(asset);
          expect(db.prepare('SELECT count(*) AS n FROM generated_assets').get()).toEqual({ n: 1 });
        }
        expect(db.prepare('SELECT actual_cost FROM generation_runs').get()).toEqual({
          actual_cost: 4,
        });
        expect(db.prepare('SELECT model FROM generation_runs').get()).toEqual({
          model: 'musefold-image-pro',
        });
        expect(db.serialize().includes(Buffer.from('synthetic-cloud-e2e-bearer'))).toBe(false);
      } finally {
        db.close();
      }
      expect(readFileSync(join(userData, 'v25-account-session.json'), 'utf8')).not.toContain(
        'synthetic-cloud-e2e-bearer',
      );
      expect(api.calls.filter((call) => call.path === '/api/v1/generations')).toHaveLength(1);
      expect(api.calls.some((call) => call.path.startsWith('/api/v1/sync'))).toBe(false);
    } finally {
      await app?.close();
      await api.close();
      if (userData) rmSync(userData, { recursive: true, force: true });
    }
  });
}
