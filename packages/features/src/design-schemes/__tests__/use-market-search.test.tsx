import {
  marketSearchResultSchema,
  type MarketSearchQuery,
  type MarketSearchResult,
} from '@musefold/contracts';
import { PlatformProvider, WEB_CAPABILITIES, type MusefoldGateway } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SchemesScreen } from '../SchemesScreen';
import { useMarketSearch } from '../use-market-search';

const NOW = '2026-09-07T12:00:00.000Z';
function page(ids = ['one'], overrides: Partial<MarketSearchResult> = {}): MarketSearchResult {
  return marketSearchResultSchema.parse({
    query: 'poster',
    fromCache: false,
    fetchedAt: NOW,
    nextCursor: null,
    candidates: ids.map((id) => ({
      candidateId: id,
      repositoryUrl: `https://github.com/example/${id}`,
      fullName: `example/${id}`,
      description: 'Poster design rules',
      license: 'MIT',
      ref: 'main',
      commit: null,
      updatedAt: NOW,
      stars: 20,
      topics: ['poster'],
      matchReason: '匹配搜索词',
      riskSummary: null,
    })),
    ...overrides,
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const searchMarket = vi.fn<(query: MarketSearchQuery) => Promise<MarketSearchResult>>();
  let gateway = {
    designSchemes: {
      searchMarket,
      list: vi.fn(async () => ({ items: [], nextCursor: null })),
    },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return {
    searchMarket,
    Wrapper,
    replaceGateway: () => {
      gateway = { ...gateway, designSchemes: { ...gateway.designSchemes } } as MusefoldGateway;
    },
  };
}

describe('explicit market search and pagination', () => {
  it('does not request until submit; keeps canonical pages and deduplicates candidates', async () => {
    const h = setup();
    h.searchMarket
      .mockResolvedValueOnce(page(['one'], { nextCursor: 'page-2' }))
      .mockResolvedValueOnce(page(['one', 'two'], { fromCache: true }));
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    expect(h.searchMarket).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.mutateAsync({ query: ' poster ', limit: 2 });
    });
    expect(h.searchMarket).toHaveBeenNthCalledWith(1, { query: 'poster', limit: 2 });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(h.searchMarket).toHaveBeenNthCalledWith(2, {
      query: 'poster',
      limit: 2,
      cursor: 'page-2',
    });
    expect(result.current.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'one',
      'two',
    ]);
    expect(result.current.data?.candidates).toHaveLength(1);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.cachedAt).toBe(NOW);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(h.searchMarket).toHaveBeenCalledTimes(2);
  });

  it('deduplicates pending first/page requests and preserves the page on retryable failure', async () => {
    const h = setup();
    const first = deferred<MarketSearchResult>();
    const second = deferred<MarketSearchResult>();
    h.searchMarket
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('请稍后重试'))
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    let started!: Promise<MarketSearchResult>;
    act(() => {
      started = result.current.mutateAsync({ query: 'poster' });
      expect(result.current.mutateAsync({ query: 'poster' })).toBe(started);
    });
    expect(result.current.isPending).toBe(true);
    await act(async () => {
      first.resolve(page(['one'], { nextCursor: 'page-2' }));
      await started;
    });
    await act(async () => {
      await expect(result.current.loadMore()).rejects.toThrow('请稍后重试');
    });
    expect(result.current.candidates).toHaveLength(1);
    expect(result.current.isError).toBe(false);
    expect(result.current.pageError?.message).toBe('请稍后重试');
    let more!: Promise<MarketSearchResult | null>;
    act(() => {
      more = result.current.loadMore();
      expect(result.current.loadMore()).toBe(more);
    });
    expect(result.current.isLoadingMore).toBe(true);
    expect(result.current.candidates).toHaveLength(1);
    await act(async () => {
      second.resolve(page(['two']));
      await more;
    });
    expect(result.current.pageError).toBeNull();
    expect(result.current.candidates).toHaveLength(2);
    expect(h.searchMarket).toHaveBeenCalledTimes(3);
  });

  it('retries the same first-page query after the gateway throws synchronously', async () => {
    const h = setup();
    h.searchMarket
      .mockImplementationOnce(() => {
        throw new Error('同步搜索失败');
      })
      .mockResolvedValueOnce(page(['recovered']));
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ query: 'poster' })).rejects.toThrow('同步搜索失败');
    });
    expect(h.searchMarket).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error?.message).toBe('同步搜索失败');
    await act(async () => {
      await result.current.mutateAsync({ query: 'poster' });
    });
    expect(h.searchMarket).toHaveBeenCalledTimes(2);
    expect(h.searchMarket).toHaveBeenLastCalledWith({ query: 'poster', limit: 20 });
    expect(result.current.error).toBeNull();
    expect(result.current.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'recovered',
    ]);
  });

  it('retries the same next-page cursor after the gateway throws synchronously', async () => {
    const h = setup();
    h.searchMarket
      .mockResolvedValueOnce(page(['one'], { nextCursor: 'page-2' }))
      .mockImplementationOnce(() => {
        throw new Error('同步分页失败');
      })
      .mockResolvedValueOnce(page(['two']));
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ query: 'poster' });
    });
    await act(async () => {
      await expect(result.current.loadMore()).rejects.toThrow('同步分页失败');
    });
    expect(h.searchMarket).toHaveBeenCalledTimes(2);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.pageError?.message).toBe('同步分页失败');
    expect(result.current.candidates.map((candidate) => candidate.candidateId)).toEqual(['one']);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(h.searchMarket).toHaveBeenCalledTimes(3);
    expect(h.searchMarket).toHaveBeenNthCalledWith(2, {
      query: 'poster',
      limit: 20,
      cursor: 'page-2',
    });
    expect(h.searchMarket).toHaveBeenLastCalledWith({
      query: 'poster',
      limit: 20,
      cursor: 'page-2',
    });
    expect(result.current.pageError).toBeNull();
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'one',
      'two',
    ]);
  });

  it('ignores an old first reply and an old next-page reply after a new search', async () => {
    const h = setup();
    const oldFirst = deferred<MarketSearchResult>();
    const oldPage = deferred<MarketSearchResult>();
    h.searchMarket
      .mockReturnValueOnce(oldFirst.promise)
      .mockResolvedValueOnce(page(['new'], { query: 'new', nextCursor: 'new-2' }))
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce(page(['latest'], { query: 'latest' }));
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    let original!: Promise<MarketSearchResult>;
    act(() => {
      original = result.current.mutateAsync({ query: 'old' });
    });
    await act(async () => {
      await result.current.mutateAsync({ query: 'new' });
    });
    await act(async () => {
      oldFirst.resolve(page(['old']));
      await original;
    });
    expect(result.current.candidates[0]?.candidateId).toBe('new');
    let pendingPage!: Promise<MarketSearchResult | null>;
    act(() => {
      pendingPage = result.current.loadMore();
    });
    await act(async () => {
      await result.current.mutateAsync({ query: 'latest' });
    });
    await act(async () => {
      oldPage.resolve(page(['stale']));
      await pendingPage;
    });
    expect(result.current.candidates.map((candidate) => candidate.candidateId)).toEqual(['latest']);
    expect(result.current.nextCursor).toBeNull();
  });

  it('clears results on gateway replacement and rejects stale or malformed pages', async () => {
    const h = setup();
    const pending = deferred<MarketSearchResult>();
    h.searchMarket
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page(['one'], { nextCursor: 'same' }))
      .mockResolvedValueOnce(page(['two'], { nextCursor: 'same' }));
    const { result, rerender } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    let first!: Promise<MarketSearchResult>;
    act(() => {
      first = result.current.mutateAsync({ query: 'poster' });
    });
    h.replaceGateway();
    rerender();
    await act(async () => {
      pending.resolve(page(['old']));
      await first;
    });
    expect(result.current.data).toBeUndefined();
    await act(async () => {
      await result.current.mutateAsync({ query: 'poster' });
    });
    await act(async () => {
      await expect(result.current.loadMore()).rejects.toThrow('分页已失效');
    });
    expect(result.current.candidates.map((candidate) => candidate.candidateId)).toEqual(['one']);
    h.searchMarket.mockResolvedValueOnce({ candidates: [] } as unknown as MarketSearchResult);
    await act(async () => {
      await expect(result.current.mutateAsync({ query: 'invalid' })).rejects.toThrow('格式异常');
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.candidates).toEqual([]);
  });

  it('normalizes legacy epoch cache timestamps and refuses an unrenderable date', async () => {
    const h = setup();
    h.searchMarket
      .mockResolvedValueOnce(page(['one'], { fromCache: true, fetchedAt: 0 }))
      .mockResolvedValueOnce(page(['two'], { fetchedAt: Number.MAX_SAFE_INTEGER }));
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ query: 'poster' });
    });
    expect(result.current.cachedAt).toBe('1970-01-01T00:00:00.000Z');
    await act(async () => {
      await expect(result.current.mutateAsync({ query: 'next' })).rejects.toThrow('格式异常');
    });
    expect(result.current.isError).toBe(true);
  });

  it('rejects a multi-hop cursor cycle without appending its candidates', async () => {
    const h = setup();
    h.searchMarket
      .mockResolvedValueOnce(page(['one'], { nextCursor: 'cursor-a' }))
      .mockResolvedValueOnce(page(['two'], { nextCursor: 'cursor-b' }))
      .mockResolvedValueOnce(page(['looped'], { nextCursor: 'cursor-a' }));
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ query: 'poster' });
    });
    await act(async () => {
      await result.current.loadMore();
    });
    await act(async () => {
      await expect(result.current.loadMore()).rejects.toThrow('分页已失效');
    });
    expect(h.searchMarket).toHaveBeenCalledTimes(3);
    expect(h.searchMarket).toHaveBeenLastCalledWith({
      query: 'poster',
      limit: 20,
      cursor: 'cursor-b',
    });
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.pageError?.message).toContain('分页已失效');
    expect(result.current.nextCursor).toBe('cursor-b');
    expect(result.current.candidates.map((candidate) => candidate.candidateId)).toEqual([
      'one',
      'two',
    ]);
  });

  it('reports the oldest cached page date across mixed fresh and cached pages', async () => {
    const h = setup();
    const oldestCache = '2026-09-06T12:00:00.000Z';
    h.searchMarket
      .mockResolvedValueOnce(page(['one'], { fromCache: true, nextCursor: 'page-2' }))
      .mockResolvedValueOnce(
        page(['two'], { fetchedAt: '2026-09-01T12:00:00.000Z', nextCursor: 'page-3' }),
      )
      .mockResolvedValueOnce(
        page(['three'], { fromCache: true, fetchedAt: oldestCache, nextCursor: 'page-4' }),
      )
      .mockResolvedValueOnce(
        page(['four'], { fromCache: true, fetchedAt: '2026-09-08T12:00:00.000Z' }),
      );
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ query: 'poster' });
    });
    expect(result.current.cachedAt).toBe(NOW);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.cachedAt).toBe(NOW);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.cachedAt).toBe(oldestCache);
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.cachedAt).toBe(oldestCache);
    expect(result.current.candidates).toHaveLength(4);
    expect(h.searchMarket).toHaveBeenCalledTimes(4);
  });

  it('invalid input is an inline error and never reaches the gateway', async () => {
    const h = setup();
    const { result } = renderHook(useMarketSearch, { wrapper: h.Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ query: 'x'.repeat(201) })).rejects.toThrow('1–200');
    });
    expect(result.current.isError).toBe(true);
    expect(h.searchMarket).not.toHaveBeenCalled();
  });

  it('shows cache age and unavailable installation; pagination errors leave earlier rows usable', async () => {
    const h = setup();
    h.searchMarket
      .mockResolvedValueOnce(page(['one'], { fromCache: true, nextCursor: 'page-2' }))
      .mockRejectedValueOnce(new Error('GitHub 暂不可用'))
      .mockResolvedValueOnce(page(['two']));
    render(<SchemesScreen initialSurface="discover" />, { wrapper: h.Wrapper });
    fireEvent.change(screen.getByTestId('scheme-search'), { target: { value: 'poster' } });
    fireEvent.click(screen.getByTestId('market-search-run'));
    await waitFor(() => expect(screen.getByTestId('market-candidate-one')).toBeTruthy());
    expect(screen.getByTestId('market-cache-notice').textContent).not.toContain('网络暂不可用');
    expect(screen.getByTestId('market-cache-notice').querySelector('time')?.dateTime).toBe(NOW);
    expect(screen.getByTestId('market-install-unavailable').textContent).toContain(
      '暂未接入市场安装',
    );
    expect((screen.getByTestId('market-add-one') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('scheme-search'), { target: { value: 'changed draft' } });
    fireEvent.click(screen.getByTestId('market-load-more'));
    await waitFor(() => expect(screen.getByTestId('market-page-error')).toBeTruthy());
    expect(screen.getByTestId('market-candidate-one')).toBeTruthy();
    fireEvent.click(
      within(screen.getByTestId('market-page-error')).getByRole('button', { name: '重试' }),
    );
    await waitFor(() => expect(screen.getByTestId('market-candidate-two')).toBeTruthy());
    expect(h.searchMarket).toHaveBeenLastCalledWith({
      query: 'poster',
      limit: 20,
      cursor: 'page-2',
    });
    expect(screen.queryByTestId('market-load-more')).toBeNull();
  });
});
