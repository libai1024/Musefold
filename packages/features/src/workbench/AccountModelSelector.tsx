import { Button } from '@musefold/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { RefreshCw } from '@musefold/ui/icons';
import { modelPriceLabel, modelUnavailableReason } from './account-model-choice';
import type { AccountModelChoice } from './use-account-model-choice';

/**
 * 云端账号模型选择(2026-09 走查美化):
 * - 内联在 Composer 动作行、发送钮左侧,不再独占一行、不再外推工作台 inset;
 * - 目录只列可选模型(不可用项不渲染;当前值失效时 reason 状态仍可读);
 * - 展开面板与共享 Select/Popover 视觉同步(p-1.5 圆角行 + 名称/单价双行);
 * - 单价与状态改 sr-only aria-live + 触发钮 title 提示,不占版面。
 */
export function AccountModelSelector({
  choice,
  disabled = false,
}: {
  choice: AccountModelChoice;
  disabled?: boolean;
}) {
  if (!choice.enabled) return null;
  const available = (choice.catalog?.models ?? []).filter(
    (entry) => !modelUnavailableReason(entry),
  );
  const status =
    choice.reason ??
    (choice.selected &&
      `云端单价：${modelPriceLabel(choice.selected.pricing)}；已含账号倍率，实际费用以云端结算为准。`);
  const titleText = [status, choice.persistenceWarning].filter(Boolean).join('；');

  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="composer-account-model">
      <Select
        value={choice.model}
        onValueChange={choice.selectModel}
        disabled={disabled || !choice.catalog}
      >
        <SelectTrigger
          aria-label="账号模型"
          data-testid="composer-model"
          title={titleText || '账号模型'}
          size="sm"
          className="min-h-11 min-w-0 max-w-40 gap-1.5 rounded-[7px] border-border/55 bg-card/50 px-2.5 font-mono text-xs md:h-8 md:min-h-8 md:max-w-52"
        >
          <SelectValue placeholder="选择云端模型">
            <span className="truncate">{choice.model || '云端模型'}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="max-w-[calc(100vw-32px)] p-1.5">
          {available.length === 0 ? (
            <p
              className="px-2 py-3 text-center text-muted-foreground text-xs"
              data-testid="composer-model-empty"
            >
              暂无可用云端模型
            </p>
          ) : (
            available.map((entry) => (
              <SelectItem
                key={entry.model}
                value={entry.model}
                className="min-h-11 rounded-md whitespace-normal break-all md:min-h-9"
                textValue={entry.model}
              >
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="font-mono">{entry.model}</span>
                  <span className="font-sans text-muted-foreground text-xs">
                    {modelPriceLabel(entry.pricing)}
                  </span>
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground md:size-8"
        aria-label="刷新云端模型与价格"
        title="刷新云端模型与价格"
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
      <span data-testid="composer-model-price" role="status" aria-live="polite" className="sr-only">
        {titleText}
      </span>
    </div>
  );
}
