'use client';

import type { WorkbenchDraft, WorkbenchSession } from '@musefold/contracts';
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
import { Button } from '@musefold/ui/components/button';

function DraftSummary({ label, draft }: { label: string; draft: WorkbenchDraft }) {
  return (
    <section className="min-w-0 space-y-1">
      <h3 className="font-medium text-sm">{label}</h3>
      <div
        className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border p-2 text-sm"
        tabIndex={0}
        aria-label={label}
      >
        {draft.prompt || '（正文为空）'}
        {draft.negative && <p className="mt-2 text-muted-foreground">反向词：{draft.negative}</p>}
        <p className="mt-2 text-muted-foreground text-xs">
          比例：{draft.params.aspectRatio ?? '默认'} · 质量：{draft.params.quality ?? '默认'} ·
          提示词引用：{draft.promptReferenceSelections.length || draft.promptReferenceIds.length}
        </p>
      </div>
    </section>
  );
}

export function SessionDraftConflictDialog({
  review,
  localDraft,
  busy,
  error,
  onClose,
  onRefresh,
  onLoad,
  onSave,
  onReturnFocus,
}: {
  review: WorkbenchSession | null;
  localDraft: WorkbenchDraft;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onRefresh(): void;
  onLoad(): void;
  onSave(): void;
  onReturnFocus(): void;
}) {
  return (
    <AlertDialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent
        className="max-h-[90dvh] max-w-lg overflow-y-auto"
        data-testid="session-draft-conflict-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>处理草稿保存冲突</AlertDialogTitle>
          <AlertDialogDescription>
            本页输入尚未保存。载入最新草稿会替换本页输入和参考素材；保留本页并保存会覆盖下方已核对的草稿，不会生成图片。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {review && <DraftSummary label="最新保存的草稿" draft={review.draft} />}
        <DraftSummary label="本页草稿" draft={localDraft} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          className="min-h-11 md:min-h-9"
          variant="ghost"
          disabled={busy}
          onClick={onRefresh}
          data-testid="session-draft-review-refresh"
        >
          {busy ? '处理中…' : '重新核对最新草稿'}
        </Button>
        <AlertDialogFooter className="flex-wrap">
          <AlertDialogCancel className="min-h-11 md:min-h-9" disabled={busy}>
            取消
          </AlertDialogCancel>
          <Button
            className="min-h-11 md:min-h-9"
            variant="outline"
            disabled={busy || Boolean(error)}
            onClick={onLoad}
            data-testid="session-draft-load-remote"
          >
            载入最新草稿
          </Button>
          <AlertDialogAction
            className="min-h-11 md:min-h-9"
            disabled={busy || Boolean(error)}
            onClick={(event) => {
              event.preventDefault();
              onSave();
            }}
            data-testid="session-draft-save-local"
          >
            保留本页并保存
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
