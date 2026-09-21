'use client';

import { cloudMcpOAuthRequestSchema, type CloudMcpOAuthReview } from '@musefold/contracts';
import { useGateway } from '@musefold/platform';
import { Button } from '@musefold/ui/components/button';
import { Spinner } from '@musefold/ui/components/spinner';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AuthForm } from './AccountPanel';
import { useAccountStatus } from './hooks';

const scopeLabels: Record<CloudMcpOAuthReview['scopes'][number], string> = {
  'account:read': '读取账号基本信息与额度',
  'prompts:read': '读取提示词库',
  'skills:read': '读取可用 Skill 信息',
  offline_access: '离开此页面后保持连接，直到授权过期或被撤销',
};

/** Both hosts reuse product UI; only the Web host mounts the provider's browser routes. */
export function OAuthAuthorizationScreen({
  query,
  screen,
  onNavigate,
}: {
  query: string;
  screen: 'login' | 'consent';
  onNavigate: (url: string) => void;
}) {
  const gateway = useGateway().cloudMcp?.authorization;
  // Login (including capacity cleanup) updates the existing account query. Never
  // append oauth_query to credential requests: BA would replace their response.
  const account = useAccountStatus();
  const valid = cloudMcpOAuthRequestSchema.safeParse({ oauth_query: query }).success;
  const review = useQuery({
    queryKey: ['cloud-mcp-oauth-review', query, account.dataUpdatedAt],
    queryFn: () => {
      if (!gateway) throw new Error('授权服务不可用');
      return gateway.review({ oauth_query: query });
    },
    // Keep an unsubmitted login form mounted while rechecking the same request.
    // Never reuse prior consent authority or carry credentials to another request.
    placeholderData: (previous, previousQuery) =>
      previous?.loginRequired && previousQuery?.queryKey[1] === query ? previous : undefined,
    enabled: !!gateway && valid,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const decision = useMutation({
    mutationFn: async (accept: boolean) => {
      if (!gateway || !review.data?.reviewRef) throw new Error('请先核对授权请求');
      return gateway.decide({ oauth_query: query, reviewRef: review.data.reviewRef, accept });
    },
    retry: false,
    gcTime: 0,
    onSuccess: (value) => onNavigate(value.url),
  });
  const value = review.data;
  const busy = review.isFetching || decision.isPending || decision.isSuccess;
  const failed = !valid || !gateway || review.isError;
  const retryReview = () => {
    decision.reset();
    void review.refetch();
  };
  return (
    <main
      className="flex min-h-dvh items-start justify-center overflow-auto bg-background px-4 py-10 sm:items-center"
      data-testid="oauth-screen"
      aria-busy={busy}
    >
      <section
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
        aria-labelledby="oauth-title"
      >
        <p className="mb-2 text-xs text-muted-foreground">未像 Musefold · Cloud MCP</p>
        <h1 id="oauth-title" className="text-xl font-semibold">
          {screen === 'login' ? '登录以继续授权' : '允许应用访问？'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          只读连接，不允许生图、扣费或修改你的数据。
        </p>
        {failed ? (
          <div className="mt-6 space-y-4">
            <p role="alert" className="text-sm text-destructive">
              无法核对授权请求，链接可能已失效或被修改。请返回申请应用重新连接。
            </p>
            {valid && gateway && (
              <Button variant="outline" onClick={retryReview} disabled={busy}>
                重新核对授权请求
              </Button>
            )}
          </div>
        ) : !value ? (
          <p role="status" className="mt-6 flex items-center gap-2 text-sm">
            <Spinner className="size-4" />
            正在核对授权请求…
          </p>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="space-y-1 break-words">
              <h2 className="font-medium" data-testid="oauth-client-name">
                {value.client.name}
              </h2>
              <p className="text-xs text-muted-foreground">应用标识：{value.client.id}</p>
              {value.client.origin && (
                <p className="text-xs text-muted-foreground">网站：{value.client.origin}</p>
              )}
              <p className="text-xs text-muted-foreground">
                应用名称由申请方提供，请确认是你正在连接的应用。
              </p>
            </div>
            <ul className="list-disc space-y-2 pl-5 text-sm" aria-label="申请的权限">
              {value.scopes.map((scope) => (
                <li key={scope}>{scopeLabels[scope]}</li>
              ))}
            </ul>
            {value.loginRequired ? (
              <AuthForm />
            ) : (
              <>
                <p className="text-sm">
                  当前账号：<span className="font-medium">{value.account?.name}</span>
                </p>
                {screen === 'login' ? (
                  <Button
                    className="min-h-11 w-full"
                    disabled={busy || !value.continueUrl}
                    onClick={() => value.continueUrl && onNavigate(value.continueUrl)}
                  >
                    继续核对授权
                  </Button>
                ) : (
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="min-h-11 flex-1"
                      disabled={busy || decision.isError || !value.reviewRef}
                      onClick={() => decision.mutate(false)}
                    >
                      拒绝
                    </Button>
                    <Button
                      className="min-h-11 flex-1"
                      disabled={busy || decision.isError || !value.reviewRef}
                      onClick={() => decision.mutate(true)}
                    >
                      允许只读访问
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  稍后可在「设置 → 开放能力 → 已连接应用」撤销授权。
                </p>
              </>
            )}
            {busy && (
              <p role="status" className="flex items-center gap-2 text-sm">
                <Spinner className="size-4" />
                {decision.isPending || decision.isSuccess
                  ? '正在返回申请应用…'
                  : '正在重新核对请求…'}
              </p>
            )}
            {decision.isError && (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-destructive">
                  未能确认授权结果。请返回申请应用检查，或重新核对此请求。
                </p>
                <Button variant="outline" onClick={retryReview}>
                  重新核对授权请求
                </Button>
              </div>
            )}
          </div>
        )}
        <a
          href="/workbench"
          className="mt-6 inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4"
        >
          取消并返回未像
        </a>
      </section>
    </main>
  );
}
