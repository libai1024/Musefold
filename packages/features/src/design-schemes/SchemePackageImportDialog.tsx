'use client';

import type { ImportDesignSchemeResult } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@musefold/ui/components/sheet';
import { Input } from '@musefold/ui/components/input';
import { Loader2 } from '@musefold/ui/icons';
import { useId, useState } from 'react';
import { useAccountStatus } from '../account/hooks';
import { isAccountRestricted } from '../account/account-session';
import { useMediaQuery } from '../history/hooks';
import { usePackageImport } from './use-package-import';
import { PackageImportRecoveryList, packageRecoveryMessage } from './PackageImportRecoveryList';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@musefold/ui/components/alert-dialog';

/** Mounted only while open, so each explicit opening owns one immutable file/upload intent. */
export function SchemePackageImportDialog({
  onClose,
  onRestoreFocus,
  onImported,
}: {
  onClose(): void;
  onRestoreFocus?(): void;
  onImported(result: ImportDesignSchemeResult): void;
}) {
  const flow = usePackageImport(onImported);
  const account = useAccountStatus();
  const desktop = useMediaQuery('(min-width: 768px)');
  const id = useId();
  const [showRecovery, setShowRecovery] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const busy = ['reading', 'uploading', 'importing', 'checking', 'cancelling'].includes(flow.phase);
  const canUpload =
    !!account.data &&
    !account.isError &&
    !isAccountRestricted(account.data) &&
    !flow.changedAccount;
  const canContinue =
    canUpload && (!flow.recovery || flow.recovery.canContinue || !!flow.recovery.receipt);
  const close = () => {
    if (flow.phase !== 'importing') onClose();
  };
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  const body = (
    <>
      <div className="space-y-2">
        <Title>导入分享包</Title>
        <Description>
          上传后先核对内容，再确认加入我的方案。导入结果是草稿，需要试运行后才能设为正式。
        </Description>
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto text-sm" aria-busy={busy}>
        {flow.canRecover && !flow.locked && canUpload ? (
          <Button
            variant="outline"
            onClick={() => setShowRecovery(!showRecovery)}
            data-testid="scheme-package-show-recovery"
          >
            {showRecovery ? '选择新的方案包' : '查看此前的导入记录'}
          </Button>
        ) : null}
        {showRecovery && !flow.locked && canUpload ? (
          <PackageImportRecoveryList onSelect={(stageId) => void flow.recover(stageId)} />
        ) : !flow.stage?.preview ? (
          <>
            <label className="block space-y-2" htmlFor={`${id}-file`}>
              <span>选择方案包（最大 256 MiB）</span>
              <Input
                id={`${id}-file`}
                type="file"
                accept=".musefold.design"
                disabled={!flow.canSelectFile || !canContinue}
                data-testid="scheme-package-file"
                onChange={(event) => flow.setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <fieldset disabled={flow.locked || !canUpload} className="space-y-2">
              <legend className="mb-2">方案包格式</legend>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-format`}
                  checked={flow.formatVersion === 2}
                  onChange={() => flow.setFormatVersion(2)}
                />
                当前格式（格式 2）
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-format`}
                  checked={flow.formatVersion === 1}
                  onChange={() => flow.setFormatVersion(1)}
                />
                旧版方案包（格式 1）
              </label>
            </fieldset>
            {flow.file && canUpload ? (
              <p className="break-all text-muted-foreground">
                {flow.file.name} · {(flow.file.size / 1024 / 1024).toFixed(2)} MiB
              </p>
            ) : null}
          </>
        ) : canUpload ? (
          <section
            className="space-y-2 rounded-md border border-border p-4"
            data-testid="scheme-package-preview"
          >
            <h3 className="break-words font-medium">{flow.stage.preview.name}</h3>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {flow.stage.preview.summary}
            </p>
            <p>
              {flow.stage.preview.sourceCount} 个来源 · {flow.stage.preview.imageCount} 张图片 ·{' '}
              {flow.stage.preview.entryCount} 个文件
            </p>
            {flow.stage.preview.legacyPreviewCount > 0 ? (
              <p className="text-muted-foreground">
                包含 {flow.stage.preview.legacyPreviewCount} 张旧版预览图；预览图不代表试运行成功。
              </p>
            ) : null}
          </section>
        ) : null}
        {flow.recovery && canUpload ? (
          <p
            role="status"
            className="text-muted-foreground"
            data-testid="scheme-package-recovery-status"
          >
            {packageRecoveryMessage(flow.recovery)}
          </p>
        ) : null}
        {flow.recovering && canUpload ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (flow.recovering) void flow.recover(flow.recovering);
            }}
            data-testid="scheme-package-refresh-recovery"
          >
            刷新核对记录
          </Button>
        ) : null}
        {flow.canRecover ? (
          <p className="text-xs text-muted-foreground">
            关闭页面会保留服务器记录，可从导入记录重新核对；未完成上传受服务器有效期限制。
          </p>
        ) : null}
        {!canUpload ? (
          <p role="alert">
            {flow.changedAccount
              ? '账号已切换，请关闭后重新导入。'
              : account.isPending
                ? '正在核对账号…'
                : '请先登录并完成账号核对。'}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {flow.phase === 'checking'
              ? '正在核对原导入记录…'
              : flow.phase === 'cancelling'
                ? '正在取消上传…'
                : flow.phase === 'reading'
                  ? '正在读取和校验文件…'
                  : flow.phase === 'uploading'
                    ? '正在上传并核对内容…'
                    : '正在确认导入，请稍候…'}
          </p>
        ) : null}
        {flow.error && canUpload ? (
          <p role="alert" className="break-words text-destructive">
            {flow.error}
          </p>
        ) : null}
        {flow.phase === 'review' && flow.error ? (
          <p className="text-muted-foreground">重试会核对同一次导入，不会重新创建一份副本。</p>
        ) : null}
      </div>
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消这次上传？</AlertDialogTitle>
            <AlertDialogDescription>
              取消后不能继续使用此上传。若其他页面已开始导入，会先核对结果；不会删除已经导入的草稿。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留记录</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void flow.cancel().then((cancelled) => {
                  if (cancelled) onClose();
                })
              }
            >
              确认取消上传
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {flow.stage && !['imported', 'cancelled', 'rejected'].includes(flow.stage.status) ? (
          <Button
            variant="outline"
            disabled={busy || !canUpload || flow.recovery?.execution === 'running'}
            onClick={() => setConfirmCancel(true)}
          >
            取消此上传
          </Button>
        ) : null}
        <Button variant="outline" onClick={close} disabled={flow.phase === 'importing'}>
          关闭
        </Button>
        {flow.phase === 'review' || flow.phase === 'importing' ? (
          <Button
            disabled={busy || !canContinue}
            aria-busy={busy}
            onClick={() => void flow.confirm()}
            data-testid="scheme-package-confirm"
          >
            {flow.recovery?.receipt
              ? '查看原导入结果'
              : flow.error
                ? '核对并继续导入'
                : '确认导入为草稿'}
          </Button>
        ) : (
          <Button
            disabled={busy || !canContinue || !flow.file || (showRecovery && !flow.locked)}
            aria-busy={busy}
            onClick={() => void flow.upload()}
            data-testid="scheme-package-upload"
          >
            {flow.locked ? '重试核对上传' : '上传并预览'}
          </Button>
        )}
      </div>
    </>
  );
  return desktop ? (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="flex max-h-[90dvh] flex-col"
        showCloseButton={flow.phase !== 'importing'}
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus) {
            event.preventDefault();
            onRestoreFocus();
          }
        }}
        data-testid="scheme-package-import"
      >
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
        showCloseButton={flow.phase !== 'importing'}
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus) {
            event.preventDefault();
            onRestoreFocus();
          }
        }}
        data-testid="scheme-package-import"
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}
