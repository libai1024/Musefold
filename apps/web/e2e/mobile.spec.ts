import { expect, test, type Page } from '@playwright/test';

/**
 * v1.1.1 mobile UI: touch-first сценарии на 390×844 c эмуляцией тача
 * (hasTouch → в Chromium матчатся `pointer: coarse` и `hover: none`).
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function waitForFixtureWorkspace(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('generation-workbench')).toBeVisible();
  await expect(page.getByText('开发预览', { exact: true })).toBeVisible();
}

async function openCompactSidebar(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '展开侧栏' });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
  await expect(page.getByTestId('product-sidebar')).toBeVisible();
}

async function chooseCompactNav(page: Page, testId: string): Promise<void> {
  await openCompactSidebar(page);
  await page.getByTestId('product-sidebar').getByTestId(testId).click();
}

async function expectTouchMediaEmulated(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => ({
      coarse: window.matchMedia('(pointer: coarse)').matches,
      hoverNone: window.matchMedia('(hover: none)').matches,
    })),
  ).toEqual({ coarse: true, hoverNone: true });
}

test('composer popovers open as full-width bottom sheets', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);
  await expectTouchMediaEmulated(page);
  const viewport = page.viewportSize()!;

  await page.getByTestId('refine-ratio-trigger').click();
  const ratioMenu = page.getByTestId('refine-ratio-menu');
  await expect(ratioMenu).toBeVisible();
  const ratioBox = (await ratioMenu.boundingBox())!;
  expect(ratioBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(ratioBox.y + ratioBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
  await page.getByTestId('refine-ratio-16:9').click();
  await expect(page.getByTestId('refine-ratio-trigger')).toHaveAttribute('data-value', '16:9');
  await expect(ratioMenu).toHaveCount(0);

  await page.getByTestId('workbench-more-settings').click();
  const settings = page.getByTestId('workbench-generation-options');
  await expect(settings).toBeVisible();
  const settingsBox = (await settings.boundingBox())!;
  expect(settingsBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(settingsBox.y + settingsBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
  await settings.getByRole('radio', { name: '超清' }).click();
  await expect(page.getByTestId('workbench-more-settings')).toContainText('超清');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('session rows expose a visible touch menu instead of right-click', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);
  await expectTouchMediaEmulated(page);

  const prompt = page.getByTestId('generation-composer-prompt');
  await prompt.fill('触屏会话菜单测试');
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });

  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(page.getByTestId('product-sidebar')).toBeVisible();

  // Клавиатурные подсказки скрыты на таче.
  await expect(page.getByTestId('sidebar-new-design').locator('kbd')).toBeHidden();

  const sessionRow = page.locator('[data-conversation-row]').first();
  const moreButton = sessionRow.getByTestId('conversation-more');
  await expect(moreButton).toBeVisible();
  // Hover-пара pin/archive заменена одной явной целью «…».
  await expect(sessionRow.getByTestId('conversation-hover-pin')).toBeHidden();
  const moreBox = (await moreButton.boundingBox())!;
  expect(moreBox.width).toBeGreaterThanOrEqual(36);
  expect(moreBox.height).toBeGreaterThanOrEqual(36);

  await moreButton.click();
  await expect(page.getByTestId('conversation-context-pin')).toBeVisible();
  await page.getByTestId('conversation-context-pin').click();
  await expect(page.getByRole('heading', { name: '置顶' })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('soft keyboard keeps composer visible in the shrunken viewport', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible();
  await expect(page.getByTestId('web-topbar-search')).toBeVisible();
  await expect(page.getByLabel(/可用额度/)).toBeVisible();

  const prompt = page.getByTestId('generation-composer-prompt');
  await prompt.click();
  await expect(prompt).toBeFocused();

  // Симуляция экранной клавиатуры в режиме resizes-content: layout viewport
  // сжимается, пока composer в фокусе (см. useKeyboardInset).
  await page.setViewportSize({ width: 390, height: 460 });
  const composerBox = (await page.getByTestId('workbench-composer-surface').boundingBox())!;
  expect(composerBox.y).toBeGreaterThanOrEqual(0);
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(460 + 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('workbench-composer-surface')).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('touch targets meet the mobile size contract', async ({ page }) => {
  await waitForFixtureWorkspace(page);
  await expectTouchMediaEmulated(page);

  const submitBox = (await page.getByLabel('生成图片').boundingBox())!;
  expect(submitBox.width).toBeGreaterThanOrEqual(44);
  expect(submitBox.height).toBeGreaterThanOrEqual(44);

  const ratioBox = (await page.getByTestId('refine-ratio-trigger').boundingBox())!;
  expect(ratioBox.height).toBeGreaterThanOrEqual(40);

  await openCompactSidebar(page);
  for (const button of await page
    .getByTestId('product-sidebar')
    .locator('.mf-product-sidebar-nav-button')
    .all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByTestId('sidebar-scrim').click();

  // Поле composer ≥16px — iOS Safari не делает авто-зум при фокусе.
  const promptFontSize = await page
    .getByTestId('generation-composer-prompt')
    .evaluate((element) => window.getComputedStyle(element).fontSize);
  expect(Number.parseFloat(promptFontSize)).toBeGreaterThanOrEqual(16);

  // Метка пропорций не обрезается (была «1…» при фиксированной ширине 82px),
  // при этом строка composer'а по-прежнему не переполняется.
  for (const ratio of ['1:1', '16:9', '9:16']) {
    if (ratio !== '1:1') {
      await page.getByTestId('refine-ratio-trigger').click();
      await page.getByTestId(`refine-ratio-${ratio}`).click();
    }
    const label = page
      .getByTestId('refine-ratio-trigger')
      .locator('span:not(.mf-workbench-ratio-preview)');
    await expect(label).toHaveText(ratio);
    const metrics = await label.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  }
  const composerFits = await page
    .getByTestId('workbench-composer-surface')
    .evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  expect(composerFits).toBe(true);
});

test('generated image opens in the lightbox with download action', async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);

  await page.getByTestId('generation-composer-prompt').fill('移动端灯箱预览测试');
  await page.getByLabel('生成图片').click();
  await expect(page.locator('.generated-asset img')).toBeVisible({
    timeout: 8_000,
  });

  await page.getByTestId('generation-result-image').click();
  await expect(page.getByTestId('image-lightbox')).toBeVisible();
  await expect(page.getByTestId('image-lightbox-image')).toBeVisible();
  await expect(page.getByTestId('image-lightbox-save')).toBeVisible();
  await page.getByTestId('image-lightbox-close').click();
  await expect(page.getByTestId('image-lightbox')).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('left drawer holds functions, conversations and account; main stays the composer', async ({
  page,
}) => {
  const browserErrors = collectBrowserErrors(page);
  await waitForFixtureWorkspace(page);
  await expectTouchMediaEmulated(page);

  await expect(page.getByRole('navigation', { name: '移动端导航' })).toHaveCount(0);
  await expect(page.getByTestId('workbench-composer-surface')).toBeVisible();
  await expect(page.getByTestId('generation-directions')).toBeHidden();
  await expect(page.getByTestId('web-topbar-search')).toBeVisible();
  await expect(page.getByLabel(/可用额度/)).toBeVisible();

  await openCompactSidebar(page);
  const sidebar = page.getByTestId('product-sidebar');
  await expect(sidebar.getByText('功能', { exact: true })).toBeVisible();
  await expect(sidebar.getByTestId('nav-prompts')).toBeVisible();
  await expect(sidebar.getByTestId('nav-history')).toBeVisible();
  await expect(sidebar.getByTestId('nav-connections')).toBeVisible();
  await expect(sidebar.getByTestId('workbench-session-list')).toBeVisible();
  await expect(sidebar.getByTestId('sidebar-account')).toBeVisible();

  const drawerMetrics = await sidebar.evaluate((root) => {
    const nav = root.querySelector('[aria-label="主导航"]');
    const sessions = root.querySelector('[data-testid="workbench-session-list"]');
    const account = root.querySelector('[data-testid="sidebar-account"]');
    if (!nav || !sessions || !account) return null;
    const rootBox = root.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    const sessionBox = sessions.getBoundingClientRect();
    const accountBox = account.getBoundingClientRect();
    return {
      navBelowHeader: navBox.top > rootBox.top,
      sessionsBelowNav: sessionBox.top >= navBox.bottom - 1,
      accountBelowSessions: accountBox.top >= sessionBox.bottom - 1,
      accountAtBottom: Math.round(rootBox.bottom - accountBox.bottom) <= 2,
      accountHeight: Math.round(accountBox.height),
    };
  });
  expect(drawerMetrics).not.toBeNull();
  expect(drawerMetrics!.navBelowHeader).toBe(true);
  expect(drawerMetrics!.sessionsBelowNav).toBe(true);
  expect(drawerMetrics!.accountBelowSessions).toBe(true);
  expect(drawerMetrics!.accountAtBottom).toBe(true);
  expect(drawerMetrics!.accountHeight).toBeGreaterThanOrEqual(44);

  await chooseCompactNav(page, 'nav-connections');
  await expect(page.getByTestId('connected-apps-screen')).toBeVisible();
  const gutters = await page.getByTestId('connected-apps-screen').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const intro = el.querySelector('p')?.getBoundingClientRect();
    const select = el.querySelector('select')?.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      introLeft: intro ? Math.round(intro.left) : 0,
      selectHeight: select ? Math.round(select.height) : 0,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  expect(gutters.left).toBeGreaterThanOrEqual(12);
  expect(gutters.clientWidth - gutters.right).toBeGreaterThanOrEqual(12);
  expect(gutters.introLeft).toBeGreaterThanOrEqual(12);
  expect(gutters.selectHeight).toBeGreaterThanOrEqual(44);
  expect(gutters.scrollWidth).toBeLessThanOrEqual(gutters.clientWidth + 1);

  await openCompactSidebar(page);
  await page.getByTestId('sidebar-account').click();
  await expect(page.getByTestId('account-screen')).toBeVisible();
  const accountLeft = await page
    .getByTestId('account-screen')
    .evaluate((el) => Math.round(el.getBoundingClientRect().left));
  expect(accountLeft).toBeGreaterThanOrEqual(12);
  expect(browserErrors).toEqual([]);
});
