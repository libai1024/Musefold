import type {
  NewPromptDocument,
  PromptDocument,
  PromptListQuery,
  UpdatePromptDocument,
} from '@musefold/contracts';
import type { MusefoldGateway, PromptsGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PromptLibraryScreen } from '../PromptLibraryScreen';

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

function renderLibrary(prompts: PromptsGateway) {
  const gateway = { prompts } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<PromptLibraryScreen />, { wrapper: Providers });
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
});
