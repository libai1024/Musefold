'use client';

import {
  marketSearchQuerySchema,
  marketSearchResultSchema,
  type MarketSearchQuery,
  type MarketSearchResult,
  type ParsedMarketSearchQuery,
} from '@musefold/contracts';
import { useCapabilities, usePlatform } from '@musefold/platform';
import { useEffect, useRef, useState } from 'react';

interface SearchState {
  pages: MarketSearchResult[];
  pending: boolean;
  error: Error | null;
  loadingMore: boolean;
  pageError: Error | null;
}
const emptyState = (): SearchState => ({
  pages: [],
  pending: false,
  error: null,
  loadingMore: false,
  pageError: null,
});
const asError = (error: unknown) =>
  error instanceof Error ? error : new Error('搜索失败，请重试');

function readPage(value: unknown): MarketSearchResult {
  const parsed = marketSearchResultSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(new Date(parsed.data.fetchedAt).getTime())) {
    throw new Error('搜索结果格式异常，请重新搜索');
  }
  return parsed.data;
}

/** 显式搜索；下一页保留已有候选，响应只归属发起时的搜索轮次。 */
export function useMarketSearch() {
  const { gateway } = usePlatform();
  const { hasDesignSchemes } = useCapabilities();
  const schemes = hasDesignSchemes ? gateway.designSchemes : undefined;
  const [state, setState] = useState<SearchState>(emptyState);
  const epoch = useRef(0);
  const activeGateway = useRef(schemes);
  const current = useRef<{
    query: ParsedMarketSearchQuery;
    pages: MarketSearchResult[];
    cursors: Set<string>;
  } | null>(null);
  const firstRequest = useRef<{ key: string; promise: Promise<MarketSearchResult> } | null>(null);
  const nextRequest = useRef<Promise<MarketSearchResult | null> | null>(null);

  useEffect(() => {
    activeGateway.current = schemes;
    epoch.current += 1;
    current.current = null;
    firstRequest.current = null;
    nextRequest.current = null;
    setState(emptyState());
    return () => {
      epoch.current += 1;
    };
  }, [schemes]);

  function mutateAsync(raw: MarketSearchQuery): Promise<MarketSearchResult> {
    if (!schemes) return Promise.reject(new Error('当前宿主不提供设计方案能力'));
    const parsed = marketSearchQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const error = new Error('搜索内容无效，请输入 1–200 个字符的关键词');
      epoch.current += 1;
      current.current = null;
      firstRequest.current = null;
      nextRequest.current = null;
      setState({ ...emptyState(), error });
      return Promise.reject(error);
    }
    const query = parsed.data;
    const key = JSON.stringify(query);
    if (firstRequest.current?.key === key) return firstRequest.current.promise;
    const requestEpoch = ++epoch.current;
    current.current = null;
    nextRequest.current = null;
    setState({ ...emptyState(), pending: true });
    const promise = (async () => {
      try {
        const page = readPage(await Promise.resolve().then(() => schemes.searchMarket(query)));
        if (epoch.current === requestEpoch && activeGateway.current === schemes) {
          current.current = { query, pages: [page], cursors: new Set() };
          setState({ ...emptyState(), pages: [page] });
        }
        return page;
      } catch (error) {
        if (epoch.current === requestEpoch && activeGateway.current === schemes)
          setState({ ...emptyState(), error: asError(error) });
        throw error;
      } finally {
        if (epoch.current === requestEpoch && activeGateway.current === schemes)
          firstRequest.current = null;
      }
    })();
    firstRequest.current = { key, promise };
    return promise;
  }

  function loadMore(): Promise<MarketSearchResult | null> {
    if (nextRequest.current) return nextRequest.current;
    const snapshot = current.current;
    const cursor = snapshot?.pages.at(-1)?.nextCursor;
    if (!schemes || !snapshot || !cursor || firstRequest.current) return Promise.resolve(null);
    const requestEpoch = epoch.current;
    setState((previous) => ({ ...previous, loadingMore: true, pageError: null }));
    const promise = (async () => {
      try {
        const page = readPage(
          await Promise.resolve().then(() => schemes.searchMarket({ ...snapshot.query, cursor })),
        );
        if (
          page.nextCursor === cursor ||
          (page.nextCursor && snapshot.cursors.has(page.nextCursor))
        ) {
          throw new Error('候选分页已失效，请重新搜索');
        }
        if (epoch.current === requestEpoch && activeGateway.current === schemes) {
          snapshot.cursors.add(cursor);
          snapshot.pages = [...snapshot.pages, page];
          setState((previous) => ({ ...previous, pages: snapshot.pages, loadingMore: false }));
        }
        return page;
      } catch (error) {
        if (epoch.current === requestEpoch && activeGateway.current === schemes) {
          setState((previous) => ({ ...previous, loadingMore: false, pageError: asError(error) }));
        }
        throw error;
      } finally {
        if (epoch.current === requestEpoch && activeGateway.current === schemes)
          nextRequest.current = null;
      }
    })();
    nextRequest.current = promise;
    return promise;
  }

  // 每页仍保留 canonical 结果，不把多页合并成超出契约 max(100) 的假页面。
  const candidates = [
    ...new Map(
      state.pages
        .flatMap((page) => page.candidates)
        .map((candidate) => [candidate.candidateId, candidate]),
    ).values(),
  ];
  const cachedPages = state.pages.filter((page) => page.fromCache);
  return {
    mutateAsync,
    loadMore,
    data: state.pages[0],
    candidates,
    nextCursor: state.pages.at(-1)?.nextCursor ?? null,
    cachedAt: cachedPages.map((page) => new Date(page.fetchedAt).toISOString()).sort()[0] ?? null,
    isPending: state.pending,
    isError: state.error != null,
    error: state.error,
    isLoadingMore: state.loadingMore,
    pageError: state.pageError,
  };
}
