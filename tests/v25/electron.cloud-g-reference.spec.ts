// 云 G 参考图桌面接线（正式主进程 Electron，只写不跑：由主代理统一首跑）。
// 真实 Electron 主进程 + 真实 v25 渲染壳 + 真实 SQLite；自含回环账号/生成服务
// （含 /api/v1/reference-images multipart 与按需 422 开关），不需要 Docker。
// 覆盖两段：
//   A) 正向：壳内上传参考图 → generation.create（账号云默认）→ 主进程 multipart
//      上传真实字节 → 冻结云 ID + sha256 摘要 → 单次云创建 POST 携带冻结引用 →
//      回执/结果/资产回投，本机历史 success、actual_cost=4、资产字节与摘要一致；
//      bearer token 不落 DB。
//   B) 失败面：服务端拒绝参考图上传 → 用户可见 MANAGED_GENERATION_NOT_STARTED、
//      0 次云创建 POST、0 条托管登记、0 条本机生成行（0 付费发送）。
// 证据：tests/v25/.results/f5x/cloud-g-wiring-glm-result.json（首跑后由主代理回填）。

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { cloudInvoke, cloudLocalState, connectCloud } from './cloud-crash-helpers';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const digest = createHash('sha256').update(png).digest('hex');
const CLOUD_REFERENCE_ID = 'cloudgref000001';

/** 自含回环控制面：账号三路由、参考图 multipart 上传、云创建/回执/结果/资产。 */
async function cloudGReferenceFixture() {
  let baseUrl = '';
  let rejectUploads = false;
  let key = '';
  let frozen: Record<string, unknown> = {};
  const uploads: Array<{
    authorization?: string;
    contentType: string;
    filename: string;
    body: Buffer;
  }> = [];
  const generationsPosts: number[] = [];
  const binding = () => ({
    apiIssuer: baseUrl,
    principalId: 'cloud-g-principal',
    payer: { issuer: 'https://payer.example.invalid', ownerId: 'cloud-g-owner' },
    credential: { ref: 'cloud-g-credential', version: 1 },
    providerId: 'cloud-default',
    model: 'musefold-image-pro',
    capabilities: { image: true, text: false },
  });
  const job = () => ({
    id: 'cloud-g-remote-run',
    sessionId: null,
    parentRunId: null,
    promptId: null,
    actorType: 'desktop_local',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: frozen,
    providerModel: 'musefold-image-pro',
    costPoints: 4,
    assets: [
      {
        id: 'cloud-g-asset',
        url: 'https://untrusted.invalid/never-fetch',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteSize: png.length,
        expiresAt: '2030-01-01T00:00:00Z',
      },
    ],
    error: null,
    createdAt: '2026-09-14T01:00:00Z',
    startedAt: null,
    finishedAt: '2026-09-14T02:00:00Z',
  });
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const path = request.url ?? '/';
    response.setHeader('content-type', 'application/json');
    const send = (value: unknown) => response.end(JSON.stringify(value));
    if (path === '/api/auth/sign-in/new-api') return send({ token: 'synthetic-cloud-g-bearer' });
    if (request.headers.authorization !== 'Bearer synthetic-cloud-g-bearer') {
      response.statusCode = 401;
      return send({});
    }
    if (path === '/api/v1/account/status')
      return send({
        id: 'cloud-g-owner',
        username: 'cloud-creator',
        displayName: null,
        quota: 500000,
        quotaUnit: '点',
        canGenerate: true,
        identity: {
          apiIssuer: baseUrl,
          principalId: 'cloud-g-principal',
          status: 'active',
          identityVersion: 1,
        },
        recovery: null,
      });
    if (path === '/api/v1/account/execution-binding')
      return send({ ...binding(), status: 'available', verifiedAt: '2026-09-14T01:00:00Z' });
    if (path === '/api/v1/reference-images' && request.method === 'POST') {
      uploads.push({
        authorization: request.headers.authorization,
        contentType: String(request.headers['content-type'] ?? ''),
        filename: /filename="([^"]*)"/.exec(body.subarray(0, 512).toString('utf8'))?.[1] ?? '',
        body,
      });
      if (rejectUploads || !body.includes(png)) {
        response.statusCode = 422;
        return send({ error: { message: 'fixture reference rejection' } });
      }
      response.statusCode = 201;
      return send({
        id: CLOUD_REFERENCE_ID,
        url: `/api/v1/reference-images/${CLOUD_REFERENCE_ID}/url`,
        name: 'cloud-g-ref.png',
        mimeType: 'image/png',
        byteSize: png.length,
      });
    }
    if (path === '/api/v1/generations' && request.method === 'POST') {
      generationsPosts.push(generationsPosts.length + 1);
      frozen = JSON.parse(body.toString());
      key = String(request.headers['idempotency-key']);
      response.statusCode = 201;
      return send(job());
    }
    if (path.startsWith('/api/v1/generations/receipts/by-key')) {
      if (!key || new URL(path, baseUrl).searchParams.get('key') !== key) {
        response.statusCode = 404;
        return send({});
      }
      return send({
        id: 'cloud-g-receipt',
        principalId: 'cloud-g-principal',
        idempotencyKey: key,
        operation: 'ordinary_create',
        originalRunId: 'cloud-g-remote-run',
        sourceRunId: null,
        bindingState: 'bound',
        binding: binding(),
        status: 'succeeded',
        dispatch: 'claimed',
        costProvenance: 'provider_reported',
        costPoints: 4,
        revision: 2,
        createdAt: '2026-09-14T01:00:00Z',
        updatedAt: '2026-09-14T02:00:00Z',
        terminalAt: '2026-09-14T02:00:00Z',
        purgedAt: null,
      });
    }
    if (path === '/api/v1/generations/cloud-g-remote-run') return send(job());
    if (path === '/api/v1/assets/cloud-g-asset/content') {
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
    uploads,
    generationsPosts,
    frozen: () => frozen,
    rejectUploads: (value: boolean) => {
      rejectUploads = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** 在壳页面内把 png 字节经真实 IPC 暂存为本地参考图，返回契约引用。 */
async function stageReferenceInShell(page: Awaited<ReturnType<typeof v25ShellPage>>) {
  const reply = await page.evaluate(
    ({ b64 }) => {
      const host = window as unknown as {
        musefoldV25: {
          invoke(
            method: string,
            payload?: unknown,
          ): Promise<{ ok: boolean; data?: unknown; code?: string }>;
        };
      };
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
      return host.musefoldV25.invoke('generation.uploadReferenceImage', {
        name: 'cloud-g-ref.png',
        bytes,
      });
    },
    { b64: png.toString('base64') },
  );
  expect(reply).toMatchObject({ ok: true });
  return reply.data as {
    id: string;
    url: string;
    name: string;
    mimeType: 'image/png';
    byteSize: number;
  };
}

test('云 G 参考图：壳内上传→主进程冻结云引用→单次创建与资产回投', async () => {
  test.setTimeout(180000);
  const api = await cloudGReferenceFixture();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-cloud-g-ref-', {
      env: { MUSEFOLD_API_URL: api.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    const page = await v25ShellPage(app);
    await connectCloud(page);
    const reference = await stageReferenceInShell(page);
    expect(reference).toMatchObject({ mimeType: 'image/png', byteSize: png.length });
    const created = await cloudInvoke(page, 'generation.create', {
      prompt: '按参考图生成一只猫',
      referenceImages: [reference],
    });
    expect(created).toMatchObject({ ok: true });

    // 主进程上传：单次 multipart,携带真实字节与 bearer,文件名只作展示。
    await expect.poll(() => api.uploads.length).toBe(1);
    expect(api.uploads[0]?.authorization).toBe('Bearer synthetic-cloud-g-bearer');
    expect(api.uploads[0]?.contentType).toContain('multipart/form-data');
    expect(api.uploads[0]?.filename).toBe('cloud-g-ref.png');
    expect(api.uploads[0]?.body.includes(png)).toBe(true);

    // 云创建:单次 POST,冻结引用含云 ID + sha256(字节)。
    await expect.poll(() => api.generationsPosts.length).toBe(1);
    expect(
      (api.frozen() as { referenceImages?: Array<Record<string, unknown>> }).referenceImages,
    ).toEqual([
      {
        id: CLOUD_REFERENCE_ID,
        url: `/api/v1/reference-images/${CLOUD_REFERENCE_ID}/url`,
        name: 'cloud-g-ref.png',
        mimeType: 'image/png',
        byteSize: png.length,
        digest,
      },
    ]);

    // 本机投影:历史 success、费用 4、托管登记的冻结摘要一致、资产字节逐位一致。
    await expect
      .poll(() => cloudLocalState(userData).runs, { timeout: 20000 })
      .toEqual([{ id: expect.any(String), status: 'success', actual_cost: 4 }]);
    const local = cloudLocalState(userData);
    expect(local.records).toHaveLength(1);
    expect(local.records[0]?.frozenRequest.referenceImages).toEqual([
      {
        id: CLOUD_REFERENCE_ID,
        url: `/api/v1/reference-images/${CLOUD_REFERENCE_ID}/url`,
        name: 'cloud-g-ref.png',
        mimeType: 'image/png',
        byteSize: png.length,
        digest,
      },
    ]);
    // 资产行在 runs.complete 之后落库,单独等它,再校验字节与摘要。
    await expect.poll(() => cloudLocalState(userData).assets.length).toBe(1);
    const settled = cloudLocalState(userData);
    expect(settled.assets[0]?.checksum).toBe(digest);
    expect(readFileSync(settled.assets[0]?.media_path ?? '')).toEqual(png);
    const db = new Database(desktopDbPath(userData), { readonly: true });
    try {
      expect(db.serialize().includes(Buffer.from('synthetic-cloud-g-bearer'))).toBe(false);
    } finally {
      db.close();
    }
    expect(readFileSync(join(userData, 'v25-account-session.json'), 'utf8')).not.toContain(
      'synthetic-cloud-g-bearer',
    );
  } finally {
    await app?.close();
    await api.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});

test('云 G 参考图失败面：上传被拒→用户可见错误且零云创建零登记', async () => {
  test.setTimeout(180000);
  const api = await cloudGReferenceFixture();
  api.rejectUploads(true);
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-cloud-g-ref-', {
      env: { MUSEFOLD_API_URL: api.baseUrl },
    });
    app = first.app;
    userData = first.userDataDir;
    const page = await v25ShellPage(app);
    await connectCloud(page);
    const reference = await stageReferenceInShell(page);
    const created = await cloudInvoke(page, 'generation.create', {
      prompt: '这次上传会被服务端拒绝',
      referenceImages: [reference],
    });
    expect(created).toMatchObject({
      ok: false,
      code: 'MANAGED_GENERATION_NOT_STARTED',
      message: expect.stringContaining('参考图上传失败'),
    });

    // 0 付费发送:上传尝试 1 次,云创建 0 次,托管登记 0 条,本机生成行 0 条。
    await expect.poll(() => api.uploads.length).toBe(1);
    expect(api.generationsPosts).toHaveLength(0);
    const local = cloudLocalState(userData);
    expect(local.records).toHaveLength(0);
    expect(local.runs).toHaveLength(0);
    expect(local.assets).toHaveLength(0);
  } finally {
    await app?.close();
    await api.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
