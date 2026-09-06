'use client';

import { useId, useMemo, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';

import { cn } from '@musefold/ui/lib/utils';
import { Input } from '@musefold/ui/components/input';

export interface ComboboxOption {
  value: string;
  label?: string;
}

/**
 * 可输可选 combobox:输入框始终可手填,有选项时展开列表点选。
 * 零 workspace 依赖;不引入 cmdk,避免 Dialog 内再套一层 Command 焦点陷阱。
 */
export function Combobox({
  value,
  onValueChange,
  options = [],
  placeholder,
  id,
  disabled,
  highlight = false,
  emptyText = '没有匹配项',
  className,
  'data-testid': testId,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options?: ComboboxOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** 自动选中后的 300ms muted 底闪。 */
  highlight?: boolean;
  emptyText?: string;
  className?: string;
  'data-testid'?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => {
      const label = (option.label ?? option.value).toLowerCase();
      return option.value.toLowerCase().includes(query) || label.includes(query);
    });
  }, [options, value]);

  const showList = open && options.length > 0;

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          data-testid={testId}
          className={cn(
            'pr-8 font-mono',
            highlight && 'bg-muted duration-(--dur-fast)',
            options.length > 0 && 'pr-8',
          )}
          onChange={(event) => {
            onValueChange(event.target.value);
            if (options.length > 0) setOpen(true);
          }}
          onFocus={() => {
            if (options.length > 0) setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
        />
        {options.length > 0 && (
          <ChevronDownIcon
            className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          data-testid={testId ? `${testId}-options` : undefined}
          className="absolute z-50 mt-1 max-h-40 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md duration-(--dur-fast) animate-in fade-in-0"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground text-xs">{emptyText}</li>
          ) : (
            filtered.map((option) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full rounded-sm px-2 py-1.5 text-left font-mono text-sm hover:bg-accent',
                    option.value === value && 'bg-accent',
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label ?? option.value}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
