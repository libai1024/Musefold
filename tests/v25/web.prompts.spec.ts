import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';
import { clickRowAction, createPrompt, openPromptDetail } from './prompt-helpers';

// 首启引导夹具(U01-onboarding):既有用例都是未登录环境,不预置完成哨兵会被引导层盖住。
test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

// Web 提示词库 E2E:UI 流程走真实 features/api-client 代码,
// 网络层用内存 mock(后端行为由 apps/api testcontainers 集成测试守护)。

interface MockPrompt {
  id: string;
  title: string;
  description: string | null;
  content: string;
  negative: string | null;
  folderId: string | null;
  tags: unknown[];
  modelId: string | null;
  params: Record<string, unknown> | null;
  rating: number;
  isPinned: boolean;
  pinOrder: number | null;
  usageCount: number;
  lastUsedAt: string | null;
  source: string;
  sourceUrl: string | null;
  coverImageUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function nowIso(): string {
  return new Date().toISOString().replace(/Z$/, '+00:00');
}

async function installPromptApiMock(page: Page): Promise<void> {
  let seq = 0;
  const prompts = new Map<string, MockPrompt>();

  function json(body: unknown, status = 200) {
    return { status, contentType: 'application/json', body: JSON.stringify(body) };
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/folders' && method === 'GET') return route.fulfill(json([]));
    if (path === '/tags' && method === 'GET') return route.fulfill(json([]));
    // 详情「相关作品」反向查询:本 spec 不造生成回合,固定返回空页。
    if (path === '/generations' && method === 'GET') {
      return route.fulfill(json({ items: [], nextCursor: null }));
    }
    if (path === '/account/status') {
      return route.fulfill(json({ code: 'AUTH_REQUIRED', message: '未登录' }, 401));
    }

    if (path === '/prompts' && method === 'GET') {
      let rows = [...prompts.values()];
      const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
      if (!includeDeleted) rows = rows.filter((row) => row.deletedAt == null);
      if (url.searchParams.get('pinnedOnly') === 'true') {
        rows = rows.filter((row) => row.isPinned);
      }
      const q = url.searchParams.get('q');
      if (q) rows = rows.filter((row) => row.title.includes(q) || row.content.includes(q));
      rows.sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
      return route.fulfill(json({ items: rows, nextCursor: null }));
    }

    if (path === '/prompts' && method === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>;
      seq += 1;
      const timestamp = nowIso();
      const prompt: MockPrompt = {
        id: `prompt-${seq}`,
        title: String(input.title),
        description: (input.description as string) ?? null,
        content: String(input.content),
        negative: (input.negative as string) ?? null,
        folderId: (input.folderId as string) ?? null,
        tags: [],
        modelId: null,
        params: null,
        rating: (input.rating as number) ?? 0,
        isPinned: Boolean(input.isPinned),
        pinOrder: null,
        usageCount: 0,
        lastUsedAt: null,
        source: 'manual',
        sourceUrl: null,
        coverImageUrl: (input.coverImageUrl as string) ?? null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      prompts.set(prompt.id, prompt);
      return route.fulfill(json(prompt, 201));
    }

    // 集合级动作必须排在 /prompts/{id} 之前,否则会被当成 id=empty-trash。
    if (path === '/prompts/empty-trash' && method === 'POST') {
      const trashed = [...prompts.values()].filter((row) => row.deletedAt != null);
      for (const row of trashed) prompts.delete(row.id);
      return route.fulfill(json({ purged: trashed.length }));
    }

    const promptMatch = path.match(/^\/prompts\/([^/]+)(?:\/(restore|use))?$/);
    if (promptMatch) {
      const [, id, action] = promptMatch;
      const prompt = prompts.get(id);
      if (!prompt) return route.fulfill(json({ code: 'NOT_FOUND', message: '不存在' }, 404));

      if (action === 'restore' && method === 'POST') {
        prompt.deletedAt = null;
        return route.fulfill(json(prompt));
      }
      if (action === 'use' && method === 'POST') {
        prompt.usageCount += 1;
        return route.fulfill(json({ prompt, recorded: true }));
      }
      if (method === 'GET') return route.fulfill(json(prompt));
      if (method === 'PATCH') {
        const patch = request.postDataJSON() as Record<string, unknown>;
        if (patch.title !== undefined) prompt.title = String(patch.title);
        if (patch.content !== undefined) prompt.content = String(patch.content);
        if (patch.negative !== undefined) prompt.negative = patch.negative as string | null;
        if (patch.rating !== undefined) prompt.rating = patch.rating as number;
        if (patch.isPinned !== undefined) prompt.isPinned = Boolean(patch.isPinned);
        prompt.version += 1;
        prompt.updatedAt = nowIso();
        return route.fulfill(json(prompt));
      }
      if (method === 'DELETE') {
        prompt.deletedAt = nowIso();
        return route.fulfill(json(prompt));
      }
    }

    return route.fulfill(
      json({ code: 'NOT_FOUND', message: `mock 未覆盖:${method} ${path}` }, 404),
    );
  });
}

test.beforeEach(async ({ page }) => {
  await installPromptApiMock(page);
  await page.goto('/prompts');
  await expect(page.getByTestId('prompt-library')).toBeVisible();
});

test('空态与视觉基线', async ({ page }) => {
  await expect(page.getByTestId('prompt-empty')).toBeVisible();
  await expect(page).toHaveScreenshot('prompts-empty.png');
});

test('编辑器脏表单在 Escape 后要求确认,放弃不会保存', async ({ page }) => {
  await page.getByTestId('prompt-create').click();
  await page.getByTestId('prompt-editor-title').fill('待放弃的提示词');
  await page.getByTestId('prompt-editor-content').fill('draft content');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('prompt-editor')).toBeVisible();
  await expect(page.getByTestId('prompt-editor-discard-dialog')).toBeVisible();
  await page.getByTestId('prompt-editor-continue').click();
  await expect(page.getByTestId('prompt-editor-discard-dialog')).toBeHidden();
  await expect(page.getByTestId('prompt-editor-title')).toHaveValue('待放弃的提示词');

  await page.getByTestId('prompt-editor-cancel').click();
  await page.getByTestId('prompt-editor-discard').click();
  await expect(page.getByTestId('prompt-editor')).toBeHidden();
  await expect(page.getByText('待放弃的提示词')).toBeHidden();
  await expect(page.getByTestId('prompt-empty')).toBeVisible();
});

test('置顶、软删与回收站恢复闭环', async ({ page }) => {
  await createPrompt(page, '极简海报', 'minimalist poster design');

  await clickRowAction(page, '极简海报', 'prompt-row-pin');
  await expect(page.getByLabel('已置顶')).toBeVisible();

  await clickRowAction(page, '极简海报', 'prompt-row-remove');
  await expect(page.getByTestId('prompt-empty')).toBeVisible();

  await page.getByTestId('prompt-tab-trash').click();
  await expect(page.getByText('极简海报')).toBeVisible();

  await clickRowAction(page, '极简海报', 'prompt-row-restore');
  await expect(page.getByTestId('prompt-empty')).toBeVisible();

  await page.getByTestId('prompt-tab-all').click();
  await expect(page.getByText('极简海报')).toBeVisible();
});

test('搜索过滤列表', async ({ page }) => {
  await createPrompt(page, '油画肖像', 'oil painting portrait');
  await createPrompt(page, '像素游戏场景', 'pixel art game scene');

  await page.getByTestId('prompt-search').fill('像素');
  await expect(page.getByText('像素游戏场景')).toBeVisible();
  await expect(page.getByText('油画肖像')).toBeHidden();
});

test('行点击开详情 Inspector,菜单编辑与关闭闭环', async ({ page }) => {
  await createPrompt(page, '青瓷静物', 'celadon still life, soft light');

  const detail = await openPromptDetail(page, '青瓷静物');
  await expect(detail.getByTestId('prompt-detail-content')).toHaveText(
    'celadon still life, soft light',
  );
  // 元数据:来源枚举映射中文 + 创建/更新时间。
  await expect(detail.getByTestId('prompt-detail-meta')).toContainText('本机创建');
  await expect(detail.getByTestId('prompt-detail-facts')).toContainText('创建');
  // 无相关作品时给空态,不留死链接。
  await expect(detail.getByTestId('prompt-detail-works-empty')).toBeVisible();

  await detail.getByTestId('prompt-detail-menu').click();
  await page.getByTestId('prompt-detail-edit').click();
  await expect(page.getByTestId('prompt-editor')).toBeVisible();
  await page.getByTestId('prompt-editor-cancel').click();

  await detail.getByTestId('prompt-detail-close').click();
  await expect(detail).toBeHidden();
});

test('详情菜单「移入回收站」后面板自动收起', async ({ page }) => {
  await createPrompt(page, '铜版蚀刻', 'copperplate etching');

  await openPromptDetail(page, '铜版蚀刻');
  await page.getByTestId('prompt-detail-menu').click();
  await page.getByTestId('prompt-detail-remove').click();

  await expect(page.getByTestId('prompt-detail')).toBeHidden();
  await expect(page.getByTestId('prompt-empty')).toBeVisible();
});

test('清空回收站:双重确认写明条数,确认后一次性清空', async ({ page }) => {
  await createPrompt(page, '待清一', 'to purge a');
  await createPrompt(page, '待清二', 'to purge b');
  await clickRowAction(page, '待清一', 'prompt-row-remove');
  await clickRowAction(page, '待清二', 'prompt-row-remove');

  await page.getByTestId('prompt-tab-trash').click();
  await expect(page.getByTestId('prompt-count')).toHaveText('2 条');

  await page.getByTestId('prompt-empty-trash').click();
  const dialog = page.getByTestId('prompt-empty-trash-dialog');
  await expect(dialog).toContainText('2 条');
  await dialog.getByTestId('prompt-empty-trash-confirm').click();

  await expect(page.getByTestId('prompt-empty')).toBeVisible();
  await expect(page.getByTestId('prompt-empty-trash')).toBeHidden();
});

test('搜索无匹配给「清除筛选」,清除后列表回来', async ({ page }) => {
  await createPrompt(page, '雪山日照', 'alpenglow on snow peaks');

  await page.getByTestId('prompt-search').fill('不存在的词');
  await expect(page.getByTestId('prompt-empty')).toBeVisible();
  await page.getByTestId('prompt-clear-filters').click();

  await expect(page.getByTestId('prompt-search')).toHaveValue('');
  await expect(page.getByText('雪山日照')).toBeVisible();
});

test('空库空态「新建提示词」直开编辑器', async ({ page }) => {
  await expect(page.getByTestId('prompt-empty')).toBeVisible();
  await page.getByTestId('prompt-empty-create').click();
  await expect(page.getByTestId('prompt-editor')).toBeVisible();
});

test('快捷键:「/」聚焦搜索框,编辑器 ⌘/Ctrl+S 保存', async ({ page }) => {
  await page.locator('body').click();
  await page.keyboard.press('/');
  await expect(page.getByTestId('prompt-search')).toBeFocused();

  await page.getByTestId('prompt-create').click();
  await page.getByTestId('prompt-editor-title').fill('快捷保存');
  await page.getByTestId('prompt-editor-content').fill('saved via keyboard');
  await page.keyboard.press('ControlOrMeta+s');

  await expect(page.getByTestId('prompt-editor')).toBeHidden();
  await expect(page.getByText('快捷保存')).toBeVisible();
});

test('列表态视觉基线', async ({ page }) => {
  await createPrompt(page, '晨雾森林', 'misty forest at dawn, volumetric light');
  await expect(page).toHaveScreenshot('prompts-list.png');
});

test('详情 Inspector 视觉基线', async ({ page }) => {
  await createPrompt(page, '晨雾森林', 'misty forest at dawn, volumetric light');
  await openPromptDetail(page, '晨雾森林');
  await expect(page.getByTestId('prompt-detail-works-empty')).toBeVisible();
  await expect(page).toHaveScreenshot('prompts-detail.png');
});
