'use client';

import type {
  NewPromptDocument,
  PromptDocument,
  PromptFolder,
  PromptTag,
} from '@musefold/contracts';
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
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Input } from '@musefold/ui/components/input';
import { Label } from '@musefold/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Switch } from '@musefold/ui/components/switch';
import { Textarea } from '@musefold/ui/components/textarea';
import { cn } from '@musefold/ui/lib/utils';
import { useEffect, useState } from 'react';

/** 「未整理」在 Select 里的哨兵值(Select 不接受空串 item)。 */
const NO_FOLDER = '__none__';

export interface PromptEditorValue {
  title: string;
  content: string;
  negative: string;
  description: string;
  folderId: string | null;
  tagIds: string[];
  rating: number;
  isPinned: boolean;
}

export interface PromptEditorDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** null = 新建;有值 = 编辑该文档。 */
  prompt: PromptDocument | null;
  folders: PromptFolder[];
  tags: PromptTag[];
  submitting: boolean;
  onSubmit(value: PromptEditorValue): void;
}

function toEditorValue(prompt: PromptDocument | null): PromptEditorValue {
  return {
    title: prompt?.title ?? '',
    content: prompt?.content ?? '',
    negative: prompt?.negative ?? '',
    description: prompt?.description ?? '',
    folderId: prompt?.folderId ?? null,
    tagIds: prompt?.tags.map((tag) => tag.id) ?? [],
    rating: prompt?.rating ?? 0,
    isPinned: prompt?.isPinned ?? false,
  };
}

/** dirty 判定:逐字段浅比较;tagIds 按集合比较(勾选顺序不算修改)。 */
function editorValuesEqual(a: PromptEditorValue, b: PromptEditorValue): boolean {
  if (
    a.title !== b.title ||
    a.content !== b.content ||
    a.negative !== b.negative ||
    a.description !== b.description ||
    a.folderId !== b.folderId ||
    a.rating !== b.rating ||
    a.isPinned !== b.isPinned ||
    a.tagIds.length !== b.tagIds.length
  ) {
    return false;
  }
  const sortedA = [...a.tagIds].sort();
  const sortedB = [...b.tagIds].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

export function editorValueToNewDocument(value: PromptEditorValue): NewPromptDocument {
  return {
    title: value.title.trim(),
    description: value.description.trim() ? value.description.trim() : null,
    content: value.content.trim(),
    negative: value.negative.trim() ? value.negative.trim() : null,
    folderId: value.folderId,
    tagIds: value.tagIds,
    modelId: null,
    params: null,
    rating: value.rating,
    isPinned: value.isPinned,
    source: 'manual',
    sourceUrl: null,
  };
}

/** 新建/编辑共用表单;提交语义由宿主屏幕决定(create 或 update+expectedVersion)。 */
export function PromptEditorDialog({
  open,
  onOpenChange,
  prompt,
  folders,
  tags,
  submitting,
  onSubmit,
}: PromptEditorDialogProps) {
  const [value, setValue] = useState<PromptEditorValue>(() => toEditorValue(prompt));
  const [initialValue, setInitialValue] = useState<PromptEditorValue>(() => toEditorValue(prompt));
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setDiscardConfirmOpen(false);
      return;
    }

    // 打开时快照初始值,dirty 全程对照这份快照。
    const snapshot = toEditorValue(prompt);
    setValue(snapshot);
    setInitialValue(snapshot);
    setDiscardConfirmOpen(false);
  }, [open, prompt]);

  const dirty = !editorValuesEqual(value, initialValue);
  const canSubmit = value.title.trim().length > 0 && value.content.trim().length > 0 && !submitting;

  /** 所有关闭意图(取消按钮 / Escape / 外点 / X)统一走这里:clean 直接关,dirty 弹确认层。 */
  function requestClose() {
    if (!dirty) {
      onOpenChange(false);
      return;
    }
    setDiscardConfirmOpen(true);
  }

  function toggleTag(id: string) {
    setValue((prev) => ({
      ...prev,
      tagIds: prev.tagIds.includes(id)
        ? prev.tagIds.filter((tagId) => tagId !== id)
        : [...prev.tagIds, id],
    }));
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // 关闭路径(X 按钮等)统一汇入 guarded close。
          if (next) {
            onOpenChange(true);
          } else {
            requestClose();
          }
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
          data-testid="prompt-editor"
          onEscapeKeyDown={(event) => {
            // 接管 Radix 默认关闭,避免 Escape 绕过 dirty guard。
            event.preventDefault();
            requestClose();
          }}
          onPointerDownOutside={(event) => {
            // 同上:外点也必须走 guarded close。
            event.preventDefault();
            requestClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{prompt ? '编辑提示词' : '新建提示词'}</DialogTitle>
            <DialogDescription>
              {prompt ? '修改后保存,变更会同步到所有设备' : '保存到提示词库,随时复用'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt-title">标题</Label>
              <Input
                id="prompt-title"
                data-testid="prompt-editor-title"
                value={value.title}
                maxLength={80}
                placeholder="给这条提示词起个名字"
                onChange={(event) => setValue((prev) => ({ ...prev, title: event.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt-content">提示词内容</Label>
              <Textarea
                id="prompt-content"
                data-testid="prompt-editor-content"
                value={value.content}
                rows={5}
                placeholder="正向提示词"
                onChange={(event) => setValue((prev) => ({ ...prev, content: event.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt-negative">负向提示词(可选)</Label>
              <Textarea
                id="prompt-negative"
                data-testid="prompt-editor-negative"
                value={value.negative}
                rows={2}
                placeholder="不希望出现的内容"
                onChange={(event) =>
                  setValue((prev) => ({ ...prev, negative: event.target.value }))
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prompt-description">备注(可选)</Label>
              <Input
                id="prompt-description"
                data-testid="prompt-editor-description"
                value={value.description}
                maxLength={500}
                placeholder="适用场景、注意事项…"
                onChange={(event) =>
                  setValue((prev) => ({ ...prev, description: event.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prompt-folder">文件夹</Label>
                <Select
                  value={value.folderId ?? NO_FOLDER}
                  onValueChange={(selected) =>
                    setValue((prev) => ({
                      ...prev,
                      folderId: selected === NO_FOLDER ? null : selected,
                    }))
                  }
                >
                  <SelectTrigger id="prompt-folder" data-testid="prompt-editor-folder">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FOLDER}>未整理</SelectItem>
                    {folders.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prompt-rating">评分</Label>
                <Select
                  value={String(value.rating)}
                  onValueChange={(selected) =>
                    setValue((prev) => ({ ...prev, rating: Number(selected) }))
                  }
                >
                  <SelectTrigger id="prompt-rating" data-testid="prompt-editor-rating">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4, 5].map((rating) => (
                      <SelectItem key={rating} value={String(rating)}>
                        {rating === 0 ? '未评分' : `${rating} 星`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>标签</Label>
                <div className="flex flex-wrap gap-1.5" data-testid="prompt-editor-tags">
                  {tags.map((tag) => {
                    const selected = value.tagIds.includes(tag.id);
                    return (
                      <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)}>
                        <Badge
                          variant={selected ? 'default' : 'outline'}
                          className={cn('cursor-pointer', !selected && 'text-muted-foreground')}
                        >
                          {tag.name}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <Label htmlFor="prompt-pinned">置顶到列表最前</Label>
              <Switch
                id="prompt-pinned"
                data-testid="prompt-editor-pinned"
                checked={value.isPinned}
                onCheckedChange={(checked) => setValue((prev) => ({ ...prev, isPinned: checked }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" data-testid="prompt-editor-cancel" onClick={requestClose}>
              取消
            </Button>
            <Button
              data-testid="prompt-editor-submit"
              disabled={!canSubmit}
              onClick={() => onSubmit(value)}
            >
              {submitting ? '保存中…' : prompt ? '保存修改' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent className="max-w-sm" data-testid="prompt-editor-discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改?</AlertDialogTitle>
            <AlertDialogDescription>当前编辑内容尚未保存,关闭后修改将丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="prompt-editor-continue">继续编辑</AlertDialogCancel>
            <AlertDialogAction
              data-testid="prompt-editor-discard"
              variant="destructive"
              onClick={() => onOpenChange(false)}
            >
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
