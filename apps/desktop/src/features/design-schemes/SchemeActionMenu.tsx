import { useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
} from '../../components/ui/icons';
import type { DesignSchemeSummary } from '@musefold/desktop-contracts/design-scheme';

/** 详情操作菜单（UI 规范 §4.2）：主动作之外的操作收进 ...；危险操作垫底分隔。 */
export function SchemeActionMenu({
  scheme,
  onModify,
  onRename,
  onViewSource,
  onCheckUpdate,
  checkUpdateBusy,
  onExport,
  exportBusy,
  onRemove,
}: {
  scheme: DesignSchemeSummary;
  /** 正式方案菜单首项「在 Composer 中修改」；草稿的修改入口在标题栏。 */
  onModify: (() => void) | null;
  onRename: () => void;
  onViewSource: () => void;
  /** 只有 GitHub 来源的方案提供「检查更新」。 */
  onCheckUpdate: (() => void) | null;
  checkUpdateBusy: boolean;
  /** 导出 .musefold.design 分享包（设计规范 §7）：仅正式方案。 */
  onExport: (() => void) | null;
  exportBusy: boolean;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isDraft = scheme.status === 'draft';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (action: () => void) => { setOpen(false); action(); };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="icon-action h-8 w-8"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多操作"
        title="更多操作"
        data-testid="runtime-scheme-menu"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[200px] rounded-lg border border-border-default bg-popover p-1.5 shadow-pop animate-scale-fade-in" role="menu" aria-label="方案操作" data-testid="runtime-scheme-menu-list">
          {onModify && (
            <button type="button" role="menuitem" onClick={() => choose(onModify)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover" data-testid="runtime-scheme-menu-modify">
              <Pencil className="h-3.5 w-3.5 shrink-0 text-secondary" />在 Composer 中修改
            </button>
          )}
          {isDraft && (
            <button type="button" role="menuitem" onClick={() => choose(onRename)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover" data-testid="runtime-scheme-menu-rename">
              <Pencil className="h-3.5 w-3.5 shrink-0 text-secondary" />重命名
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onViewSource)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover" data-testid="runtime-scheme-menu-source">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-secondary" />查看来源
          </button>
          {onCheckUpdate && (
            <button
              type="button"
              role="menuitem"
              disabled={checkUpdateBusy}
              onClick={() => choose(onCheckUpdate)}
              className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
              data-testid="runtime-scheme-menu-check-update"
            >
              {checkUpdateBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-secondary" /> : <RefreshCw className="h-3.5 w-3.5 shrink-0 text-secondary" />}
              检查更新
            </button>
          )}
          {onExport && (
            <button
              type="button"
              role="menuitem"
              disabled={exportBusy}
              onClick={() => choose(onExport)}
              className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
              data-testid="runtime-scheme-menu-export"
            >
              {exportBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-secondary" /> : <Share2 className="h-3.5 w-3.5 shrink-0 text-secondary" />}
              导出分享包
            </button>
          )}
          <div className="my-1.5 border-t border-border-subtle" role="separator" />
          <button type="button" role="menuitem" onClick={() => choose(onRemove)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[11.5px] text-danger hover:bg-danger/10" data-testid="runtime-scheme-menu-remove">
            <Trash2 className="h-3.5 w-3.5 shrink-0" />{isDraft ? '删除草稿' : '移除方案'}
          </button>
        </div>
      )}
    </div>
  );
}
