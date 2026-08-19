import {
  ArrowDownToLine,
  Copy,
  MoreHorizontal,
  RotateCcw,
  Save,
  Square,
  Trash2,
  WandSparkles,
} from "@musefold/ui/icons";
import { Button, IconButton } from "@musefold/ui";
import { useEffect, useState, type ReactNode } from "react";

export type GenerationHistoryBusyAction =
  | "retry"
  | "cancel"
  | "save"
  | "delete"
  | "restore"
  | null;

export interface GenerationHistoryDetailActionsProps {
  deleted?: boolean;
  busyAction?: GenerationHistoryBusyAction;
  onRestore?: () => void;
  onReuse?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  downloadUrl?: string | null;
  onSavePrompt?: () => void;
  onCopyPrompt?: () => void;
  onDelete?: () => void;
  reuseTestId?: string;
  savePromptLabel?: string;
  deleteLabel?: string;
  extraActions?: ReactNode;
  layout?: "inline" | "stacked";
  className?: string;
}

/** Common history actions; hosts only provide platform-specific extra actions. */
export function GenerationHistoryDetailActions({
  deleted = false,
  busyAction = null,
  onRestore,
  onReuse,
  onRetry,
  onCancel,
  downloadUrl,
  onSavePrompt,
  onCopyPrompt,
  onDelete,
  reuseTestId = "history-detail-reuse",
  savePromptLabel = "存为提示词",
  deleteLabel = "移到回收站",
  extraActions,
  layout = "inline",
  className,
}: GenerationHistoryDetailActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const disabled = Boolean(busyAction);

  useEffect(() => setMenuOpen(false), [deleted]);

  const saveButton = onSavePrompt ? (
    <Button
      variant="secondary"
      className="mf-secondary-button"
      disabled={disabled}
      onClick={onSavePrompt}
      data-testid="history-detail-save"
      icon={<Save aria-hidden="true" />}
      busy={busyAction === "save"}
      busyLabel="保存中..."
    >
      {savePromptLabel}
    </Button>
  ) : null;
  const copyButton = onCopyPrompt ? (
    <Button
      variant="secondary"
      className="mf-secondary-button"
      onClick={onCopyPrompt}
      data-testid="history-detail-copy"
      icon={<Copy aria-hidden="true" />}
    >
      复制提示词
    </Button>
  ) : null;
  const deleteButton = onDelete ? (
    <Button
      variant="danger"
      className="mf-danger-button"
      disabled={disabled}
      onClick={onDelete}
      data-testid="history-detail-delete"
      icon={<Trash2 aria-hidden="true" />}
    >
      {deleteLabel}
    </Button>
  ) : null;

  return (
    <div
      className={["mf-history-detail-actions", className]
        .filter(Boolean)
        .join(" ")}
      data-layout={layout}
    >
      {deleted && onRestore ? (
        <Button
          variant="primary"
          className="mf-detail-primary"
          disabled={disabled}
          onClick={onRestore}
          data-testid="history-detail-restore"
          icon={<RotateCcw aria-hidden="true" />}
          busy={busyAction === "restore"}
          busyLabel="恢复中..."
        >
          恢复
        </Button>
      ) : (
        <>
          {onReuse ? (
            <Button
              variant="primary"
              className="mf-detail-primary"
              onClick={onReuse}
              data-testid={reuseTestId}
              icon={<WandSparkles aria-hidden="true" />}
            >
              再次制作
            </Button>
          ) : null}
          {onRetry ? (
            <Button
              variant="secondary"
              className="mf-secondary-button"
              disabled={disabled}
              onClick={onRetry}
              data-testid="history-detail-retry"
              icon={<RotateCcw aria-hidden="true" />}
              busy={busyAction === "retry"}
              busyLabel="重试中..."
            >
              重试
            </Button>
          ) : null}
          {onCancel ? (
            <Button
              variant="secondary"
              className="mf-secondary-button"
              disabled={disabled}
              onClick={onCancel}
              data-testid="history-detail-cancel"
              icon={<Square aria-hidden="true" />}
              busy={busyAction === "cancel"}
              busyLabel="取消中..."
            >
              取消任务
            </Button>
          ) : null}
          {downloadUrl ? (
            <a
              className="mf-secondary-button"
              href={downloadUrl}
              download
              data-testid="history-detail-download"
            >
              <ArrowDownToLine aria-hidden="true" />
              下载
            </a>
          ) : null}
          {layout === "stacked" ? (
            <>
              {saveButton}
              {copyButton}
              {deleteButton}
            </>
          ) : (onSavePrompt || onDelete || onCopyPrompt) ? (
            <div className="mf-history-detail-menu-wrap">
              <IconButton
                className="mf-icon-button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                label="更多操作"
              >
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
              {menuOpen ? (
                <div
                  className="mf-prompt-detail-menu"
                  role="menu"
                  aria-label="生成记录操作"
                >
                  {onSavePrompt ? (
                    <Button
                      variant="ghost"
                      role="menuitem"
                      disabled={disabled}
                      onClick={() => {
                        setMenuOpen(false);
                        onSavePrompt();
                      }}
                      data-testid="history-detail-save"
                      icon={<Save aria-hidden="true" />}
                    >
                      {busyAction === "save" ? "保存中..." : savePromptLabel}
                    </Button>
                  ) : null}
                  {onCopyPrompt ? (
                    <Button
                      variant="ghost"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onCopyPrompt();
                      }}
                      icon={<Copy aria-hidden="true" />}
                    >
                      复制提示词
                    </Button>
                  ) : null}
                  {onDelete ? <span className="mf-menu-separator" /> : null}
                  {onDelete ? (
                    <Button
                      variant="danger"
                      role="menuitem"
                      className="mf-danger-action"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete();
                      }}
                      data-testid="history-detail-delete"
                      icon={<Trash2 aria-hidden="true" />}
                    >
                      {deleteLabel}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {extraActions}
        </>
      )}
    </div>
  );
}
