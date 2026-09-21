'use client';

import {
  accountNoticesSchema,
  type AccountNotices,
  type AccountSummary,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePreferences } from '../settings/hooks';
import {
  accountEpoch,
  accountIdentityKey,
  assertAccountEpoch,
  isAccountSessionCurrent,
  subscribeAccountEpoch,
} from './account-session';
import {
  markNoticeIdsRead,
  noticeReadKey,
  readLegacyNoticeIds,
  readNoticeIds,
} from './notice-read-state';

export function AccountNoticesPanel({ account }: { account: AccountSummary }) {
  const gateway = useGateway();
  return gateway.account.getNotices ? <NoticeQuery account={account} /> : null;
}

function NoticeQuery({ account }: { account: AccountSummary }) {
  const gateway = useGateway();
  const client = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => subscribeAccountEpoch(client, listener),
    [client],
  );
  const epoch = useSyncExternalStore(
    subscribe,
    () => accountEpoch(client),
    () => 0,
  );
  const current = isAccountSessionCurrent(client);
  const query = useQuery({
    queryKey: queryKeys.account.notices(accountIdentityKey(account), epoch),
    enabled: current,
    queryFn: async () => {
      const captured = accountEpoch(client);
      const data = accountNoticesSchema.parse(await gateway.account.getNotices?.());
      assertAccountEpoch(client, captured);
      if (account.identity && data.apiIssuer !== account.identity.apiIssuer)
        throw new Error('公告服务来源已变化');
      return data;
    },
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (!current) return null;
  if (query.isSuccess && query.data.items.length === 0) return null;
  if (query.isSuccess)
    return (
      <NoticeItems
        key={noticeReadKey(account, query.data)}
        account={account}
        feed={query.data}
        refreshing={query.isFetching}
        refresh={() => void query.refetch()}
        isCurrent={() => accountEpoch(client) === epoch && isAccountSessionCurrent(client)}
      />
    );
  return (
    <Card data-testid="account-notices">
      <CardHeader>
        <CardTitle>服务公告</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Skeleton className="h-10 w-full" aria-label="正在读取服务公告" />
        ) : (
          <div className="flex flex-col gap-3">
            <p role="alert" className="text-sm text-muted-foreground">
              公告暂时无法读取，不影响其他账号功能。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 w-fit md:min-h-0"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching && <Spinner />}重新读取公告
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NoticeItems({
  account,
  feed,
  refresh,
  refreshing,
  isCurrent,
}: {
  account: AccountSummary;
  feed: AccountNotices;
  refresh(): void;
  refreshing: boolean;
  isCurrent(): boolean;
}) {
  const key = noticeReadKey(account, feed);
  const preferences = usePreferences();
  const [readIds, setReadIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  const reload = useCallback(() => {
    try {
      setReadIds(readNoticeIds(key));
      setError(null);
    } catch {
      setError('无法读取此设备的公告已读记录，请检查存储权限后重试。');
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    reload();
    const listener = (event: StorageEvent) => {
      if (event.key === key || event.key === null) reload();
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [key, reload]);
  const read = new Set([
    ...readIds,
    ...readLegacyNoticeIds(),
    ...(preferences.data?.legacyAccountNoticeReadIds ?? []),
  ]);
  const unread = feed.items.filter(
    (item) => !read.has(item.id) && !item.legacyReadIds?.some((id) => read.has(id)),
  );
  if (loaded && preferences.isSuccess && !unread.length && !marked && !error) return null;
  const ready = loaded && preferences.isSuccess;
  function markRead() {
    if (!ready || !isCurrent() || refreshing || !unread.length) return;
    try {
      setReadIds(
        markNoticeIdsRead(
          key,
          unread.map((item) => item.id),
        ),
      );
      setError(null);
      setMarked(true);
      heading.current?.focus();
    } catch {
      setError('无法保存公告已读状态，请检查此设备的存储权限后重试。');
    }
  }
  return (
    <Card data-testid="account-notices">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle ref={heading} tabIndex={-1}>
            服务公告
          </CardTitle>
          {ready && unread.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 md:min-h-0"
              disabled={refreshing}
              onClick={markRead}
              data-testid="account-notices-mark-read"
            >
              全部已读
            </Button>
          )}
        </div>
        <CardDescription>已读状态仅保存在此设备。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!loaded || preferences.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : preferences.isError ? (
          <>
            <p role="alert" className="text-sm text-muted-foreground">
              旧版公告已读记录暂时无法读取。
            </p>
            <Button
              variant="outline"
              className="min-h-11 w-fit md:min-h-0"
              onClick={() => void preferences.refetch()}
            >
              重新读取已读记录
            </Button>
          </>
        ) : unread.length ? (
          <ul className="divide-y divide-border">
            {unread.map((item) => (
              <li key={`${item.id}:${item.content}`} className="py-3 first:pt-0 last:pb-0">
                <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                  {item.content}
                </p>
                {item.publishedAt !== null && (
                  <time
                    dateTime={new Date(item.publishedAt).toISOString()}
                    className="mt-1 block text-xs text-muted-foreground"
                  >
                    {new Date(item.publishedAt).toLocaleDateString()}
                  </time>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            公告已全部标为已读。
          </p>
        )}
        {error && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            <Button variant="outline" className="min-h-11 w-fit md:min-h-0" onClick={reload}>
              重新读取已读记录
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 w-fit md:min-h-0"
          disabled={refreshing}
          onClick={refresh}
        >
          {refreshing && <Spinner />}刷新公告
        </Button>
      </CardContent>
    </Card>
  );
}
