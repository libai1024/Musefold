'use client';

import type { PromptFolder, PromptTag } from '@musefold/contracts';
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
import { Input } from '@musefold/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@musefold/ui/components/popover';
import { Separator } from '@musefold/ui/components/separator';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@musefold/ui/components/sheet';
import { toast } from '@musefold/ui/components/sonner';
import { FolderPlus, Settings2, Trash2 } from '@musefold/ui/icons';
import { type RefObject, useRef, useState } from 'react';
import { SHELL_SIDEBAR_COMPACT_BREAKPOINT, useMediaQuery } from '../shell/sidebar-layout';
import { useCreateFolder, useCreateTag, useRemoveFolder, useRemoveTag } from './hooks';

export interface TaxonomyManagerProps {
  folders: PromptFolder[];
  tags: PromptTag[];
}

const TAXONOMY_TITLE = '管理文件夹与标签';
type DeleteTarget = { kind: 'folder'; item: PromptFolder } | { kind: 'tag'; item: PromptTag };
type TaxonomyFormProps = TaxonomyManagerProps & {
  deleteTarget: DeleteTarget | null;
  setDeleteTarget: (target: DeleteTarget | null) => void;
  deleteInFlight: RefObject<boolean>;
};

/** 文件夹/标签新建与删除表单。桌面 Popover 与窄屏 Sheet 共用,业务逻辑只写一份。 */
function TaxonomyForm({
  folders,
  tags,
  deleteTarget,
  setDeleteTarget,
  deleteInFlight,
}: TaxonomyFormProps) {
  const [folderName, setFolderName] = useState('');
  const [tagName, setTagName] = useState('');
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const form = useRef<HTMLDivElement | null>(null);
  const createFolder = useCreateFolder();
  const removeFolder = useRemoveFolder();
  const createTag = useCreateTag();
  const removeTag = useRemoveTag();

  function submitFolder() {
    const name = folderName.trim();
    if (!name || createFolder.isPending) return;
    createFolder.mutate(
      { name, parentId: null, sortOrder: folders.length },
      {
        onSuccess: () => setFolderName(''),
        onError: (error) => toast.error(error instanceof Error ? error.message : '创建文件夹失败'),
      },
    );
  }

  function submitTag() {
    const name = tagName.trim();
    if (!name || createTag.isPending) return;
    createTag.mutate(
      { name, group: null, color: null },
      {
        onSuccess: () => setTagName(''),
        onError: (error) => toast.error(error instanceof Error ? error.message : '创建标签失败'),
      },
    );
  }

  function confirmDelete() {
    if (!deleteTarget || deleteInFlight.current) return;
    deleteInFlight.current = true;
    const mutation = deleteTarget.kind === 'folder' ? removeFolder : removeTag;
    mutation.mutate(deleteTarget.item.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (error) => toast.error(error instanceof Error ? error.message : '删除失败，请重试'),
      onSettled: () => {
        deleteInFlight.current = false;
      },
    });
  }
  const deleting = removeFolder.isPending || removeTag.isPending;

  return (
    <div ref={form} className="flex flex-col gap-3" data-testid="taxonomy-panel">
      <div>
        <p className="mb-2 font-medium text-foreground text-sm">文件夹</p>
        <div className="flex gap-1.5">
          <Input
            value={folderName}
            data-testid="taxonomy-folder-name"
            placeholder="新文件夹名"
            maxLength={80}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submitFolder()}
          />
          <Button
            size="icon"
            variant="secondary"
            aria-label="新建文件夹"
            data-testid="taxonomy-folder-create"
            disabled={!folderName.trim() || createFolder.isPending}
            onClick={submitFolder}
          >
            <FolderPlus className="size-4" />
          </Button>
        </div>
        <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
          {folders.map((folder) => (
            <li key={folder.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-foreground">{folder.name}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 text-muted-foreground"
                aria-label={`删除文件夹 ${folder.name}`}
                onClick={(event) => {
                  deleteTrigger.current = event.currentTarget;
                  setDeleteTarget({ kind: 'folder', item: folder });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
          {folders.length === 0 && <li className="text-muted-foreground text-xs">暂无文件夹</li>}
        </ul>
      </div>

      <Separator />

      <div>
        <p className="mb-2 font-medium text-foreground text-sm">标签</p>
        <div className="flex gap-1.5">
          <Input
            value={tagName}
            data-testid="taxonomy-tag-name"
            placeholder="新标签名"
            maxLength={40}
            onChange={(event) => setTagName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submitTag()}
          />
          <Button
            size="icon"
            variant="secondary"
            aria-label="新建标签"
            data-testid="taxonomy-tag-create"
            disabled={!tagName.trim() || createTag.isPending}
            onClick={submitTag}
          >
            <FolderPlus className="size-4" />
          </Button>
        </div>
        <ul className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-foreground">{tag.name}</span>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 text-muted-foreground"
                aria-label={`删除标签 ${tag.name}`}
                onClick={(event) => {
                  deleteTrigger.current = event.currentTarget;
                  setDeleteTarget({ kind: 'tag', item: tag });
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
          {tags.length === 0 && <li className="text-muted-foreground text-xs">暂无标签</li>}
        </ul>
      </div>
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleteInFlight.current) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent
          data-testid="taxonomy-delete-dialog"
          onEscapeKeyDown={(event) => {
            // 仅关闭最内层确认框，不能让同一次 Escape 继续关闭移动管理抽屉。
            event.preventDefault();
            event.stopPropagation();
            if (!deleteInFlight.current) setDeleteTarget(null);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus();
            else form.current?.querySelector('input')?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除{deleteTarget?.kind === 'folder' ? '文件夹' : '标签'}「{deleteTarget?.item.name}
              」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === 'folder'
                ? '删除后无法恢复。提示词和子文件夹会保留，只解除与此文件夹的关联。'
                : '删除后无法恢复。提示词会保留，只移除此标签的关联。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                // Radix Action 默认立即关闭；请求失败时应保留原目标供用户重试。
                event.preventDefault();
                confirmDelete();
              }}
            >
              {deleting ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 文件夹/标签目录管理:新建与删除。重命名低频,先不占交互面。 */
export function TaxonomyManager({ folders, tags }: TaxonomyManagerProps) {
  // 与壳侧栏同一条 <md 边界(max-width: 767px);jsdom 无 matchMedia 时回落 false → Popover。
  const compact = useMediaQuery(`(max-width: ${SHELL_SIDEBAR_COMPACT_BREAKPOINT}px)`);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const deleteInFlight = useRef(false);
  // 快速关闭再打开时，Radix 退出动画的层注册顺序可能尚未稳定。
  // 外层也按当前确认状态处理 Escape，避免一次按键卸载整个管理表单。
  function onEscapeKeyDown(event: KeyboardEvent) {
    if (!deleteTarget) return;
    event.preventDefault();
    event.stopPropagation();
    if (!deleteInFlight.current) setDeleteTarget(null);
  }
  function onOpenChange(next: boolean) {
    if (next || !deleteTarget) setOpen(next);
  }
  const form = (
    <TaxonomyForm
      folders={folders}
      tags={tags}
      deleteTarget={deleteTarget}
      setDeleteTarget={setDeleteTarget}
      deleteInFlight={deleteInFlight}
    />
  );

  if (compact) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={TAXONOMY_TITLE}
            data-testid="taxonomy-open"
          >
            <Settings2 className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="right"
          className="p-4"
          data-testid="taxonomy-sheet"
          onEscapeKeyDown={onEscapeKeyDown}
        >
          <SheetTitle className="sr-only">{TAXONOMY_TITLE}</SheetTitle>
          {form}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={TAXONOMY_TITLE}
          data-testid="taxonomy-open"
        >
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" onEscapeKeyDown={onEscapeKeyDown}>
        {form}
      </PopoverContent>
    </Popover>
  );
}
