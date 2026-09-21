import { promptFolderSchema, promptTagSchema } from '@musefold/contracts';
import { type MusefoldGateway, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePromptFolders, usePromptTags } from '../hooks';
import { TaxonomyManager } from '../TaxonomyManager';

vi.mock('@musefold/ui/components/sonner', () => ({ toast: { error: vi.fn() } }));

const folder = promptFolderSchema.parse({
  id: 'folder',
  name: '庭院',
  parentId: null,
  sortOrder: 0,
  version: 1,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
  deletedAt: null,
});
const tag = promptTagSchema.parse({
  id: 'tag',
  name: '水彩',
  group: null,
  color: null,
  version: 1,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
  deletedAt: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function setup(compact: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: compact,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  let folders = [folder];
  let tags = [tag];
  const prompts = {
    listFolders: vi.fn(async () => folders),
    listTags: vi.fn(async () => tags),
    removeFolder: vi.fn(async (_id: string) => {
      folders = [];
      return folder;
    }),
    removeTag: vi.fn(async (_id: string) => {
      tags = [];
      return tag;
    }),
    createFolder: vi.fn(async () => folder),
    createTag: vi.fn(async () => tag),
  };
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Manager() {
    const folders = usePromptFolders();
    const tags = usePromptTags();
    return <TaxonomyManager folders={folders.data ?? []} tags={tags.data ?? []} />;
  }
  render(
    <QueryClientProvider client={client}>
      <PlatformProvider
        runtime={{
          gateway: { prompts } as unknown as MusefoldGateway,
          capabilities: WEB_CAPABILITIES,
        }}
      >
        <Manager />
      </PlatformProvider>
    </QueryClientProvider>,
  );
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(screen.getByTestId('taxonomy-open'));
  await screen.findByRole('button', { name: '删除文件夹 庭院' });
  return { user, prompts, client };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe.each([false, true])('taxonomy confirmation compact=%s', (compact) => {
  it.each(['folder', 'tag'] as const)(
    '%s cancel and Escape preserve the record and return focus',
    async (kind) => {
      const { user, prompts } = await setup(compact);
      const trigger = screen.getByRole('button', {
        name: kind === 'folder' ? '删除文件夹 庭院' : '删除标签 水彩',
      });
      await user.click(trigger);
      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).getByRole('heading').textContent).toContain(
        kind === 'folder' ? '庭院' : '水彩',
      );
      expect(prompts.removeFolder).not.toHaveBeenCalled();
      expect(prompts.removeTag).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: '取消' }));
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      await user.click(trigger);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(document.activeElement).toBe(trigger);
      expect(prompts.removeFolder).not.toHaveBeenCalled();
      expect(prompts.removeTag).not.toHaveBeenCalled();
    },
  );

  it.each(['folder', 'tag'] as const)(
    '%s waits for one request, retains failure and retries explicitly',
    async (kind) => {
      const { user, prompts } = await setup(compact);
      const mutation = kind === 'folder' ? prompts.removeFolder : prompts.removeTag;
      const pending = deferred<never>();
      mutation.mockImplementationOnce(() => pending.promise);
      await user.type(screen.getByTestId('taxonomy-folder-name'), '未提交的名称');
      await user.click(
        screen.getByRole('button', {
          name: kind === 'folder' ? '删除文件夹 庭院' : '删除标签 水彩',
        }),
      );
      const dialog = screen.getByRole('alertdialog');
      const confirm = within(dialog).getByRole('button', { name: '确认删除' });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
      expect(
        (within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await user.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog')).toBe(dialog);
      await act(async () => pending.reject(new Error('删除失败，请重试')));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('删除失败，请重试'));
      expect(screen.getByRole('alertdialog')).toBe(dialog);
      expect((screen.getByTestId('taxonomy-folder-name') as HTMLInputElement).value).toBe(
        '未提交的名称',
      );
      await user.click(within(dialog).getByRole('button', { name: '确认删除' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(mutation).toHaveBeenCalledTimes(2);
      expect(mutation).toHaveBeenNthCalledWith(2, kind);
      await waitFor(() =>
        expect(
          screen.queryByRole('button', {
            name: kind === 'folder' ? '删除文件夹 庭院' : '删除标签 水彩',
          }),
        ).toBeNull(),
      );
      expect(screen.getByTestId('taxonomy-panel')).toBeTruthy();
    },
  );

  it.each(['folder', 'tag'] as const)(
    '%s committed deletion closes even if list refresh hangs',
    async (kind) => {
      const { user, prompts, client } = await setup(compact);
      const refresh = deferred<never>();
      (kind === 'folder' ? prompts.listFolders : prompts.listTags).mockImplementationOnce(
        () => refresh.promise,
      );
      await user.click(
        screen.getByRole('button', {
          name: kind === 'folder' ? '删除文件夹 庭院' : '删除标签 水彩',
        }),
      );
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }),
      );
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(kind === 'folder' ? prompts.removeFolder : prompts.removeTag).toHaveBeenCalledTimes(1);
      await client.cancelQueries();
    },
  );

  it.each(['folder', 'tag'] as const)(
    '%s failed creation preserves input; Enter cannot duplicate pending creation',
    async (kind) => {
      const { user, prompts } = await setup(compact);
      const pending = deferred<never>();
      const create = kind === 'folder' ? prompts.createFolder : prompts.createTag;
      create.mockImplementationOnce(() => pending.promise);
      const input = screen.getByTestId(`taxonomy-${kind}-name`);
      await user.type(input, '保留此名称{Enter}{Enter}');
      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      await act(async () => pending.reject(new Error('同名分类已经存在')));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('同名分类已经存在'));
      expect((input as HTMLInputElement).value).toBe('保留此名称');
    },
  );
});
