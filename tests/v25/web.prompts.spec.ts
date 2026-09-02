import { expect, type Page, test } from '@playwright/test';
import { clickRowAction, createPrompt } from './prompt-helpers';

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
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
      prompts.set(prompt.id, prompt);
      return route.fulfill(json(prompt, 201));
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

test('列表态视觉基线', async ({ page }) => {
  await createPrompt(page, '晨雾森林', 'misty forest at dawn, volumetric light');
  await expect(page).toHaveScreenshot('prompts-list.png');
});
