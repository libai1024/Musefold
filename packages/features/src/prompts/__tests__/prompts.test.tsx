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
    expect(screen.getByTestId(`prompt-row-${created.id}`).className).toContain('mf-row-highlight');
    expect(useScreenIntent.getState().intent).toBeNull();
    useScreenIntent.setState({ intent: null });
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
