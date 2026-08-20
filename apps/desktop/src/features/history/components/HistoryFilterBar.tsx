// src/features/history/components/HistoryFilterBar.tsx
// 历史筛选栏：状态 + 日期 + Provider（TASK-HIS-02）
// 全部条件 AND，下推 SQL（见 electron/main/ipc/history.ts）

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Filter, X } from '../../../components/ui/icons';
import { useHistoryStore } from '../store';
import {
  DATE_PRESET_OPTIONS,
  STATUS_OPTIONS,
} from '../filters';
import { useGenerationStore } from '../../generation/store';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { HistoryStatus } from '@musefold/desktop-contracts/enums';

export function HistoryFilterBar() {
  const filters = useHistoryStore((s) => s.filters);
  const setFilters = useHistoryStore((s) => s.setFilters);
  const clearFilters = useHistoryStore((s) => s.clearFilters);
  const activeCount = useHistoryStore((s) => s.activeFilterCount());
  const recordsLen = useHistoryStore((s) => s.records.length);

  const providers = useGenerationStore((s) => s.providers);
  const loadProviders = useGenerationStore((s) => s.loadProviders);

  useEffect(() => {
    if (providers.length === 0) void loadProviders().catch(() => {});
  }, [providers.length, loadProviders]);

  const statusValue: HistoryStatus | 'all' = filters.status ?? 'all';

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2"
      data-testid="history-filter-bar"
    >
      <Filter className="mr-0.5 h-3 w-3 text-quaternary" aria-hidden="true" />

      {/* 状态 */}
      <div className="flex flex-wrap gap-1" data-testid="history-filter-status">
        {STATUS_OPTIONS.map((opt) => (
          <Chip
            key={opt.id}
            active={statusValue === opt.id}
            testId={`history-filter-status-${opt.id}`}
            onClick={() =>
              setFilters({ status: opt.id === 'all' ? undefined : (opt.id as HistoryStatus) })
            }
          >
            {opt.label}
          </Chip>
        ))}
      </div>

      <span className="mx-0.5 h-3 w-px bg-border-subtle" />

      {/* 日期 */}
      <div className="flex flex-wrap gap-1" data-testid="history-filter-date">
        {DATE_PRESET_OPTIONS.map((opt) => (
          <Chip
            key={opt.id}
            active={filters.datePreset === opt.id}
            testId={`history-filter-date-${opt.id}`}
            onClick={() => setFilters({ datePreset: opt.id })}
          >
            {opt.label}
          </Chip>
        ))}
      </div>

      {filters.datePreset === 'custom' && (
        <div className="flex items-center gap-1" data-testid="history-filter-custom-range">
          <DateInput
            label="起"
            value={filters.customFrom}
            testId="history-filter-from"
            onChange={(ms) => setFilters({ customFrom: ms, datePreset: 'custom' })}
          />
          <span className="text-[10px] text-quaternary">→</span>
          <DateInput
            label="止"
            value={filters.customTo}
            testId="history-filter-to"
            onChange={(ms) => setFilters({ customTo: ms, datePreset: 'custom' })}
          />
        </div>
      )}

      <span className="mx-0.5 h-3 w-px bg-border-subtle" />

      {/* Provider */}
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
          已筛选 {activeCount} 项 · {recordsLen} 条
          <span className="sr-only">清空</span>
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
        className="no-drag flex h-6.5 max-w-[10rem] min-w-[8.5rem] items-center gap-1.5 rounded-full border border-border-subtle px-2.5 text-[11px] text-secondary outline-none transition-colors hover:border-border-default focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.name ?? '全部服务商'}</span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 text-tertiary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 top-[calc(100%+5px)] z-50 min-w-[180px] rounded-md border border-border-default bg-popover p-1 shadow-pop animate-scale-fade-in">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => { onChange(undefined); setOpen(false); }}
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
                onClick={() => { onChange(provider.id); setOpen(false); }}
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

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'no-drag h-6.5 rounded-full border px-2.5 text-[11px] font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]',
        active
          ? 'border-primary bg-primary text-background'
          : 'border-transparent text-tertiary hover:bg-hover hover:text-secondary',
      )}
    >
      {children}
    </button>
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
    <label className="flex items-center gap-1 text-[10px] text-quaternary">
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
        className="no-drag h-6.5 rounded-md border border-border-subtle bg-inset px-1.5 font-mono text-[10px] text-secondary outline-none focus-visible:border-border-strong"
      />
    </label>
  );
}

function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
