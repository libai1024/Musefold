import type {
  PromptDocument,
  PromptListQuery,
  PromptReferenceSelection,
} from '@musefold/contracts';
import type { MusefoldGateway, PromptsGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PromptReferenceDock,
  PromptReferencePanel,
  readSelectionRangeWithin,
} from '../PromptReferencePanel';
import { addPromptReference, notifyPromptReferenceAddError } from '../prompt-references';

vi.mock('@musefold/ui/components/sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@musefold/ui/components/sonner')>();
  return { ...actual, toast: { ...actual.toast, error: vi.fn(), success: vi.fn() } };
});

function makePrompt(id: string, overrides: Partial<PromptDocument> = {}): PromptDocument {
  const timestamp = '2026-08-29T08:00:00+00:00';
  return {
    id,
    title: `提示词 ${id}`,
    description: null,
    content: `${id} 的正文内容`,
    negative: null,
    folderId: null,
    tags: [],
    modelId: null,
    params: null,
    rating: 0,
    isPinned: false,
    pinOrder: null,
    usageCount: 0,
    lastUsedAt: null,
    source: 'manual',
    sourceUrl: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...overrides,
  };
}

/** 内存 prompts:list 支持 q 过滤与 cursor 翻页;get 按 id 查,不存在抛 NOT_FOUND。 */
function createPromptsGateway(seed: PromptDocument[], calls?: PromptListQuery[]): PromptsGateway {
  const gateway: Pick<PromptsGateway, 'list' | 'get'> = {
    list: async (query: PromptListQuery) => {
      calls?.push(query);
      const filtered = query.q
        ? seed.filter(
            (prompt) =>
              prompt.title.includes(query.q ?? '') || prompt.content.includes(query.q ?? ''),
          )
        : seed;
      const limit = typeof query.limit === 'number' ? query.limit : 20;
      const start = typeof query.cursor === 'string' && query.cursor ? Number(query.cursor) : 0;
      const items = filtered.slice(start, start + limit);
      return {
        items,
        nextCursor: start + limit < filtered.length ? String(start + limit) : null,
      };
    },
    get: async (id: string) => {
      const found = seed.find((prompt) => prompt.id === id);
      if (!found) throw new Error('NOT_FOUND');
      return found;
    },
  };
  return gateway as PromptsGateway;
}

function renderWithPlatform(node: ReactNode, prompts: PromptsGateway) {
  const gateway = { prompts } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {node}
      </PlatformProvider>
    </QueryClientProvider>,
  );
}

/** 受控宿主:与 WorkbenchScreen 同构,上限/重复走同一份 addPromptReference 判定。 */
function PanelHarness({
  initialSelections = [],
  onClose = () => {},
}: {
  initialSelections?: PromptReferenceSelection[];
  onClose?: () => void;
}) {
  const [selections, setSelections] = useState<PromptReferenceSelection[]>(initialSelections);
  return (
    <PromptReferencePanel
      selections={selections}
      onClose={onClose}
      onAdd={(intent) => {
        const result = addPromptReference(selections, intent);
        if (!result.ok) {
          notifyPromptReferenceAddError(result.reason);
          return;
        }
        setSelections(result.next);
      }}
    />
  );
}

/** 在展开正文上制造真实 DOM 选区(UTF-16 区间)。 */
function selectContentRange(start: number, end: number) {
  const content = screen.getByTestId('workbench-reference-content');
  const textNode = content.firstChild as Text;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.getSelection()?.removeAllRanges();
});

describe('PromptReferencePanel 状态矩阵与结构', () => {
  it('loading:显示「加载提示词」;结构含标题/搜索/计数/关闭', async () => {
    const pending = {
      list: (_query: PromptListQuery) => new Promise<never>(() => {}),
      get: (_id: string) => new Promise<never>(() => {}),
    } as unknown as PromptsGateway;
    renderWithPlatform(<PanelHarness />, pending);
    expect(screen.getByText('加载提示词')).toBeTruthy();
    // 结构契约:heading 参考素材 / 搜索 aria+占位 / 计数 / 关闭 label+title / 根 testid。
    expect(screen.getByTestId('workbench-reference-sidebar')).toBeTruthy();
    expect(screen.getByText('参考素材')).toBeTruthy();
    const search = screen.getByTestId('workbench-reference-search');
    expect(search.getAttribute('aria-label')).toBe('搜索提示词');
    expect(search.getAttribute('placeholder')).toBe('搜索提示词');
    expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 0/6');
    const close = screen.getByTestId('workbench-materials-close');
    expect(close.getAttribute('aria-label')).toBe('收起参考素材面板');
    expect(close.getAttribute('title')).toBe('收起参考素材面板');
  });

  it('empty:没有结果时显示「没有找到提示词」', async () => {
    renderWithPlatform(<PanelHarness />, createPromptsGateway([]));
    await waitFor(() => {
      expect(screen.getByText('没有找到提示词')).toBeTruthy();
    });
  });

  it('error:错误卡 + 重试(refetch)', async () => {
    let calls = 0;
    const failing = {
      list: async (_query: PromptListQuery) => {
        calls += 1;
        throw new Error('网络异常');
      },
      get: async (_id: string) => {
        throw new Error('NOT_FOUND');
      },
    } as unknown as PromptsGateway;
    renderWithPlatform(<PanelHarness />, failing);
    await waitFor(() => {
      expect(screen.getByText('提示词加载失败')).toBeTruthy();
      expect(screen.getByText('网络异常')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('workbench-reference-retry'));
    await waitFor(() => {
      expect(calls).toBe(2);
    });
  });

  it('搜索:输入经 q 传给网关;分页:加载更多带 cursor 追加', async () => {
    const calls: PromptListQuery[] = [];
    const seed = Array.from({ length: 25 }, (_, index) => makePrompt(`p-${index}`));
    renderWithPlatform(<PanelHarness />, createPromptsGateway(seed, calls));
    await waitFor(() => {
      expect(screen.getAllByTestId('workbench-reference-row')).toHaveLength(20);
    });

    // 翻页:cursor 注入第二页,行数累计到 25。
    fireEvent.click(screen.getByTestId('workbench-reference-more'));
    await waitFor(() => {
      expect(screen.getAllByTestId('workbench-reference-row')).toHaveLength(25);
    });
    expect(calls.some((call) => call.cursor === '20')).toBe(true);

    // 搜索:q 进入查询;无命中回到空态。
    fireEvent.change(screen.getByTestId('workbench-reference-search'), {
      target: { value: 'p-24' },
    });
    await waitFor(() => {
      expect(calls.some((call) => call.q === 'p-24')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('workbench-reference-row')).toHaveLength(1);
    });
  });

  it('关闭按钮回调 onClose', async () => {
    const onClose = vi.fn();
    renderWithPlatform(<PanelHarness onClose={onClose} />, createPromptsGateway([]));
    fireEvent.click(screen.getByTestId('workbench-materials-close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('PromptReferencePanel 引用动作', () => {
  it('展开行显示可选正文与两个动作;引用整条产生 full 意图并更新计数/已引用', async () => {
    renderWithPlatform(
      <PanelHarness />,
      createPromptsGateway([makePrompt('p-1', { title: '霓虹街景', version: 7 })]),
    );
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('workbench-reference-expand'));
    const content = screen.getByTestId('workbench-reference-content');
    expect(content.textContent).toBe('p-1 的正文内容');
    expect(screen.getByTestId('workbench-reference-expand').getAttribute('aria-expanded')).toBe(
      'true',
    );

    fireEvent.click(screen.getByTestId('workbench-reference-full'));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 1/6');
    });
    // 已引用:行内标记 + 整条动作禁用并改文案。
    const row = screen.getByTestId('workbench-reference-row');
    expect(within(row).getAllByText('已引用').length).toBeGreaterThan(0);
    const fullButton = screen.getByTestId('workbench-reference-full') as HTMLButtonElement;
    expect(fullButton.disabled).toBe(true);
    expect(fullButton.textContent).toContain('已引用');
  });

  it('引用选中内容:真实 DOM 选区按 UTF-16 偏移生成 excerpt 意图(astral 字符)', async () => {
    // '前😀后' —— 😀 占 2 个 UTF-16 code unit;选 [0,3) = '前😀'。
    const seed = [makePrompt('p-astral', { content: '前😀后缀文字' })];
    let added: PromptReferenceSelection | null = null;
    renderWithPlatform(
      <PromptReferencePanel
        selections={[]}
        onClose={() => {}}
        onAdd={(intent) => {
          added = intent;
        }}
      />,
      createPromptsGateway(seed),
    );
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('workbench-reference-expand'));

    selectContentRange(0, 3);
    fireEvent.click(screen.getByTestId('workbench-reference-selection'));
    expect(added).toEqual({
      promptId: 'p-astral',
      scope: 'excerpt',
      expectedVersion: 1,
      range: { start: 0, end: 3 },
    });
    // 添加后选区清空,避免下次误用。
    expect(window.getSelection()?.isCollapsed ?? true).toBe(true);
  });

  it('未选中内容点击「引用选中内容」:明确反馈,不产生意图', async () => {
    let added = 0;
    renderWithPlatform(
      <PromptReferencePanel
        selections={[]}
        onClose={() => {}}
        onAdd={() => {
          added += 1;
        }}
      />,
      createPromptsGateway([makePrompt('p-1')]),
    );
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('workbench-reference-expand'));
    fireEvent.click(screen.getByTestId('workbench-reference-selection'));
    expect(added).toBe(0);
    expect(toast.error).toHaveBeenCalledWith('没有选中内容', {
      description: '请先在提示词正文里选中要引用的片段。',
    });
  });

  it('选区超 4000 字:拒绝并提示缩短', async () => {
    const seed = [makePrompt('p-long', { content: '长'.repeat(5_000) })];
    let added = 0;
    renderWithPlatform(
      <PromptReferencePanel
        selections={[]}
        onClose={() => {}}
        onAdd={() => {
          added += 1;
        }}
      />,
      createPromptsGateway(seed),
    );
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('workbench-reference-expand'));
    selectContentRange(0, 4_500);
    fireEvent.click(screen.getByTestId('workbench-reference-selection'));
    expect(added).toBe(0);
    expect(toast.error).toHaveBeenCalledWith('选中内容过长', {
      description: '请把选区缩短到 4000 字以内。',
    });
  });

  it('重复意图不静默添加;第 7 条触发上限反馈', async () => {
    const six: PromptReferenceSelection[] = Array.from({ length: 6 }, (_, index) => ({
      promptId: `seed-${index}`,
      scope: 'full',
      expectedVersion: 1,
    }));
    renderWithPlatform(
      <PanelHarness initialSelections={six} />,
      createPromptsGateway([makePrompt('p-1')]),
    );
    expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 6/6');
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('workbench-reference-expand'));
    fireEvent.click(screen.getByTestId('workbench-reference-full'));
    expect(toast.error).toHaveBeenCalledWith('引用数量已满', {
      description: '最多同时引用 6 条提示词。',
    });
    expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 6/6');
  });

  it('相同区间片段重复添加被拒绝', async () => {
    const seed = [makePrompt('p-1')];
    renderWithPlatform(<PanelHarness />, createPromptsGateway(seed));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-row')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('workbench-reference-expand'));

    selectContentRange(0, 3);
    fireEvent.click(screen.getByTestId('workbench-reference-selection'));
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 1/6');
    });

    selectContentRange(0, 3);
    fireEvent.click(screen.getByTestId('workbench-reference-selection'));
    expect(toast.error).toHaveBeenCalledWith('已经引用过这段内容');
    expect(screen.getByTestId('workbench-reference-count').textContent).toBe('已引用 1/6');
  });
});

describe('readSelectionRangeWithin(UTF-16 选区读取)', () => {
  it('空选区/容器外选区返回 null', () => {
    const container = document.createElement('p');
    container.textContent = '正文内容';
    document.body.appendChild(container);
    expect(readSelectionRangeWithin(container)).toBeNull();

    const outside = document.createElement('p');
    outside.textContent = '外部文字';
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(readSelectionRangeWithin(container)).toBeNull();
    selection?.removeAllRanges();
    container.remove();
    outside.remove();
  });
});

describe('PromptReferenceDock(双形态宿主)', () => {
  function DockHarness({ returnFocus }: { returnFocus: HTMLButtonElement }) {
    const [open, setOpen] = useState(true);
    const returnFocusRef = useRefValue(returnFocus);
    return (
      <PromptReferenceDock
        open={open}
        selections={[]}
        onAdd={() => {}}
        onOpenChange={setOpen}
        returnFocusRef={returnFocusRef}
      />
    );
  }

  function useRefValue<T>(value: T) {
    const ref = { current: value };
    return ref;
  }

  it('移动端(jsdom 默认):Dialog 形态,含背景罩,打开聚焦搜索,Esc 关闭并归还焦点', async () => {
    const trigger = document.createElement('button');
    trigger.dataset.testid = 'composer-attach';
    document.body.appendChild(trigger);
    renderWithPlatform(<DockHarness returnFocus={trigger} />, createPromptsGateway([]));

    // 背景罩与面板根并存(Radix 焦点圈闭)。
    await waitFor(() => {
      expect(screen.getByTestId('workbench-reference-backdrop')).toBeTruthy();
      expect(screen.getByTestId('workbench-reference-sidebar')).toBeTruthy();
    });
    expect(document.querySelector('[data-slot="dialog-content"]')?.className).toContain(
      'h-[82dvh]',
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('workbench-reference-search'));
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('workbench-reference-sidebar')).toBeNull();
    });
    // 焦点归还「添加上下文」触发钮。
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    trigger.remove();
  });

  it('桌面形态(matchMedia ≥768px):内联侧栏无背景罩,Esc 关闭并归还焦点', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    try {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      renderWithPlatform(<DockHarness returnFocus={trigger} />, createPromptsGateway([]));

      await waitFor(() => {
        expect(screen.getByTestId('workbench-reference-sidebar')).toBeTruthy();
      });
      // 内联面板:无移动背景罩,搜索框自动聚焦。
      expect(screen.queryByTestId('workbench-reference-backdrop')).toBeNull();
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByTestId('workbench-reference-search'));
      });

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByTestId('workbench-reference-sidebar')).toBeNull();
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
      trigger.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('桌面关闭按钮同样归还焦点', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    try {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      renderWithPlatform(<DockHarness returnFocus={trigger} />, createPromptsGateway([]));
      await waitFor(() => {
        expect(screen.getByTestId('workbench-materials-close')).toBeTruthy();
      });
      fireEvent.click(screen.getByTestId('workbench-materials-close'));
      await waitFor(() => {
        expect(screen.queryByTestId('workbench-reference-sidebar')).toBeNull();
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
      trigger.remove();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
