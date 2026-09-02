import { expect, test, type Page } from '@playwright/test';

function archiveNowIso(offsetMinutes: number): string {
  return new Date(Date.now() - offsetMinutes * 60_000).toISOString().replace(/Z$/, '+00:00');
}

function archiveSession(id: string, title: string, updatedAt: string) {
  return {
    id,
    title,
    draft: {
      prompt: '',
      negative: '',
      params: {},
      promptReferenceSelections: [],
      promptReferenceIds: [],
    },
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null as string | null,
    deletedAt: null as string | null,
    latestJobStatus: null,
    latestJobFinishedAt: null,
  };
}

function archiveJob(sessionId: string, createdAt: string) {
  return {
    id: 'archive-retained-generation',
    sessionId,
    parentRunId: null,
    promptId: null,
    userPrompt: '归档后仍保留的生成',
    promptReferences: [],
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: '归档后仍保留的生成',
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    },
    providerModel: 'musefold-image-pro',
    costPoints: null,
    assets: [],
    error: null,
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
    deletedAt: null,
  };
}

/** Web 归档闭环的隔离服务:保留真实 api-client/features/UI,仅替换网络响应。 */
async function installArchiveApiMock(page: Page, mode: 'restore' | 'delete'): Promise<void> {
  const updatedAt = archiveNowIso(mode === 'restore' ? 1 : 2);
  const id = mode === 'restore' ? 'archive-restore' : 'archive-delete';
  const title = mode === 'restore' ? '待恢复归档' : '待删除归档';
  const session = archiveSession(id, title, updatedAt);
  const sessions = new Map([[id, session]]);
  const jobs = mode === 'delete' ? [archiveJob(id, updatedAt)] : [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/account/status') {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'AUTH_REQUIRED', message: '未登录' }),
      });
    }
    if (path === '/generations/providers' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }
    if (path === '/workbench/sessions' && method === 'GET') {
      const archivedOnly = url.searchParams.get('archivedOnly') === 'true';
      const items = [...sessions.values()]
        .filter(
          (session) =>
            session.deletedAt == null &&
            (archivedOnly ? session.archivedAt != null : session.archivedAt == null),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null }),
      });
    }
    const sessionMatch = path.match(/^\/workbench\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const session = sessions.get(sessionMatch[1] ?? '');
      if (!session) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'NOT_FOUND', message: '会话不存在' }),
        });
      }
      if (method === 'PATCH') {
        const patch = request.postDataJSON() as {
          expectedVersion?: number;
          archived?: boolean;
        };
        if (patch.expectedVersion !== session.version) {
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'WORKBENCH_VERSION_CONFLICT', message: '会话版本已更新' }),
          });
        }
        if (patch.archived !== undefined) {
          session.archivedAt = patch.archived ? archiveNowIso(0) : null;
        }
        session.version += 1;
        session.updatedAt = archiveNowIso(0);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(session),
        });
      }
      if (method === 'DELETE') {
        session.deletedAt = archiveNowIso(0);
        session.updatedAt = archiveNowIso(0);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(session),
        });
      }
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(session),
        });
      }
    }
    if (path === '/generations' && method === 'GET') {
      const sessionId = url.searchParams.get('sessionId');
      const items = jobs.filter((job) => sessionId == null || job.sessionId === sessionId);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null }),
      });
    }

    return route.continue();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
});

test('设置页在两种视口渲染同一 features 屏幕', async ({ page, isMobile }) => {
  await expect(page.getByTestId('settings-host-badge')).toHaveText('Web 版');
  await expect(page.getByTestId('settings-appearance-card')).toBeVisible();

  if (isMobile) {
    await expect(page.getByTestId('app-bottom-nav')).toBeVisible();
    await expect(page.getByTestId('app-sidebar')).toBeHidden();
  } else {
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
    await expect(page.getByTestId('app-bottom-nav')).toBeHidden();
  }
});

test('账号卡在未登录(无 API)时显示登录提示', async ({ page }) => {
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
});

test('主题切换写入偏好并在刷新后保持', async ({ page }) => {
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();

  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.reload();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  // 还原浅色,避免污染后续快照用例
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('设置页视觉基线(浅色)', async ({ page }) => {
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
  await expect(page).toHaveScreenshot('settings-light.png', { fullPage: true });
});

test('设置页视觉基线(深色)', async ({ page }) => {
  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByTestId('settings-account-signed-out')).toBeVisible();
  await expect(page).toHaveScreenshot('settings-dark.png', { fullPage: true });

  await page.getByTestId('settings-theme-trigger').click();
  await page.getByTestId('settings-theme-light').click();
});

test('归档闭环:设置中恢复会话,移动端经抽屉回到侧栏', async ({ page, isMobile }) => {
  await installArchiveApiMock(page, 'restore');
  await page.goto('/workbench');
  await expect(page.getByTestId('workbench')).toBeVisible();

  if (isMobile) {
    await page.getByTestId('sidebar-drawer-open').click();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
  }
  const sessionRow = page.getByTestId('session-archive-restore');
  await expect(sessionRow).toContainText('待恢复归档');
  await sessionRow.hover();
  await page.getByTestId('session-archive').click();
  await expect(sessionRow).toBeHidden();

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('archived-toggle').click();
  const archivedRow = page.getByTestId('archived-session-archive-restore');
  await expect(archivedRow).toBeVisible();
  await expect(page.getByTestId('archived-time-archive-restore')).toContainText(/20\d\d/);
  await page.getByTestId('archived-restore-archive-restore').click();
  await expect(archivedRow).toBeHidden();

  if (isMobile) {
    await page.getByTestId('sidebar-drawer-open').click();
    await expect(page.getByTestId('session-archive-restore')).toBeVisible();
  } else {
    await expect(page.getByTestId('session-archive-restore')).toBeVisible();
  }
});

test('归档闭环:删除确认软删,生成记录仍可查询', async ({ page }) => {
  await installArchiveApiMock(page, 'delete');
  await page.goto('/workbench');
  await expect(page.getByTestId('workbench')).toBeVisible();

  const sessionRow = page.getByTestId('session-archive-delete');
  if (await page.getByTestId('sidebar-drawer-open').count()) {
    await page.getByTestId('sidebar-drawer-open').click();
    await expect(page.getByTestId('app-sidebar')).toBeVisible();
  }
  await sessionRow.hover();
  await page.getByTestId('session-archive').click();
  await expect(sessionRow).toBeHidden();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('archived-toggle').click();
  await expect(page.getByTestId('archived-session-archive-delete')).toBeVisible();
  await page.getByTestId('archived-remove-archive-delete').click();
  await expect(page.getByTestId('archived-remove-confirm')).toBeVisible();
  await page.getByTestId('archived-remove-confirm').click();
  await expect(page.getByTestId('archived-session-archive-delete')).toBeHidden();

  const retained = await page.evaluate(async () => {
    const response = await fetch('/api/v1/generations?sessionId=archive-delete');
    return (await response.json()) as { items: Array<{ id: string }> };
  });
  expect(retained.items.map((item) => item.id)).toContain('archive-retained-generation');
});
