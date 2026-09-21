import { createServer, type ServerResponse } from 'node:http';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';

// 桌面首启引导全链路(U01-onboarding):fresh userData → 引导层 → BYOK 轨建本地连接 →
// validate(回环 /v1/models,不发外网请求)→ first-image 经 pendingDraft 送工作台 → 不重放。
// 桌面三轨齐全(账号 / BYOK / 豆包),豆包轨只在此断言入口可见,不进冻结面内部。

let app: ElectronApplication | undefined;
let page: Page;
let userDataDir: string;
let gateway: ModelsServer;

const PROMPT = 'a cozy cabin in snowy forest, cinematic';

interface ModelsServer {
  baseUrl: string;
  modelsRequests(): number;
  close(): Promise<void>;
}

/**
 * 回环 OpenAI 兼容网关:只应答「测试连接」用的 GET /v1/models。
 * 生图端点故意不实现——引导流程不该发起任何生成请求,真发了就是 404 + 计数为 0 的断言失败。
 */
async function startModelsServer(): Promise<ModelsServer> {
  let modelsRequests = 0;
  const responses = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    responses.add(response);
    response.on('close', () => responses.delete(response));
    if (request.method === 'GET' && request.url?.endsWith('/models')) {
      modelsRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'e2e-image-model' }],
          has_more: false,
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('回环网关未取得 TCP 端口');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    modelsRequests: () => modelsRequests,
    close: async () => {
      for (const response of responses) response.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function countRows(table: string): number {
  const db = new Database(desktopDbPath(userDataDir), { readonly: true });
  try {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  } finally {
    db.close();
  }
}

test.beforeAll(async () => {
  gateway = await startModelsServer();
  // onboarding: 'pending' = 不预置完成哨兵,走真实首次启动(其余 spec 默认预置)。
  ({ app, userDataDir } = await launchV25App('musefold-v25-onboarding-', {
    onboarding: 'pending',
  }));
  page = await v25ShellPage(app);
});

test.afterAll(async () => {
  await app?.close();
  await gateway.close();
});

test('fresh userData:引导层弹出,桌面三轨齐全', async () => {
  const flow = page.getByTestId('onboarding-flow');
  await expect(flow).toBeVisible();
  await expect(flow).toHaveAttribute('role', 'dialog');
  await expect(page.getByTestId('onboarding-step-welcome')).toBeVisible();

  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-connect')).toBeVisible();
  await expect(page.getByTestId('onboarding-track-account')).toBeVisible();
  // 桌面 capability 全开:自备 API 与豆包免费试用都在轨道列表里。
  await expect(page.getByTestId('onboarding-track-byok')).toBeVisible();
  await expect(page.getByTestId('onboarding-track-doubao')).toBeVisible();
});

test('BYOK 轨:建本地连接 → 确认连接 → 首图提示词进工作台,不发起生成', async () => {
  await page.getByTestId('onboarding-track-byok').click();
  await expect(page.getByTestId('onboarding-byok-form')).toBeVisible();

  await page.getByTestId('onboarding-byok-name').fill('E2E 回环网关');
  await page.getByTestId('onboarding-byok-base-url').fill(gateway.baseUrl);
  await page.getByTestId('onboarding-byok-model').fill('e2e-image-model');
  await page.getByTestId('onboarding-byok-api-key').fill('sk-e2e-onboarding');
  await page.getByTestId('onboarding-next').click();

  // validate 进入即自动确认一次:回环 /v1/models 返回 200 → 连接正常。
  // 探测本身 8s 超时;给结果行留出主进程排队余量,避免只等到默认 5s。
  await expect(page.getByTestId('onboarding-step-validate')).toBeVisible();
  await expect(page.getByTestId('onboarding-validate-result')).toContainText('连接正常', {
    timeout: 15_000,
  });
  expect(gateway.modelsRequests()).toBeGreaterThan(0);

  // 连接落库:API Key 进系统安全存储(has_key=1),库里不存明文。
  const db = new Database(desktopDbPath(userDataDir), { readonly: true });
  const provider = db
    .prepare('SELECT name, base_url, model, has_key, is_active FROM providers')
    .get() as
    | { name: string; base_url: string; model: string; has_key: number; is_active: number }
    | undefined;
  db.close();
  expect(provider).toMatchObject({
    name: 'E2E 回环网关',
    base_url: gateway.baseUrl,
    model: 'e2e-image-model',
    has_key: 1,
    is_active: 1,
  });

  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-step-first-image')).toBeVisible();
  await page.getByTestId('onboarding-example-0').click();
  await expect(page.getByTestId('onboarding-prompt')).toHaveValue(PROMPT);
  await page.getByTestId('onboarding-next').click();

  // 收尾:引导层撤走、切到工作台、提示词落在 Composer 里等用户自己发送。
  await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('composer-prompt')).toHaveValue(PROMPT);
  // 引导不代替用户生图:一条运行都不该落库。
  expect(countRows('generation_runs')).toBe(0);
});

test('再次启动:哨兵已落,引导不重放', async () => {
  await app?.close();
  // 复用同一 userData 且不预置哨兵:哨兵必须是上一条用例里应用自己写下的。
  ({ app } = await launchV25App('musefold-v25-onboarding-', {
    reuseUserDataDir: userDataDir,
    onboarding: 'pending',
  }));
  page = await v25ShellPage(app);

  await expect(page.getByTestId('v25-shell')).toBeVisible();
  await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
});
