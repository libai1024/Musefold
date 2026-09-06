import { expect, type Page, test } from '@playwright/test';
import { seedOnboardingCompleted } from './onboarding-helpers';

// 首启引导夹具(U01-onboarding):既有用例都是未登录环境,不预置完成哨兵会被引导层盖住。
test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

// Web 设计方案 E2E(生产 capability 证据,P01-7):
// - hasDesignSchemes=true 后壳导航注册「设计方案」,列表/详情走真实
//   features/api-client 代码,网络层内存 mock(镜像 apps/api 契约信封);
// - 确定性 CRUD 面:云列表分组渲染、?scheme= 深链详情、rename 回写;
// - 云端未部署面(市场/导出/运行)保持诚实降级:可读错误或禁用并解释,不伪造。

const CREATED_AT = '2026-08-20T08:00:00.000Z';
const UPDATED_AT = '2026-08-28T09:30:00.000Z';

interface MockSchemeState {
  summary: Record<string, unknown> & { id: string; name: string; version: number };
  document: Record<string, unknown>;
  assets: unknown[];
}

function schemeDocument(input: {
  schemeId: string;
  revisionId: string;
  name: string;
  summary: string;
  assetIds?: string[];
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revisionId: input.revisionId,
    schemeId: input.schemeId,
    name: input.name,
    summary: input.summary,
    fidelity: 'adapted',
    sources: [
      {
        id: 'source-brief',
        kind: 'user-brief',
        role: 'context',
        packageId: 'package-web-brief',
        snapshotId: 'snapshot-web-brief',
      },
    ],
    sourceSnapshotIds: ['snapshot-web-brief'],
    inputs: [
      { id: 'topic', label: '主题', kind: 'text', required: true, description: '输入海报主题' },
    ],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'module-1',
        order: 0,
        kind: 'input-template',
        template: 'Create a restrained poster about {{topic}}',
        variables: ['topic'],
        sourceIds: ['source-brief'],
      },
    ],
    ...(input.assetIds ? { assetIds: input.assetIds } : {}),
    compilation: {
      compiledAt: 1,
      model: { model: 'e2e-fixture', connectionName: 'E2E fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
}

/** 与 apps/api sourceSnapshotSchema 对齐的 wire 快照(detail.sourceSnapshots)。 */
const SOURCE_SNAPSHOT = {
  id: 'snapshot-web-brief',
  packageId: 'package-web-brief',
  kind: 'user-brief',
  resolvedRef: 'seed',
  totalBytes: 0,
  files: [],
  createdAt: CREATED_AT,
};

function makeSchemes(): Map<string, MockSchemeState> {
  const draft: MockSchemeState = {
    summary: {
      id: 'scheme-web-draft',
      name: '晨读会海报方案',
      summary: '晨读活动主视觉:大标题 + 留白构图。',
      status: 'draft',
      sourcePresentation: 'musefold-created',
      sourceLabel: 'Musefold 创建',
      currentRevisionId: 'revision-web-draft',
      workingDraftRevisionId: null,
      coverAssetId: null,
      fidelity: 'adapted',
      version: 1,
      inputLabels: ['主题 · 必需'],
      hasSuccessfulTrial: false,
      lastRunAt: null,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
    document: schemeDocument({
      schemeId: 'scheme-web-draft',
      revisionId: 'revision-web-draft',
      name: '晨读会海报方案',
      summary: '晨读活动主视觉:大标题 + 留白构图。',
    }),
    assets: [],
  };
  const formal: MockSchemeState = {
    summary: {
      id: 'scheme-web-formal',
      name: '夜展主视觉方案',
      summary: '夜间展览海报:深色底 + 高对比标题。',
      status: 'formal',
      sourcePresentation: 'musefold-created',
      sourceLabel: 'Musefold 创建',
      currentRevisionId: 'revision-web-formal',
      workingDraftRevisionId: null,
      coverAssetId: 'asset-web-cover',
      fidelity: 'adapted',
      version: 3,
      inputLabels: ['主题 · 必需'],
      hasSuccessfulTrial: true,
      lastRunAt: UPDATED_AT,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
    document: schemeDocument({
      schemeId: 'scheme-web-formal',
      revisionId: 'revision-web-formal',
      name: '夜展主视觉方案',
      summary: '夜间展览海报:深色底 + 高对比标题。',
      assetIds: ['asset-web-cover'],
    }),
    assets: [
      {
        id: 'asset-web-cover',
        origin: 'local-run',
        mimeType: 'image/png',
        width: 1024,
        height: 1024,
        byteSize: 2048,
        contentHash: '0'.repeat(64),
        role: 'cover',
        license: null,
        createdAt: CREATED_AT,
      },
    ],
  };
  return new Map([
    [draft.summary.id, draft],
    [formal.summary.id, formal],
  ]);
}

interface DesignSchemesApiMock {
  calls: {
    rename: Array<Record<string, unknown>>;
    market: number;
    exportPackage: number;
  };
}

async function installDesignSchemesApiMock(page: Page): Promise<DesignSchemesApiMock> {
  const schemes = makeSchemes();
  const calls: DesignSchemesApiMock['calls'] = { rename: [], market: 0, exportPackage: 0 };

  function json(body: unknown, status = 200) {
    return { status, contentType: 'application/json', body: JSON.stringify(body) };
  }

  /** apps/api 契约错误信封(lib/errors AppError → toError 解析路径)。 */
  function contractError(status: number, message: string, details: Record<string, unknown> = {}) {
    return json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message,
          requestId: 'e2e-request',
          retryable: false,
          details,
        },
      },
      status,
    );
  }

  /** 镜像 apps/api CLOUD_DESIGN_SCHEME_UNAVAILABLE 的结构化 501。 */
  function schemeUnavailable(operation: string, code: string, message: string) {
    return contractError(501, message, {
      operation,
      designSchemeError: { code, message, retryable: false, recoveryAction: 'none' },
    });
  }

  function detailOf(state: MockSchemeState) {
    return {
      summary: state.summary,
      document: state.document,
      assets: state.assets,
      sourceSnapshots: [SOURCE_SNAPSHOT],
    };
  }

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = request.method();

    if (path === '/account/status') {
      return route.fulfill(json({ code: 'AUTH_REQUIRED', message: '未登录' }, 401));
    }
    if (path === '/workbench/sessions' && method === 'GET') {
      return route.fulfill(json({ items: [], nextCursor: null }));
    }
    if (path === '/generations/providers' && method === 'GET') {
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
    }
    if (path === '/generations' && method === 'GET') {
      return route.fulfill(json({ items: [], nextCursor: null }));
    }

    if (path === '/design-schemes' && method === 'GET') {
      return route.fulfill(
        json({ items: [...schemes.values()].map((state) => state.summary), nextCursor: null }),
      );
    }
    if (path === '/design-schemes/market' && method === 'GET') {
      calls.market += 1;
      return route.fulfill(
        schemeUnavailable(
          'searchMarket',
          'DESIGN_SCHEME_CLOUD_MARKET_UNAVAILABLE',
          'Cloud Design Scheme market search is not available.',
        ),
      );
    }
    if (path === '/design-schemes/rename' && method === 'POST') {
      const input = request.postDataJSON() as {
        schemeId: string;
        name: string;
        expectedVersion: number;
      };
      calls.rename.push(input);
      const state = schemes.get(input.schemeId);
      if (!state || state.summary.version !== input.expectedVersion) {
        return route.fulfill(contractError(409, 'The Design Scheme changed; refresh and retry.'));
      }
      state.summary.name = input.name;
      (state.document as { name: string }).name = input.name;
      state.summary.version += 1;
      return route.fulfill(json({ scheme: state.summary }));
    }
    if (path === '/design-schemes/export-package' && method === 'POST') {
      calls.exportPackage += 1;
      return route.fulfill(
        schemeUnavailable(
          'exportPackage',
          'DESIGN_SCHEME_CLOUD_EXPORT_STAGING_UNAVAILABLE',
          'Cloud .musefold.design package staging is not available for export.',
        ),
      );
    }
    const detailMatch = path.match(/^\/design-schemes\/([^/]+)$/);
    if (detailMatch && method === 'GET') {
      const state = schemes.get(detailMatch[1] ?? '');
      if (!state) {
        return route.fulfill(
          json({ code: 'VALIDATION_FAILED', message: 'Design Scheme not found.' }, 404),
        );
      }
      return route.fulfill(json(detailOf(state)));
    }

    return route.fulfill(json({ code: 'NOT_FOUND', message: `未 mock 的接口:${path}` }, 404));
  });

  return { calls };
}

let apiMock: DesignSchemesApiMock;

test.beforeEach(async ({ page }) => {
  // 固定页面时钟:问候语时段与相对时间标签确定,视觉基线可复现。
  await page.clock.setFixedTime(new Date('2026-08-29T15:00:00'));
  apiMock = await installDesignSchemesApiMock(page);
});

test('壳导航注册「设计方案」入口,云端列表按草稿/正式分组渲染(含视觉基线)', async ({
  page,
}, testInfo) => {
  await page.goto('/workbench');
  await expect(page.getByTestId('workbench')).toBeVisible();

  // 生产 WEB_CAPABILITIES 驱动的入口(非测试注入):桌面侧栏 / 移动底部标签栏。
  const navTestId =
    testInfo.project.name === 'web-mobile' ? 'bottom-nav-design-schemes' : 'nav-design-schemes';
  await page.getByTestId(navTestId).click();
  await expect(page).toHaveURL(/\/design-schemes$/);
  await expect(page.getByTestId('design-schemes-page')).toBeVisible();

  await expect(page.getByTestId('runtime-scheme-row-scheme-web-draft')).toContainText(
    '晨读会海报方案',
  );
  await expect(page.getByTestId('runtime-scheme-row-scheme-web-formal')).toContainText(
    '夜展主视觉方案',
  );
  await expect(page).toHaveScreenshot('design-schemes-list.png');
});

test('?scheme= 深链打开详情,重命名经云端回写并刷新标题', async ({ page }) => {
  await page.goto('/design-schemes?scheme=scheme-web-draft');
  const detail = page.getByTestId('runtime-scheme-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('晨读会海报方案');

  await page.getByTestId('runtime-scheme-menu').click();
  await page.getByTestId('runtime-scheme-menu-rename').click();
  await page.getByTestId('scheme-rename-input').fill('晨读会海报方案 v2');
  await page.getByTestId('scheme-rename-confirm').click();

  await expect(page.getByText('已重命名')).toBeVisible();
  await expect(detail).toContainText('晨读会海报方案 v2');
  expect(apiMock.calls.rename).toEqual([
    { schemeId: 'scheme-web-draft', name: '晨读会海报方案 v2', expectedVersion: 1 },
  ]);
});

test('云端未部署面诚实降级:市场搜索与导出分享包呈现可读错误', async ({ page }) => {
  // 市场搜索:服务端结构化 501 → 就地错误行(可重试),不出现假候选。
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-surface-explore').click();
  await expect(page.getByTestId('market-idle')).toBeVisible();
  await page.getByTestId('market-suggestion-插画 skill').click();
  const marketError = page.getByTestId('market-error');
  await expect(marketError).toBeVisible();
  await expect(marketError).toContainText('搜索市场失败');
  await expect(marketError).toContainText('Cloud Design Scheme market search is not available.');
  expect(apiMock.calls.market).toBe(1);

  // 导出分享包(仅正式方案入口):501 → 错误 toast,如实转述服务端说明。
  await page.goto('/design-schemes?scheme=scheme-web-formal');
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  await page.getByTestId('runtime-scheme-menu').click();
  await page.getByTestId('runtime-scheme-menu-export').click();
  await expect(page.getByText('导出失败')).toBeVisible();
  await expect(
    page.getByText('Cloud .musefold.design package staging is not available for export.'),
  ).toBeVisible();
  expect(apiMock.calls.exportPackage).toBe(1);
});

test('方案可挂载到工作台 Composer,运行提交禁用并解释(不伪造云端运行)', async ({ page }) => {
  await page.goto('/design-schemes?scheme=scheme-web-formal');
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  await page.getByTestId('runtime-scheme-primary-action').click();

  // 集成层写入一次性意图并切工作台;附件与输入槽位真实可达。
  await expect(page).toHaveURL(/\/workbench/);
  await expect(page.getByTestId('scheme-run-chip')).toContainText('夜展主视觉方案');
  await expect(page.getByTestId('scheme-run-variable-topic')).toBeVisible();

  // 云端 run 管线未部署:提交禁用并解释(I4),绝不回落普通生成。
  const submit = page.getByTestId('composer-submit');
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('title', '当前环境暂未接入方案运行');
});
