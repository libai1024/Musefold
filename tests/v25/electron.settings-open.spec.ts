import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage } from './electron-helpers';

/**
 * 设置「开放能力」的桌面闭环(07-settings-04 / 01-shell §4)。
 *
 * 本文件是**安全回归**的落点:掩码令牌、主进程复制、轮换即失效、关闭即停听、
 * 预算持久化。断言全部对着真实的回环 HTTP 服务与真实落盘文件,不信任 UI 自述。
 *
 * 独占一次性 userData:用例会真的开关端口、轮换令牌、改预算。
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

/** 发现文件(automation-server/discovery.ts):userData/automation.json,0600。 */
const DISCOVERY_FILE = 'automation.json';
/** 主 electron-store 文件(core constants STORE_NAME + 数据命名空间)。 */
const STORE_FILE = 'musefold-providers-v0.3.0.json';

interface Discovery {
  port: number;
  token: string;
}

function readDiscovery(): Discovery | null {
  try {
    const raw = JSON.parse(readFileSync(join(userDataDir, DISCOVERY_FILE), 'utf8')) as Discovery;
    return typeof raw.token === 'string' && typeof raw.port === 'number' ? raw : null;
  } catch {
    return null;
  }
}

function readStoredBudget(): { monthlyLimitPoints?: number; usedPoints?: number } | null {
  try {
    const raw = JSON.parse(readFileSync(join(userDataDir, STORE_FILE), 'utf8')) as {
      automation?: { budget?: { monthlyLimitPoints?: number; usedPoints?: number } };
    };
    return raw.automation?.budget ?? null;
  } catch {
    return null;
  }
}

/** 带令牌打一次 /v1/health;连不上(端口停听)返回 0。 */
async function health(port: number, token: string): Promise<number> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function openSettingsSection(id: string): Promise<void> {
  await page.getByTestId(`settings-nav-${id}`).click();
  await expect(page.getByTestId(`settings-section-${id}`)).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, userDataDir } = await launchV25App('musefold-v25-e2e-open-'));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('v25-shell')).toBeVisible();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('开放能力分区:桌面注册三张卡(控制面/最近调用/接入向导)', async () => {
  await openSettingsSection('open');
  await expect(page.getByTestId('settings-automation-card')).toBeVisible();
  await expect(page.getByTestId('settings-automation-audit-card')).toBeVisible();
  await expect(page.getByTestId('settings-automation-guide-card')).toBeVisible();

  // 控制面默认开(D7):地址行指向真实回环端口。
  await expect(page.getByTestId('settings-automation-toggle')).toHaveAttribute(
    'data-state',
    'checked',
  );
  const discovery = readDiscovery();
  expect(discovery).not.toBeNull();
  await expect(page.getByTestId('settings-automation-address')).toHaveText(
    `http://127.0.0.1:${discovery?.port}`,
  );
  expect(await health(discovery?.port ?? 0, discovery?.token ?? '')).toBe(200);
});

test('令牌只以掩码呈现:DOM 与渲染层可达存储都不含完整令牌', async () => {
  await openSettingsSection('open');
  const token = readDiscovery()?.token ?? '';
  expect(token.length).toBeGreaterThan(8);

  // 掩码口径:前 4 + … + 后 4。
  await expect(page.getByTestId('settings-automation-token')).toHaveText(
    `${token.slice(0, 4)}…${token.slice(-4)}`,
  );

  // 整个渲染层文档(含 script/属性)里不出现完整令牌。
  expect(await page.content()).not.toContain(token);

  // 发现文件是令牌的**唯一**落盘位置且为 0600;其余 userData 文件都不得包含它。
  expect(statSync(join(userDataDir, DISCOVERY_FILE)).mode & 0o777).toBe(0o600);
  for (const name of readdirSync(userDataDir)) {
    if (name === DISCOVERY_FILE) continue;
    let text: string;
    try {
      const path = join(userDataDir, name);
      if (!statSync(path).isFile()) continue;
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    expect(text, `${name} 不应包含控制面令牌`).not.toContain(token);
  }
});

test('复制令牌经主进程写系统剪贴板(渲染层不持有明文)', async () => {
  await openSettingsSection('open');
  const token = readDiscovery()?.token ?? '';

  await page.getByTestId('settings-automation-token-copy').click();
  await expect(page.getByText('令牌已复制到剪贴板')).toBeVisible();
  const clipboardText = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clipboardText).toBe(token);
  // 复制之后 DOM 里依然只有掩码。
  expect(await page.content()).not.toContain(token);
});

test('轮换令牌:AlertDialog 二次确认,旧令牌立即 401,新令牌可用', async () => {
  await openSettingsSection('open');
  const before = readDiscovery();
  expect(before).not.toBeNull();
  const port = before?.port ?? 0;
  const oldToken = before?.token ?? '';

  await page.getByTestId('settings-automation-token-rotate').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('轮换访问令牌?');
  await expect(dialog).toContainText('旧令牌立即失效');
  await page.getByTestId('settings-automation-token-rotate-confirm').click();
  await expect(page.getByRole('alertdialog')).toBeHidden();

  await expect.poll(() => readDiscovery()?.token, { timeout: 10_000 }).not.toBe(oldToken);
  const newToken = readDiscovery()?.token ?? '';
  expect(newToken).not.toBe(oldToken);
  expect(await health(port, oldToken)).toBe(401);
  expect(await health(port, newToken)).toBe(200);
  await expect(page.getByTestId('settings-automation-token')).toHaveText(
    `${newToken.slice(0, 4)}…${newToken.slice(-4)}`,
  );
});

test('月度预算:防呆(清空不落盘)+ 落进既有预算存储 + 重启后仍在', async () => {
  await openSettingsSection('open');
  const input = page.getByTestId('settings-automation-budget-input');
  const save = page.getByTestId('settings-automation-budget-save');

  // 草稿 = 服务端真值 → 保存禁用;清空输入也不可保存(绝不把预算悄悄改成 0)。
  await expect(save).toBeDisabled();
  await input.fill('');
  await expect(save).toBeDisabled();

  await input.fill('250');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('月度预算已保存:250 积分')).toBeVisible();
  await expect(page.getByTestId('settings-automation-budget-readout')).toContainText('/ 250 积分');

  // 落进主进程既有存储(与生图闸门同一命名空间),不是另起一份。
  await expect.poll(() => readStoredBudget()?.monthlyLimitPoints, { timeout: 5_000 }).toBe(250);

  // 重启同一 userData:预算仍是 250。
  await app.close();
  ({ app } = await launchV25App('musefold-v25-e2e-open-', userDataDir));
  page = await v25ShellPage(app);
  await expect(page.getByTestId('v25-shell')).toBeVisible();
  await page.getByTestId('nav-settings').click();
  await openSettingsSection('open');
  await expect(page.getByTestId('settings-automation-budget-input')).toHaveValue('250');
});

test('最近调用:折叠区默认收起,展开后能看到自己刚打过的请求', async () => {
  await openSettingsSection('open');
  const discovery = readDiscovery();
  // 制造两条可断言的调用:一条成功、一条无令牌 401。
  expect(await health(discovery?.port ?? 0, discovery?.token ?? '')).toBe(200);
  const unauthorized = await fetch(`http://127.0.0.1:${discovery?.port}/v1/health`).catch(
    () => null,
  );
  expect(unauthorized?.status).toBe(401);

  await expect(page.getByTestId('settings-automation-audit-body')).toBeHidden();
  await page.getByTestId('settings-automation-audit-toggle').click();
  const log = page.getByTestId('settings-automation-request-log');
  await expect(log).toBeVisible();
  await expect(log).toContainText('/v1/health');
  await expect(log).toContainText('401');
  // 花钱记录本次未发生:空态文案而不是空白。
  await expect(
    page
      .getByTestId('settings-automation-spend-audit')
      .or(page.getByTestId('settings-automation-spend-audit-empty')),
  ).toBeVisible();
});

test('接入向导:三段片段可复制且不含用户绝对路径与令牌', async () => {
  await openSettingsSection('open');
  const token = readDiscovery()?.token ?? '';
  const home = process.env.HOME ?? '';

  for (const kind of ['mcp', 'codex', 'claude']) {
    const snippet = page.getByTestId(`settings-automation-guide-${kind}`);
    await expect(snippet).toBeVisible();
    const text = (await snippet.innerText()) ?? '';
    expect(text).not.toContain(token);
    if (home) expect(text).not.toContain(home);
    await expect(page.getByTestId(`settings-automation-guide-${kind}-copy`)).toBeVisible();
  }
});

test('关闭开关:端口停听、发现文件删除、令牌行降级', async () => {
  await openSettingsSection('open');
  const before = readDiscovery();
  const port = before?.port ?? 0;
  const token = before?.token ?? '';
  expect(await health(port, token)).toBe(200);

  await page.getByTestId('settings-automation-toggle').click();
  await expect(page.getByTestId('settings-automation-toggle')).toHaveAttribute(
    'data-state',
    'unchecked',
  );
  await expect(page.getByTestId('settings-automation-address-row')).toBeHidden();
  await expect(page.getByTestId('settings-automation-token')).toHaveText('—');
  await expect(page.getByTestId('settings-automation-token-rotate')).toBeDisabled();

  // 端口真的不再监听,发现文件也删了(客户端无从发现)。
  await expect.poll(() => health(port, token), { timeout: 10_000 }).toBe(0);
  await expect.poll(() => readDiscovery(), { timeout: 5_000 }).toBeNull();

  // 关闭态可逆:重新打开后端口与令牌都回来(令牌是新的)。
  await page.getByTestId('settings-automation-toggle').click();
  await expect(page.getByTestId('settings-automation-toggle')).toHaveAttribute(
    'data-state',
    'checked',
  );
  await expect.poll(() => readDiscovery()?.port, { timeout: 10_000 }).toBeGreaterThan(0);
  const after = readDiscovery();
  expect(await health(after?.port ?? 0, after?.token ?? '')).toBe(200);
});

test('已连接应用卡:开放能力分区底部可见(未登录夹具显示登录门控)', async () => {
  await openSettingsSection('open');
  await expect(page.getByTestId('settings-connected-apps-card')).toBeVisible();
  await expect(page.getByTestId('settings-connected-apps-signed-out')).toContainText(
    '登录 Musefold 账号后可管理',
  );
});
