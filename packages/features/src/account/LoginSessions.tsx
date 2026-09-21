'use client';

import type {
  CompleteLoginCapacity,
  LoginCapacityReview,
  LoginSessionSelection,
  LoginSessionView,
} from '@musefold/contracts';
import { useGateway } from '@musefold/platform';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@musefold/ui/components/sheet';
import { Button } from '@musefold/ui/components/button';
import { Badge } from '@musefold/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Checkbox } from '@musefold/ui/components/checkbox';
import { Input } from '@musefold/ui/components/input';
import { Label } from '@musefold/ui/components/label';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { toast } from '@musefold/ui/components/sonner';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useMediaQuery } from '../history/hooks';
import { accountEpoch, applyAccountSession, subscribeAccountEpoch } from './account-session';
import { accountErrorMessage, extractErrorCode } from './error-messages';
import { useLogout } from './hooks';
import { useRememberedUsername } from './remembered-username';

function useLoginViewEpoch() {
  const client = useQueryClient();
  return useSyncExternalStore(
    (listener) => subscribeAccountEpoch(client, listener),
    () => accountEpoch(client),
    () => 0,
  );
}
const formatTime = (value: string | null) => (value ? new Date(value).toLocaleString() : '未知');
const selectionOf = (rows: LoginSessionView[]): LoginSessionSelection[] =>
  rows.map(({ sessionRef, version }) => ({ sessionRef, version }));

function LoginSessionRows({
  items,
  selected,
  onSelect,
  disabled = false,
}: {
  items: LoginSessionView[];
  selected: string[];
  onSelect(value: string[]): void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="divide-y divide-border">
      {items.length === 0 && (
        <p className="py-4 text-muted-foreground text-sm">暂无其他登录设备。</p>
      )}
      {items.map((item) => (
        <div
          className="flex items-start gap-3 py-3"
          key={item.sessionRef}
          data-testid={`account-login-session-row-${item.sessionRef}`}
        >
          <label
            className="flex min-h-11 min-w-11 items-center justify-center"
            htmlFor={`${id}-${item.sessionRef}`}
          >
            <Checkbox
              id={`${id}-${item.sessionRef}`}
              disabled={disabled || item.current}
              checked={selected.includes(item.sessionRef)}
              aria-label={`选择 ${item.client} · ${item.platform}`}
              data-testid={`account-login-session-select-${item.sessionRef}`}
              onCheckedChange={(checked) =>
                onSelect(
                  checked
                    ? [...selected, item.sessionRef]
                    : selected.filter((value) => value !== item.sessionRef),
                )
              }
            />
          </label>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {item.client} · {item.platform}
              </span>
              {item.current && <Badge variant="secondary">当前设备</Badge>}
            </div>
            <p className="text-muted-foreground">登录：{formatTime(item.createdAt)}</p>
            <p className="text-muted-foreground">最近使用：{formatTime(item.lastInteractiveAt)}</p>
            <p className="break-words text-muted-foreground">
              失效：{formatTime(item.expiresAt)} · 接入 IP：{item.maskedIp}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReleaseConfirmation({
  items,
  busy,
  error,
  onCancel,
  onConfirm,
  login = false,
  children,
}: {
  items: LoginSessionView[];
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
  login?: boolean;
  children?: ReactNode;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent
        className="max-h-[90dvh] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>释放所选的 {items.length} 个登录设备？</AlertDialogTitle>
          <AlertDialogDescription>
            这些设备需要重新登录。作品、提示词、图片及费用记录不会删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 overflow-y-auto text-sm">
          {items.map((item) => (
            <li key={item.sessionRef}>
              {item.client} · {item.platform} · {formatTime(item.createdAt)}
            </li>
          ))}
        </ul>
        {children}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11 bg-destructive text-destructive-foreground"
            disabled={busy}
            data-testid="account-login-sessions-confirm"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {busy && <Spinner />} {login ? '确认释放并登录' : '确认释放'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** One mount owns one password-verified, credential-free public flow reference. */
export function LoginCapacityDialog({
  onClose,
  restoreFocus,
}: {
  onClose(): void;
  restoreFocus(): void;
}) {
  const gateway = useGateway();
  const client = useQueryClient();
  const epoch = useLoginViewEpoch();
  const [initialEpoch] = useState(epoch);
  const desktop = useMediaQuery('(min-width: 768px)');
  const [review, setReview] = useState<LoginCapacityReview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<LoginSessionView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const operation = useRef<CompleteLoginCapacity | null>(null);
  const flow = useRef<string | undefined>(undefined);
  const refreshSequence = useRef(0);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const active = useCallback(
    () => alive.current && accountEpoch(client) === initialEpoch,
    [client, initialEpoch],
  );
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!gateway.account.getLoginCapacityReview) {
      setError('当前版本不支持设备清理，请升级后重试');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setSelected([]);
    const flowRef = flow.current;
    setReview(null);
    try {
      const value = await gateway.account.getLoginCapacityReview(flowRef ? { flowRef } : undefined);
      if (active() && sequence === refreshSequence.current) {
        flow.current = value.flowRef;
        setReview(value);
      }
    } catch (failure) {
      if (active() && sequence === refreshSequence.current) {
        setError(accountErrorMessage(failure));
        setExpired(extractErrorCode(failure) === 'AUTH_LOGIN_CHALLENGE_EXPIRED');
      }
    } finally {
      if (active() && sequence === refreshSequence.current) setLoading(false);
    }
  }, [gateway, active]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      refreshSequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(review.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [review]);
  const close = async () => {
    if (busy) return;
    if (review && !expired && !unknown && gateway.account.cancelLoginCapacity) {
      setBusy(true);
      try {
        await gateway.account.cancelLoginCapacity({ flowRef: review.flowRef });
      } catch (failure) {
        if (active()) {
          setError(accountErrorMessage(failure));
          setBusy(false);
        }
        return;
      }
    }
    onClose();
  };
  const complete = async () => {
    if (busyRef.current || !review || !gateway.account.completeLoginCapacity || !active()) return;
    busyRef.current = true;
    if (!operation.current)
      operation.current = {
        flowRef: review.flowRef,
        operationId: crypto.randomUUID(),
        selected: selectionOf(confirm ?? []),
      };
    setBusy(true);
    setError(null);
    try {
      const account = await gateway.account.completeLoginCapacity(operation.current);
      if (!active()) return;
      useRememberedUsername.getState().remember(account.username);
      await applyAccountSession(client, account, initialEpoch);
      toast.success('登录已完成');
      onClose();
    } catch (failure) {
      if (!active()) return;
      const code = extractErrorCode(failure);
      setError(accountErrorMessage(failure));
      if (code === 'AUTH_SESSION_LIMIT' || code === 'AUTH_SESSION_REVIEW_CHANGED') {
        operation.current = null;
        setConfirm(null);
        setUnknown(false);
        await refresh();
        if (active()) setError('设备名额或选择已变化，请重新选择并确认。');
      } else if (code === 'AUTH_LOGIN_CHALLENGE_EXPIRED' || code === 'AUTH_SESSION_EXPIRED') {
        setExpired(true);
        setConfirm(null);
      } else {
        setUnknown(true);
        setConfirm(null);
      }
    } finally {
      busyRef.current = false;
      if (active()) setBusy(false);
    }
  };
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  if (epoch !== initialEpoch) return null;
  const content = (
    <>
      <div className="space-y-2">
        <Title>清理登录设备</Title>
        <Description>登录设备数量已达上限，请选择要退出的设备。清理后会继续本次登录。</Description>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading || busy}>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : expired ? (
          <p role="alert" data-testid="account-login-capacity-expired">
            验证已过期，请关闭窗口后重新登录。
          </p>
        ) : review ? (
          <>
            <p className="py-2 text-muted-foreground text-sm">
              {review.sessions.total} / {review.sessions.limit} 个设备 · 至少释放{' '}
              {review.sessions.required} 个
            </p>
            <LoginSessionRows
              items={review.sessions.items}
              selected={selected}
              onSelect={setSelected}
              disabled={busy || unknown}
            />
          </>
        ) : null}
        {error && (
          <p role="alert" className="py-2 text-destructive text-sm">
            {error}
          </p>
        )}
        {unknown && (
          <p className="text-muted-foreground text-sm">
            结果尚未确认。核对只重试原请求，不追加释放其他设备。
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void close()}>
          {unknown || expired ? '关闭' : '取消'}
        </Button>
        {!expired && !unknown && (
          <Button
            className="min-h-11"
            variant="outline"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            刷新列表
          </Button>
        )}
        {!expired && (
          <Button
            className="min-h-11"
            disabled={
              busy || loading || !review || (!unknown && selected.length < review.sessions.required)
            }
            data-testid="account-login-capacity-submit"
            onClick={() => {
              if (unknown || review?.sessions.required === 0) void complete();
              else
                setConfirm(
                  review?.sessions.items.filter((item) => selected.includes(item.sessionRef)) ?? [],
                );
            }}
          >
            {busy && <Spinner />}
            {unknown
              ? '核对原登录请求'
              : review?.sessions.required === 0
                ? '继续登录'
                : '释放所选并登录'}
          </Button>
        )}
      </div>
    </>
  );
  return (
    <>
      {desktop ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !confirm) void close();
          }}
        >
          <DialogContent
            className="flex max-h-[85dvh] max-w-2xl flex-col"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocus();
            }}
            onEscapeKeyDown={(event) => {
              if (busy || confirm) event.preventDefault();
            }}
            data-testid="account-login-capacity"
          >
            {content}
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open && !confirm) void close();
          }}
        >
          <SheetContent
            side="bottom"
            className="flex max-h-[90dvh] flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocus();
            }}
            onEscapeKeyDown={(event) => {
              if (busy || confirm) event.preventDefault();
            }}
            data-testid="account-login-capacity"
          >
            {content}
          </SheetContent>
        </Sheet>
      )}
      {confirm && (
        <ReleaseConfirmation
          items={confirm}
          busy={busy}
          error={error}
          login
          onCancel={() => {
            setConfirm(null);
            operation.current = null;
          }}
          onConfirm={() => void complete()}
        />
      )}
    </>
  );
}

export function LoginSessionsPanel() {
  const epoch = useLoginViewEpoch();
  return <LoginSessionsPanelState key={epoch} epoch={epoch} />;
}

/** Desktop-only capability; contains a count, never a credential or issuer. */
export function PendingLoginReleases() {
  const gateway = useGateway();
  const epoch = useLoginViewEpoch();
  const status = useQuery({
    queryKey: ['account', 'login-release-status', epoch],
    queryFn: () => gateway.account.getLoginReleaseStatus?.() ?? Promise.resolve({ pending: 0 }),
    enabled: !!gateway.account.getLoginReleaseStatus,
    refetchInterval: 30_000,
    retry: false,
  });
  if (!status.data?.pending) return null;
  return (
    <p
      role="status"
      className="text-muted-foreground text-sm"
      data-testid="account-pending-login-releases"
    >
      本机已退出，{status.data.pending} 个远端登录的释放待联网确认。联网后会自动重试。
    </p>
  );
}

function LoginSessionsPanelState({ epoch }: { epoch: number }) {
  const gateway = useGateway();
  const client = useQueryClient();
  const logout = useLogout();
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<LoginSessionView[] | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<string | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sessions = useQuery({
    queryKey: ['account', 'login-sessions', epoch],
    queryFn: async () => {
      if (!gateway.account.listLoginSessions) throw new Error('当前版本不支持登录设备管理');
      const result = await gateway.account.listLoginSessions();
      if (accountEpoch(client) !== epoch) throw new Error('账号已切换');
      return result;
    },
    enabled: !!gateway.account.listLoginSessions,
    retry: false,
  });
  if (!gateway.account.listLoginSessions) return null;
  const revoke = async () => {
    if (!confirm || busy || !gateway.account.revokeLoginSessions) return;
    operation.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    const credentials = { password: password || undefined, twoFactorCode: code || undefined };
    setPassword('');
    setCode('');
    try {
      const result = await gateway.account.revokeLoginSessions({
        operationId: operation.current,
        selected: selectionOf(confirm),
        ...credentials,
      });
      if (accountEpoch(client) !== epoch) return;
      setConfirm(null);
      setSelected([]);
      operation.current = null;
      toast.success(`已确认释放 ${result.released} 个设备`);
      await sessions.refetch();
      titleRef.current?.focus();
    } catch (failure) {
      if (accountEpoch(client) === epoch) {
        if (
          ['AUTH_CREDENTIALS_INVALID', 'AUTH_2FA_REQUIRED'].includes(
            extractErrorCode(failure) ?? '',
          )
        )
          setReauthenticate(true);
        setError(accountErrorMessage(failure));
      }
    } finally {
      if (accountEpoch(client) === epoch) setBusy(false);
    }
  };
  return (
    <Card data-testid="account-login-sessions">
      <CardHeader>
        <CardTitle ref={titleRef} tabIndex={-1}>
          登录设备
        </CardTitle>
        <CardDescription>仅管理登录状态；作品、提示词和费用记录不会删除。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-11"
            variant="outline"
            disabled={busy || sessions.isFetching}
            onClick={() => {
              setSelected([]);
              void sessions.refetch();
            }}
          >
            刷新
          </Button>
          <Button
            className="min-h-11"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmLogout(true)}
          >
            退出此设备
          </Button>
          <Button
            className="min-h-11"
            disabled={busy || sessions.isError || !selected.length}
            onClick={() => {
              operation.current = null;
              setError(null);
              setConfirm(
                sessions.data?.items.filter(
                  (item) => selected.includes(item.sessionRef) && !item.current,
                ) ?? [],
              );
            }}
          >
            释放所选
          </Button>
        </div>
        {sessions.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : sessions.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {accountErrorMessage(sessions.error)}
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {sessions.data.total} / {sessions.data.limit} 个登录设备
            </p>
            <LoginSessionRows
              items={sessions.data.items}
              selected={selected}
              onSelect={setSelected}
              disabled={busy}
            />
          </>
        )}
        {confirm && (
          <ReleaseConfirmation
            items={confirm}
            busy={busy}
            error={error}
            onCancel={() => {
              setConfirm(null);
              setPassword('');
              setCode('');
            }}
            onConfirm={() => void revoke()}
          >
            {(sessions.data?.requiresReauthentication || reauthenticate) && (
              <div className="space-y-2">
                <Label htmlFor={`${id}-password`}>释放前重新验证密码</Label>
                <Input
                  id={`${id}-password`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Label htmlFor={`${id}-code`}>两步验证码或备用码（已开启时填写）</Label>
                <Input
                  id={`${id}-code`}
                  autoComplete="one-time-code"
                  value={code}
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
            )}
          </ReleaseConfirmation>
        )}
        <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>退出此设备？</AlertDialogTitle>
              <AlertDialogDescription>
                云同步与在线生图将暂停，本地数据不受影响。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => logout.mutate()}>退出登录</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
