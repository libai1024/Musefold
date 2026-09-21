// SP-P5 层③（正式主进程 Electron，只写不跑：由主代理统一首跑）。
// 真实 Electron 主进程 + 真实回环 Provider/账号/GitHub 控制面 + 真实 SQLite；
// 自含回环服务（含 /v1/images/edits 与按次失败开关，不改动共享 local-execution-fixture）。
// 覆盖四段：
//   A) G BYOK 参考图上传 → 冻结引用走 /v1/images/edits，一次发送成功（参考字节/最终输入固定）；
//   B) R 方案 n=2 第 2 张图 503 → 部分成功 outcome=success、costPoints=null、单资产，
//      同键重放不补发剩余图（部分成功不续发）；
//   C) S Skill 文本+图像 → 文本 call 恒为 unknown，costPoints=null（文本/图像身份独立）；
//   D) 云启用为默认且登录态缺失（登出后）时 R 不带 providerId → 有界拒绝 PAYMENT_IDENTITY_UNBOUND
//      （0 图像/文本/云创建发送、1 审计、同键重放同结论）；显式 BYOK providerId 正常成功。
//      RS-MAP 后契约：已验证会话的云默认 R 走 managed 子执行（真实 API 集成层覆盖，见
//      managed-cloud-service.integration.test.ts R/S 用例）；本 e2e 层钉死未验证边界。
// 证据：tests/v25/.results/s5/sp-p5-electron-spec.json（首跑后由主代理回填实际结果）。

import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { aiProviderSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { connectCloud } from './cloud-crash-helpers';
import { seedFormalTextScheme } from './design-scheme-test-helpers';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke as invoke } from './local-execution-fixture';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGQAAAABJRU5ErkJggg==',
  'base64',
);
const skill = Buffer.from(
  '---\nname: fixture-visual\ndescription: A local visual fixture\n---\nUse a clear geometric landscape.\n',
);

/** 自含回环控制面：账号（sign-in/status/execution-binding）、GitHub Skill 源、图像两条通道、文本 SSE。 */
async function spP5Fixture() {
  const imageGenerations: Array<Record<string, unknown>> = [];
  const imageEdits: Array<{ auth?: string; bytes: number }> = [];
  const textCalls: Array<Record<string, unknown>> = [];
  const cloudCreates: string[] = [];
  const githubReads: string[] = [];
  let failImageGenerations = new Set<number>();
  let baseUrl = '';
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const chunk of request) parts.push(Buffer.from(chunk));
    const body = Buffer.concat(parts);
    const path = request.url ?? '/';
    const send = (value: unknown) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(value));
    };
    if (path.startsWith('/repos/fixture/visual')) {
      githubReads.push(path);
      if (path.includes('/commits/'))
        return send({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } });
      if (path.includes('/git/trees/'))
        return send({
          truncated: false,
          tree: [
            {
              path: 'SKILL.md',
              mode: '100644',
              type: 'blob',
              sha: 'c'.repeat(40),
              size: skill.length,
            },
          ],
        });
      if (path.includes('/git/blobs/'))
        return send({ encoding: 'base64', content: skill.toString('base64'), size: skill.length });
      return send({ default_branch: 'main' });
    }
    if (path === '/api/auth/sign-in/new-api') return send({ token: 'synthetic-local-account' });
    if (path === '/api/v1/account/status') {
      if (request.headers.authorization !== 'Bearer synthetic-local-account') {
        response.statusCode = 401;
        return send({});
      }
      return send({
        id: 'local-owner',
        username: 'joint-a',
        displayName: null,
        quota: 500000,
        quotaUnit: '点',
        canGenerate: true,
        identity: {
          apiIssuer: baseUrl,
          principalId: 'local-principal',
          status: 'active',
          identityVersion: 1,
        },
        recovery: null,
      });
    }
    if (path === '/api/v1/account/execution-binding')
      return send({
        status: 'available',
        apiIssuer: baseUrl,
        principalId: 'local-principal',
        payer: { issuer: 'https://payer.example.invalid', ownerId: 'local-owner' },
        credential: { ref: 'local-credential', version: 1 },
        providerId: 'cloud-default',
        model: 'musefold-image-pro',
        capabilities: { image: true, text: false },
        verifiedAt: new Date().toISOString(),
      });
    if (path.startsWith('/api/v1/generations') && request.method === 'POST')
      cloudCreates.push(path);
    if (path === '/v1/images/generations' && request.method === 'POST') {
      const parsed = JSON.parse(body.toString()) as Record<string, unknown>;
      imageGenerations.push(parsed);
      const ordinal = imageGenerations.length - 1;
      if (failImageGenerations.has(ordinal)) {
        response.statusCode = 503;
        return send({ error: { message: 'sp-p5 fixture image failure' } });
      }
      return send({ data: [{ b64_json: png.toString('base64') }] });
    }
    if (path === '/v1/images/edits' && request.method === 'POST') {
      imageEdits.push({ auth: request.headers.authorization, bytes: body.byteLength });
      return send({ data: [{ b64_json: png.toString('base64') }] });
    }
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      textCalls.push(JSON.parse(body.toString()));
      response.setHeader('content-type', 'text/event-stream');
      const chunk = {
        id: 'fixture-completion',
        created: 1,
        model: 'fixture-text',
        object: 'chat.completion.chunk',
      };
      return response.end(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Draw a warm geometric landscape.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      );
    }
    response.writeHead(404).end('{}');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    imageGenerations,
    imageEdits,
    textCalls,
    cloudCreates,
    githubReads,
    failImages: (ordinals: number[]) => {
      failImageGenerations = new Set(ordinals);
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('SP-P5 正式主进程：冻结参考/部分成功不续发/文本图像身份独立/云默认未验证有界拒绝', async ({}, testInfo) => {
  test.setTimeout(300000);
  const fixture = await spP5Fixture();
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    // ---- 自备 Provider + 文本连接 + 正式方案种子 ----
    const first = await launchV25App('musefold-sp-p5-runs-', {
      env: {
        MUSEFOLD_API_URL: fixture.baseUrl,
        MUSEFOLD_E2E_GITHUB_API_BASE: fixture.baseUrl,
      },
    });
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    const byok = aiProviderSchema.parse(
      await invoke(page, 'aiProviders.create', {
        name: '自备 A',
        baseUrl: `${fixture.baseUrl}/v1`,
        model: 'fixture-a',
        apiKey: 'synthetic-a',
        activate: true,
      }),
    );
    await invoke(page, 'agentConnections.create', {
      name: '自备文本',
      baseUrl: `${fixture.baseUrl}/v1`,
      model: 'fixture-text',
      apiKey: 'synthetic-text',
      activate: true,
    });
    await app.close();
    app = undefined;
    seedFormalTextScheme(userData);
    ({ app } = await launchV25App('musefold-sp-p5-runs-', {
      reuseUserDataDir: userData,
      env: {
        MUSEFOLD_API_URL: fixture.baseUrl,
        MUSEFOLD_E2E_GITHUB_API_BASE: fixture.baseUrl,
      },
    }));
    page = await v25ShellPage(app);
    await expect.poll(() => existsSync(join(userData, 'automation.json'))).toBe(true);
    const discovery = JSON.parse(readFileSync(join(userData, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`http://127.0.0.1:${discovery.port}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${discovery.token}`,
          'content-type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(30000),
      });
      return response;
    };
    const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

    // ---- A) G BYOK 参考图：上传 → 冻结引用 → /v1/images/edits 一次成功 ----
    const uploaded = await call('/v1/uploads', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(uploaded.status).toBe(201);
    const { image } = (await uploaded.json()) as { image: { path: string } };
    expect(readFileSync(image.path)).toEqual(png);
    const submitted = await call('/v1/generations', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'sp-p5 frozen reference',
        providerId: byok.id,
        referenceImagePaths: [image.path],
        consent: 'interactive',
      }),
      headers: { 'idempotency-key': 'sp-p5-g-reference' },
    });
    expect(submitted.status).toBe(202);
    const gJob = (await submitted.json()) as { jobId: string };
    await expect
      .poll(
        async () =>
          ((await json(await call(`/v1/generations/${gJob.jobId}`))) as { status: string }).status,
      )
      .toBe('success');
    expect(fixture.imageEdits).toHaveLength(1);
    expect(fixture.imageEdits[0]?.auth).toBe('Bearer synthetic-a');
    expect(fixture.imageGenerations).toHaveLength(0);

    // ---- B) R 方案 n=2：第 2 张图 503 → 部分成功不续发,同键重放只读 ----
    fixture.failImages([1]); // 第 2 次 /v1/images/generations 失败。
    const partial = await call('/v1/schemes/scheme_e2e_formal/runs', {
      method: 'POST',
      body: JSON.stringify({
        inputs: { topic: 'sp-p5 部分成功' },
        brief: '固定输入',
        n: 2,
        providerId: byok.id,
      }),
      headers: { 'idempotency-key': 'sp-p5-partial' },
    });
    expect(partial.status).toBe(202);
    const rJob = (await partial.json()) as { jobId: string };
    const runState = async () =>
      (await json(await call(`/v1/scheme-runs/${rJob.jobId}`))) as {
        status: string;
        costPoints: number | null;
        assets: unknown[];
      };
    await expect.poll(async () => (await runState()).status, { timeout: 30000 }).toBe('success');
    const partialState = await runState();
    expect(partialState.costPoints).toBeNull(); // 任一 call unknown → 总费用未知。
    expect(partialState.assets).toHaveLength(1);
    expect(fixture.imageGenerations).toHaveLength(2);
    const replayed = await call('/v1/schemes/scheme_e2e_formal/runs', {
      method: 'POST',
      body: JSON.stringify({
        inputs: { topic: 'sp-p5 部分成功' },
        brief: '固定输入',
        n: 2,
        providerId: byok.id,
      }),
      headers: { 'idempotency-key': 'sp-p5-partial' },
    });
    expect(replayed.status).toBe(200);
    const replayState = (await replayed.json()) as {
      status: string;
      costPoints: number | null;
      assets: unknown[];
    };
    expect(replayState).toMatchObject({ status: 'success', costPoints: null });
    expect(replayState.assets).toHaveLength(1);
    expect(fixture.imageGenerations).toHaveLength(2); // 不补发第 2 张图。

    // ---- C) S Skill：文本 unknown 恒不冒充图像点数 ----
    const skillJob = await call('/v1/skills/github/run', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://github.com/fixture/visual',
        prompt: 'sp-p5 skill identity',
        n: 1,
        providerId: byok.id,
      }),
      headers: { 'idempotency-key': 'sp-p5-skill' },
    });
    expect(skillJob.status).toBe(202);
    const sJob = (await skillJob.json()) as { jobId: string };
    const skillState = async () =>
      (await json(await call(`/v1/skill-runs/${sJob.jobId}`))) as {
        status: string;
        costPoints: number | null;
      };
    await expect.poll(async () => (await skillState()).status, { timeout: 30000 }).toBe('success');
    expect((await skillState()).costPoints).toBeNull(); // 文本 unknown → 不产生已知点数。
    expect(fixture.textCalls).toHaveLength(1);
    expect(fixture.imageGenerations).toHaveLength(3);

    // ---- D) 云启用为默认但登录态缺失：不带 providerId 的 R 是有界拒绝;显式 BYOK 正常 ----
    await connectCloud(page);
    const connections = (await invoke(page, 'aiProviders.list')) as Array<{
      id: string;
      type: string;
      isActive: boolean;
    }>;
    const cloud = connections.find((item) => item.type === 'musefold-cloud');
    if (!cloud) throw new Error('Cloud connection missing');
    await invoke(page, 'aiProviders.setActive', { id: cloud.id }); // 默认选择只看 is_active。
    // RS-MAP 后已验证会话走 managed 子执行；登出移除本地会话凭据，钉死未验证有界拒绝边界。
    await invoke(page, 'account.logout');
    fixture.failImages([]); // 后续图像全部成功。
    const countsBeforeCloud = {
      generations: fixture.imageGenerations.length,
      edits: fixture.imageEdits.length,
      text: fixture.textCalls.length,
    };
    const cloudBody = JSON.stringify({ inputs: { topic: 'sp-p5 云默认' }, n: 2 });
    const cloudRejected = await call('/v1/schemes/scheme_e2e_formal/runs', {
      method: 'POST',
      body: cloudBody,
      headers: { 'idempotency-key': 'sp-p5-cloud-default' },
    });
    expect(cloudRejected.status).toBe(409);
    expect(((await cloudRejected.json()) as { error: { code: string } }).error.code).toBe(
      'PAYMENT_IDENTITY_UNBOUND',
    );
    expect(fixture.imageGenerations).toHaveLength(countsBeforeCloud.generations);
    expect(fixture.imageEdits).toHaveLength(countsBeforeCloud.edits);
    expect(fixture.textCalls).toHaveLength(countsBeforeCloud.text);
    expect(fixture.cloudCreates).toEqual([]); // 既不本地发送,也不隐式改走云提交。
    const cloudReplay = await call('/v1/schemes/scheme_e2e_formal/runs', {
      method: 'POST',
      body: cloudBody,
      headers: { 'idempotency-key': 'sp-p5-cloud-default' },
    });
    expect(cloudReplay.status).toBe(409);
    expect(((await cloudReplay.json()) as { error: { code: string } }).error.code).toBe(
      'PAYMENT_IDENTITY_UNBOUND',
    );
    expect(fixture.imageGenerations).toHaveLength(countsBeforeCloud.generations);
    expect(fixture.cloudCreates).toEqual([]);
    const explicitByok = await call('/v1/schemes/scheme_e2e_formal/runs', {
      method: 'POST',
      body: JSON.stringify({ inputs: { topic: 'sp-p5 显式自备' }, n: 2, providerId: byok.id }),
      headers: { 'idempotency-key': 'sp-p5-cloud-explicit-byok' },
    });
    expect(explicitByok.status).toBe(202);
    const byokJob = (await explicitByok.json()) as { jobId: string };
    const byokState = async () =>
      (await json(await call(`/v1/scheme-runs/${byokJob.jobId}`))) as {
        status: string;
        costPoints: number;
      };
    await expect.poll(async () => (await byokState()).status, { timeout: 30000 }).toBe('success');
    expect(fixture.imageGenerations).toHaveLength(countsBeforeCloud.generations + 2);
    expect(fixture.cloudCreates).toEqual([]);

    // ---- SQLite 账本与审计事实 ----
    const db = new Database(desktopDbPath(userData), { readonly: true });
    type RequestRow = { id: string; state: string; outcome: string; error_code: string | null };
    type CallRow = { kind: string; cost_source: string; reported_points: number | null };
    let requests: RequestRow[];
    let partialCalls: CallRow[];
    let skillCalls: CallRow[];
    let cloudAudits: number;
    try {
      requests = db
        .prepare(
          `SELECT id,state,outcome,error_code FROM automation_spend_requests
           WHERE idempotency_key IN ('sp-p5-partial','sp-p5-skill','sp-p5-cloud-default') ORDER BY id`,
        )
        .all() as RequestRow[];
      const byKey = (key: string) =>
        db
          .prepare('SELECT id FROM automation_spend_requests WHERE idempotency_key = ?')
          .get(key) as { id: string };
      partialCalls = db
        .prepare(
          'SELECT kind,cost_source,reported_points FROM automation_spend_calls WHERE request_id = ? ORDER BY ordinal',
        )
        .all(byKey('sp-p5-partial').id) as CallRow[];
      skillCalls = db
        .prepare(
          'SELECT kind,cost_source,reported_points FROM automation_spend_calls WHERE request_id = ? ORDER BY ordinal',
        )
        .all(byKey('sp-p5-skill').id) as CallRow[];
      cloudAudits = (
        db
          .prepare('SELECT COUNT(*) AS n FROM automation_audit WHERE automation_request_id = ?')
          .get(byKey('sp-p5-cloud-default').id) as { n: number }
      ).n;
    } finally {
      db.close();
    }
    expect(requests).toHaveLength(3);
    expect(requests.every((row) => row.state === 'terminal')).toBe(true);
    // 部分成功:两张图各自成行,BYOK 无本地价格 → 恒 unknown,总费用不落已知点数。
    expect(partialCalls.map((call) => call.kind)).toEqual(['image', 'image']);
    expect(partialCalls.every((call) => call.reported_points === null)).toBe(true);
    // Skill:文本与图像分列(身份独立),文本恒 unknown,不冒充图像点数。
    expect(skillCalls.map((call) => call.kind)).toEqual(['image', 'text']);
    expect(skillCalls.every((call) => call.reported_points === null)).toBe(true);
    expect(cloudAudits).toBe(1); // 同键两次拒绝只审计一次。

    await testInfo.attach('sp-p5-electron-evidence.json', {
      body: JSON.stringify(
        {
          boundary:
            'Real Electron main process + loopback Provider/account/GitHub control plane + real SQLite. No paid upstream; synthetic credentials only.',
          imageGenerations: fixture.imageGenerations.length,
          imageEdits: fixture.imageEdits.length,
          textCalls: fixture.textCalls.length,
          cloudCreates: fixture.cloudCreates,
          githubReads: fixture.githubReads.length,
          partial: { status: 'success', costPoints: null, assets: 1, ledger: partialCalls },
          skillLedger: skillCalls,
          cloudDefault: { rejected: 'PAYMENT_IDENTITY_UNBOUND', audits: cloudAudits },
          requests: requests,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
    await fixture.close();
  }
});
