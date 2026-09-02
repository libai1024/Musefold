import type { NewPromptDocument, PromptDocument } from '@musefold/contracts';
import type { MusefoldGateway, PromptsGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { TooltipProvider } from '@musefold/ui/components/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSchemeIntegration } from '../../design-schemes/integration-store';
import { PromptLibraryScreen } from '../PromptLibraryScreen';

const user = userEvent.setup({ pointerEventsCheck: 0 });
const NOW = '2026-08-30T08:00:00.000Z';
const SCHEME_CAPABILITIES = { ...WEB_CAPABILITIES, hasDesignSchemes: true };

function makePrompt(overrides: Partial<PromptDocument> = {}): PromptDocument {
  return {
    id: 'prompt-1',
    title: '水彩猫',
    description: null,
    content: '画一只水彩风格的猫',
    negative: '低清晰度',
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
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

/** 最小 prompts gateway:列表/文件夹/标签闭环,其余为未用桩。 */
function createPromptsGateway(items: PromptDocument[]): PromptsGateway {
  const unused = () => {
    throw new Error('unused');
  };
  return {
    list: async () => ({ items, nextCursor: null }),
    get: async (id: string) => {
      const found = items.find((item) => item.id === id);
      if (!found) throw new Error('NOT_FOUND');
      return found;
    },
    create: async (input: NewPromptDocument) => makePrompt({ ...input, id: 'prompt-new' }),
    update: unused,
    remove: unused,
    restore: unused,
    purge: async () => {},
    use: async () => ({ prompt: items[0] ?? makePrompt(), recorded: true }),
    listFolders: async () => [],
    createFolder: unused,
    updateFolder: unused,
    removeFolder: unused,
    listTags: async () => [],
    createTag: unused,
    updateTag: unused,
    removeTag: unused,
  } as unknown as PromptsGateway;
}

function renderLibrary(
  items: PromptDocument[],
  options: { onOpenWorkbench?: () => void; capabilities?: typeof WEB_CAPABILITIES } = {},
) {
  const gateway = { prompts: createPromptsGateway(items) } as unknown as MusefoldGateway;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{ gateway, capabilities: options.capabilities ?? SCHEME_CAPABILITIES }}
        >
          {/* 壳级 TooltipProvider 是生产唯一 provider(AppShell);独立渲染屏幕时测试壳补齐。 */}
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<PromptLibraryScreen onOpenWorkbench={options.onOpenWorkbench} />, {
    wrapper: Providers,
  });
}

beforeEach(() => {
  useSchemeIntegration.getState().consumeWorkbenchIntent();
});

describe('PromptLibraryScreen「创建方案」(承 v2.1 详情页菜单项)', () => {
  it('能力开 + 切屏回调齐备:行操作组出现「创建方案」,点击写创建意图并切屏', async () => {
    const onOpenWorkbench = vi.fn();
    renderLibrary([makePrompt()], { onOpenWorkbench });
    await waitFor(() => expect(screen.getByTestId('prompt-row-prompt-1')).toBeTruthy());

    await user.click(screen.getByTestId('prompt-row-create-scheme'));
    expect(onOpenWorkbench).toHaveBeenCalledTimes(1);

    const intent = useSchemeIntegration.getState().consumeWorkbenchIntent();
    expect(intent?.kind).toBe('create');
    if (intent?.kind === 'create') {
      expect(intent.createKind).toBe('prompt');
      // 种子逐字承旧:指令行 + 正文 + 可选「避免:反向词」。
      expect(intent.seed).toBe(
        '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。\n\n画一只水彩风格的猫\n\n避免：低清晰度',
      );
      // 来源上下文(promptId/标题)随意图保留。
      expect(intent.source).toEqual({ kind: 'prompt', promptId: 'prompt-1', title: '水彩猫' });
    }
  });

  it('方案域能力关闭:不出现该钮(D2 无死入口)', async () => {
    // 生产 Web capability 关闭；这里显式开启以验证共享入口。
    renderLibrary([makePrompt()], {
      onOpenWorkbench: vi.fn(),
      capabilities: { ...WEB_CAPABILITIES, hasDesignSchemes: false },
    });
    await waitFor(() => expect(screen.getByTestId('prompt-row-prompt-1')).toBeTruthy());
    expect(screen.queryByTestId('prompt-row-create-scheme')).toBeNull();
  });

  it('宿主未给切屏回调:不出现该钮(意图无法落地,宁可不显示)', async () => {
    renderLibrary([makePrompt()]);
    await waitFor(() => expect(screen.getByTestId('prompt-row-prompt-1')).toBeTruthy());
    expect(screen.queryByTestId('prompt-row-create-scheme')).toBeNull();
  });

  it('回收站行不出现「创建方案」(只有恢复/永久删除)', async () => {
    renderLibrary([makePrompt({ deletedAt: NOW })], { onOpenWorkbench: vi.fn() });
    await waitFor(() => expect(screen.getByTestId('prompt-row-prompt-1')).toBeTruthy());
    await user.click(screen.getByTestId('prompt-tab-trash'));
    await waitFor(() => expect(screen.getByTestId('prompt-row-restore')).toBeTruthy());
    expect(screen.queryByTestId('prompt-row-create-scheme')).toBeNull();
  });
});
