import {
  ArrowLeft,
  Copy,
  History,
  ImageOff,
} from "@musefold/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@musefold/ui";
import { useEffect, useState, type ReactNode } from "react";
import type { GenerationHistoryDetailViewModel } from "../models";
import {
  GenerationHistoryDetailActions,
  type GenerationHistoryBusyAction,
} from "./GenerationHistoryDetailActions";

export interface GenerationHistoryDetailContentProps {
  detail: GenerationHistoryDetailViewModel;
  density?: "comfortable" | "compact";
  onOpenImage?: () => void;
  onCopyPrompt?: () => void;
  bodyExtra?: ReactNode;
  errorAction?: ReactNode;
}

export function GenerationHistoryDetailContent({
  detail,
  density = "comfortable",
  onOpenImage,
  onCopyPrompt,
  bodyExtra,
  errorAction,
}: GenerationHistoryDetailContentProps) {
  const [imageBroken, setImageBroken] = useState(false);

  useEffect(() => setImageBroken(false), [detail.imageUrl]);

  const showImage = Boolean(detail.imageUrl) && !imageBroken;

  return (
    <div
      className="mf-history-detail-content"
      data-density={density}
      data-status={detail.statusKey}
      data-testid="history-detail-content"
    >
      <Button
        unstyled
        type="button"
        className="mf-history-detail-image"
        disabled={!showImage || !onOpenImage}
        onClick={onOpenImage}
        title={showImage && onOpenImage ? "放大预览" : undefined}
        aria-label={showImage && onOpenImage ? "放大预览" : undefined}
        data-testid="history-detail-image"
      >
        {showImage ? (
          <img
            src={detail.imageUrl ?? undefined}
            alt=""
            onError={() => setImageBroken(true)}
          />
        ) : (
          <span>
            {detail.imageUrl ? <ImageOff aria-hidden="true" /> : <History aria-hidden="true" />}
            {detail.imageUnavailableLabel ?? "无生成图片"}
          </span>
        )}
      </Button>

      <div className="mf-history-detail-summary">
        <div>
          <span className="mf-history-detail-status" data-tone={detail.statusTone}>
            {detail.statusLabel}
          </span>
          <strong title={detail.modelLabel}>{detail.modelLabel}</strong>
        </div>
        <p>
          {detail.metadata.map((value) => (
            <span key={value}>{value}</span>
          ))}
        </p>
      </div>

      <HistoryDetailSection
        label="提示词"
        action={
          onCopyPrompt ? (
            <Button
              variant="ghost"
              onClick={onCopyPrompt}
              data-testid="history-detail-copy-prompt"
              icon={<Copy aria-hidden="true" />}
            >
              复制
            </Button>
          ) : undefined
        }
      >
        <pre data-testid="history-detail-prompt">{detail.prompt || "未记录"}</pre>
      </HistoryDetailSection>

      {detail.negative ? (
        <HistoryDetailSection label="负面提示词">
          <pre data-testid="history-detail-negative">{detail.negative}</pre>
        </HistoryDetailSection>
      ) : null}

      <HistoryDetailSection label="参数">
        <p className="mf-history-detail-value" data-testid="history-detail-params">
          {detail.paramsLabel}
        </p>
      </HistoryDetailSection>

      {bodyExtra}

      <HistoryDetailSection label="来源">
        <p className="mf-history-detail-value" data-testid="history-detail-source">
          {detail.sourceLabel}
        </p>
      </HistoryDetailSection>

      {detail.error ? (
        <div className="mf-history-detail-error" data-testid="history-detail-error">
          <strong>
            {detail.error.code ? `${detail.error.code} · ` : ""}
            {detail.error.title}
          </strong>
          {detail.error.hint ? <p>{detail.error.hint}</p> : null}
          {detail.error.details ? <pre>{detail.error.details}</pre> : null}
          {errorAction ? <div>{errorAction}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export interface GenerationHistoryDetailScreenProps
  extends Omit<GenerationHistoryDetailContentProps, "density"> {
  onBack: () => void;
  backLabel?: string;
  onReuse?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onSavePrompt?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  savePromptLabel?: string;
  busyAction?: GenerationHistoryBusyAction;
  notice?: string | null;
  actionError?: string | null;
}

export function GenerationHistoryDetailScreen({
  detail,
  onBack,
  backLabel = "生成历史",
  onOpenImage,
  onCopyPrompt,
  onReuse,
  onRetry,
  onCancel,
  onSavePrompt,
  onDelete,
  onRestore,
  savePromptLabel = "存为提示词",
  busyAction = null,
  notice,
  actionError,
  bodyExtra,
  errorAction,
}: GenerationHistoryDetailScreenProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleted = Boolean(detail.deletedAtLabel);

  useEffect(() => {
    setConfirmDelete(false);
  }, [detail.id]);

  return (
    <section
      className="mf-history-detail-screen"
      data-testid="history-detail"
      data-history-id={detail.id}
    >
      <Button
        variant="ghost"
        className="mf-detail-back"
        onClick={onBack}
        data-testid="history-detail-back"
        icon={<ArrowLeft aria-hidden="true" />}
      >
        {backLabel}
      </Button>

      <header className="mf-history-detail-heading">
        <div>
          <h1>生成详情</h1>
          {detail.deletedAtLabel ? <span>已于 {detail.deletedAtLabel} 移到回收站</span> : null}
        </div>
        <GenerationHistoryDetailActions
          deleted={deleted}
          busyAction={busyAction}
          onRestore={onRestore}
          onReuse={onReuse}
          onRetry={onRetry}
          onCancel={onCancel}
          downloadUrl={detail.imageUrl}
          onSavePrompt={onSavePrompt}
          onCopyPrompt={onCopyPrompt}
          onDelete={onDelete ? () => setConfirmDelete(true) : undefined}
          savePromptLabel={savePromptLabel}
        />
      </header>

      {notice ? <p className="mf-inline-notice">{notice}</p> : null}
      {actionError ? <p className="mf-inline-error">{actionError}</p> : null}

      <GenerationHistoryDetailContent
        detail={detail}
        onOpenImage={onOpenImage}
        onCopyPrompt={onCopyPrompt}
        bodyExtra={bodyExtra}
        errorAction={errorAction}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          className="mf-confirm-dialog"
          overlayClassName="mf-dialog-backdrop"
          aria-labelledby="history-delete-title"
        >
          <DialogHeader className="mf-confirm-dialog-header">
            <DialogTitle id="history-delete-title">
              将这条生成记录移到回收站？
            </DialogTitle>
            <DialogDescription>图片资产会保留，可从回收站恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              className="mf-secondary-button"
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </Button>
            <Button
              variant="danger"
              className="mf-danger-button"
              disabled={Boolean(busyAction)}
              onClick={() => {
                setConfirmDelete(false);
                onDelete?.();
              }}
              data-testid="history-detail-delete-confirm"
            >
              {busyAction === "delete" ? "处理中..." : "移到回收站"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function HistoryDetailSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mf-history-detail-section">
      <header>
        <h2>{label}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
