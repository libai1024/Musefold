import type {
  GenerationAsset,
  GenerationCount,
  GenerationJob,
  SaveAssetInput,
} from '@musefold/contracts';
import type { GenerationGateway, MusefoldGateway } from '@musefold/platform';
import { DESKTOP_CAPABILITIES, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerValue } from '../Composer';
import { GenerationTimeline } from '../GenerationTimeline';
import { resolveInheritedGenerationParams } from '../session-store';
import { turnMetaSegments, turnNumbers } from '../turn-meta';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
});

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace(/Z$/, '+00:00');
}

function makeAsset(id: string): GenerationAsset {
  return {
    id,
    url: `https://example.test/${id}.png`,
    mimeType: 'image/png',
    width: 512,
    height: 512,
    byteSize: 1024,
    expiresAt: '2099-01-01T00:00:00+00:00',
  };
}

function makeJob(partial: Partial<GenerationJob> & { id: string }): GenerationJob {
  return {
    sessionId: 'session-1',
    parentRunId: null,
    promptId: null,
    userPrompt: `prompt ${partial.id}`,
    promptReferences: [],
    actorType: 'web',
    approvalStatus: 'not_required',
    status: 'succeeded',
    progress: 100,
    request: {
      prompt: `prompt ${partial.id}`,
      size: 'auto',
      quality: 'auto',
      count: 1,
      referenceImages: [],
    },
    providerModel: 'model-a',
    costPoints: null,
    assets: [],
    error: null,
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: nowIso(1_000),
    deletedAt: null,
    ...partial,
  };
}

/** 请求快照基线:各用例只覆盖 count / aspectRatio / quality 三项。 */
const BASE_REQUEST = makeJob({ id: 'base' }).request;

/** 时间线直渲染:资产集合固定,专测结果消费(网格 / 逐图动作 / Lightbox)。 */
function renderTimeline(
  jobs: GenerationJob[],
  options: {
    desktop?: boolean;
    saveResult?: 'saved' | 'cancelled';
    onOpenSettings?: () => void;
  } = {},
) {
  const assetSaves: SaveAssetInput[] = [];
  const copied: string[] = [];
  const generation = {
    saveAsset: async (input: SaveAssetInput) => {
      assetSaves.push(input);
      return options.saveResult ?? ('saved' as const);
    },
    copyAssetToClipboard: async (assetId: string) => {
      copied.push(assetId);
    },
  } as unknown as GenerationGateway;
  const gateway = { generation } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformProvider
        runtime={{
          gateway,
          capabilities: options.desktop ? DESKTOP_CAPABILITIES : WEB_CAPABILITIES,
        }}
      >
        <GenerationTimeline
          jobs={jobs}
          onCancel={() => {}}
          onRetry={() => {}}
          onRemove={() => {}}
          onEditMessage={() => {}}
          onOpenSettings={options.onOpenSettings}
        />
      </PlatformProvider>
    </QueryClientProvider>,
  );
  return { assetSaves, copied };
}

const BASE_VALUE: ComposerValue = {
  prompt: '',
  negative: '',
  aspectRatio: 'auto',
  quality: 'auto',
  count: 1,
  promptReferenceSelections: [],
};

function ComposerHarness({ maxCount }: { maxCount?: GenerationCount }) {
  const [value, setValue] = useState<ComposerValue>(BASE_VALUE);
  return (
    <Composer
      value={value}
      submitting={false}
      maxCount={maxCount}
      onChange={setValue}
      onSubmit={() => {}}
    />
  );
}

describe('Composer 张数控件门控(§9-D3 / ui-parity 03 §2)', () => {
  it('maxCount 缺省或为 1:张数控件整体不渲染(不留死控件,D2)', () => {
    render(<ComposerHarness />);
    fireEvent.click(screen.getByTestId('composer-settings'));
    expect(screen.queryByTestId('composer-count')).toBeNull();
    expect(screen.getByTestId('composer-quality')).toBeTruthy();
  });

  it('maxCount 4:radio 组按旧序 1/2/4,选中写回 value 并进摘要文案', () => {
    render(<ComposerHarness maxCount={4} />);
    fireEvent.click(screen.getByTestId('composer-settings'));

    const group = screen.getByTestId('composer-count');
    expect([...group.querySelectorAll('[role="radio"]')].map((node) => node.textContent)).toEqual([
      '1 张',
      '2 张',
      '4 张',
    ]);
    expect(screen.getByTestId('composer-count-1').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('composer-count-4'));

    expect(screen.getByTestId('composer-count-4').getAttribute('aria-checked')).toBe('true');
    // 值摘要钮:>1 时带张数(=1 时不啰嗦)。
    expect(screen.getByTestId('composer-settings').textContent).toContain('4 张');
    fireEvent.click(screen.getByTestId('composer-count-1'));
    expect(screen.getByTestId('composer-settings').textContent).not.toContain('张');
  });

  it('maxCount 2:只出 1/2 两档,不渲染宿主不支持的 4', () => {
    render(<ComposerHarness maxCount={2} />);
    fireEvent.click(screen.getByTestId('composer-settings'));
    expect(screen.getByTestId('composer-count-2')).toBeTruthy();
    expect(screen.queryByTestId('composer-count-4')).toBeNull();
  });
});

describe('张数继承/覆盖(与比例、质量同一套语义)', () => {
  it('未显式改过跟随默认张数;显式覆盖后不再跟随', () => {
    expect(
      resolveInheritedGenerationParams(
        { defaultAspectRatio: '16:9', defaultQuality: 'high', defaultCount: 4 },
        {},
      ),
    ).toEqual({ aspectRatio: '16:9', quality: 'high', count: 4 });
    expect(
      resolveInheritedGenerationParams(
        { defaultAspectRatio: '16:9', defaultQuality: 'high', defaultCount: 4 },
        { count: 2 },
      ).count,
    ).toBe(2);
    // 张数覆盖不牵动其它两项。
    expect(
      resolveInheritedGenerationParams(
        { defaultAspectRatio: '16:9', defaultQuality: 'high', defaultCount: 4 },
        { count: 1 },
      ),
    ).toEqual({ aspectRatio: '16:9', quality: 'high', count: 1 });
  });
});

describe('时间线多图结果消费(ui-parity 03 §2 / §4)', () => {
  it.each([
    { width: 1600, height: 900, aspectRatio: '1:1', expected: 'auto 1600 / 900' },
    { width: 900, height: 1600, aspectRatio: 'auto', expected: 'auto 900 / 1600' },
  ])(
    '单图加载前保留尺寸，解码后使用实际比例 ($expected)',
    ({ width, height, aspectRatio, expected }) => {
      renderTimeline([
        makeJob({
          id: 'pending-image',
          request: { ...BASE_REQUEST, aspectRatio },
          assets: [{ ...makeAsset('pending-asset'), width, height }],
        }),
      ]);
      const image = screen.getByTestId('job-asset').querySelector('img');
      expect(image?.style.aspectRatio).toBe(expected);
      expect(image?.getAttribute('width')).toBe(String(width));
      expect(image?.getAttribute('height')).toBe(String(height));
      expect(image?.getAttribute('data-loaded')).toBe('false');
    },
  );

  it('1 张单列 / 2 张两列 / 4 张 2×2:同一 grid-cols-2 承 2 与 4', () => {
    renderTimeline([
      makeJob({ id: 'job-1', assets: [makeAsset('a1')] }),
      makeJob({
        id: 'job-2',
        request: { ...BASE_REQUEST, count: 2 },
        assets: [makeAsset('b1'), makeAsset('b2')],
      }),
      makeJob({
        id: 'job-4',
        request: { ...BASE_REQUEST, count: 4 },
        assets: ['c1', 'c2', 'c3', 'c4'].map(makeAsset),
      }),
    ]);

    const grids = screen.getAllByTestId('job-asset-grid');
    expect(grids.map((grid) => grid.getAttribute('data-count'))).toEqual(['1', '2', '4']);
    expect(grids[0]?.className).not.toContain('grid-cols-2');
    expect(grids[1]?.className).toContain('grid-cols-2');
    expect(grids[2]?.className).toContain('grid-cols-2');
    expect(screen.getAllByTestId('job-asset')).toHaveLength(7);
  });

  it('生成中骨架按 request.count 与 aspectRatio 占位', () => {
    renderTimeline([
      makeJob({
        id: 'job-running',
        status: 'running',
        finishedAt: null,
        assets: [],
        request: { ...BASE_REQUEST, count: 4, aspectRatio: '16:9' },
      }),
    ]);

    const placeholders = screen.getAllByTestId('job-placeholder');
    expect(placeholders).toHaveLength(4);
    expect(placeholders[0]?.style.aspectRatio).toBe('16 / 9');
    expect(screen.getByTestId('job-placeholder-grid').getAttribute('data-count')).toBe('4');
  });

  it('逐图动作:第 N 张单独保存、以第 N 张为首图存为提示词', async () => {
    const { assetSaves } = renderTimeline([
      makeJob({
        id: 'job-2',
        request: { ...BASE_REQUEST, count: 2 },
        assets: [makeAsset('b1'), makeAsset('b2')],
      }),
    ]);

    fireEvent.click(screen.getAllByTestId('job-asset-save')[1] as HTMLElement);
    await waitFor(() => expect(assetSaves).toHaveLength(1));
    expect(assetSaves[0]?.url).toBe('https://example.test/b2.png');

    fireEvent.click(screen.getAllByTestId('job-asset-save-prompt')[1] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('save-prompt-dialog')).toBeTruthy());
  });

  it('回合级「全部保存」顺序保存每一张;单图回合只出单张保存钮', async () => {
    const { assetSaves } = renderTimeline([
      makeJob({
        id: 'job-4',
        request: { ...BASE_REQUEST, count: 4 },
        assets: ['c1', 'c2', 'c3', 'c4'].map(makeAsset),
      }),
    ]);

    expect(screen.queryByTestId('job-save-asset')).toBeNull();
    fireEvent.click(screen.getByTestId('job-save-all'));

    await waitFor(() => expect(assetSaves).toHaveLength(4));
    expect(assetSaves.map((save) => save.url)).toEqual([
      'https://example.test/c1.png',
      'https://example.test/c2.png',
      'https://example.test/c3.png',
      'https://example.test/c4.png',
    ]);
  });

  it('用户取消系统对话框即停止后续保存(取消不是错误)', async () => {
    const { assetSaves } = renderTimeline(
      [
        makeJob({
          id: 'job-4',
          request: { ...BASE_REQUEST, count: 4 },
          assets: ['c1', 'c2', 'c3', 'c4'].map(makeAsset),
        }),
      ],
      { saveResult: 'cancelled' },
    );

    fireEvent.click(screen.getByTestId('job-save-all'));
    await waitFor(() => expect(assetSaves).toHaveLength(1));
    // 首张即被取消 → 不继续问第二张。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(assetSaves).toHaveLength(1);
  });
});

describe('时间线 Lightbox 单回合多图翻页(ui-parity 03 §4 P2)', () => {
  const multiJob = makeJob({
    id: 'job-4',
    request: { ...BASE_REQUEST, count: 4 },
    assets: ['c1', 'c2', 'c3', 'c4'].map(makeAsset),
  });

  it('按钮与 ←/→ 在同一回合内翻页,计数「n / N」跟随', () => {
    renderTimeline([multiJob]);
    fireEvent.click(screen.getAllByTestId('job-asset')[1] as HTMLElement);

    const lightbox = screen.getByTestId('job-lightbox');
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('2 / 4');
    expect(screen.getByTestId('lightbox-image').getAttribute('src')).toContain('c2');

    fireEvent.click(screen.getByTestId('lightbox-next'));
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('3 / 4');

    fireEvent.keyDown(lightbox, { key: 'ArrowRight' });
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('4 / 4');
    // 末张无「下一张」,方向键也不越界。
    expect(screen.queryByTestId('lightbox-next')).toBeNull();
    fireEvent.keyDown(lightbox, { key: 'ArrowRight' });
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('4 / 4');

    fireEvent.keyDown(lightbox, { key: 'ArrowLeft' });
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('3 / 4');
    fireEvent.click(screen.getByTestId('lightbox-prev'));
    expect(screen.getByTestId('lightbox-counter').textContent).toBe('2 / 4');
  });

  it('单图回合不出计数与翻页钮', () => {
    renderTimeline([makeJob({ id: 'job-1', assets: [makeAsset('a1')] })]);
    fireEvent.click(screen.getByTestId('job-asset'));

    expect(screen.getByTestId('job-lightbox')).toBeTruthy();
    expect(screen.queryByTestId('lightbox-counter')).toBeNull();
    expect(screen.queryByTestId('lightbox-prev')).toBeNull();
    expect(screen.queryByTestId('lightbox-next')).toBeNull();
  });

  it('「复制图片」按 canRevealLocalFile 门控:桌面渲染并送资产 id,Web 不渲染', async () => {
    const desktop = renderTimeline([multiJob], { desktop: true });
    fireEvent.click(screen.getAllByTestId('job-asset')[2] as HTMLElement);
    fireEvent.click(screen.getByTestId('lightbox-copy-asset'));
    await waitFor(() => expect(desktop.copied).toEqual(['c3']));
  });

  it('Web 宿主不渲染「复制图片」', () => {
    renderTimeline([multiJob]);
    fireEvent.click(screen.getAllByTestId('job-asset')[0] as HTMLElement);
    expect(screen.queryByTestId('lightbox-copy-asset')).toBeNull();
    expect(screen.getByTestId('lightbox-save-asset')).toBeTruthy();
  });

  it('Esc 关闭并把焦点还给触发的图格(§8-I9)', async () => {
    renderTimeline([multiJob]);
    const trigger = screen.getAllByTestId('job-asset')[1] as HTMLElement;
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByTestId('job-lightbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('job-lightbox')).toBeNull());
    await waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.dataset.testid).toBe('job-asset'),
    );
    expect(document.activeElement).toBe(trigger);
  });
});

describe('用户消息 meta 行(ui-parity 03 §4)', () => {
  it('文案 = 比例 · 质量 · 张数(>1 时);目录文案与 Composer 同源', () => {
    expect(
      turnMetaSegments(
        makeJob({
          id: 'job-1',
          request: {
            ...BASE_REQUEST,
            aspectRatio: '16:9',
            quality: 'high',
            count: 4,
          },
        }),
      ),
    ).toEqual(['16:9', '超清', '4 张']);
    // 单张不写张数;缺比例回 auto(与 Composer 比例钮同显示)。
    expect(turnMetaSegments(makeJob({ id: 'job-2' }))).toEqual(['auto', '自动']);
  });

  it('回合序号从 #1 起,按时间线可视顺序', () => {
    const numbers = turnNumbers([makeJob({ id: 'a' }), makeJob({ id: 'b' })]);
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(2);
  });

  it('有 parentRunId 时渲染「来自 #1 微调」并可点击滚到父回合;纯引用任务不渲染 meta 行', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderTimeline([
      makeJob({ id: 'job-parent', assets: [makeAsset('a1')] }),
      makeJob({
        id: 'job-child',
        parentRunId: 'job-parent',
        request: { ...BASE_REQUEST, aspectRatio: '3:4', count: 2 },
        assets: [makeAsset('b1'), makeAsset('b2')],
      }),
      // 纯引用任务:原文为空 → 无气泡、无 meta 行。
      makeJob({ id: 'job-refs-only', userPrompt: '', assets: [makeAsset('d1')] }),
    ]);

    const metas = screen.getAllByTestId('job-meta');
    expect(metas).toHaveLength(2);
    expect(metas[1]?.textContent).toContain('3:4');
    expect(metas[1]?.textContent).toContain('2 张');

    fireEvent.click(screen.getByTestId('job-meta-parent'));
    expect(screen.getByTestId('job-meta-parent').textContent).toBe('来自 #1 微调');
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe('时间线密钥失效引导', () => {
  it('AUTH 失败给出可点检查密钥', async () => {
    const onOpenSettings = vi.fn();
    renderTimeline(
      [
        makeJob({
          id: 'job-auth',
          status: 'failed',
          error: { code: 'AUTH_CREDENTIALS_INVALID', message: 'invalid api key' },
          assets: [],
        }),
      ],
      { onOpenSettings },
    );

    expect(screen.getByTestId('job-error').textContent).toContain('API Key 无效');
    fireEvent.click(screen.getByTestId('job-error-action'));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
