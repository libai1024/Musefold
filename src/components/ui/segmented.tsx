// src/components/ui/segmented.tsx
// macOS 分段控件 —— 滑块背景在选项间过渡，紧凑
import { cn } from '../../lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ...aria
}: Props<T>) {
  const h = size === 'sm' ? 'h-7' : 'h-8';
  return (
    <div
      role="tablist"
      aria-label={aria['aria-label']}
      className={cn(
        'no-drag inline-flex items-center gap-0.5 rounded-md border border-border-default bg-inset p-0.5',
        h,
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex h-full items-center gap-1.5 rounded-xs border border-transparent px-2.5 text-xs font-medium transition-[background-color,border-color,color,box-shadow] duration-[var(--dur-fast)] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
              active
                ? 'border-border-default bg-popover text-primary'
                : 'text-secondary hover:bg-hover hover:text-primary'
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
