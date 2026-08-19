import {
  ArrowLeft,
  Copy,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  RotateCcw,
  Sparkles,
  Trash2,
} from "@musefold/ui/icons";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
} from "@musefold/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PromptDetailViewModel } from "../models";

type PromptAction = () => void | Promise<void>;
type PromptDetailMenuItems = ReactNode | ((close: () => void) => ReactNode);

export interface PromptDetailScreenProps {
  prompt: PromptDetailViewModel;
  onBack: PromptAction;
  onUse?: PromptAction;
  onEdit?: PromptAction;
  onCopy?: PromptAction;
  onTogglePin?: PromptAction;
  onDelete?: PromptAction;
  onRestore?: PromptAction;
  busy?: boolean;
  error?: string | null;
  confirmDelete?: boolean;
  additionalMenuItems?: PromptDetailMenuItems;
  bodyExtra?: ReactNode;
}

export function PromptDetailScreen({
  prompt,
  onBack,
  onUse,
  onEdit,
  onCopy,
  onTogglePin,
  onDelete,
  onRestore,
  busy = false,
  error,
  confirmDelete = false,
  additionalMenuItems,
  bodyExtra,
}: PromptDetailScreenProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const deleted = Boolean(prompt.deletedAtLabel);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const runMenuAction = (action?: PromptAction) => {
    setMenuOpen(false);
    if (action) void action();
  };

  const closeMenu = () => setMenuOpen(false);

  const requestDelete = () => {
    setMenuOpen(false);
    if (confirmDelete) setDeleteOpen(true);
    else if (onDelete) void onDelete();
  };

  return (
    <section
      className="mf-prompt-detail-screen"
      data-testid="prompt-detail"
      data-prompt-id={prompt.id}
      data-deleted={deleted ? "true" : "false"}
    >
      <Button
        variant="ghost"
        className="mf-detail-back"
        onClick={() => void onBack()}
        data-testid="detail-back"
        icon={<ArrowLeft aria-hidden="true" />}
      >
        提示词
      </Button>

      <header className="mf-prompt-detail-heading">
        <span className="mf-prompt-detail-icon" aria-hidden="true">
          {prompt.imageUrl ? <img src={prompt.imageUrl} alt="" /> : <FileText />}
        </span>
        <div className="mf-prompt-detail-title">
          <div>
            <h1 data-testid="detail-title">{prompt.title}</h1>
            {prompt.isPinned && <Pin aria-label="已置顶" />}
            {deleted && <span className="mf-deleted-badge">回收站</span>}
          </div>
          {prompt.description && <p>{prompt.description}</p>}
          <small>
            {prompt.sourceLabel} · 使用 {prompt.usageCount} 次 · 更新于{" "}
            {prompt.updatedAtLabel}
          </small>
        </div>
        <div className="mf-prompt-detail-actions" ref={menuRef}>
          {deleted ? (
            onRestore && (
              <Button
                variant="primary"
                className="mf-detail-primary"
                disabled={busy}
                onClick={() => void onRestore()}
                data-testid="detail-restore"
                icon={<RotateCcw aria-hidden="true" />}
              >
                恢复
              </Button>
            )
          ) : (
            <>
              <IconButton
                className="mf-icon-button"
                label="更多操作"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={busy}
                onClick={() => setMenuOpen((open) => !open)}
                data-testid="detail-menu"
              >
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
              {onUse && (
                <Button
                  variant="primary"
                  className="mf-detail-primary"
                  disabled={busy}
                  onClick={() => void onUse()}
                  data-testid="detail-generate"
                  icon={<Sparkles aria-hidden="true" />}
                >
                  使用
                </Button>
              )}
              {menuOpen && (
                <div
                  className="mf-prompt-detail-menu"
                  role="menu"
                  aria-label="提示词操作"
                >
                  {onEdit && (
                    <Button
                      variant="ghost"
                      role="menuitem"
                      onClick={() => runMenuAction(onEdit)}
                      data-testid="detail-edit"
                      icon={<Pencil aria-hidden="true" />}
                    >
                      编辑
                    </Button>
                  )}
                  {onCopy && (
                    <Button
                      variant="ghost"
                      role="menuitem"
                      onClick={() => runMenuAction(onCopy)}
                      data-testid="detail-copy"
                      icon={<Copy aria-hidden="true" />}
                    >
                      复制正文
                    </Button>
                  )}
                  {onTogglePin && (
                    <Button
                      variant="ghost"
                      role="menuitem"
                      onClick={() => runMenuAction(onTogglePin)}
                      data-testid="detail-pin"
                      icon={<Pin aria-hidden="true" />}
                    >
                      {prompt.isPinned ? "取消置顶" : "置顶"}
                    </Button>
                  )}
                  {typeof additionalMenuItems === "function"
                    ? additionalMenuItems(closeMenu)
                    : additionalMenuItems}
                  {onDelete && (
                    <>
                      <span className="mf-menu-separator" />
                      <Button
                        variant="danger"
                        role="menuitem"
                        className="mf-danger-action"
                        onClick={requestDelete}
                        data-testid="detail-delete"
                        icon={<Trash2 aria-hidden="true" />}
                      >
                        移到回收站
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </header>

      {error && (
        <p className="mf-inline-error" role="alert">
          {error}
        </p>
      )}

      <PromptDetailContent prompt={prompt} bodyExtra={bodyExtra} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent
          className="mf-confirm-dialog"
          overlayClassName="mf-dialog-backdrop"
          aria-labelledby="mf-delete-prompt-title"
        >
          <DialogHeader className="mf-confirm-dialog-header">
            <DialogTitle id="mf-delete-prompt-title">移到回收站</DialogTitle>
            <DialogDescription>提示词可从回收站恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
              <Button
                variant="secondary"
                className="mf-secondary-button"
                onClick={() => setDeleteOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="danger"
                className="mf-danger-button"
                disabled={busy}
                data-testid="detail-delete-confirm"
                onClick={() => {
                  setDeleteOpen(false);
                  if (onDelete) void onDelete();
                }}
              >
                移到回收站
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function PromptDetailContent({
  prompt,
  bodyExtra,
}: {
  prompt: PromptDetailViewModel;
  bodyExtra?: ReactNode;
}) {
  return (
    <div className="mf-prompt-detail-content">
      <section>
        <h2>正文</h2>
        <pre data-testid="detail-content">{prompt.content}</pre>
      </section>
      {prompt.negative && (
        <section>
          <h2>负面提示词</h2>
          <pre data-testid="detail-negative">{prompt.negative}</pre>
        </section>
      )}
      {bodyExtra}
      <section>
        <h2>详情</h2>
        <dl className="mf-prompt-detail-facts">
          <div>
            <dt>创建</dt>
            <dd>{prompt.createdAtLabel}</dd>
          </div>
          <div>
            <dt>更新</dt>
            <dd>{prompt.updatedAtLabel}</dd>
          </div>
          <div>
            <dt>使用次数</dt>
            <dd>{prompt.usageCount}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
