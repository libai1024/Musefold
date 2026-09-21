// D02.6 E2E：长驻 Automation 上传的终态显式释放与自然期限回收。
// 真实 Electron + 真实 HTTP 控制面 + 真实回环 Provider；断言文件字节与 SQLite 行。
// 覆盖：控制面运行中（不停止服务）终态释放把已消费上传降级为 referenced；
// 未消费上传在新 PID 崩溃重启后由启动 drain 回收；冻结引用字节不变。

import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { aiProviderSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { killCloudProcess } from './cloud-crash-helpers';
import { localInvoke } from './local-execution-fixture';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('terminal release reclaims an unused upload while a frozen reference survives a new PID', async () => {
  test.setTimeout(300000);
  let sends = 0;
  const provider = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    if (request.method !== 'POST' || request.url !== '/v1/images/edits') {
      response.writeHead(404).end();
      return;
    }
    sends++;
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned server');
  let app: ElectronApplication | undefined;
  let root = '';
  const queueRow = (path: string) => {
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      return db
        .prepare('SELECT state,last_error,next_attempt_at FROM local_asset_cleanup WHERE path=?')
        .get(realpathSync(path)) as
        | { state: string; last_error: string | null; next_attempt_at: number }
        | undefined;
    } finally {
      db.close();
    }
  };
  const requestsFacts = () => {
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      return db.prepare('SELECT * FROM automation_spend_requests ORDER BY id').all();
    } finally {
      db.close();
    }
  };
  const call = async (path: string, init: RequestInit = {}) => {
    const discovery = JSON.parse(readFileSync(join(root, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    return fetch(`http://127.0.0.1:${discovery.port}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${discovery.token}`, ...init.headers },
      signal: AbortSignal.timeout(15000),
    });
  };
  const upload = async () => {
    const response = await call('/v1/uploads', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(response.status).toBe(201);
    const { image } = (await response.json()) as { image: { path: string } };
    expect(readFileSync(image.path)).toEqual(png);
    return image.path;
  };
  try {
    ({ app, userDataDir: root } = await launchV25App('musefold-owned-upload-release-'));
    const page = await v25ShellPage(app);
    const connection = aiProviderSchema.parse(
      await localInvoke(page, 'aiProviders.create', {
        name: 'Owned upload release',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'fixture-image',
        apiKey: 'synthetic-owned-key',
        activate: true,
      }),
    );
    await expect.poll(() => existsSync(join(root, 'automation.json'))).toBe(true);

    // 控制面运行中上传两张：A 供生成消费（冻结引用），B 完全未使用。
    const used = await upload();
    const unused = await upload();
    const input = {
      prompt: 'Owned upload release',
      providerId: connection.id,
      referenceImagePaths: [used],
      consent: 'interactive',
    };
    const submitted = await call('/v1/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'owned-upload-release',
      },
      body: JSON.stringify(input),
    });
    expect(submitted.status).toBe(202);
    const job = (await submitted.json()) as { jobId: string };
    await expect
      .poll(async () => {
        const response = await call(`/v1/generations/${job.jobId}`);
        expect(response.ok).toBe(true);
        return ((await response.json()) as { status: string }).status;
      })
      .toBe('success');
    expect(sends).toBe(1);

    // 终态释放发生在控制面仍运行时：A 降级为 referenced（不删），B 仍被持有（writing）。
    await expect.poll(() => queueRow(used)?.last_error, { timeout: 30000 }).toBe('referenced');
    expect(readFileSync(used)).toEqual(png);
    expect(queueRow(unused)?.last_error).toBe('writing');
    expect(readFileSync(unused)).toEqual(png);
    const beforeRequests = requestsFacts();
    expect(beforeRequests).toHaveLength(1);

    // 再传一张 C：专归新 PID 启动 drain 回收。SIGKILL 模拟崩溃，跳过停机 close。
    const reclaimed = await upload();
    const pid = app.process().pid;
    await killCloudProcess(app);
    app = undefined;
    ({ app } = await launchV25App('musefold-owned-upload-release-', { reuseUserDataDir: root }));
    expect(app.process().pid).not.toBe(pid);
    await v25ShellPage(app);

    // 无引用上传（B、C）由新宿主启动 drain 回收（行可能在 defer 窗口内，轮询到 60s timer 触发）。
    await expect.poll(() => existsSync(reclaimed), { timeout: 150000 }).toBe(false);
    expect(existsSync(unused)).toBe(false);
    // 冻结引用的 A 字节不变，行保持 referenced，账本不变。
    expect(readFileSync(used)).toEqual(png);
    expect(queueRow(used)?.last_error).toBe('referenced');
    expect(requestsFacts()).toEqual(beforeRequests);
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM local_asset_cleanup').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  } finally {
    await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    if (root) rmSync(root, { recursive: true, force: true });
  }
});
