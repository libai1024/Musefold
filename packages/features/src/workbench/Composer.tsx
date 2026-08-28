'use client';

import type { GenerationQuality, ProviderOption, WorkbenchDraft } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { Label } from '@musefold/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@musefold/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Spinner } from '@musefold/ui/components/spinner';
import { Textarea } from '@musefold/ui/components/textarea';
import { ArrowUp, Proportions, Settings2 } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useState } from 'react';

/** 比例目录承旧 WorkbenchRatioPicker 预设;自定义比例暂缓(V25-UI-SPEC §9-D7)。 */
const RATIO_OPTIONS = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16'] as const;
export type ComposerRatio = (typeof RATIO_OPTIONS)[number];

const QUALITY_LABELS: Record<GenerationQuality, string> = {
  auto: '自动',
  low: '快速',
  medium: '标准',
  high: '精细',
};

export interface ComposerValue {
  prompt: string;
  negative: string;
  aspectRatio: ComposerRatio;
  quality: GenerationQuality;
  providerId: string | null;
}

function toComposerRatio(value: string | undefined): ComposerRatio {
  return (RATIO_OPTIONS as readonly string[]).includes(value ?? '')
    ? (value as ComposerRatio)
    : 'auto';
}

export function draftToComposerValue(draft: WorkbenchDraft): ComposerValue {
  return {
    prompt: draft.prompt,
    negative: draft.negative,
    aspectRatio: toComposerRatio(draft.params.aspectRatio),
    quality: draft.params.quality ?? 'auto',
    providerId: null,
  };
}

export function composerValueToDraft(value: ComposerValue): WorkbenchDraft {
  return {
    prompt: value.prompt,
    negative: value.negative,
    params: {
      ...(value.aspectRatio !== 'auto' ? { aspectRatio: value.aspectRatio } : {}),
      ...(value.quality !== 'auto' ? { quality: value.quality } : {}),
    },
    promptReferenceIds: [],
  };
}

export interface ComposerProps {
  value: ComposerValue;
  providers: readonly ProviderOption[];
  submitting: boolean;
  disabled?: boolean;
  onChange(value: ComposerValue): void;
  onSubmit(): void;
}

/**
 * 生成输入区(V25-UI-SPEC §3.2):
 * 提示词 + 工具条(比例 Popover / 设置 Popover(质量+反向词)/ Provider)+ 提交。
 */
export function Composer({
  value,
  providers,
  submitting,
  disabled = false,
  onChange,
  onSubmit,
}: ComposerProps) {
  const [ratioOpen, setRatioOpen] = useState(false);
  const canSubmit = !disabled && !submitting && value.prompt.trim().length > 0;
  const settingsActive = value.quality !== 'auto' || value.negative.trim().length > 0;

  return (
    <div className="border-border border-t bg-background p-3" data-testid="composer">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-xs">
        <Textarea
          value={value.prompt}
          placeholder="描述你想生成的画面…(Enter 发送,Shift+Enter 换行)"
          rows={2}
          data-testid="composer-prompt"
          className="max-h-48 min-h-16 resize-none border-0 p-0 shadow-none focus-visible:ring-0"
          onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <Popover open={ratioOpen} onOpenChange={setRatioOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 gap-1 px-2 text-xs',
                  value.aspectRatio !== 'auto' ? 'text-foreground' : 'text-muted-foreground',
                )}
                data-testid="composer-ratio"
              >
                <Proportions className="size-3.5" />
                {value.aspectRatio === 'auto' ? '比例' : value.aspectRatio}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-1.5">
              <div className="flex gap-1" role="radiogroup" aria-label="画面比例">
                {RATIO_OPTIONS.map((ratio) => (
                  <Button
                    key={ratio}
                    variant={value.aspectRatio === ratio ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    role="radio"
                    aria-checked={value.aspectRatio === ratio}
                    data-testid={`composer-ratio-${ratio.replace(':', 'x')}`}
                    onClick={() => {
                      onChange({ ...value, aspectRatio: ratio });
                      setRatioOpen(false);
                    }}
                  >
                    {ratio === 'auto' ? '自动' : ratio}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 gap-1 px-2 text-xs',
                  settingsActive ? 'text-foreground' : 'text-muted-foreground',
                )}
                data-testid="composer-settings"
              >
                <Settings2 className="size-3.5" />
                设置
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="flex w-72 flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs" htmlFor="composer-quality">
                  质量
                </Label>
                <Select
                  value={value.quality}
                  onValueChange={(next) =>
                    onChange({ ...value, quality: next as GenerationQuality })
                  }
                >
                  <SelectTrigger
                    id="composer-quality"
                    size="sm"
                    className="h-7 w-28 text-xs"
                    data-testid="composer-quality"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(QUALITY_LABELS) as GenerationQuality[]).map((quality) => (
                      <SelectItem key={quality} value={quality}>
                        {QUALITY_LABELS[quality]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs" htmlFor="composer-negative">
                  反向提示词
                </Label>
                <Textarea
                  id="composer-negative"
                  value={value.negative}
                  placeholder="不希望出现的内容"
                  rows={2}
                  data-testid="composer-negative"
                  className="max-h-24 min-h-14 resize-none text-sm"
                  onChange={(event) => onChange({ ...value, negative: event.target.value })}
                />
              </div>
            </PopoverContent>
          </Popover>

          {providers.length > 0 && (
            <Select
              value={value.providerId ?? providers[0]?.id}
              onValueChange={(next) => onChange({ ...value, providerId: next })}
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-auto max-w-44 gap-1 text-xs"
                data-testid="composer-provider"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id} disabled={!provider.available}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            size="icon"
            className="ml-auto size-8 rounded-full"
            disabled={!canSubmit}
            onClick={onSubmit}
            aria-label="生成"
            data-testid="composer-submit"
          >
            {submitting ? <Spinner className="size-4" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
