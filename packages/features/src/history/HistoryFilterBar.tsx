'use client';

import type { GenerationStatus } from '@musefold/contracts';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { Input } from '@musefold/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Search, X } from '@musefold/ui/icons';
import {
  activeFilterCount,
  DATE_PRESET_LABELS,
  type HistoryDatePreset,
  type HistoryFilters,
} from './hooks';
import { STATUS_LABELS } from './format';

/** Select 无空值项:'all' 作哨兵。 */
const ALL = 'all';

const STATUS_OPTIONS: readonly GenerationStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

export interface HistoryFilterBarProps {
  filters: HistoryFilters;
  search: string;
  modelOptions: readonly string[];
  onFiltersChange(patch: Partial<HistoryFilters>): void;
  onSearchChange(value: string): void;
  onClear(): void;
}

/** 历史筛选栏(承旧 HistoryFilterBar):搜索 + 状态 + 模型 + 时间预设 + 清除。 */
export function HistoryFilterBar({
  filters,
  search,
  modelOptions,
  onFiltersChange,
  onSearchChange,
  onClear,
}: HistoryFilterBarProps) {
  const activeCount = activeFilterCount(filters, search);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="history-filter-bar">
      <div className="relative min-w-44 flex-1 md:max-w-72">
        <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
        <Input
          value={search}
          placeholder="搜索提示词"
          className="h-8 pl-8 text-sm"
          data-testid="history-filter-search"
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search && (
          <Button
            variant="ghost"
            size="icon"
            className="-translate-y-1/2 absolute top-1/2 right-1 size-6 text-muted-foreground"
            aria-label="清空搜索"
            onClick={() => onSearchChange('')}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <Select
        value={filters.status ?? ALL}
        onValueChange={(next) =>
          onFiltersChange({ status: next === ALL ? null : (next as GenerationStatus) })
        }
      >
        <SelectTrigger size="sm" className="h-8 w-auto text-xs" data-testid="history-filter-status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>全部状态</SelectItem>
          {STATUS_OPTIONS.map((status) => (
            <SelectItem key={status} value={status}>
              {STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {modelOptions.length > 0 && (
        <Select
          value={filters.providerModel ?? ALL}
          onValueChange={(next) => onFiltersChange({ providerModel: next === ALL ? null : next })}
        >
          <SelectTrigger
            size="sm"
            className="h-8 w-auto max-w-44 text-xs"
            data-testid="history-filter-model"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部模型</SelectItem>
            {modelOptions.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={filters.datePreset}
        onValueChange={(next) => onFiltersChange({ datePreset: next as HistoryDatePreset })}
      >
        <SelectTrigger size="sm" className="h-8 w-auto text-xs" data-testid="history-filter-date">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(DATE_PRESET_LABELS) as HistoryDatePreset[]).map((preset) => (
            <SelectItem key={preset} value={preset}>
              {DATE_PRESET_LABELS[preset]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 自定义区间(承旧 history-filter-custom-range):含首含尾,只填一头也生效。 */}
      {filters.datePreset === 'custom' && (
        <div
          className="flex items-center gap-1.5 text-muted-foreground text-xs"
          data-testid="history-filter-custom-range"
        >
          <Input
            type="date"
            value={filters.customFrom ?? ''}
            max={filters.customTo ?? undefined}
            aria-label="起始日期"
            className="h-8 w-36 text-xs tabular-nums"
            data-testid="history-filter-custom-from"
            onChange={(event) => onFiltersChange({ customFrom: event.target.value || null })}
          />
          <span aria-hidden>至</span>
          <Input
            type="date"
            value={filters.customTo ?? ''}
            min={filters.customFrom ?? undefined}
            aria-label="结束日期"
            className="h-8 w-36 text-xs tabular-nums"
            data-testid="history-filter-custom-to"
            onChange={(event) => onFiltersChange({ customTo: event.target.value || null })}
          />
        </div>
      )}

      {activeCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground text-xs"
          onClick={onClear}
          data-testid="history-filter-clear"
        >
          清除筛选
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {activeCount}
          </Badge>
        </Button>
      )}
    </div>
  );
}
