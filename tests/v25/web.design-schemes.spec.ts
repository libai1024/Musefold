import { expect, type Page, test } from '@playwright/test';
import {
  accountModelCatalogSchema,
  accountSummarySchema,
  designSchemeRevisionDocumentSchema,
  designSchemeSummarySchema,
  marketSearchResultSchema,
  prepareDesignSchemeRunInputSchema,
  type RunResult,
  type WorkbenchSession,
} from '@musefold/contracts';
import { prepareCloudFixedRunPlan } from '../../packages/domain/src/design-scheme/fixed-run-plan';
import { cloudGenerationProviderSnapshot } from '../../packages/domain/src/cloud-generation-policy';
import { seedOnboardingCompleted } from './onboarding-helpers';

// 首启引导夹具(U01-onboarding):默认访客；云方案运行另显式提供已核对账号。
test.beforeEach(async ({ page }) => {
  await seedOnboardingCompleted(page);
});

// Web 设计方案 E2E(生产 capability 证据,P01-7):
// - hasDesignSchemes=true 后壳导航注册「设计方案」,列表/详情走真实
//   features/api-client 代码,网络层内存 mock(镜像 apps/api 契约信封);
// - 确定性 CRUD 面:云列表分组渲染、?scheme= 深链详情、rename 回写;
// - 云 run 的准备/轮询终态/取消和市场分页使用契约 mock；导出仍结构化降级。

const CREATED_AT = '2026-08-20T08:00:00.000Z';
const UPDATED_AT = '2026-08-28T09:30:00.000Z';
const RUN_ACCOUNT = accountSummarySchema.parse({
  id: 'scheme-owner',
  username: 'scheme-test',
  displayName: null,
  quota: 500000,
  quotaUnit: 'quota',
  canGenerate: true,
  identity: {
    apiIssuer: 'https://scheme-api.test',
    principalId: 'scheme-principal',
    status: 'active',
    identityVersion: 1,
  },
});
const RUN_MODEL_CATALOG = accountModelCatalogSchema.parse({
  identity: {
    apiIssuer: 'https://scheme-api.test',
    principalId: 'scheme-principal',
    payer: { issuer: 'https://scheme-upstream.test', ownerId: 'scheme-owner' },
    credential: { ref: 'scheme-credential', version: 1 },
  },
  group: 'vip',
  checkedAt: '2026-09-20T00:00:00.000Z',
  models: [
    {
      model: 'musefold-image-pro',
      supportedEndpointTypes: ['image-generation'],
      imageGeneration: true,
      pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 3, quotaPerCall: 60000 },
    },
  ],
});

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
  control: {
    signedIn: boolean;
    hold: boolean;
    prepareError: string | null;
    marketFailure: 'rate-limit' | 'unavailable' | null;
    emptyMarket: boolean;
    cachedMarket: boolean;
    nextPageFailure: boolean;
    marketWait: Promise<void> | null;
  };
  calls: {
    modelCatalog: number;
    rename: Array<Record<string, unknown>>;
    market: number;
    marketQueries: Array<Record<string, string>>;
    exportPackage: number;
    prepare: Array<Record<string, unknown>>;
    run: Array<Record<string, unknown>>;
    cancel: Array<Record<string, unknown>>;
    ordinaryGeneration: number;
  };
}

async function installDesignSchemesApiMock(page: Page): Promise<DesignSchemesApiMock> {
  const schemes = makeSchemes();
  const calls: DesignSchemesApiMock['calls'] = {
    modelCatalog: 0,
    rename: [],
    market: 0,
    marketQueries: [],
    exportPackage: 0,
    prepare: [],
    run: [],
    cancel: [],
    ordinaryGeneration: 0,
  };
  const control: DesignSchemesApiMock['control'] = {
    signedIn: false,
    hold: false,
    prepareError: null,
    marketFailure: null,
    emptyMarket: false,
    cachedMarket: false,
    nextPageFailure: false,
    marketWait: null,
  };
  let session: WorkbenchSession | null = null;
  let result: RunResult | null = null;

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
      if (control.signedIn) return route.fulfill(json(RUN_ACCOUNT));
      return route.fulfill(json({ code: 'AUTH_REQUIRED', message: '未登录' }, 401));
    }
    if (path === '/account/models') {
      calls.modelCatalog += 1;
      if (control.signedIn) return route.fulfill(json(RUN_MODEL_CATALOG));
      return route.fulfill(json({ code: 'AUTH_REQUIRED', message: '未登录' }, 401));
    }
    if (path === '/workbench/sessions' && method === 'GET') {
      return route.fulfill(json({ items: session ? [session] : [], nextCursor: null }));
    }
    if (path === '/workbench/sessions' && method === 'POST') {
      const input = request.postDataJSON();
      session = {
        id: 'scheme-session',
        title: input.title,
        draft: input.draft,
        version: 1,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        archivedAt: null,
        deletedAt: null,
        latestJobStatus: null,
        latestJobFinishedAt: null,
      };
      return route.fulfill(json(session, 201));
    }
    if (path === '/workbench/sessions/scheme-session' && session) {
      if (method === 'PATCH') {
        const input = request.postDataJSON();
        if (input.draft) session.draft = input.draft;
        session.version += 1;
      }
      return route.fulfill(json(session));
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
    if (path === '/generations' && method === 'POST') {
      calls.ordinaryGeneration += 1;
      return route.fulfill(contractError(400, '方案运行不得回落普通生成'));
    }
    if (path === '/design-schemes/prepare-run' && method === 'POST') {
      const input = request.postDataJSON();
      calls.prepare.push(input);
      if (control.prepareError) return route.fulfill(contractError(409, control.prepareError));
      const state = schemes.get(input.schemeId);
      if (!state) return route.fulfill(contractError(404, '方案不存在'));
      const prepared = prepareCloudFixedRunPlan(
        prepareDesignSchemeRunInputSchema.parse(input),
        {
          summary: designSchemeSummarySchema.parse(state.summary),
          document: designSchemeRevisionDocumentSchema.parse(state.document),
          sourceSnapshotIds: [SOURCE_SNAPSHOT.id],
          provider: cloudGenerationProviderSnapshot,
          referenceAssetIds: [],
        },
        {
          planId: 'mock-server-plan',
          stepIds: ['inspect', 'compile', 'generate', 'evaluate'],
          now: UPDATED_AT,
        },
      );
      return route.fulfill(json(prepared));
    }
    if (path === '/design-schemes/run' && method === 'POST') {
      const input = request.postDataJSON();
      calls.run.push(input);
      result = {
        runId: 'cloud-scheme-run',
        schemeId: input.schemeId,
        revisionId: input.revisionId,
        mode: input.mode,
        status: 'executing',
        compiledPrompt: 'mock compiled poster',
        outputs: [],
        steps: [],
        evaluation: null,
        repair: null,
        error: null,
        createdAt: UPDATED_AT,
        completedAt: null,
      };
      return route.fulfill(json(result));
    }
    if (path === '/design-schemes/cancel' && method === 'POST') {
      const input = request.postDataJSON();
      calls.cancel.push(input);
      if (result) {
        result.status = 'cancelled';
        result.completedAt = UPDATED_AT;
      }
      return route.fulfill(json({ executionId: input.executionId, status: 'cancelled' }));
    }
    if (path === '/design-schemes/runs/cloud-scheme-run/events') {
      return route.fulfill(json({ events: [], nextSeq: 0 }));
    }
    if (path === '/design-schemes/runs/cloud-scheme-run' && result) {
      if (!control.hold && result.status === 'executing') {
        result.status = 'completed';
        result.completedAt = UPDATED_AT;
      }
      return route.fulfill(json(result));
    }

    if (path === '/design-schemes' && method === 'GET') {
      return route.fulfill(
        json({ items: [...schemes.values()].map((state) => state.summary), nextCursor: null }),
      );
    }
    if (path === '/design-schemes/market' && method === 'GET') {
      calls.market += 1;
      calls.marketQueries.push(Object.fromEntries(url.searchParams));
      if (control.marketWait) await control.marketWait;
      const cursor = url.searchParams.get('cursor');
      if (control.marketFailure || (cursor && control.nextPageFailure)) {
        const limited = control.marketFailure === 'rate-limit';
        return route.fulfill(
          json(
            {
              error: {
                code: limited ? 'RATE_LIMITED' : 'INTERNAL_ERROR',
                message: limited ? '搜索过于频繁，请稍后重试' : 'GitHub 暂不可用，请稍后重试',
                requestId: 'market-request',
                retryable: true,
                details: {
                  operation: 'searchMarket',
                  marketError: limited ? 'MARKET_RATE_LIMITED' : 'MARKET_UPSTREAM_ERROR',
                  retryAfterSeconds: 30,
                },
              },
            },
            limited ? 429 : 503,
          ),
        );
      }
      const ids = control.emptyMarket
        ? []
        : cursor
          ? ['poster-guide', 'watercolor-kit']
          : ['illustration-kit', 'poster-guide'];
      return route.fulfill(
        json(
          marketSearchResultSchema.parse({
            query: url.searchParams.get('query'),
            fromCache: control.cachedMarket,
            fetchedAt: UPDATED_AT,
            nextCursor: !cursor && !control.emptyMarket ? 'market-next' : null,
            candidates: ids.map((id) => ({
              candidateId: id,
              repositoryUrl: `https://github.com/musefold-fixtures/${id}`,
              fullName: `musefold-fixtures/${id}`,
              description: '可复用的海报设计规则',
              license: id === 'illustration-kit' ? 'MIT' : null,
              ref: 'main',
              commit: null,
              updatedAt: UPDATED_AT,
              stars: 120,
              topics: ['poster'],
              matchReason: '匹配搜索方向',
              riskSummary: id === 'illustration-kit' ? null : '未声明许可证，请在使用前核对',
            })),
          }),
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

  return { calls, control };
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
  const trash = page.getByTestId('scheme-trash-open');
  await expect(trash).toBeVisible();
  await expect(trash).toHaveAccessibleName('已移除');
  await expect(trash).toBeInViewport();
  const layout = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
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

test('市场限流可重试，访客导出要求先登录', async ({ page }) => {
  apiMock.control.marketFailure = 'rate-limit';
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-surface-explore').click();
  await expect(page.getByTestId('market-idle')).toBeVisible();
  await page.getByTestId('market-suggestion-插画 skill').click();
  const marketError = page.getByTestId('market-error');
  await expect(marketError).toBeVisible();
  await expect(marketError).toContainText('搜索过于频繁，请稍后重试');
  await expect(page.getByTestId(/^market-candidate-/)).toHaveCount(0);
  expect(apiMock.calls.market).toBe(1);
  apiMock.control.marketFailure = null;
  await marketError.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('market-candidate-illustration-kit')).toBeVisible();
  expect(apiMock.calls.market).toBe(2);

  // 导出由宿主分阶段交付，访客不能准备或下载归档。
  await page.goto('/design-schemes?scheme=scheme-web-formal');
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  await page.getByTestId('runtime-scheme-menu').click();
  await page.getByTestId('runtime-scheme-menu-export').click();
  await expect(page.getByText('请先登录并完成账号核对。')).toBeVisible();
  await expect(page.getByTestId('scheme-package-export-action')).toBeDisabled();
  expect(apiMock.calls.exportPackage).toBe(0);
});

test('市场显式搜索显示许可证与缓存时间，下一页合并去重且不触发安装', async ({ page }, testInfo) => {
  let release!: () => void;
  apiMock.control.marketWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  apiMock.control.cachedMarket = true;
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-surface-explore').click();
  await expect(page.getByTestId('market-idle')).toBeVisible();
  expect(apiMock.calls.market).toBe(0);
  await page.getByTestId('scheme-search').fill('poster');
  await page.getByTestId('market-search-run').click();
  await expect(page.getByTestId('market-loading')).toBeVisible();
  await expect(page.getByTestId('market-search-run')).toBeDisabled();
  release();
  apiMock.control.marketWait = null;
  await expect(page.getByTestId(/^market-candidate-/)).toHaveCount(2);
  await expect(page.getByTestId('market-candidate-illustration-kit')).toContainText('MIT');
  await expect(page.getByTestId('market-risk-poster-guide')).toContainText('未声明许可证');
  const cache = page.getByTestId('market-cache-notice');
  await expect(cache).toContainText('包含缓存候选');
  await expect(cache).not.toContainText('网络暂不可用');
  await expect(cache.locator('time')).toHaveAttribute('datetime', UPDATED_AT);
  await expect(page.getByTestId('market-install-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('market-add-illustration-kit')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('market-ready.png') });
  await page.getByTestId('scheme-search').fill('尚未提交的新搜索');
  await page.getByTestId('market-load-more').click();
  await expect(page.getByTestId(/^market-candidate-/)).toHaveCount(3);
  await expect(page.getByTestId('market-load-more')).toHaveCount(0);
  expect(apiMock.calls.marketQueries).toEqual([
    { query: 'poster', limit: '20' },
    { query: 'poster', limit: '20', cursor: 'market-next' },
  ]);
  expect(apiMock.calls.ordinaryGeneration).toBe(0);
  expect(apiMock.calls.run).toEqual([]);
});

test('市场下一页失败保留已有结果，重试仍使用原游标', async ({ page }) => {
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-surface-explore').click();
  await page.getByTestId('market-suggestion-poster prompt').click();
  await expect(page.getByTestId(/^market-candidate-/)).toHaveCount(2);
  apiMock.control.nextPageFailure = true;
  await page.getByTestId('market-load-more').click();
  const error = page.getByTestId('market-page-error');
  await expect(error).toContainText('GitHub 暂不可用');
  await expect(page.getByTestId(/^market-candidate-/)).toHaveCount(2);
  apiMock.control.nextPageFailure = false;
  await error.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId(/^market-candidate-/)).toHaveCount(3);
  expect(apiMock.calls.marketQueries[1]).toEqual(apiMock.calls.marketQueries[2]);
});

test('市场无结果保留搜索入口，可换关键词重新搜索', async ({ page }) => {
  apiMock.control.emptyMarket = true;
  await page.goto('/design-schemes');
  await page.getByTestId('scheme-surface-explore').click();
  await page.getByTestId('market-suggestion-poster prompt').click();
  await expect(page.getByTestId('market-empty')).toBeVisible();
  await expect(page.getByTestId('market-load-more')).toHaveCount(0);
  apiMock.control.emptyMarket = false;
  await page.getByTestId('scheme-search').fill('illustration');
  await page.getByTestId('scheme-search').press('Enter');
  await expect(page.getByTestId(/^market-candidate-/)).toHaveCount(2);
  expect(apiMock.calls.marketQueries[1]).toEqual({ query: 'illustration', limit: '20' });
});

async function attachFormalScheme(page: Page) {
  apiMock.control.signedIn = true;
  await page.goto('/design-schemes?scheme=scheme-web-formal');
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  await page.getByTestId('runtime-scheme-primary-action').click();

  // 集成层写入一次性意图并切工作台;附件与输入槽位真实可达。
  await expect(page).toHaveURL(/\/workbench/);
  await expect(page.getByTestId('scheme-run-chip')).toContainText('夜展主视觉方案');
  await expect(page.getByTestId('scheme-run-variable-topic')).toBeVisible();

  await page.getByTestId('scheme-run-variable-topic').fill('秋季书展');
  await page.getByTestId('composer-prompt').fill('保持大标题');
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
}

test('未登录的方案运行保留输入并禁止模型读取、准备和发送', async ({ page }) => {
  await page.goto('/design-schemes?scheme=scheme-web-formal');
  await expect(page.getByTestId('runtime-scheme-detail')).toBeVisible();
  await page.getByTestId('runtime-scheme-primary-action').click();
  await page.getByTestId('scheme-run-variable-topic').fill('秋季书展');
  await page.getByTestId('composer-prompt').fill('保持大标题');
  await expect(page.getByTestId('composer-submit')).toBeDisabled();
  await expect(page.getByTestId('composer-submit')).toHaveAttribute(
    'title',
    '请先登录并核对当前账号',
  );
  await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
  await expect(page.getByTestId('composer-prompt')).toHaveValue('保持大标题');
  expect(apiMock.calls.modelCatalog).toBe(0);
  expect(apiMock.calls.prepare).toEqual([]);
  expect(apiMock.calls.run).toEqual([]);
});

test('方案运行走服务端准备与终态轮询,成功才清空输入并保留方案附件', async ({ page }) => {
  await attachFormalScheme(page);
  await page.getByTestId('composer-settings').click();
  await page.getByTestId('composer-count-2').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('');
  await expect(page.getByTestId('composer-prompt')).toHaveValue('');
  await expect(page.getByTestId('scheme-run-chip')).toContainText('夜展主视觉方案');
  expect(apiMock.calls.prepare).toHaveLength(1);
  expect(apiMock.calls.run).toHaveLength(1);
  expect(apiMock.calls.prepare[0]).toMatchObject({
    revisionId: 'revision-web-formal',
    mode: 'formal',
    inputValues: { topic: '秋季书展' },
    executionSettings: {
      outputCount: 2,
      providerId: 'cloud-default',
      model: 'musefold-image-pro',
      expectedBinding: {
        ...RUN_MODEL_CATALOG.identity,
        providerId: 'cloud-default',
        model: 'musefold-image-pro',
        capabilities: { image: true, text: false },
      },
      workbenchSessionId: 'scheme-session',
    },
  });
  expect(apiMock.calls.prepare[0]).not.toHaveProperty('plan');
  expect(apiMock.calls.modelCatalog).toBeGreaterThanOrEqual(2);
  expect(apiMock.calls.run[0]).toHaveProperty('plan.id', 'mock-server-plan');
  expect(apiMock.calls.ordinaryGeneration).toBe(0);
});

test('方案准备被拒绝时保留正文和槽位,错误就地可读且不发送run', async ({ page }) => {
  apiMock.control.prepareError = '方案版本已变化，请刷新后重新选择';
  await attachFormalScheme(page);
  await page.getByTestId('composer-submit').click();
  await expect(page.getByTestId('scheme-submit-error')).toContainText('方案版本已变化');
  await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
  await expect(page.getByTestId('composer-prompt')).toHaveValue('保持大标题');
  expect(apiMock.calls.run).toHaveLength(0);
  expect(apiMock.calls.ordinaryGeneration).toBe(0);
});

test('方案运行中可按同一executionId停止,取消保留输入并不显示失败', async ({ page }) => {
  apiMock.control.hold = true;
  await attachFormalScheme(page);
  await page.getByTestId('composer-submit').click();
  await expect.poll(() => apiMock.calls.run.length).toBe(1);
  await page.getByTestId('composer-cancel').click();
  await expect.poll(() => apiMock.calls.cancel.length).toBe(1);
  await expect(page.getByTestId('composer-cancel')).toHaveCount(0);
  await expect(page.getByTestId('composer-submit')).toBeEnabled();
  await expect(page.getByTestId('scheme-run-variable-topic')).toHaveValue('秋季书展');
  await expect(page.getByTestId('composer-prompt')).toHaveValue('保持大标题');
  await expect(page.getByTestId('scheme-submit-error')).toHaveCount(0);
  expect(apiMock.calls.cancel[0]?.executionId).toBe(apiMock.calls.run[0]?.executionId);
  expect(apiMock.calls.ordinaryGeneration).toBe(0);
});
