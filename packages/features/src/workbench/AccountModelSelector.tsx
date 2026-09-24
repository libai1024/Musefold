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
 * 云端账号模型选择(2026-09 极简化,承 Codex/ZCode 模型切换钮语法):
 * - 触发钮为安静的无边框 pill:静息只显模型名(等宽小字 + 微箭头),hover 才浮出
 *   可点暗示;单价/状态走 title 提示与 sr-only aria-live,不占版面;
 * - 刷新是 pill 紧邻的极小图标钮(视觉同一簇),常驻可用——目录读取失败时它是
 *   唯一恢复路径,不能藏进会随目录状态变化的菜单里;
 * - 目录只列可选模型(不可用项不渲染;当前值失效时 reason 状态仍可读)。
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
    <div className="flex min-w-0 items-center gap-0.5" data-testid="composer-account-model">
      <Select
        value={choice.model}
        onValueChange={choice.selectModel}
        // 目录缺失(读取失败)不禁用触发钮:恢复路径必须始终可达。
        disabled={disabled}
      >
        <SelectTrigger
          aria-label="账号模型"
          data-testid="composer-model"
          title={titleText || '账号模型'}
          size="sm"
          className="min-h-11 min-w-0 max-w-44 gap-1 rounded-[7px] border-transparent bg-transparent px-2 font-mono text-xs text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground md:h-7 md:max-w-48 md:min-h-7 md:px-1.5"
        >
          <SelectValue placeholder="云端模型">
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
        className="size-6 shrink-0 text-muted-foreground/60 hover:text-foreground"
        aria-label="刷新云端模型与价格"
        title="刷新云端模型与价格"
        disabled={disabled}
        onClick={() => void choice.refresh()}
      >
        <RefreshCw
          aria-hidden="true"
          className={choice.loading ? 'size-3 animate-spin motion-reduce:animate-none' : 'size-3'}
        />
      </Button>
      <span data-testid="composer-model-price" role="status" aria-live="polite" className="sr-only">
        {titleText}
      </span>
    </div>
  );
}
