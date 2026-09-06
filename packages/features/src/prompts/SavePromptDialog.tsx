'use client';

import type { GenerationJob } from '@musefold/contracts';
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
import { toast } from '@musefold/ui/components/sonner';
import { useState } from 'react';
import { useScreenIntent } from '../shell/screen-intent-store';
import { useCreatePrompt } from './hooks';

/** 存为提示词的取材(工作台结果卡与历史检视共用同一条链路,ui-parity 03/05 §7 P1)。 */
export interface SavePromptSource {
  content: string;
  negative: string | null;
  modelId: string | null;
  params: Record<string, unknown> | null;
  /** 本次首张成功图,写成新条目的封面(ui-parity 04 §8-1);无成图则为 null。 */
  coverImageUrl: string | null;
}

/** 从生成回合收编取材:参数只带契约认可的比例/质量,缺省不落键。 */
export function jobToSavePromptSource(job: GenerationJob): SavePromptSource {
  const params = {
    ...(job.request.aspectRatio ? { aspectRatio: job.request.aspectRatio } : {}),
    ...(job.request.quality && job.request.quality !== 'auto'
      ? { quality: job.request.quality }
      : {}),
  };
  return {
    content: job.request.prompt,
    negative: job.request.negative ?? null,
    modelId: job.providerModel,
    params: Object.keys(params).length > 0 ? params : null,
    // 封面是展示地址(桌面 media:// 受管 URL / 云端对象存储 URL),绝不是本地绝对路径。
    coverImageUrl: job.assets[0]?.url ?? null,
  };
}

export interface SavePromptDialogProps {
  /** null = 关闭;有值 = 以该取材打开。 */
  source: SavePromptSource | null;
  onOpenChange(open: boolean): void;
  /** 宿主切屏到提示词库(成功 toast「查看」用);未注入时 toast 无动作钮。 */
  onOpenPrompts?(): void;
}

/**
 * 「存为提示词」Dialog(承旧 HistoryDetail 存为提示词,ui-parity 05 §3):
 * 标题留空取内容前 20 字;预览正文/反向词;成功 toast 带「查看」跳库高亮新条目。
 */
export function SavePromptDialog({ source, onOpenChange, onOpenPrompts }: SavePromptDialogProps) {
  const [title, setTitle] = useState('');
  const createPrompt = useCreatePrompt();
  const setIntent = useScreenIntent((s) => s.setIntent);

  const fallbackTitle = source ? source.content.trim().slice(0, 20) : '';

  async function handleSave() {
    if (!source || createPrompt.isPending) return;
    try {
      const created = await createPrompt.mutateAsync({
        title: title.trim() || fallbackTitle,
        description: null,
        content: source.content,
        negative: source.negative,
        folderId: null,
        tagIds: [],
        modelId: source.modelId,
        params: source.params,
        rating: 0,
        isPinned: false,
        source: 'generation',
        sourceUrl: null,
        coverImageUrl: source.coverImageUrl,
      });
      onOpenChange(false);
      toast.success('已存为提示词', {
        action: onOpenPrompts
          ? {
              label: '查看',
              onClick: () => {
                setIntent({ kind: 'prompt-highlight', promptId: created.id });
                onOpenPrompts();
              },
            }
          : undefined,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  }

  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) setTitle('');
        onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-md" data-testid="save-prompt-dialog">
        <DialogHeader>
          <DialogTitle>存为提示词</DialogTitle>
          <DialogDescription>保存到提示词库,之后可一键送回工作台复用。</DialogDescription>
        </DialogHeader>
        {source && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" htmlFor="save-prompt-title">
                标题
              </Label>
              <Input
                id="save-prompt-title"
                value={title}
                placeholder={fallbackTitle}
                maxLength={80}
                autoFocus
                data-testid="save-prompt-title"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void handleSave();
                  }
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-medium text-muted-foreground text-xs">提示词</p>
              <p
                className="line-clamp-4 whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2.5 py-2 text-foreground text-xs"
                data-testid="save-prompt-preview"
              >
                {source.content}
              </p>
            </div>
            {source.negative && (
              <div className="flex flex-col gap-1">
                <p className="font-medium text-muted-foreground text-xs">反向提示词</p>
                <p className="line-clamp-2 whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2.5 py-2 text-muted-foreground text-xs">
                  {source.negative}
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={createPrompt.isPending}
            onClick={() => void handleSave()}
            data-testid="save-prompt-confirm"
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
