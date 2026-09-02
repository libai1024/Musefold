'use client';

import { Button } from '@musefold/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@musefold/ui/components/popover';
import { Blocks, ImagePlus, Plus, X } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useState } from 'react';
import type { SchemeComposerAttachment } from '../design-schemes/integration-store';
import { FIDELITY_LABEL } from '../design-schemes/scheme-labels';

/** 模式副标题(承旧 SchemeAttachmentPopover):试运行/修改在来源行追加徽记。 */
function modeBadge(mode: SchemeComposerAttachment['mode']): string {
  return mode === 'trial' ? ' · 试运行' : mode === 'modify' ? ' · 修改中' : '';
}

/** 模式说明行(逐字承旧 scheme-run-mode-hint)。 */
function modeHint(mode: SchemeComposerAttachment['mode']): string {
  if (mode === 'modify') return '描述要修改的内容，Agent 会更新方案；修改后需要重新试运行验证。';
  if (mode === 'trial') return '本次输入只用于验证方案，不会修改方案本身。';
  return '方案决定稳定的视觉方向，本次输入只影响这一次生成。';
}

/**
 * 方案附件块(承旧 SchemeRunAttachment + SchemeRunVariableFields,v2.5 紧凑密度):
 * 方案芯片(试运行/修改态带 Ember 脉冲点)+ 详情浮层(摘要/输入要求/查看详情/更换/移除)
 * + 具名图片槽位(点击走 Composer 参考图选择)+ 文本变量字段(必填常驻,可选经 + 添加)。
 * 修改模式不收集运行输入(规范 §8.3),只保留芯片与说明行。
 */
export function SchemeAttachmentBlock({
  attachment,
  inputValues,
  readyImageCount,
  onChangeInput,
  onClear,
  onSwap,
  onOpenDetail,
  onPickImages,
}: {
  attachment: SchemeComposerAttachment;
  inputValues: Record<string, string>;
  /** 就绪参考图总数:必需图片槽位按声明顺序依次占用(承旧 assignedImages)。 */
  readyImageCount: number;
  onChangeInput(slotId: string, value: string): void;
  onClear(): void;
  /** 「更换」:重新打开方案选择器。 */
  onSwap(): void;
  /** 「查看详情」:宿主切方案中心;缺省隐藏该钮(不出现死入口)。 */
  onOpenDetail?(): void;
  /** 图片槽位点击:复用 Composer 的参考图文件选择。 */
  onPickImages(): void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  /** 用户显式添加的可选变量 id;换方案(revision)时在渲染期重置(承旧,不经 effect)。 */
  const [addedOptional, setAddedOptional] = useState<string[]>([]);
  const [seenRevision, setSeenRevision] = useState(attachment.revisionId);
  if (seenRevision !== attachment.revisionId) {
    setSeenRevision(attachment.revisionId);
    setAddedOptional([]);
  }

  const trial = attachment.mode === 'trial';
  const modify = attachment.mode === 'modify';
  const imageSlots = modify
    ? []
    : attachment.inputs.filter((slot) => slot.kind === 'image' || slot.kind === 'image-set');
  const textSlots = modify
    ? []
    : attachment.inputs.filter(
        (slot) => slot.kind === 'text' || slot.kind === 'article' || slot.kind === 'choice',
      );
  const visibleTextSlots = textSlots.filter(
    (slot) =>
      slot.required || addedOptional.includes(slot.id) || Boolean(inputValues[slot.id]?.trim()),
  );
  const hiddenOptional = textSlots.filter((slot) => !visibleTextSlots.includes(slot));

  let assignedImages = 0;

  return (
    <div
      className="border-border/55 border-b px-1 pb-2"
      data-testid="scheme-run-attachment"
      data-mode={attachment.mode}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <div
            className={cn(
              'flex h-11 min-w-[220px] max-w-full items-center gap-2 rounded-lg border bg-card px-2',
              trial || modify ? 'border-primary/35' : 'border-border/55',
            )}
            data-testid="scheme-run-chip"
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-haspopup="dialog"
                title="查看方案附件详情"
                data-testid="scheme-run-chip-body"
              >
                <span
                  className={cn(
                    'relative flex size-7 shrink-0 items-center justify-center rounded-md',
                    trial || modify
                      ? 'bg-accent text-primary'
                      : 'bg-primary text-primary-foreground',
                  )}
                >
                  <Blocks className="size-3.5" aria-hidden />
                  {trial && (
                    <span
                      className="absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full bg-primary"
                      aria-hidden
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block max-w-56 truncate font-medium text-foreground text-xs">
                    {trial
                      ? `试运行 · ${attachment.name}`
                      : modify
                        ? `修改方案 · ${attachment.name}`
                        : attachment.name}
                  </span>
                  <span className="mt-0.5 block max-w-56 truncate text-[11px] text-muted-foreground">
                    {attachment.sourceLabel} ·{' '}
                    {FIDELITY_LABEL[attachment.fidelity] ?? attachment.fidelity}
                  </span>
                </span>
              </button>
            </PopoverTrigger>
            <button
              type="button"
              onClick={onClear}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/45"
              aria-label="移除方案"
              title="移除方案"
              data-testid="scheme-run-chip-remove"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <PopoverContent
            align="start"
            side="top"
            sideOffset={8}
            className="w-[300px] p-3.5"
            role="dialog"
            aria-label="方案附件详情"
            data-testid="scheme-attachment-popover"
          >
            <div className="flex items-start gap-2.5">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
                aria-hidden
              >
                <Blocks className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground text-xs">{attachment.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {attachment.sourceLabel} ·{' '}
                  {FIDELITY_LABEL[attachment.fidelity] ?? attachment.fidelity}
                  {modeBadge(attachment.mode)}
                </p>
              </div>
            </div>
            {attachment.summary ? (
              <p className="mt-2.5 text-[11px] text-muted-foreground leading-5">
                {attachment.summary}
              </p>
            ) : null}
            {attachment.inputs.length > 0 && (
              <div className="mt-3 border-border/55 border-t pt-2.5">
                <p className="font-medium text-[11px] text-muted-foreground">需要提供</p>
                <ul className="mt-1.5 space-y-1">
                  {attachment.inputs.map((slot) => (
                    <li key={slot.id} className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          slot.required ? 'bg-primary' : 'bg-border',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 truncate text-foreground">{slot.label}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {slot.kind === 'image' || slot.kind === 'image-set' ? '图片' : '文本'}
                        {slot.required ? ' · 必需' : ' · 可选'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 flex items-center gap-1.5 border-border/55 border-t pt-2.5">
              {onOpenDetail ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  data-testid="scheme-attachment-detail"
                  onClick={() => {
                    setPopoverOpen(false);
                    onOpenDetail();
                  }}
                >
                  查看详情
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                data-testid="scheme-attachment-swap"
                onClick={() => {
                  setPopoverOpen(false);
                  onSwap();
                }}
              >
                更换
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid="scheme-attachment-remove"
                onClick={() => {
                  setPopoverOpen(false);
                  onClear();
                }}
              >
                移除
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {imageSlots.map((slot) => {
          const need = Math.max(1, slot.minItems ?? 1);
          const filled = readyImageCount >= assignedImages + (slot.required ? need : 1);
          if (slot.required) assignedImages += need;
          return (
            <button
              key={slot.id}
              type="button"
              onClick={onPickImages}
              className={cn(
                'flex h-11 min-w-[94px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 font-medium text-[11px] transition-colors',
                filled
                  ? 'border-border/55 bg-muted/50 text-muted-foreground'
                  : slot.required
                    ? 'border-primary/45 border-dashed bg-accent text-primary'
                    : 'border-border/55 border-dashed text-muted-foreground',
              )}
              data-testid={`scheme-run-image-slot-${slot.id}`}
              data-filled={filled}
              title={slot.description ?? slot.label}
            >
              <ImagePlus className="size-3.5" aria-hidden />
              {slot.label}
              {slot.required ? ' · 必需' : ''}
            </button>
          );
        })}
      </div>

      {visibleTextSlots.length > 0 || hiddenOptional.length > 0 ? (
        <div className="mt-2" data-testid="scheme-run-variable-fields">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {visibleTextSlots.map((slot) => {
              const empty = !(inputValues[slot.id] ?? '').trim();
              return (
                <label
                  key={slot.id}
                  className="flex min-h-8 min-w-0 items-center gap-2 rounded-md bg-muted/50 px-2.5 focus-within:ring-1 focus-within:ring-ring/35"
                >
                  <span className="shrink-0 font-medium text-[11px] text-primary">
                    @{slot.label}
                  </span>
                  <input
                    value={inputValues[slot.id] ?? ''}
                    onChange={(event) => onChangeInput(slot.id, event.target.value)}
                    placeholder={slot.description ?? (slot.required ? '必填' : '可选')}
                    className="min-w-0 flex-1 bg-transparent text-foreground text-xs outline-none placeholder:text-muted-foreground/70"
                    data-testid={`scheme-run-variable-${slot.id}`}
                  />
                  {slot.required && empty && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                      title="必需"
                      aria-label="必填项未填写"
                    />
                  )}
                  {!slot.required && (
                    <button
                      type="button"
                      onClick={() => {
                        onChangeInput(slot.id, '');
                        setAddedOptional((prev) => prev.filter((id) => id !== slot.id));
                      }}
                      className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={`移除${slot.label}`}
                      title="移除这个可选变量"
                      data-testid={`scheme-run-variable-remove-${slot.id}`}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </label>
              );
            })}
          </div>
          {hiddenOptional.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="mt-1.5 flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  data-testid="scheme-run-variable-add"
                >
                  <Plus className="size-3" aria-hidden />
                  添加可选输入
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" aria-label="可选输入">
                {hiddenOptional.map((slot) => (
                  <DropdownMenuItem
                    key={slot.id}
                    onSelect={() => setAddedOptional((prev) => [...prev, slot.id])}
                    data-testid={`scheme-run-variable-add-${slot.id}`}
                  >
                    {slot.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      <p className="mt-1 px-1 text-[11px] text-muted-foreground" data-testid="scheme-run-mode-hint">
        {modeHint(attachment.mode)}
      </p>
    </div>
  );
}
