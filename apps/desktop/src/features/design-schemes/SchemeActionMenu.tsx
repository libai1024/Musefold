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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@musefold/ui';

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
  const isDraft = scheme.status === 'draft';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="icon-action h-8 w-8"
          aria-label="更多操作"
          title="更多操作"
          data-testid="runtime-scheme-menu"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-[200px]"
        aria-label="方案操作"
        data-testid="runtime-scheme-menu-list"
      >
        {onModify && (
          <DropdownMenuItem onSelect={onModify} data-testid="runtime-scheme-menu-modify">
            <Pencil className="h-3.5 w-3.5 text-secondary" />在 Composer 中修改
          </DropdownMenuItem>
        )}
        {isDraft && (
          <DropdownMenuItem onSelect={onRename} data-testid="runtime-scheme-menu-rename">
            <Pencil className="h-3.5 w-3.5 text-secondary" />
            重命名
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onViewSource} data-testid="runtime-scheme-menu-source">
          <FolderOpen className="h-3.5 w-3.5 text-secondary" />
          查看来源
        </DropdownMenuItem>
        {onCheckUpdate && (
          <DropdownMenuItem
            disabled={checkUpdateBusy}
            onSelect={onCheckUpdate}
            data-testid="runtime-scheme-menu-check-update"
          >
            {checkUpdateBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-secondary" />
            )}
            检查更新
          </DropdownMenuItem>
        )}
        {onExport && (
          <DropdownMenuItem
            disabled={exportBusy}
            onSelect={onExport}
            data-testid="runtime-scheme-menu-export"
          >
            {exportBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />
            ) : (
              <Share2 className="h-3.5 w-3.5 text-secondary" />
            )}
            导出分享包
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onRemove}
          className="mf-danger-action"
          data-testid="runtime-scheme-menu-remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {isDraft ? '删除草稿' : '移除方案'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
