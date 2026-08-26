/**
 * 真实方案附件（v0.3.2 运行切片）的 Composer 展示：
 * 方案芯片（试运行态带 Ember 状态点）+ 附件浮层 + 具名图片槽位 + 文本变量字段
 * + 方案选择器（UI 规范 §6/§7）。
 */
import { useEffect, useState } from 'react';
import { Blocks, ImagePlus, Plus, X } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../stores/app';
import { useGenerationWorkbenchStore } from '@renderer/runtime/workbench-access';
import type { GenerationSource } from '@musefold/desktop-contracts/generation-source';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@musefold/ui';

type SchemeDraftSource = Extract<GenerationSource, { kind: 'scheme' }>;

const FIDELITY_LABEL: Record<string, string> = {
  verified: '已验证',
  faithful: '完整还原',
  adapted: '有取舍',
  unsupported: '暂不支持',
};

/** 方案附件浮层（UI 规范 §6.1）：摘要、来源、输入要求、查看详情、更换和移除。 */
function SchemeAttachmentPopover({
  source,
  onClose,
  onSwap,
  onClear,
}: {
  source: SchemeDraftSource;
  onClose: () => void;
  onSwap: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-background">
          <Blocks className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-primary">{source.label}</p>
          <p className="mt-0.5 text-meta text-tertiary">
            {source.sourceLabel} · {FIDELITY_LABEL[source.fidelity] ?? source.fidelity}
            {source.mode === 'trial' ? ' · 试运行' : source.mode === 'modify' ? ' · 修改中' : ''}
          </p>
        </div>
      </div>
      {source.summary && (
        <p className="mt-2.5 text-meta leading-5 text-secondary">{source.summary}</p>
      )}
      {source.inputs.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2.5">
          <p className="text-meta font-medium text-secondary">需要提供</p>
          <ul className="mt-1.5 space-y-1">
            {source.inputs.map((slot) => (
              <li key={slot.id} className="flex items-center gap-2 text-meta text-primary">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    slot.required ? 'bg-accent' : 'bg-border-default',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 truncate">{slot.label}</span>
                <span className="ml-auto shrink-0 text-meta text-tertiary">
                  {slot.kind === 'image' || slot.kind === 'image-set' ? '图片' : '文本'}
                  {slot.required ? ' · 必需' : ' · 可选'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 border-t border-border-subtle pt-2.5">
        <button
          type="button"
          onClick={() => {
            onClose();
            useAppStore.getState().requestSchemeCenter({ detailId: source.schemeId });
          }}
          className="min-h-7 rounded-md px-2 text-meta font-medium text-secondary hover:bg-hover hover:text-primary"
          data-testid="scheme-attachment-detail"
        >
          查看详情
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            onSwap();
          }}
          className="min-h-7 rounded-md px-2 text-meta font-medium text-secondary hover:bg-hover hover:text-primary"
          data-testid="scheme-attachment-swap"
        >
          更换
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            onClear();
          }}
          className="ml-auto min-h-7 rounded-md px-2 text-meta font-medium text-danger hover:bg-danger/10"
          data-testid="scheme-attachment-remove"
        >
          移除
        </button>
      </div>
    </>
  );
}

export function SchemeRunAttachment({
  source,
  imageCount,
  onClear,
  onPickImage,
  onSwap,
}: {
  source: SchemeDraftSource;
  imageCount: number;
  onClear: () => void;
  onPickImage: () => void;
  /** 打开方案选择器更换主方案（§6.1）。 */
  onSwap: () => void;
}) {
  const trial = source.mode === 'trial';
  const modify = source.mode === 'modify';
  const [popoverOpen, setPopoverOpen] = useState(false);
  // 修改模式不显示运行输入（规范 §8.3）。
  const imageSlots = modify
    ? []
    : source.inputs.filter((slot) => slot.kind === 'image' || slot.kind === 'image-set');
  let assignedImages = 0;

  return (
    <div data-testid="scheme-run-attachment" data-mode={source.mode}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <div className="relative">
            <div
              className={cn(
                'flex h-12 min-w-[240px] max-w-full items-center gap-2.5 rounded-lg border bg-popover px-2.5',
                trial || modify ? 'border-accent/35' : 'border-border-default',
              )}
              data-testid="scheme-run-chip"
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  aria-haspopup="dialog"
                  title="查看方案附件详情"
                  data-testid="scheme-run-chip-body"
                >
                  <span
                    className={cn(
                      'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      trial || modify ? 'bg-accent-soft text-accent' : 'bg-primary text-background',
                    )}
                  >
                    <Blocks className="h-3.5 w-3.5" />
                    {trial && (
                      <span
                        className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-accent"
                        aria-hidden
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block max-w-[220px] truncate text-meta font-medium text-primary">
                      {trial
                        ? `试运行 · ${source.label}`
                        : modify
                          ? `修改方案 · ${source.label}`
                          : source.label}
                    </span>
                    <span className="mt-0.5 block max-w-[220px] truncate text-meta text-tertiary">
                      {source.sourceLabel} · {FIDELITY_LABEL[source.fidelity] ?? source.fidelity}
                    </span>
                  </span>
                </button>
              </PopoverTrigger>
              <button
                type="button"
                onClick={onClear}
                className="icon-action h-7 w-7 shrink-0"
                aria-label="移除方案"
                title="移除方案"
                data-testid="scheme-run-chip-remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <PopoverContent
              portal={false}
              className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-[300px] p-3.5 animate-scale-fade-in"
              role="dialog"
              aria-label="方案附件详情"
              data-testid="scheme-attachment-popover"
            >
              <SchemeAttachmentPopover
                source={source}
                onClose={() => setPopoverOpen(false)}
                onSwap={onSwap}
                onClear={onClear}
              />
            </PopoverContent>
          </div>
        </Popover>
        {imageSlots.map((slot) => {
          const need = Math.max(1, slot.minItems ?? 1);
          const filled = imageCount >= assignedImages + (slot.required ? need : 1);
          if (slot.required) assignedImages += need;
          return (
            <button
              key={slot.id}
              type="button"
              onClick={onPickImage}
              className={cn(
                'flex h-12 min-w-[94px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-meta font-medium',
                filled
                  ? 'border-border-default bg-inset/55 text-secondary'
                  : slot.required
                    ? 'border-dashed border-accent/45 bg-accent-soft text-accent'
                    : 'border-dashed border-border-default text-tertiary',
              )}
              data-testid={`scheme-run-image-slot-${slot.id}`}
              data-filled={filled}
              title={slot.description ?? slot.label}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {slot.label}
              {slot.required ? ' · 必需' : ''}
            </button>
          );
        })}
      </div>
      <p className="mt-1 px-1 text-meta text-tertiary" data-testid="scheme-run-mode-hint">
        {modify
          ? '描述要修改的内容，Agent 会更新方案；修改后需要重新试运行验证。'
          : trial
            ? '本次输入只用于验证方案，不会修改方案本身。'
            : '方案决定稳定的视觉方向，本次输入只影响这一次生成。'}
      </p>
    </div>
  );
}

/**
 * 方案声明的文本输入（@变量）；值存在工作台 store，提交时随运行请求发往主进程。
 * 必填变量自动出现；可选变量默认隐藏，通过 + 添加（UI 规范 §7.1）。
 */
export function SchemeRunVariableFields() {
  const source = useGenerationWorkbenchStore((state) => state.draftSource);
  const values = useGenerationWorkbenchStore((state) => state.schemeInputValues);
  const setValue = useGenerationWorkbenchStore((state) => state.setSchemeInputValue);
  /** 用户显式添加的可选变量 id；换方案（revision）时重置。 */
  const [added, setAdded] = useState<string[]>([]);
  const revisionId = source.kind === 'scheme' ? source.revisionId : null;

  useEffect(() => {
    setAdded([]);
  }, [revisionId]);

  if (source.kind !== 'scheme' || source.mode === 'modify') return null;
  const textSlots = source.inputs.filter(
    (slot) => slot.kind === 'text' || slot.kind === 'article' || slot.kind === 'choice',
  );
  if (textSlots.length === 0) return null;

  const visibleSlots = textSlots.filter(
    (slot) => slot.required || added.includes(slot.id) || Boolean(values[slot.id]?.trim()),
  );
  const hiddenOptional = textSlots.filter((slot) => !visibleSlots.includes(slot));

  const removeOptional = (slotId: string) => {
    setValue(slotId, '');
    setAdded((prev) => prev.filter((id) => id !== slotId));
  };

  return (
    <div
      className="mb-1.5 border-b border-border-subtle px-1 pb-2"
      data-testid="scheme-run-variable-fields"
    >
      <div className="grid gap-1.5 sm:grid-cols-2">
        {visibleSlots.map((slot) => (
          <label
            key={slot.id}
            className="flex min-h-8 min-w-0 items-center gap-2 rounded-md bg-inset/55 px-2.5 focus-within:ring-1 focus-within:ring-accent/35"
          >
            <span className="shrink-0 text-meta font-medium text-accent">@{slot.label}</span>
            <input
              value={values[slot.id] ?? ''}
              onChange={(event) => setValue(slot.id, event.target.value)}
              placeholder={slot.description ?? (slot.required ? '必填' : '可选')}
              className="min-w-0 flex-1 bg-transparent text-meta text-primary outline-none placeholder:text-quaternary"
              autoFocus={!slot.required && added.includes(slot.id)}
              data-testid={`scheme-run-variable-${slot.id}`}
            />
            {slot.required && !values[slot.id]?.trim() && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                title="必需"
                aria-label="必填项未填写"
              />
            )}
            {!slot.required && (
              <button
                type="button"
                onClick={() => removeOptional(slot.id)}
                className="icon-action h-5 w-5 shrink-0"
                aria-label={`移除${slot.label}`}
                title="移除这个可选变量"
                data-testid={`scheme-run-variable-remove-${slot.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        ))}
      </div>
      {hiddenOptional.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex min-h-7 items-center gap-1 rounded-md border border-dashed border-border-default px-2 text-meta font-medium text-tertiary hover:border-border-default hover:bg-hover hover:text-primary"
              data-testid="scheme-run-add-variable"
            >
              <Plus className="h-3 w-3" />
              变量
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={6}
            className="w-[220px]"
            aria-label="添加可选变量"
            data-testid="scheme-run-add-variable-menu"
          >
            {hiddenOptional.map((slot) => (
              <DropdownMenuItem
                key={slot.id}
                onSelect={() => setAdded((prev) => [...prev, slot.id])}
                data-testid={`scheme-run-add-variable-${slot.id}`}
              >
                <span className="truncate text-meta font-medium text-accent">@{slot.label}</span>
                {slot.description && (
                  <span className="min-w-0 truncate text-meta text-tertiary">
                    {slot.description}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
