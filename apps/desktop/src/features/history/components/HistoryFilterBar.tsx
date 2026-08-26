// src/features/history/components/HistoryFilterBar.tsx
// 历史筛选栏：状态 + 日期 + Provider（TASK-HIS-02）
// 全部条件 AND，下推 SQL（见 electron/main/ipc/history.ts）

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from '../../../components/ui/icons';
import { useHistoryStore } from '../store';
import { useHistoryListQuery } from '../use-history-queries';
import { DATE_PRESET_OPTIONS, STATUS_OPTIONS } from '@musefold/domain/history-filters';
import { useGenerationStore } from '../../../runtime/generation-access';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { HistoryStatus } from '@musefold/domain/history-status';

export function HistoryFilterBar() {
  const filters = useHistoryStore((s) => s.filters);
  const setFilters = useHistoryStore((s) => s.setFilters);
  const searchQuery = useHistoryStore((s) => s.searchQuery);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const clearFilters = useHistoryStore((s) => s.clearFilters);
  const activeCount = useHistoryStore((s) => s.activeFilterCount());
  const recordsLen = useHistoryListQuery().records.length;

  const providers = useGenerationStore((s) => s.providers);
  const loadProviders = useGenerationStore((s) => s.loadProviders);

  useEffect(() => {
    if (providers.length === 0) void loadProviders().catch(() => {});
  }, [providers.length, loadProviders]);

  const statusValue: HistoryStatus | 'all' = filters.status ?? 'all';
  const statusLabel =
    STATUS_OPTIONS.find((option) => option.id === statusValue)?.label ?? '全部状态';
  const dateLabel =
    DATE_PRESET_OPTIONS.find((option) => option.id === filters.datePreset)?.label ?? '近 30 天';

  return (
    <div
      className="mt-[8px] flex min-h-12 flex-wrap items-center gap-2 rounded-[8px] border border-border-default bg-elevated px-2.5 py-2"
      id="history-filter-panel"
      data-testid="history-filter-bar"
    >
      <label className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-[8px] border border-border-default bg-work px-2.5 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-accent/10">
        <Search className="h-3.5 w-3.5 shrink-0 text-tertiary" aria-hidden="true" />
        <span className="sr-only">搜索生成历史</span>
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索提示词、模型或错误信息"
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-primary outline-none placeholder:text-quaternary"
          data-testid="history-filter-search"
        />
        {searchQuery && (
          <button
            type="button"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
            aria-label="清空搜索"
            onClick={() => setSearchQuery('')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </label>

      <FilterPicker
        value={statusValue}
        label={statusLabel}
        active={statusValue !== 'all'}
        options={STATUS_OPTIONS}
        testId="history-filter-status"
        onChange={(value) =>
          setFilters({ status: value === 'all' ? undefined : (value as HistoryStatus) })
        }
      />

      <FilterPicker
        value={filters.datePreset}
        label={dateLabel}
        active={filters.datePreset !== '30d'}
        options={DATE_PRESET_OPTIONS}
        testId="history-filter-date"
        onChange={(datePreset) => setFilters({ datePreset })}
      />

      {filters.datePreset === 'custom' && (
        <div className="flex items-center gap-1" data-testid="history-filter-custom-range">
          <DateInput
            label="起"
            value={filters.customFrom}
            testId="history-filter-from"
            onChange={(ms) => setFilters({ customFrom: ms, datePreset: 'custom' })}
          />
          <span className="text-meta text-quaternary">→</span>
          <DateInput
            label="止"
            value={filters.customTo}
            testId="history-filter-to"
            onChange={(ms) => setFilters({ customTo: ms, datePreset: 'custom' })}
          />
        </div>
      )}

      <ProviderFilterPicker
        value={filters.providerId}
        providers={providers}
        onChange={(providerId) => setFilters({ providerId })}
      />

      {activeCount > 0 && (
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto text-tertiary"
          onClick={() => clearFilters()}
          data-testid="history-filter-clear"
        >
          <X className="h-3 w-3" />
          已筛选 {activeCount} 项 · {recordsLen} 条<span className="sr-only">清空</span>
        </Button>
      )}
    </div>
  );
}

function ProviderFilterPicker({
  value,
  providers,
  onChange,
}: {
  value?: string;
  providers: { id: string; name: string }[];
  onChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = providers.find((provider) => provider.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="history-filter-provider"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'no-drag flex h-8 max-w-[10rem] min-w-[8.5rem] items-center gap-1.5 rounded-[8px] border px-2.5 text-[11px] outline-none transition-colors hover:border-border-strong focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-accent/10',
          value
            ? 'border-accent/20 bg-accent-soft text-primary'
            : 'border-border-default bg-work text-secondary',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.name ?? '全部服务商'}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-tertiary transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+5px)] z-50 min-w-[180px] rounded-md border border-border-default bg-popover p-1 shadow-pop animate-scale-fade-in"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-primary hover:bg-hover"
          >
            <span className="flex-1 text-tertiary">全部服务商</span>
            {!value && <Check className="h-3.5 w-3.5 text-primary" />}
          </button>
          {providers.map((provider) => {
            const active = provider.id === value;
            return (
              <button
                key={provider.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(provider.id);
                  setOpen(false);
                }}
                className="no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-primary hover:bg-hover"
              >
                <span className="flex-1 truncate">{provider.name}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterPicker<T extends string>({
  value,
  label,
  active,
  options,
  testId,
  onChange,
}: {
  value: T;
  label: string;
  active: boolean;
  options: readonly { id: T; label: string }[];
  testId: string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'no-drag flex h-8 min-w-[108px] items-center gap-1.5 rounded-[8px] border px-2.5 text-[11px] outline-none transition-colors hover:border-border-strong focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-accent/10',
          active
            ? 'border-accent/20 bg-accent-soft text-primary'
            : 'border-border-default bg-work text-secondary',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-tertiary transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+5px)] z-50 min-w-[160px] rounded-md border border-border-default bg-popover p-1 shadow-pop animate-scale-fade-in"
        >
          {options.map((option) => {
            const selected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`${testId}-${option.id}`}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className="no-drag flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-primary hover:bg-hover"
              >
                <span className={cn('flex-1', !selected && 'text-secondary')}>{option.label}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value?: number;
  onChange: (ms: number | undefined) => void;
  testId: string;
}) {
  // datetime-local wants local "YYYY-MM-DDTHH:mm"
  const display = value != null ? toLocalInputValue(value) : '';
  return (
    <label className="flex items-center gap-1 text-meta text-quaternary">
      <span>{label}</span>
      <input
        type="datetime-local"
        data-testid={testId}
        value={display}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            onChange(undefined);
            return;
          }
          const ms = new Date(v).getTime();
          if (!Number.isNaN(ms)) onChange(ms);
        }}
        className="no-drag h-6.5 rounded-md border border-border-subtle bg-inset px-1.5 font-mono text-meta text-secondary outline-none focus-visible:border-border-strong"
      />
    </label>
  );
}

function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
