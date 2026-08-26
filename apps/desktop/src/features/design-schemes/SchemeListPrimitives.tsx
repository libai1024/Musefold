import type { ReactNode } from 'react';
import { ArrowRight, RefreshCw, Search, X } from '../../components/ui/icons';
import { cn } from '../../lib/utils';

interface SchemeSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  submitting?: boolean;
}

export function SchemeSearchField({
  value,
  onChange,
  placeholder,
  onSubmit,
  submitting = false,
}: SchemeSearchFieldProps) {
  return (
    <div className="mf-scheme-search">
      <Search className="h-3.5 w-3.5 shrink-0 text-tertiary" />
      <span className="sr-only">搜索方案</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder ?? '搜索方案、作者或仓库'}
        aria-label="搜索方案"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-primary outline-none placeholder:text-quaternary"
        data-testid="scheme-search"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="flex h-6 w-6 items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
          aria-label="清空搜索"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {onSubmit ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="mf-scheme-search-submit"
          aria-label="搜索市场"
          title="搜索市场"
          data-testid="market-search-run"
        >
          {submitting ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
    </div>
  );
}

interface SchemeListSectionProps {
  title: string;
  count: number;
  singleColumn?: boolean;
  children: ReactNode;
}

export function SchemeListSection({
  title,
  count,
  singleColumn = false,
  children,
}: SchemeListSectionProps) {
  if (count === 0) return null;
  return (
    <section className="mt-7 first:mt-0">
      <div className="mb-2 flex items-center gap-2 border-b border-border-subtle pb-2">
        <h2 className="text-[13px] font-semibold text-primary">{title}</h2>
        <span className="text-meta tabular-nums text-tertiary">{count}</span>
      </div>
      <div
        className={cn(
          'grid gap-x-7 gap-y-1',
          singleColumn ? 'grid-cols-1' : 'grid-cols-2 max-[980px]:grid-cols-1',
        )}
      >
        {children}
      </div>
    </section>
  );
}
