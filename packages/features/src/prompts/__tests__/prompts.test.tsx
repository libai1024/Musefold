import type {
  NewPromptDocument,
  PromptDocument,
  PromptListQuery,
  UpdatePromptDocument,
} from '@musefold/contracts';
import type { MusefoldGateway, PromptsGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { TooltipProvider } from '@musefold/ui/components/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useScreenIntent } from '../../shell/screen-intent-store';
import { useActiveSession } from '../../workbench/session-store';
import { promptToWorkbenchDraft } from '../hooks';
import { PromptLibraryScreen, type PromptLibraryScreenProps } from '../PromptLibraryScreen';

/** Radix Tabs 等组件依赖完整 pointer 事件序列,统一走 user-event。 */
const user = userEvent.setup({ pointerEventsCheck: 0 });

/** 内存版 prompts gateway:形状对齐 contracts,行为够 UI 流程断言。 */
function createMemoryPromptsGateway(): PromptsGateway {
  let seq = 0;
  const now = () => new Date().toISOString().replace(/Z$/, '+00:00');
  const documents = new Map<string, PromptDocument>();

  function create(input: NewPromptDocument): PromptDocument {
    seq += 1;
    const timestamp = now();
    const doc: PromptDocument = {
      id: `prompt-${seq}`,
      title: input.title,
      description: input.description ?? null,
      content: input.content,
      negative: input.negative ?? null,
      folderId: input.folderId ?? null,
      tags: [],
      modelId: input.modelId ?? null,
      params: input.params ?? null,
      rating: input.rating ?? 0,
      isPinned: input.isPinned ?? false,
      pinOrder: null,
      usageCount: 0,
      lastUsedAt: null,
      source: input.source ?? 'manual',
      sourceUrl: input.sourceUrl ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    documents.set(doc.id, doc);
    return doc;
  }

  function get(id: string): PromptDocument {
    const doc = documents.get(id);
    if (!doc) throw new Error(`NOT_FOUND: ${id}`);
    return doc;
  }

  return {
    list: async (query: PromptListQuery) => {
      let rows = [...documents.values()];
      if (!query.includeDeleted) rows = rows.filter((row) => row.deletedAt == null);
      if (query.pinnedOnly) rows = rows.filter((row) => row.isPinned);
      if (query.q) rows = rows.filter((row) => row.title.includes(query.q ?? ''));
      return { items: rows, nextCursor: null };
    },
    get: async (id) => get(id),
    create: async (input) => create(input),
    update: async (id, patch: UpdatePromptDocument) => {
      const doc = get(id);
      const next: PromptDocument = {
        ...doc,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
        version: doc.version + 1,
        updatedAt: now(),
      };
      documents.set(id, next);
      return next;
    },
    remove: async (id) => {
      const doc = { ...get(id), deletedAt: now() };
      documents.set(id, doc);
      return doc;
    },
    restore: async (id) => {
      const doc = { ...get(id), deletedAt: null };
      documents.set(id, doc);
      return doc;
    },
    purge: async (id) => {
      const doc = get(id);
      if (doc.deletedAt == null) throw new Error('VALIDATION_FAILED: 仅回收站行可永久删除');
      documents.delete(id);
    },
    emptyTrash: async () => {
      const trashed = [...documents.values()].filter((row) => row.deletedAt != null);
      for (const row of trashed) documents.delete(row.id);
      return { purged: trashed.length };
    },
    use: async (id) => ({ prompt: get(id), recorded: true }),
    listFolders: async () => [],
    createFolder: async () => {
      throw new Error('unused');
    },
    updateFolder: async () => {
      throw new Error('unused');
    },
    removeFolder: async () => {
      throw new Error('unused');
    },
    listTags: async () => [],
    createTag: async () => {
      throw new Error('unused');
    },
    updateTag: async () => {
      throw new Error('unused');
    },
    removeTag: async () => {
      throw new Error('unused');
    },
  };
}

const BASE_INPUT: Omit<NewPromptDocument, 'title' | 'content'> = {
  description: null,
  negative: null,
  folderId: null,
  tagIds: [],
  modelId: null,
  params: null,
  rating: 0,
  isPinned: false,
  source: 'manual',
  sourceUrl: null,
  coverImageUrl: null,
};

function renderLibrary(prompts: PromptsGateway, props?: PromptLibraryScreenProps) {
  const gateway = { prompts } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {/* 壳级 TooltipProvider 是生产唯一 provider(AppShell);独立渲染屏幕时测试壳补齐。 */}
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<PromptLibraryScreen {...props} />, { wrapper: Providers });
}

describe('PromptLibraryScreen', () => {
  it('shows empty state, then created prompt appears in the list', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    await waitFor(() => {
      expect(screen.getByTestId('prompt-empty')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('prompt-create'));
    fireEvent.change(screen.getByTestId('prompt-editor-title'), {
      target: { value: '赛博城市夜景' },
    });
    fireEvent.change(screen.getByTestId('prompt-editor-content'), {
      target: { value: 'cyberpunk city at night, neon lights' },
    });
    fireEvent.click(screen.getByTestId('prompt-editor-submit'));

    await waitFor(() => {
      expect(screen.getByText('赛博城市夜景')).toBeTruthy();
    });
    expect(screen.queryByTestId('prompt-editor')).toBeNull();
  });

  it('moves a prompt to trash and restores it from the trash tab', async () => {
    const prompts = createMemoryPromptsGateway();
    await prompts.create({ ...BASE_INPUT, title: '水彩插画', content: 'watercolor illustration' });
    renderLibrary(prompts);

    await waitFor(() => {
      expect(screen.getByText('水彩插画')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('prompt-row-remove'));
    await waitFor(() => {
      expect(screen.getByTestId('prompt-empty')).toBeTruthy();
    });

    await user.click(screen.getByTestId('prompt-tab-trash'));
    await waitFor(() => {
      expect(screen.getByText('水彩插画')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('prompt-row-restore'));
    await waitFor(() => {
      expect(screen.getByTestId('prompt-empty')).toBeTruthy();
    });

    await user.click(screen.getByTestId('prompt-tab-all'));
    await waitFor(() => {
      expect(screen.getByText('水彩插画')).toBeTruthy();
    });
  });

  it('「使用」把提示词送入工作台草稿并切屏(ui-parity 04 P0)', async () => {
    useActiveSession.setState({ pendingDraft: null });
    const prompts = createMemoryPromptsGateway();
    await prompts.create({
      ...BASE_INPUT,
      title: '胶片街拍',
      content: 'film street photo',
      negative: 'blurry',
      params: { aspectRatio: '16:9', quality: 'high' },
    });
    const onOpenWorkbench = vi.fn();
    renderLibrary(prompts, { onOpenWorkbench });

    fireEvent.click(await screen.findByTestId('prompt-row-use'));

    expect(useActiveSession.getState().pendingDraft).toEqual({
      prompt: 'film street photo',
      negative: 'blurry',
      params: { aspectRatio: '16:9', quality: 'high' },
      promptReferenceSelections: [],
      promptReferenceIds: [],
    });
    expect(onOpenWorkbench).toHaveBeenCalledTimes(1);
    useActiveSession.setState({ pendingDraft: null });
  });

  it('purges a trashed prompt permanently after confirmation', async () => {
    const prompts = createMemoryPromptsGateway();
    const created = await prompts.create({ ...BASE_INPUT, title: '油画肖像', content: 'oil' });
    await prompts.remove(created.id);
    renderLibrary(prompts);

    await user.click(screen.getByTestId('prompt-tab-trash'));
    await waitFor(() => {
      expect(screen.getByText('油画肖像')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('prompt-row-purge'));
    // 破坏性动作必须有确认对话框(V25-UI-SPEC §8-I4)。
    await waitFor(() => {
      expect(screen.getByTestId('prompt-purge-confirm')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('prompt-purge-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-empty')).toBeTruthy();
    });
    await expect(prompts.get(created.id)).rejects.toThrow('NOT_FOUND');
  });

  it('toggles pin and moves the row into the pinned section', async () => {
    const prompts = createMemoryPromptsGateway();
    const created = await prompts.create({ ...BASE_INPUT, title: '像素风', content: 'pixel art' });
    renderLibrary(prompts);

    await waitFor(() => {
      expect(screen.getByText('像素风')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('prompt-row-pin'));

    await waitFor(async () => {
      const updated = await prompts.get(created.id);
      expect(updated.isPinned).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText('置顶')).toBeTruthy();
    });
  });

  it('「prompt-highlight」意图:目标行带高亮渐隐类并消费意图(存为提示词「查看」落点)', async () => {
    const prompts = createMemoryPromptsGateway();
    const created = await prompts.create({
      ...BASE_INPUT,
      title: '来自生成',
      content: 'saved from generation',
      source: 'generation',
    });
    useScreenIntent.setState({ intent: { kind: 'prompt-highlight', promptId: created.id } });
    renderLibrary(prompts);

    await waitFor(() => {
      expect(screen.getByTestId(`prompt-row-${created.id}`)).toBeTruthy();
    });
    const row = screen.getByTestId(`prompt-row-${created.id}`);
    expect(row.className).toContain('mf-row-highlight');
    // 高亮接收端同时给出可编程/可访问标记(ui-parity 04 §8-5)。
    expect(row.getAttribute('data-highlighted')).toBe('true');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(useScreenIntent.getState().intent).toBeNull();
    useScreenIntent.setState({ intent: null });
  });
});

describe('详情 Inspector 与封面(ui-parity 04 §8-1/§8-2)', () => {
  it('行点击打开详情面板,呈现正文/元数据/相关作品,关闭钮收起', async () => {
    const prompts = createMemoryPromptsGateway();
    await prompts.create({
      ...BASE_INPUT,
      title: '青瓷静物',
      content: 'celadon still life, soft light',
      negative: 'text, watermark',
      source: 'generation',
    });
    renderLibrary(prompts);

    fireEvent.click(await screen.findByTestId('prompt-row-open'));

    const detail = await screen.findByTestId('prompt-detail');
    expect(detail.textContent).toContain('青瓷静物');
    expect(screen.getByTestId('prompt-detail-content').textContent).toBe(
      'celadon still life, soft light',
    );
    expect(screen.getByTestId('prompt-detail-negative').textContent).toBe('text, watermark');
    // 来源枚举映射中文(承旧 sourceLabel)。
    expect(screen.getByTestId('prompt-detail-meta').textContent).toContain('生成入库');
    expect(screen.getByTestId('prompt-detail-facts').textContent).toContain('使用次数');
    // 宿主未注入生成域时相关作品退成空态,不报错也不留死链接。
    expect(screen.getByTestId('prompt-detail-works-empty')).toBeTruthy();

    fireEvent.click(screen.getByTestId('prompt-detail-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-detail')).toBeNull();
    });
  });

  it('详情菜单「移入回收站」把行送进回收站', async () => {
    const prompts = createMemoryPromptsGateway();
    const created = await prompts.create({ ...BASE_INPUT, title: '铜版蚀刻', content: 'etching' });
    renderLibrary(prompts);

    fireEvent.click(await screen.findByTestId('prompt-row-open'));
    await user.click(await screen.findByTestId('prompt-detail-menu'));
    await user.click(await screen.findByTestId('prompt-detail-remove'));

    await waitFor(async () => {
      expect((await prompts.get(created.id)).deletedAt).not.toBeNull();
    });
    // 目标离开当前视图后详情自动收起,不留悬空面板。
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-detail')).toBeNull();
    });
  });

  it('封面缩略:有 coverImageUrl 显图,无封面走 FileText 占位', async () => {
    const prompts = createMemoryPromptsGateway();
    await prompts.create({
      ...BASE_INPUT,
      title: '有封面',
      content: 'with cover',
      coverImageUrl: 'https://cdn.test/cover.png',
    });
    await prompts.create({ ...BASE_INPUT, title: '无封面', content: 'no cover' });
    renderLibrary(prompts);

    await waitFor(() => {
      expect(screen.getByText('有封面')).toBeTruthy();
    });
    const covers = screen.getAllByTestId('prompt-row-cover');
    expect(covers).toHaveLength(1);
    expect(covers[0]?.getAttribute('src')).toBe('https://cdn.test/cover.png');
    expect(screen.getAllByTestId('prompt-row-cover-placeholder')).toHaveLength(1);
  });
});

describe('状态 CTA 与回收站清空(ui-parity 04 §8-3)', () => {
  it('搜索无匹配给「清除筛选」,清除后列表回来', async () => {
    const prompts = createMemoryPromptsGateway();
    await prompts.create({ ...BASE_INPUT, title: '雪山日照', content: 'alpenglow' });
    renderLibrary(prompts);

    await waitFor(() => {
      expect(screen.getByText('雪山日照')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('prompt-search'), { target: { value: '不存在的词' } });
    const clear = await screen.findByTestId('prompt-clear-filters');
    fireEvent.click(clear);

    await waitFor(() => {
      expect(screen.getByText('雪山日照')).toBeTruthy();
    });
    expect((screen.getByTestId('prompt-search') as HTMLInputElement).value).toBe('');
  });

  it('空库空态给「新建提示词」钮,点击直开编辑器', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    fireEvent.click(await screen.findByTestId('prompt-empty-create'));
    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
  });

  it('「清空回收站」双重确认后一次性永久删除全部软删条目', async () => {
    const prompts = createMemoryPromptsGateway();
    const first = await prompts.create({ ...BASE_INPUT, title: '待清一', content: 'a' });
    const second = await prompts.create({ ...BASE_INPUT, title: '待清二', content: 'b' });
    const kept = await prompts.create({ ...BASE_INPUT, title: '保留的', content: 'c' });
    await prompts.remove(first.id);
    await prompts.remove(second.id);
    renderLibrary(prompts);

    await user.click(screen.getByTestId('prompt-tab-trash'));
    await waitFor(() => {
      expect(screen.getByText('待清一')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('prompt-empty-trash'));
    const dialog = await screen.findByTestId('prompt-empty-trash-dialog');
    // 破坏性动作必须说明条数(V25-UI-SPEC §8-I4)。
    expect(dialog.textContent).toContain('2 条');
    fireEvent.click(screen.getByTestId('prompt-empty-trash-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-empty')).toBeTruthy();
    });
    await expect(prompts.get(first.id)).rejects.toThrow('NOT_FOUND');
    await expect(prompts.get(second.id)).rejects.toThrow('NOT_FOUND');
    expect(await prompts.get(kept.id)).toMatchObject({ title: '保留的' });
  });
});

describe('快捷键(ui-parity 04 §8-4)', () => {
  it('「/」在非输入态聚焦搜索框,输入态不抢键', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    const search = await screen.findByTestId('prompt-search');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(search);

    // 已在输入框里打「/」应正常输入,不再重复抢焦点。
    search.blur();
    const title = screen.getByTestId('prompt-create');
    title.focus();
    fireEvent.keyDown(search, { key: '/' });
    expect(document.activeElement).toBe(title);
  });

  it('「prompts-focus-search」意图(⌘K 落点)聚焦搜索框并消费意图', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);
    await screen.findByTestId('prompt-search');

    useScreenIntent.setState({ intent: { kind: 'prompts-focus-search' } });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('prompt-search'));
    });
    expect(useScreenIntent.getState().intent).toBeNull();
  });

  it('编辑器 ⌘S 走提交路径,clean 时不提交', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    fireEvent.click(await screen.findByTestId('prompt-create'));
    const editor = screen.getByTestId('prompt-editor');

    // clean(空表单)时不提交。
    fireEvent.keyDown(editor, { key: 's', metaKey: true });
    expect((await prompts.list({})).items).toHaveLength(0);

    fireEvent.change(screen.getByTestId('prompt-editor-title'), { target: { value: '快捷保存' } });
    fireEvent.change(screen.getByTestId('prompt-editor-content'), {
      target: { value: 'saved via cmd+s' },
    });
    fireEvent.keyDown(editor, { key: 's', metaKey: true });

    await waitFor(async () => {
      expect((await prompts.list({})).items).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor')).toBeNull();
    });
  });
});

describe('PromptEditorDialog dirty guard(未保存修改保护)', () => {
  function openCreateEditor() {
    fireEvent.click(screen.getByTestId('prompt-create'));
    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
  }

  function dirtyTitle() {
    fireEvent.change(screen.getByTestId('prompt-editor-title'), {
      target: { value: '改过的标题' },
    });
  }

  /**
   * 模拟遮罩层外点。Radix DismissableLayer 的 document 级 pointerdown 监听在
   * setTimeout(0) 后才挂上;modal Dialog 走 deferPointerDownOutside,外点 dispatch
   * 推迟到 click,且目标必须落在 overlay(dismissable surface)上才生效。
   */
  async function clickEditorOverlay() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay as Element);
    fireEvent.click(overlay as Element);
  }

  it('clean 状态下取消 / Escape / 外点直接关闭,不出现确认层', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    openCreateEditor();
    fireEvent.click(screen.getByTestId('prompt-editor-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor')).toBeNull();
    });
    expect(screen.queryByTestId('prompt-editor-discard-dialog')).toBeNull();

    openCreateEditor();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor')).toBeNull();
    });
    expect(screen.queryByTestId('prompt-editor-discard-dialog')).toBeNull();

    openCreateEditor();
    await clickEditorOverlay();
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor')).toBeNull();
    });
    expect(screen.queryByTestId('prompt-editor-discard-dialog')).toBeNull();
  });

  it('dirty 状态下 Escape 被拦截,「继续编辑」关闭确认层并保留全部修改', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    openCreateEditor();
    dirtyTitle();
    fireEvent.keyDown(document, { key: 'Escape' });

    // 编辑器不被关闭,确认层出现。
    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
    expect(screen.getByTestId('prompt-editor-discard-dialog')).toBeTruthy();

    fireEvent.click(screen.getByTestId('prompt-editor-continue'));
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor-discard-dialog')).toBeNull();
    });
    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
    expect((screen.getByTestId('prompt-editor-title') as HTMLInputElement).value).toBe(
      '改过的标题',
    );
  });

  it('dirty 状态下外部点击被拦截,「放弃修改」关闭编辑器且不保存', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    openCreateEditor();
    dirtyTitle();
    await clickEditorOverlay();

    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
    expect(screen.getByTestId('prompt-editor-discard-dialog')).toBeTruthy();

    fireEvent.click(screen.getByTestId('prompt-editor-discard'));
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor')).toBeNull();
    });
    expect(screen.queryByTestId('prompt-editor-discard-dialog')).toBeNull();
    // 不调用保存:库内仍是空的。
    expect((await prompts.list({})).items).toHaveLength(0);
    await waitFor(() => {
      expect(screen.getByTestId('prompt-empty')).toBeTruthy();
    });
  });

  it('dirty 状态下 X 关闭被拦截,继续编辑后保留修改', async () => {
    const prompts = createMemoryPromptsGateway();
    const created = await prompts.create({
      ...BASE_INPUT,
      title: '编辑前标题',
      content: 'original',
    });
    renderLibrary(prompts);

    await waitFor(() => {
      expect(screen.getByText('编辑前标题')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('prompt-row-edit'));
    fireEvent.change(screen.getByTestId('prompt-editor-title'), {
      target: { value: '编辑中标题' },
    });
    const closeButton = screen
      .getByTestId('prompt-editor')
      .querySelector('[data-slot="dialog-close"]');
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton as HTMLElement);

    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
    expect(screen.getByTestId('prompt-editor-discard-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('prompt-editor-continue'));
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor-discard-dialog')).toBeNull();
    });
    expect((screen.getByTestId('prompt-editor-title') as HTMLInputElement).value).toBe(
      '编辑中标题',
    );

    fireEvent.click(screen.getByTestId('prompt-editor-cancel'));
    fireEvent.click(screen.getByTestId('prompt-editor-discard'));
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor')).toBeNull();
    });
    expect(screen.getByText('编辑前标题')).toBeTruthy();
    expect(screen.queryByText('编辑中标题')).toBeNull();
    expect(await prompts.get(created.id)).toMatchObject({ title: '编辑前标题' });
  });

  it('字段改回原值后恢复 clean,取消直接关闭不再弹确认层', async () => {
    const prompts = createMemoryPromptsGateway();
    renderLibrary(prompts);

    openCreateEditor();
    dirtyTitle();
    fireEvent.change(screen.getByTestId('prompt-editor-title'), { target: { value: '' } });

    fireEvent.click(screen.getByTestId('prompt-editor-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('prompt-editor')).toBeNull();
    });
    expect(screen.queryByTestId('prompt-editor-discard-dialog')).toBeNull();
  });

  it('保存失败时保留当前表单值,编辑器保持打开', async () => {
    const prompts = createMemoryPromptsGateway();
    const failing: PromptsGateway = {
      ...prompts,
      create: async () => {
        throw new Error('NETWORK_DOWN');
      },
    };
    renderLibrary(failing);

    openCreateEditor();
    fireEvent.change(screen.getByTestId('prompt-editor-title'), {
      target: { value: '失败也要留住' },
    });
    fireEvent.change(screen.getByTestId('prompt-editor-content'), {
      target: { value: 'prompt that fails to save' },
    });
    fireEvent.click(screen.getByTestId('prompt-editor-submit'));

    // 等 mutation 落定(提交按钮恢复可用),表单值未被重置、编辑器仍打开。
    await waitFor(() => {
      expect(screen.getByTestId('prompt-editor-submit')).toHaveProperty('disabled', false);
    });
    expect(screen.getByTestId('prompt-editor')).toBeTruthy();
    expect((screen.getByTestId('prompt-editor-title') as HTMLInputElement).value).toBe(
      '失败也要留住',
    );
    expect((screen.getByTestId('prompt-editor-content') as HTMLTextAreaElement).value).toBe(
      'prompt that fails to save',
    );
    expect((await prompts.list({})).items).toHaveLength(0);
  });
});

describe('promptToWorkbenchDraft(参数收编与降级)', () => {
  const doc = {
    content: 'poster study',
    negative: null,
    params: null,
  } as Parameters<typeof promptToWorkbenchDraft>[0];

  it('收编契约认可的比例与质量', () => {
    expect(
      promptToWorkbenchDraft({ ...doc, params: { aspectRatio: '3:4', quality: 'medium' } }),
    ).toEqual({
      prompt: 'poster study',
      negative: '',
      params: { aspectRatio: '3:4', quality: 'medium' },
      promptReferenceSelections: [],
      promptReferenceIds: [],
    });
  });

  it('奇形参数丢参保正文,使用动作不失败', () => {
    expect(
      promptToWorkbenchDraft({ ...doc, params: { aspectRatio: '超宽', quality: 'ultra' } }).params,
    ).toEqual({});
    expect(promptToWorkbenchDraft(doc).params).toEqual({});
  });
});
