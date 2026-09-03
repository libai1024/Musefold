'use client';

import type { GenerationJob } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { FadeImage } from '@musefold/ui/components/fade-image';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Switch } from '@musefold/ui/components/switch';
import { Textarea } from '@musefold/ui/components/textarea';
import { Check, History } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useMemo, useState } from 'react';
import { useSchemeHistorySources } from './hooks';
import { SchemeInlineError } from './SchemeListPrimitives';
import type { SchemeHistorySourceSelection } from './types';

/** 默认提取说明(承旧 §10.2):保留视觉方向,排除具体主体。 */
export const HISTORY_EXTRACTION_NOTE = [
  '从这些内容创建一个可复用方案。',
  '',
  '保留视觉风格、构图方式、色彩与材质方向;',
  '不保留具体人物、品牌名称和原始文案。',
].join('\n');

/** 快捷建议(承旧):点击只更新可见说明文字,不在后台增加规则。 */
export const EXTRACTION_SUGGESTIONS = [
  '保留人物特征',
  '保留文案结构',
  '保留品牌元素',
  '保留生成参数',
  '只参考其中一张图',
];

/**
 * 「从历史内容创建」来源选择层(承旧 HistorySourcePicker):
 * 用户勾选具体历史作品与是否携带提示词,绝不默认读取整段历史;
 * 确认后把可见、可编辑的提取说明与选择交给创建管线(actions.onCreateFromHistory)。
 * 数据经 gateway.generation.list(succeeded, limit 60),四端同一份。
 */
export function HistorySourcePicker({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel(): void;
  onConfirm(selection: SchemeHistorySourceSelection): void;
}) {
  const sources = useSchemeHistorySources(open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includePrompts, setIncludePrompts] = useState(true);
  const [note, setNote] = useState(HISTORY_EXTRACTION_NOTE);

  const records = useMemo(() => sources.data ?? [], [sources.data]);
  const selectedRecords = useMemo(
    () => records.filter((record) => selected.has(record.id)),
    [records, selected],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function appendSuggestion(suggestion: string) {
    setNote((current) => {
      const line = `补充:${suggestion}。`;
      if (current.includes(line)) {
        return current.replace(`\n${line}`, '').replace(line, '').trimEnd();
      }
      return `${current.trimEnd()}\n${line}`;
    });
  }

  function confirm() {
    const items = selectedRecords.map((record: GenerationJob) => ({
      jobId: record.id,
      assetId: record.assets[0]?.id ?? '',
      assetUrl: record.assets[0]?.url ?? '',
      prompt: includePrompts ? (record.userPrompt ?? record.request.prompt) : null,
    }));
    onConfirm({ items, note });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="flex max-h-[min(640px,90dvh)] max-w-2xl flex-col overflow-hidden"
        data-testid="history-source-picker"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" aria-hidden />
            从历史内容创建
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            勾选要参考的历史作品与是否携带提示词；确认后提取说明会进入 Composer 正文，可继续编辑。
          </p>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {sources.isPending ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="aspect-square rounded-md" />
              ))}
            </div>
          ) : sources.isError ? (
            <SchemeInlineError
              title="读取历史记录失败"
              message={sources.error instanceof Error ? sources.error.message : null}
              onRetry={() => void sources.refetch()}
              testId="history-source-error"
            />
          ) : records.length === 0 ? (
            <p className="py-10 text-center text-[11px] text-muted-foreground">
              还没有可用的历史作品；先去工作台生成一些图片。
            </p>
          ) : (
            <div
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
              role="group"
              aria-label="选择历史作品"
            >
              {records.map((record) => {
                const asset = record.assets[0];
                const isSelected = selected.has(record.id);
                return (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => toggle(record.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      'group relative aspect-square overflow-hidden rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected ? 'border-primary/60' : 'border-border hover:border-primary/30',
                    )}
                    data-testid={`history-pick-${record.id}`}
                  >
                    {asset ? (
                      <FadeImage
                        src={asset.url}
                        alt={record.userPrompt ?? record.request.prompt}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                    <span
                      className={cn(
                        'absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background/80 text-transparent group-hover:border-primary/40',
                      )}
                      aria-hidden
                    >
                      <Check className="size-3" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            <Switch
              checked={includePrompts}
              onCheckedChange={setIncludePrompts}
              data-testid="history-include-prompts"
            />
            携带这些作品的提示词
          </label>

          <div>
            <p className="mb-1.5 font-medium text-foreground text-xs">提取说明</p>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="text-xs leading-5"
              data-testid="history-extraction-note"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXTRACTION_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => appendSuggestion(suggestion)}
                  className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  data-testid={`history-suggestion-${suggestion}`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-[11px] text-muted-foreground" data-testid="history-selected-count">
            已选择 {selected.size} 张作品
          </span>
          <span className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0}
              title={selected.size === 0 ? '先选择至少一张历史作品' : undefined}
              onClick={confirm}
              data-testid="history-source-confirm"
            >
              使用所选内容
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
