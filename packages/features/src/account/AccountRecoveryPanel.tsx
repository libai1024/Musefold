'use client';

import type { AccountRecoveryReason, AccountSummary } from '@musefold/contracts';
import { useGateway } from '@musefold/platform';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@musefold/ui/components/alert-dialog';
import { Button } from '@musefold/ui/components/button';
import { Input } from '@musefold/ui/components/input';
import { Label } from '@musefold/ui/components/label';
import { Spinner } from '@musefold/ui/components/spinner';
import { useEffect, useState } from 'react';
import { accountErrorMessage } from './error-messages';
import { useAccountRecoveryMutation, useInspectAccountRecovery } from './recovery-hooks';

const REASONS: Record<AccountRecoveryReason, string> = {
  legacy_issuer_unknown: '旧账号的服务来源暂时无法核实。为保护旧数据，需要先验证账号归属。',
  legacy_evidence_missing:
    '当前登录已成功，但缺少领取旧工作区所需的记录。请使用仍登录旧账号的设备验证。',
  legacy_identity_conflict: '旧工作区出现不同账号的归属记录。确认归属前，旧数据保持保留。',
  verification_pending: '账号服务暂时未完成验证。你可以安全重试，旧数据不会被覆盖。',
};

function useExpired(expiresAt: string | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expiresAt || Date.parse(expiresAt) <= now) return;
    const delay = Math.min(Math.max(0, Date.parse(expiresAt) - Date.now()), 2_147_483_647);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  return expiresAt !== undefined && Date.parse(expiresAt) <= now;
}

export function AccountRecoveryPanel({
  account,
  refresh,
  refreshing,
}: {
  account: AccountSummary;
  refresh(): void;
  refreshing: boolean;
}) {
  const gateway = useGateway();
  const retry = useAccountRecoveryMutation('retryRecovery');
  const independent = useAccountRecoveryMutation('createIndependentWorkspace');
  const recovery = account.recovery;
  const expired = useExpired(recovery?.expiresAt);
  const busy = retry.isPending || independent.isPending || refreshing;
  const error = retry.error ?? independent.error;
  return (
    <section className="flex min-w-0 flex-col gap-4" data-testid="account-recovery">
      <div className="space-y-2">
        <h3 className="font-medium text-sm">需要恢复账号</h3>
        <p className="break-words text-muted-foreground text-sm">
          {recovery ? REASONS[recovery.reason] : '账号归属尚未核实，请刷新状态或使用原设备验证。'}
        </p>
        <p className="text-muted-foreground text-sm">
          恢复期间暂停云数据访问、兑换和生图。旧历史不会被删除。
        </p>
      </div>
      {recovery && (
        <div className="space-y-2 text-sm">
          <p>当前登录：{account.displayName ?? account.username}</p>
          <p className="break-all text-muted-foreground">
            用户名：{account.username} · 账号编号：{account.id}
          </p>
          <Label htmlFor="account-recovery-request">恢复申请编号</Label>
          <Input id="account-recovery-request" readOnly value={recovery.requestId} />
          <p className="text-muted-foreground text-xs">
            {expired
              ? '申请已过期，请退出后重新登录。'
              : `有效至 ${new Date(recovery.expiresAt).toLocaleString('zh-CN')}`}
          </p>
          {recovery.actions.includes('verify_original_session') && (
            <p className="text-muted-foreground text-sm">
              在仍登录旧账号的原设备打开「账号 →
              验证另一台设备」，输入此编号并核对账号。完成后在这里刷新状态。编号只用于定位申请，不能代替原设备验证。
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {recovery?.actions.includes('retry') && gateway.account.retryRecovery && (
          <Button
            size="sm"
            disabled={busy || expired}
            onClick={() => retry.mutate({ requestId: recovery.requestId })}
            data-testid="account-recovery-retry"
          >
            {retry.isPending && <Spinner className="size-3.5" />}重新验证
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={refresh}
          data-testid="account-recovery-refresh"
        >
          {refreshing && <Spinner className="size-3.5" />}刷新恢复状态
        </Button>
        {recovery?.actions.includes('create_independent_workspace') &&
          gateway.account.createIndependentWorkspace && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || expired}
                  data-testid="account-recovery-independent"
                >
                  {independent.isPending && <Spinner className="size-3.5" />}
                  创建独立工作区
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>为当前账号创建独立工作区？</AlertDialogTitle>
                  <AlertDialogDescription>
                    新工作区从空白开始，旧工作区及其历史保持保留，不会合并或归入当前账号。此操作不代表旧账号已恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy || expired}
                    onClick={() => independent.mutate({ requestId: recovery.requestId })}
                    data-testid="account-recovery-independent-confirm"
                  >
                    创建独立工作区
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {accountErrorMessage(error)}
        </p>
      )}
    </section>
  );
}

/** 原设备仍使用自身会话；编号只能发给服务端核验，不能自行激活恢复端。 */
export function OriginalSessionRecovery() {
  const gateway = useGateway();
  const [requestId, setRequestId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const inspect = useInspectAccountRecovery();
  const verify = useAccountRecoveryMutation('verifyOriginalSession');
  const review = inspect.isSuccess ? inspect.data : undefined;
  const expired = useExpired(review?.expiresAt);
  if (!gateway.account.inspectRecovery || !gateway.account.verifyOriginalSession) return null;
  const busy = inspect.isPending || verify.isPending;
  const error = inspect.error ?? verify.error;
  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="account-original-session">
      <h3 className="font-medium text-sm">验证另一台设备</h3>
      <p className="text-muted-foreground text-sm">
        仅在这台设备仍登录原账号时使用。先检查恢复申请，再确认要恢复的账号。
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && requestId.trim()) {
            setConfirmed(false);
            inspect.mutate({ requestId: requestId.trim() });
          }
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="account-original-request">另一台设备的恢复申请编号</Label>
          <Input
            id="account-original-request"
            value={requestId}
            maxLength={160}
            disabled={busy}
            onChange={(event) => {
              setRequestId(event.target.value);
              inspect.reset();
              verify.reset();
              setConfirmed(false);
            }}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !requestId.trim()}
          type="submit"
          data-testid="account-original-inspect"
        >
          {inspect.isPending && <Spinner className="size-3.5" />}检查申请
        </Button>
      </form>
      {review && !confirmed && (
        <div className="space-y-2 text-sm">
          <p>
            待恢复账号：{review.candidate.displayName ?? review.candidate.username}（
            {review.candidate.username}）
          </p>
          <p className="break-all text-muted-foreground">账号服务：{review.candidate.issuer}</p>
          <p className="break-all text-muted-foreground">账号编号：{review.candidate.ownerId}</p>
          <p className="text-muted-foreground">
            {expired
              ? '申请已过期，请在另一台设备重新登录。'
              : `有效至 ${new Date(review.expiresAt).toLocaleString('zh-CN')}`}
          </p>
          <Button
            size="sm"
            disabled={busy || expired}
            data-testid="account-original-confirm"
            onClick={() =>
              verify.mutate(
                { requestId: review.requestId },
                {
                  onSuccess: () => {
                    setConfirmed(true);
                    setRequestId('');
                  },
                },
              )
            }
          >
            {verify.isPending && <Spinner className="size-3.5" />}确认验证此账号
          </Button>
        </div>
      )}
      {confirmed && (
        <p role="status" className="text-sm">
          验证已完成，请在另一台设备刷新恢复状态。这台设备仍使用原账号。
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {accountErrorMessage(error)}
        </p>
      )}
    </section>
  );
}
