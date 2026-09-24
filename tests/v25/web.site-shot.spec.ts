import { test, type Page } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

/**
 * 官网 UI 展示截图(2026-09-24,2.5.0 细滚动条/极简模型钮版本):
 * 本地生产构建 + 合成数据(不落任何真实账号内容),1440×900 视口。
 * 产物由构建侧人工上传官网 assets/screens/,不进仓库快照基线。
 */
const json = (data: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});
const now = '2026-09-24T10:00:00.000+00:00';

const prompts = Array.from({ length: 14 }, (_, index) => ({
  id: `shot-${index}`,
  title: [
    '晨雾中的灯塔,极简负空间',
    '透明护肤品主视觉,柔和反射',
    '雨夜东京街角,低饱和日系',
    '漂浮在云层上的图书馆',
    '赛博盆栽,电影感布光',
    '手绘纹理咖啡海报',
    '深空站内景,体积光',
    '水彩凤凰,留白构图',
    '极简建筑摄影,硬阴影',
    '霓虹雨衣人像,胶片颗粒',
    '复古旅行票根拼贴',
    '微缩食物剧场,移轴',
    '宋代山水,水墨雾气',
    '玻璃质感字母实验',
  ][index],
  description: '为品牌视觉与社交封面反复打磨的一组提示词,可直接复用与二次改编。',
  content: 'cinematic lighting, soft shadows, muted palette',
  negative: null,
  folderId: null,
  tags: index % 3 === 0 ? ['场景', '概念图'] : index % 3 === 1 ? ['质感', '海报'] : ['人物'],
  modelId: null,
  params: null,
  rating: index % 5,
  isPinned: index < 2,
  pinOrder: index < 2 ? index : null,
  usageCount: 12 - index,
  lastUsedAt: now,
  source: 'manual',
  sourceUrl: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  coverImageUrl: null,
}));

async function mockAll(page: Page) {
  await page.context().route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/account/status')
      return route.fulfill(
        json({
          id: 'shot-owner',
          username: 'demo',
          displayName: null,
          quota: 500000,
          quotaUnit: 'quota',
          canGenerate: true,
          identity: {
            apiIssuer: 'https://workbench-api.test',
            principalId: 'shot-principal',
            status: 'active',
            identityVersion: 1,
          },
        }),
      );
    if (path === '/prompts') return route.fulfill(json({ items: prompts, nextCursor: null }));
    if (path === '/workbench/sessions')
      return route.fulfill(json({ items: [], nextCursor: null }));
    if (path === '/account/models')
      return route.fulfill(
        json({
          identity: {
            apiIssuer: 'https://workbench-api.test',
            principalId: 'shot-principal',
            payer: { issuer: 'https://workbench-payer.test', ownerId: 'shot-owner' },
            credential: { ref: 'shot-credential', version: 1 },
          },
          group: 'vip',
          checkedAt: now,
          models: [
            {
              model: 'musefold-image-pro',
              supportedEndpointTypes: ['image-generation'],
              imageGeneration: true,
              pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 3, quotaPerCall: 60000 },
            },
          ],
        }),
      );
    if (path === '/generations/providers')
      return route.fulfill(
        json([
          {
            id: 'cloud-default',
            label: 'Musefold 云生图',
            model: 'musefold-image-pro',
            kind: 'cloud',
            available: true,
          },
        ]),
      );
    return route.fulfill(json({ items: [], nextCursor: null }));
  });
}

test('capture official site showcase screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  await seedOnboardingCompleted(page);
  await mockAll(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/prompts');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/v25/.results/candidate-20260923/site-library.png' });
  console.log('[shot] library done');
  await page.goto('/workbench');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/v25/.results/candidate-20260923/site-workbench.png' });
  console.log('[shot] workbench done');
});
