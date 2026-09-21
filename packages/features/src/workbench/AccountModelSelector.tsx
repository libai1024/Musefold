import { Button } from '@musefold/ui/components/button';
import { Label } from '@musefold/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { RefreshCw } from '@musefold/ui/icons';
import { useEffect, useId, useRef } from 'react';
import { modelPriceLabel, modelUnavailableReason } from './account-model-choice';
import type { AccountModelChoice } from './use-account-model-choice';

export function AccountModelSelector({
  choice,
  disabled = false,
  onHeightChange,
}: {
  choice: AccountModelChoice;
  disabled?: boolean;
  onHeightChange?(height: number): void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!choice.enabled) return;
    const element = root.current;
    if (!element || !onHeightChange) return;
    const measure = () => onHeightChange(Math.ceil(element.getBoundingClientRect().height));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      onHeightChange(0);
    };
  }, [choice.enabled, onHeightChange]);
  if (!choice.enabled) return null;
  return (
    <div ref={root} className="min-w-0 space-y-1 px-1.5 pb-2" data-testid="composer-account-model">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Label htmlFor={id} className="shrink-0 text-muted-foreground text-xs">
          账号模型
        </Label>
        <Select
          value={choice.model}
          onValueChange={choice.selectModel}
          disabled={disabled || !choice.catalog}
        >
          <SelectTrigger
            id={id}
            aria-describedby={`${id}-price`}
            data-testid="composer-model"
            className="min-h-11 min-w-0 max-w-full flex-1 md:min-h-8 md:max-w-80"
            size="sm"
          >
            <SelectValue placeholder="选择云端模型">{choice.model || '选择云端模型'}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="max-w-[calc(100vw-32px)]">
            {choice.catalog?.models.map((entry) => (
              <SelectItem
                key={entry.model}
                value={entry.model}
                disabled={Boolean(modelUnavailableReason(entry))}
                className="min-h-11 whitespace-normal break-all md:min-h-8"
                textValue={entry.model}
              >
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span>{entry.model}</span>
                  <span className="text-muted-foreground text-xs">
                    {modelUnavailableReason(entry) ?? modelPriceLabel(entry.pricing)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 md:size-8"
          aria-label="刷新云端模型与价格"
          disabled={disabled || choice.loading}
          onClick={() => void choice.refresh()}
        >
          <RefreshCw
            aria-hidden="true"
            className={
              choice.loading ? 'size-3.5 animate-spin motion-reduce:animate-none' : 'size-3.5'
            }
          />
        </Button>
      </div>
      <div
        id={`${id}-price`}
        role="status"
        aria-live="polite"
        className="break-words text-muted-foreground text-xs"
        data-testid="composer-model-price"
      >
        {choice.reason ??
          (choice.selected &&
            `云端单价：${modelPriceLabel(choice.selected.pricing)}；已含账号倍率，实际费用以云端结算为准。`)}
      </div>
      {choice.persistenceWarning && (
        <p role="status" className="text-muted-foreground text-xs">
          {choice.persistenceWarning}
        </p>
      )}
    </div>
  );
}
