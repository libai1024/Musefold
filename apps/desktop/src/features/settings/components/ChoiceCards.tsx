// 设置域统一的单选卡片组；导出内容、导入冲突策略等富选项共用尺寸、焦点和选中态。
// 与 ChoiceChips（分段组）互补：这里每项带标题 + 多行说明，纵向排列。
import type { ComponentType, ReactNode } from 'react';
import { cn } from '../../../lib/utils';

export interface ChoiceCardOption<T extends string | number> {
  value: T;
  title: string;
  /** 标题后的补充节点（如危险项警示图标） */
  titleExtra?: ReactNode;
  /** 一段或多行说明 */
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  /** 危险选项：选中态走 danger 色 */
  danger?: boolean;
}

export function ChoiceCards<T extends string | number>({
  value,
  options,
  onChange,
  testIdPrefix,
  'aria-label': ariaLabel,
}: {
  value: T;
  options: ChoiceCardOption<T>[];
  onChange: (value: T) => void;
  testIdPrefix?: string;
  'aria-label'?: string;
}) {
  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}-${String(option.value)}` : undefined}
            data-active={active}
            className={cn(
              'no-drag flex items-start gap-3 rounded-md border px-3.5 py-3 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
              active
                ? option.danger
                  ? 'border-danger bg-danger/10'
                  : 'border-accent bg-accent-soft'
                : 'border-border-subtle bg-elevated hover:border-border-default',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                active
                  ? option.danger
                    ? 'border-danger'
                    : 'border-accent'
                  : 'border-border-default',
              )}
              aria-hidden="true"
            >
              {active && (
                <span
                  className={cn('h-2 w-2 rounded-full', option.danger ? 'bg-danger' : 'bg-accent')}
                />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
                {Icon ? <Icon className="h-3.5 w-3.5 text-tertiary" /> : null}
                {option.title}
                {option.titleExtra}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-[11px] leading-relaxed text-tertiary">
                  {option.description}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
