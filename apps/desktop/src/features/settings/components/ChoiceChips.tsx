// 设置域统一的单选胶囊组（Codex 纪律：黑色填充表示当前，其余透明描边）。
// 生成默认值、外观等所有设置分区的枚举选择共用本组件，保证尺寸与风格一致。
import type { ComponentType } from 'react';
import { cn } from '../../../lib/utils';

export interface ChoiceChipOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

export function ChoiceChips<T extends string | number>({
  value,
  options,
  onChange,
  testIdPrefix,
  'aria-label': ariaLabel,
}: {
  value: T;
  options: ChoiceChipOption<T>[];
  onChange: (value: T) => void;
  testIdPrefix?: string;
  'aria-label'?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={active}
            key={String(option.value)}
            onClick={() => onChange(option.value)}
            data-testid={testIdPrefix ? `${testIdPrefix}-${String(option.value)}` : undefined}
            data-active={active ? 'true' : 'false'}
            className={cn(
              'no-drag inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
              active
                ? 'border-transparent bg-primary text-background'
                : 'border-border-subtle bg-transparent text-secondary hover:border-border-default hover:text-primary',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
