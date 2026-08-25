// 中转站弹窗共用的模型行式列表：模型名 + 选中态，替代早期胶囊选项。
// 行节奏对齐设置列表（px-3 py-1.5 + 发丝分隔容器），RELAY-SETTINGS-UI 第一步。

import { Check } from './icons';
import { cn } from '../../lib/utils';

export interface ModelOptionItem {
  id: string;
  /** 展示名（调用方自行过 displayModelName 等别名） */
  label: string;
  title?: string;
  /** 无别名可显示时按模型 ID 用等宽字体 */
  mono?: boolean;
}

export function ModelOptionList({
  items,
  selectedId,
  onSelect,
  ariaLabel,
  testId,
  optionTestId,
}: {
  items: ModelOptionItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
  testId: string;
  optionTestId: (id: string) => string;
}) {
  return (
    <div
      className="mt-2 max-h-32 overflow-y-auto border-y border-border-subtle py-1"
      role="listbox"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(item.id)}
            title={item.title}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
              item.mono && 'font-mono',
              selected
                ? 'bg-pressed text-primary'
                : 'text-secondary hover:bg-hover hover:text-primary',
            )}
            data-testid={optionTestId(item.id)}
          >
            <span className="truncate">{item.label}</span>
            {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
