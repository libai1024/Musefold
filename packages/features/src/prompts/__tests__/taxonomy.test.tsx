import type { PromptFolder, PromptTag } from '@musefold/contracts';
import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHELL_SIDEBAR_COMPACT_BREAKPOINT } from '../../shell/sidebar-layout';
import { TaxonomyManager } from '../TaxonomyManager';

const user = userEvent.setup({ pointerEventsCheck: 0 });
const NOW = '2026-09-07T00:00:00.000+00:00';

function folder(partial: Partial<PromptFolder> = {}): PromptFolder {
  return {
    id: 'folder-1',
    name: '人像',
    parentId: null,
    sortOrder: 0,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...partial,
  };
}

function tag(partial: Partial<PromptTag> = {}): PromptTag {
  return {
    id: 'tag-1',
    name: '胶片',
    group: null,
    color: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...partial,
  };
}

function stubMatchMedia(isMobile: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const compactQuery = `(max-width: ${SHELL_SIDEBAR_COMPACT_BREAKPOINT}px)`;
    return {
      matches: isMobile && query === compactQuery,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  });
}

function renderTaxonomy(folders: PromptFolder[] = [folder()], tags: PromptTag[] = [tag()]) {
  const gateway = {
    prompts: {
      createFolder: vi.fn(),
      removeFolder: vi.fn(),
      createTag: vi.fn(),
      removeTag: vi.fn(),
    },
  } as unknown as MusefoldGateway;
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
  return render(<TaxonomyManager folders={folders} tags={tags} />, { wrapper: Providers });
}

describe('TaxonomyManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('jsdom/md+:打开后为 Popover 面板,无 Sheet', async () => {
    renderTaxonomy();

    const trigger = screen.getByTestId('taxonomy-open');
    expect(trigger.getAttribute('aria-label')).toBe('管理文件夹与标签');
    await user.click(trigger);

    expect(await screen.findByTestId('taxonomy-panel')).toBeTruthy();
    expect(screen.queryByTestId('taxonomy-sheet')).toBeNull();
    expect(screen.getByTestId('taxonomy-folder-name')).toBeTruthy();
    expect(screen.getByTestId('taxonomy-folder-create')).toBeTruthy();
    expect(screen.getByTestId('taxonomy-tag-name')).toBeTruthy();
    expect(screen.getByTestId('taxonomy-tag-create')).toBeTruthy();
    expect(screen.getByText('人像')).toBeTruthy();
    expect(screen.getByText('胶片')).toBeTruthy();
  });

  it('mobile(max-width: 767px):点击 taxonomy-open 后为 Sheet dialog', async () => {
    stubMatchMedia(true);
    renderTaxonomy();

    await user.click(screen.getByTestId('taxonomy-open'));

    expect(await screen.findByTestId('taxonomy-sheet')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '管理文件夹与标签' })).toBeTruthy();
    expect(screen.getByTestId('taxonomy-panel')).toBeTruthy();
    expect(screen.getByTestId('taxonomy-folder-name')).toBeTruthy();
    expect(screen.getByTestId('taxonomy-folder-create')).toBeTruthy();
    expect(screen.getByTestId('taxonomy-tag-name')).toBeTruthy();
    expect(screen.getByTestId('taxonomy-tag-create')).toBeTruthy();
  });
});
