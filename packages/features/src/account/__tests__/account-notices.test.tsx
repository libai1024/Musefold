import {
  defaultAppPreferences,
  type AccountNotices,
  type AccountSummary,
} from '@musefold/contracts';
import { type MusefoldGateway, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountNoticesPanel } from '../AccountNoticesPanel';
import { beginAccountTransition } from '../account-session';
import { markNoticeIdsRead, noticeReadKey, readNoticeIds } from '../notice-read-state';

const account: AccountSummary = {
  id: 'alice',
  username: 'alice',
  displayName: null,
  quota: 0,
  quotaUnit: '点',
  canGenerate: false,
};
const feed: AccountNotices = {
  apiIssuer: 'https://api.example',
  issuer: 'https://relay.example',
  items: [
    { id: 'n-a', content: '<script>not executable</script>\n维护公告', publishedAt: null },
    { id: 'n-b', content: '第二条公告', publishedAt: 0 },
  ],
};
function setup(getNotices = vi.fn(async () => structuredClone(feed)), legacy: string[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const gateway = {
    account: { getNotices },
    settings: {
      getPreferences: async () => ({
        ...defaultAppPreferences,
        legacyAccountNoticeReadIds: legacy,
      }),
    },
  } as unknown as MusefoldGateway;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return { client, gateway, getNotices, Wrapper };
}
beforeEach(() => {
  vi.restoreAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    get length() {
      return values.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('independent account notice card', () => {
  it('renders literal text, explicitly marks visible notices and restores heading focus', async () => {
    const { Wrapper, getNotices } = setup();
    const result = render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    await screen.findByText(/not executable/);
    expect(result.container.querySelector('script')).toBeNull();
    const button = await screen.findByRole('button', { name: '全部已读' });
    button.focus();
    fireEvent.click(button);
    expect((await screen.findByRole('status')).textContent).toContain('公告已全部标为已读');
    expect(document.activeElement).toBe(screen.getByText('服务公告'));
    expect(readNoticeIds(noticeReadKey(account, feed))).toEqual(['n-a', 'n-b']);
    expect(getNotices).toHaveBeenCalledTimes(1);
  });
  it('persists across remount and only newly published content reappears', async () => {
    const fixture = setup();
    const first = render(<AccountNoticesPanel account={account} />, { wrapper: fixture.Wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '全部已读' }));
    first.unmount();
    fixture.getNotices.mockResolvedValue({
      ...feed,
      items: [...feed.items, { id: 'n-c', content: '新增公告', publishedAt: null }],
    });
    const reloaded = setup(fixture.getNotices);
    render(<AccountNoticesPanel account={account} />, { wrapper: reloaded.Wrapper });
    expect(await screen.findByText('新增公告')).not.toBeNull();
    expect(screen.queryByText('第二条公告')).toBeNull();
  });
  it('isolates new read markers by principal and both service issuers', () => {
    const key = noticeReadKey(account, feed);
    markNoticeIdsRead(key, ['n-a']);
    for (const candidate of [
      noticeReadKey({ ...account, id: 'bob' }, feed),
      noticeReadKey(account, { ...feed, issuer: 'https://other-relay.example' }),
      noticeReadKey(account, { ...feed, apiIssuer: 'https://other-api.example' }),
    ])
      expect(readNoticeIds(candidate)).toEqual([]);
  });
  it('merges a second window and updates the current window on storage events', async () => {
    const { Wrapper } = setup();
    render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    await screen.findByRole('button', { name: '全部已读' });
    const key = noticeReadKey(account, feed);
    markNoticeIdsRead(key, ['n-a']);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
    await waitFor(() => expect(screen.queryByText(/not executable/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '全部已读' }));
    expect(readNoticeIds(key)).toEqual(['n-a', 'n-b']);
  });
  it('keeps notices visible when persistence fails, with an honest retry message', async () => {
    const { Wrapper } = setup();
    render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    await screen.findByRole('button', { name: '全部已读' });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    fireEvent.click(screen.getByRole('button', { name: '全部已读' }));
    expect((await screen.findByRole('alert')).textContent).toContain('无法保存公告已读状态');
    expect(screen.getByText('第二条公告')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('preserves legacy device-wide read IDs from old origin migration and Web storage', async () => {
    localStorage.setItem('musefold:account-notices-read', JSON.stringify(['n-a']));
    const { Wrapper } = setup(undefined, ['n-b']);
    render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.queryByTestId('account-notices')).toBeNull());
  });
  it('shows failed independent reads and retries only on request', async () => {
    const get = vi.fn(async () => structuredClone(feed));
    get.mockRejectedValueOnce(new Error('synthetic network failure'));
    const { Wrapper } = setup(get);
    render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    expect((await screen.findByRole('alert')).textContent).toContain('不影响其他账号功能');
    expect(get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新读取公告' }));
    expect(await screen.findByText('第二条公告')).not.toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('keeps legacy whitespace-sensitive announcement IDs read after normalization', async () => {
    localStorage.setItem('musefold:account-notices-read', JSON.stringify(['n-oldraw']));
    const get = vi.fn(async () => ({
      ...feed,
      items: [{ id: 'n-a', content: '旧公告', publishedAt: null, legacyReadIds: ['n-oldraw'] }],
    }));
    const { Wrapper } = setup(get);
    render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('account-notices')).toBeNull());
  });
  it('does not render an empty feed', async () => {
    const get = vi.fn(async () => ({ ...feed, items: [] }));
    const fixture = setup(get);
    render(<AccountNoticesPanel account={account} />, { wrapper: fixture.Wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('account-notices')).toBeNull());
  });
  it('does not read notices or preferences on a host without the capability', () => {
    const { gateway, Wrapper, getNotices } = setup();
    delete gateway.account.getNotices;
    const preferences = vi.spyOn(gateway.settings, 'getPreferences');
    render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    expect(screen.queryByTestId('account-notices')).toBeNull();
    expect(getNotices).not.toHaveBeenCalled();
    expect(preferences).not.toHaveBeenCalled();
  });
  it('hides old data immediately during logout and rejects a late response', async () => {
    let resolve!: (value: AccountNotices) => void;
    const get = vi.fn(
      () =>
        new Promise<AccountNotices>((done) => {
          resolve = done;
        }),
    );
    const { client, Wrapper } = setup(get);
    render(<AccountNoticesPanel account={account} />, { wrapper: Wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    act(() => beginAccountTransition(client));
    await act(async () => resolve(feed));
    expect(screen.queryByTestId('account-notices')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
