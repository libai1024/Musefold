'use client';

import type { AccountCloudStatus } from '@musefold/contracts';
import { queryKeys, useGateway, type MusefoldGateway } from '@musefold/platform';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Skeleton } from '@musefold/ui/components/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { toast } from '@musefold/ui/components/sonner';
import { accountEpoch, assertAccountEpoch } from './account-session';
import { useAccountStatus, useAiProviders, useSetActiveAiProvider } from './hooks';
import { AccountCloudRecoveryPanel } from './AccountCloudRecoveryPanel';

type CloudGateway = NonNullable<MusefoldGateway['accountCloud']>;
export function AccountCloudConnectionCard() {
  const cloud = useGateway().accountCloud;
  return cloud ? <CloudConnection cloud={cloud} /> : null;
}

function CloudConnection({ cloud }: { cloud: CloudGateway }) {
  const client = useQueryClient();
  const account = useAccountStatus();
  const providers = useAiProviders();
  const setActive = useSetActiveAiProvider();
  const [review, setReview] = useState<{
    snapshot: AccountCloudStatus;
    epoch: number;
    accountName: string;
  } | null>(null);
  const status = useQuery({
    queryKey: queryKeys.accountCloud.status(),
    retry: false,
    queryFn: async () => {
      const epoch = accountEpoch(client);
      const value = await cloud.getStatus();
      assertAccountEpoch(client, epoch);
      return value;
    },
  });
  const invalidate = () => {
    for (const key of [
      queryKeys.accountCloud.status(),
      queryKeys.accountCloud.recovery(),
      queryKeys.accountCloud.legacy(),
      queryKeys.aiProviders.list(),
      queryKeys.generation.all(),
      queryKeys.workbench.all(),
    ])
      void client.invalidateQueries({ queryKey: key });
  };
  const apply = useMutation({
    mutationFn: async (selection: NonNullable<typeof review>) => {
      assertAccountEpoch(client, selection.epoch);
      const { reviewRef, reviewAction } = selection.snapshot;
      if (!reviewRef || !reviewAction) throw new Error('请重新检查账号云连接');
      const result =
        reviewAction === 'resume'
          ? await cloud.resume({ reviewRef })
          : await cloud.connect({ reviewRef });
      assertAccountEpoch(client, selection.epoch);
      return result;
    },
    onSuccess: () => {
      setReview(null);
      invalidate();
      toast.success('账号云连接已更新');
    },
    onError: (error) => {
      setReview(null);
      invalidate();
      toast.error(error.message);
    },
  });
  const connection = providers.data?.find((item) => item.id === status.data?.connectionId);

  return (
    <Card data-testid="account-cloud-card">
      <CardHeader>
        <CardTitle>账号云图像</CardTitle>
        <CardDescription>
          使用 Musefold 账号额度，不需要填写 API Key。连接与云同步分别设置。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <p
              className="text-muted-foreground text-sm"
              role="status"
              data-testid="account-cloud-status"
            >
              {status.data?.message ?? '连接状态读取失败，请重试。'}
            </p>
            {status.data?.apiIssuer ? (
              <p className="break-all text-muted-foreground text-xs">
                {account.data?.displayName ?? account.data?.username ?? '当前账号'} ·{' '}
                {status.data.apiIssuer}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={status.isFetching || apply.isPending}
                onClick={() => {
                  void status.refetch();
                  if (status.data?.principalId)
                    void client.resetQueries({ queryKey: queryKeys.accountCloud.recovery() });
                  void client.resetQueries({ queryKey: queryKeys.accountCloud.legacy() });
                }}
                data-testid="account-cloud-check"
              >
                检查连接
              </Button>
              {status.data?.reviewRef ? (
                <Button
                  size="sm"
                  disabled={apply.isPending}
                  data-testid="account-cloud-review"
                  onClick={() => {
                    if (status.data)
                      setReview({
                        snapshot: status.data,
                        epoch: accountEpoch(client),
                        accountName:
                          account.data?.displayName ?? account.data?.username ?? '当前账号',
                      });
                  }}
                >
                  {status.data.reviewAction === 'resume' ? '核对恢复记录' : '连接账号云图像'}
                </Button>
              ) : null}
              {connection && status.data?.mode === 'active' ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={connection.isActive || setActive.isPending}
                  data-testid="account-cloud-default"
                  onClick={() =>
                    setActive.mutate(connection.id, {
                      onSuccess: invalidate,
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  {connection.isActive ? '当前默认连接' : '设为默认'}
                </Button>
              ) : null}
            </div>
          </>
        )}
        <AccountCloudRecoveryPanel cloud={cloud} enabled={status.data?.principalId != null} />
      </CardContent>
      <AlertDialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !apply.isPending) setReview(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {review?.snapshot.reviewAction === 'resume'
                ? '继续使用匹配的执行记录？'
                : '连接当前账号的云图像服务？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              账号：{review?.accountName}。服务：{review?.snapshot.apiIssuer}
              。连接不会自动生成图片或开启同步；点击工作台发送后才会提交请求。旧任务按原记录核对，不会因恢复重新生成。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apply.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={apply.isPending}
              data-testid="account-cloud-confirm"
              onClick={(event) => {
                event.preventDefault();
                if (review) apply.mutate(review);
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
