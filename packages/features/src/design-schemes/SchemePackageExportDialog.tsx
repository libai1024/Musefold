'use client';

import { useState } from 'react';
import type { BeginDesignSchemePackageExport } from '@musefold/contracts';
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
  PackageExportRecoveryList,
  packageExportRecoveryMessage,
} from './PackageExportRecoveryList';
import { Button } from '@musefold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@musefold/ui/components/sheet';
import { Loader2 } from '@musefold/ui/icons';
import { useAccountStatus } from '../account/hooks';
import { isAccountRestricted } from '../account/account-session';
import { useMediaQuery } from '../history/hooks';
import { usePackageExport } from './use-package-export';

export function SchemePackageExportDialog({
  selection,
  onClose,
  onRestoreFocus,
}: {
  selection?: Omit<BeginDesignSchemePackageExport, 'requestId' | 'formatVersion'>;
  onClose(): void;
  onRestoreFocus(): void;
}) {
  const flow = usePackageExport(selection);
  const [showHistory, setShowHistory] = useState(!selection);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const account = useAccountStatus();
  const desktop = useMediaQuery('(min-width: 768px)');
  const allowed =
    !!account.data &&
    !account.isError &&
    !isAccountRestricted(account.data) &&
    !flow.changedAccount;
  const busy = ['preparing', 'saving', 'checking', 'cancelling'].includes(flow.phase);
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  const body = (
    <>
      <div className="space-y-2">
        <Title>{selection ? '导出分享包' : '导出记录'}</Title>
        <Description>
          {selection
            ? '导出当前正式版本及其来源和素材。尚未验证的新版本不会替换本次导出内容。'
            : '核对此账号此前准备的归档，再决定是否下载。查看记录不会自动重新打包或下载。'}
        </Description>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto text-sm" aria-busy={busy}>
        {!allowed ? (
          <p role="alert">
            {flow.changedAccount
              ? '账号已切换，请关闭后重新导出。'
              : account.isPending
                ? '正在核对账号…'
                : '请先登录并完成账号核对。'}
          </p>
        ) : null}
        {flow.canRecover && flow.canChoose && allowed && selection ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            data-testid="scheme-package-export-show-history"
          >
            {showHistory ? '返回新建导出' : '查看此前的导出记录'}
          </Button>
        ) : null}
        {showHistory && flow.canChoose && allowed ? (
          <PackageExportRecoveryList onSelect={(id) => void flow.recover(id)} />
        ) : null}
        {flow.recovery && allowed && flow.phase !== 'finished' ? (
          <div className="space-y-2" data-testid="scheme-package-export-recovery">
            <p className="font-medium break-words">
              {flow.recovery.schemeName ?? '原方案已不可用'} · 版本 {flow.recovery.expectedVersion}
            </p>
            <p role="status" className="text-muted-foreground">
              {packageExportRecoveryMessage(flow.recovery)}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (flow.recovery) void flow.recover(flow.recovery.export.exportId);
              }}
            >
              刷新核对记录
            </Button>
          </div>
        ) : null}
        {flow.stage?.status === 'ready' && allowed ? (
          <p data-testid="scheme-package-export-ready">
            方案包已准备 · {((flow.stage.sizeBytes ?? 0) / 1024 / 1024).toFixed(2)} MiB
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {flow.phase === 'preparing'
              ? '正在准备并核对方案包…'
              : flow.phase === 'checking'
                ? '正在核对原归档…'
                : flow.phase === 'cancelling'
                  ? '正在确认取消…'
                  : '正在下载、核对文件并交给保存位置…'}
          </p>
        ) : null}
        {flow.receipt && allowed ? (
          <p role="status" data-testid="scheme-package-export-result">
            {flow.receipt.status === 'delivered'
              ? '方案包已保存，可以发给其他 Musefold 用户导入。'
              : '已交给浏览器下载，请在下载列表中核对是否完成。'}
          </p>
        ) : null}
        {flow.error && allowed ? (
          <p role="alert" className="break-words text-destructive">
            {flow.error}
          </p>
        ) : null}
        {flow.error && allowed ? (
          <p className="text-muted-foreground">
            重试会核对同一次导出。若已出现下载，请先检查下载列表，避免重复保存。
          </p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        关闭页面会保留导出记录；归档受有效期限制。只有明确下载才会交给保存位置，取消无法撤回已交付文件。
      </p>
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消这次导出？</AlertDialogTitle>
            <AlertDialogDescription>
              原归档将不能继续下载，其他页面也会受影响。已经保存或交给浏览器的文件无法撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留记录</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !allowed}
              onClick={() =>
                void flow.cancel().then((done) => {
                  if (done) onClose();
                })
              }
            >
              确认取消导出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {flow.stage &&
        !['cancelled', 'failed', 'expired'].includes(flow.stage.status) &&
        flow.phase !== 'finished' ? (
          <Button
            variant="outline"
            disabled={busy || !allowed}
            onClick={() => setConfirmCancel(true)}
          >
            取消此导出
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
        {flow.phase !== 'finished' && (!showHistory || !flow.canChoose) ? (
          <Button
            disabled={busy || !allowed}
            onClick={() => void (flow.phase === 'ready' ? flow.save() : flow.prepare())}
            data-testid="scheme-package-export-action"
          >
            {flow.phase === 'ready'
              ? '下载并保存'
              : flow.stage || flow.error
                ? '重试核对'
                : '准备方案包'}
          </Button>
        ) : null}
      </div>
    </>
  );
  const restore = (event: Event) => {
    event.preventDefault();
    onRestoreFocus();
  };
  return desktop ? (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[90dvh] flex-col"
        onCloseAutoFocus={restore}
        data-testid="scheme-package-export"
      >
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onCloseAutoFocus={restore}
        data-testid="scheme-package-export"
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}
