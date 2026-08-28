'use client';

import { Skeleton } from '@musefold/ui/components/skeleton';
import { LogIn } from '@musefold/ui/icons';
import { formatPoints, useAccountStatus } from './hooks';

/**
 * 壳侧栏底部账号区(V25-UI-SPEC §2.2-5):
 * 未登录整行是登录入口;已登录展示头像/名称/积分。点击都进设置(账号分区)。
 */
export function AccountFooter({ onOpenAccount }: { onOpenAccount: () => void }) {
  const account = useAccountStatus();

  if (account.isPending) {
    return <Skeleton className="h-9 w-full" data-testid="account-footer-loading" />;
  }

  if (account.isError) {
    return (
      <button
        type="button"
        onClick={onOpenAccount}
        data-testid="account-footer-signed-out"
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-muted-foreground text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        <LogIn className="size-4" aria-hidden />
        登录账号
      </button>
    );
  }

  const name = account.data.displayName ?? account.data.username;
  return (
    <button
      type="button"
      onClick={onOpenAccount}
      data-testid="account-footer"
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-xs"
        aria-hidden
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sidebar-foreground text-xs">{name}</span>
        <span className="block text-[11px] text-muted-foreground">
          {formatPoints(account.data.quota)} 积分
        </span>
      </span>
    </button>
  );
}
