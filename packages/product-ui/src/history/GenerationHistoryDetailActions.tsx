import {
  ArrowDownToLine,
  Copy,
  MoreHorizontal,
  RotateCcw,
  Save,
  Share2,
  Square,
  Trash2,
  WandSparkles,
} from '@musefold/ui/icons';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from '@musefold/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canShareImage, shareImageAsset } from '../share';

export type GenerationHistoryBusyAction = 'retry' | 'cancel' | 'save' | 'delete' | 'restore' | null;

type HistoryAction = () => void | Promise<unknown>;
type HistoryMenuItems = ReactNode | ((close: () => void) => ReactNode);

export interface GenerationHistoryDeleteConfirmation {
  title: string;
  description: string;
  confirmLabel?: string;
}

export interface GenerationHistoryDetailActionsProps {
  contextKey?: string;
  deleted?: boolean;
  busyAction?: GenerationHistoryBusyAction;
  onRestore?: HistoryAction;
  onReuse?: HistoryAction;
  onRetry?: HistoryAction;
  onCancel?: HistoryAction;
  downloadUrl?: string | null;
  onDownload?: HistoryAction;
  onSavePrompt?: HistoryAction;
  onCopyPrompt?: HistoryAction;
  onDelete?: HistoryAction;
  reuseTestId?: string;
  savePromptLabel?: string;
  deleteLabel?: string;
  deleteConfirmation?: GenerationHistoryDeleteConfirmation;
  extraActions?: ReactNode;
  additionalMenuItems?: HistoryMenuItems;
  additionalDangerMenuItems?: HistoryMenuItems;
  layout?: 'inline' | 'stacked';
  className?: string;
}

/** Common history actions; hosts only provide platform-specific extra actions. */
export function GenerationHistoryDetailActions({
  contextKey,
  deleted = false,
  busyAction = null,
  onRestore,
  onReuse,
  onRetry,
  onCancel,
  downloadUrl,
  onDownload,
  onSavePrompt,
  onCopyPrompt,
  onDelete,
  reuseTestId = 'history-detail-reuse',
  savePromptLabel = '存为提示词',
  deleteLabel = '移到回收站',
  deleteConfirmation,
  extraActions,
  additionalMenuItems,
  additionalDangerMenuItems,
  layout = 'inline',
  className,
}: GenerationHistoryDetailActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const menuContentRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const disabled = Boolean(busyAction);

  useEffect(() => {
    setMenuOpen(false);
    setDeleteOpen(false);
  }, [contextKey, deleted]);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      menuContentRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const runMenuAction = (action?: HistoryAction) => {
    closeMenu();
    if (action) void action();
  };
  const requestDelete = () => {
    closeMenu();
    if (deleteConfirmation) setDeleteOpen(true);
    else if (onDelete) void onDelete();
  };
  const renderMenuItems = (items?: HistoryMenuItems) =>
    typeof items === 'function' ? items(closeMenu) : items;
  const hasMenu = Boolean(
    downloadUrl ||
    onCopyPrompt ||
    (layout === 'inline' && onSavePrompt) ||
    additionalMenuItems ||
    additionalDangerMenuItems ||
    onDelete,
  );

  return (
    <>
      <div
        className={['mf-history-detail-actions', className].filter(Boolean).join(' ')}
        data-layout={layout}
      >
        {deleted && onRestore ? (
          <Button
            variant="primary"
            className="mf-detail-primary"
            disabled={disabled}
            onClick={() => void onRestore()}
            data-testid="history-detail-restore"
            icon={<RotateCcw aria-hidden="true" />}
            busy={busyAction === 'restore'}
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
                onClick={() => void onReuse()}
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
                onClick={() => void onRetry()}
                data-testid="history-detail-retry"
                icon={<RotateCcw aria-hidden="true" />}
                busy={busyAction === 'retry'}
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
                onClick={() => void onCancel()}
                data-testid="history-detail-cancel"
                icon={<Square aria-hidden="true" />}
                busy={busyAction === 'cancel'}
                busyLabel="取消中..."
              >
                取消任务
              </Button>
            ) : null}
            {layout === 'stacked' && onSavePrompt ? (
              <Button
                variant="secondary"
                className="mf-secondary-button"
                disabled={disabled}
                onClick={() => void onSavePrompt()}
                data-testid="history-detail-save"
                icon={<Save aria-hidden="true" />}
                busy={busyAction === 'save'}
                busyLabel="保存中..."
              >
                {savePromptLabel}
              </Button>
            ) : null}
            {extraActions}
            {hasMenu ? (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  {layout === 'stacked' ? (
                    <Button
                      ref={menuTriggerRef}
                      variant="secondary"
                      className="mf-secondary-button"
                      data-testid="history-detail-menu"
                      aria-label="生成记录操作"
                      icon={<MoreHorizontal aria-hidden="true" />}
                    >
                      更多操作
                    </Button>
                  ) : (
                    <IconButton
                      ref={menuTriggerRef}
                      className="mf-icon-button"
                      label="生成记录操作"
                      data-testid="history-detail-menu"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </IconButton>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  ref={menuContentRef}
                  className="mf-history-detail-menu"
                  align="end"
                  sideOffset={6}
                  aria-label="生成记录操作"
                >
                  {downloadUrl ? (
                    onDownload ? (
                      <DropdownMenuItem
                        onSelect={() => runMenuAction(onDownload)}
                        data-testid="history-detail-download"
                      >
                        <ArrowDownToLine aria-hidden="true" />
                        下载
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem asChild>
                        <a href={downloadUrl} download data-testid="history-detail-download">
                          <ArrowDownToLine aria-hidden="true" />
                          下载
                        </a>
                      </DropdownMenuItem>
                    )
                  ) : null}
                  {downloadUrl && canShareImage() ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        runMenuAction(() => shareImageAsset(downloadUrl, 'Musefold 生成图片'))
                      }
                      data-testid="history-detail-share"
                    >
                      <Share2 aria-hidden="true" />
                      分享
                    </DropdownMenuItem>
                  ) : null}
                  {layout === 'inline' && onSavePrompt ? (
                    <DropdownMenuItem
                      disabled={disabled}
                      onSelect={() => runMenuAction(onSavePrompt)}
                      data-testid="history-detail-save"
                    >
                      <Save aria-hidden="true" />
                      {busyAction === 'save' ? '保存中...' : savePromptLabel}
                    </DropdownMenuItem>
                  ) : null}
                  {onCopyPrompt ? (
                    <DropdownMenuItem
                      onSelect={() => runMenuAction(onCopyPrompt)}
                      data-testid="history-detail-copy"
                    >
                      <Copy aria-hidden="true" />
                      复制提示词
                    </DropdownMenuItem>
                  ) : null}
                  {renderMenuItems(additionalMenuItems)}
                  {additionalDangerMenuItems || onDelete ? <DropdownMenuSeparator /> : null}
                  {renderMenuItems(additionalDangerMenuItems)}
                  {onDelete ? (
                    <DropdownMenuItem
                      tone="danger"
                      disabled={disabled}
                      onSelect={requestDelete}
                      data-testid="history-detail-delete"
                    >
                      <Trash2 aria-hidden="true" />
                      {deleteLabel}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        )}
      </div>

      {deleteConfirmation && onDelete ? (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent
            className="mf-confirm-dialog"
            overlayClassName="mf-dialog-backdrop"
            data-testid="history-detail-delete-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              menuTriggerRef.current?.focus();
            }}
          >
            <DialogHeader className="mf-confirm-dialog-header">
              <DialogTitle>{deleteConfirmation.title}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <DialogDescription>{deleteConfirmation.description}</DialogDescription>
            </DialogBody>
            <DialogFooter>
              <Button
                variant="secondary"
                className="mf-secondary-button"
                disabled={busyAction === 'delete'}
                onClick={() => setDeleteOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="danger"
                className="mf-danger-button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  setDeleteOpen(false);
                  void onDelete();
                }}
                data-testid="history-detail-delete-confirm"
              >
                {busyAction === 'delete'
                  ? '处理中...'
                  : (deleteConfirmation.confirmLabel ?? deleteLabel)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
