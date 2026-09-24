import { expect, test } from '@playwright/test';

/**
 * 官网可交互演示验收:真实操作 iframe 内的复刻 UI——
 * 导航切屏、提示词搜索、inspector 回填、工作台输入+生成、模型菜单。
 */
test('官网交互演示全链路', async ({ page }) => {
  await page.goto('http://127.0.0.1:8777/');
  // 两处演示帧共用 src 前缀;iframe 为 lazy,先滚到可视区触发加载。
  const libraryHost = page.locator('iframe[src^="assets/demo/index.html"]').first();
  await libraryHost.scrollIntoViewIfNeeded();
  const frame = libraryHost.contentFrame();

  // 提示词库初始屏(#library)
  await expect(frame.getByText('新建提示词')).toBeVisible({ timeout: 10_000 });
  // 搜索过滤
  await frame.locator('#libSearch').fill('图书馆');
  await expect(frame.locator('.prompt-row')).toHaveCount(1);
  await frame.locator('#libSearch').fill('');
  // 选中行 → inspector → 回填工作台
  await frame.getByText('透明背景护肤品主视觉', { exact: true }).click();
  await expect(frame.getByText('提示词正文')).toBeVisible();
  await frame.getByRole('button', { name: /回填工作台/ }).click();
  await expect(frame.locator('#promptInput')).toHaveValue(/护肤品/);
  // 生成:模拟进度 → 出图
  await expect(frame.locator('#sendBtn')).toBeEnabled();
  await frame.locator('#sendBtn').click();
  await expect(frame.locator('.gen-card img').first()).toBeVisible({ timeout: 10_000 });
  // 模型菜单切换
  await frame.locator('#modelPill').click();
  await frame.getByRole('option', { name: /gpt-image-2/ }).click();
  await expect(frame.locator('#modelPill .name')).toHaveText('gpt-image-2');
  // 侧栏导航切屏
  await frame.getByRole('button', { name: '提示词库' }).click();
  await expect(frame.getByText('新建提示词')).toBeVisible();
  await frame.getByRole('button', { name: '工作台', exact: true }).click();
  await expect(frame.locator('#promptInput')).toBeVisible();

  // 第二处演示帧(工作台初始屏)也能加载交互
  const workbenchHost = page.locator('iframe[src^="assets/demo/index.html"]').nth(1);
  await workbenchHost.scrollIntoViewIfNeeded();
  const wb = workbenchHost.contentFrame();
  await expect(wb.locator('#promptInput')).toBeVisible({ timeout: 10_000 });
  await wb.locator('#promptInput').fill('官网演示:雨夜东京街角');
  await expect(wb.locator('#sendBtn')).toBeEnabled();
});
