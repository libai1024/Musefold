import { Search, X } from '@musefold/ui/icons';
import type { HistoryDatePreset, HistoryFilters } from '@musefold/domain/history-filters';
import { DATE_PRESET_OPTIONS, STATUS_OPTIONS } from '@musefold/domain/history-filters';
import type { HistoryStatus } from '@musefold/domain/history-status';

export interface HistoryFilterBarProps {
  filters: HistoryFilters;
  searchQuery: string;
  modelOptions?: readonly string[];
  resultCount?: number;
  onFiltersChange: (patch: Partial<HistoryFilters>) => void;
  onSearchChange: (value: string) => void;
  onClear: () => void;
}

/** Shared, controlled history filters. Transport and query ownership stay in each host. */
export function HistoryFilterBar({
  filters,
  searchQuery,
  modelOptions = [],
  resultCount,
  onFiltersChange,
  onSearchChange,
  onClear,
}: HistoryFilterBarProps) {
  const activeCount =
    (filters.status ? 1 : 0) +
    (filters.providerId ? 1 : 0) +
    (filters.providerModel ? 1 : 0) +
    (filters.datePreset !== '30d' ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);
  const statusValue = filters.status ?? '';
  const modelValue = filters.providerModel ?? '';

  return (
    <div className="mf-history-filter-bar" data-testid="history-filter-bar">
      <label className="mf-history-filter-search">
        <Search aria-hidden="true" />
        <span className="mf-sr-only">搜索生成历史</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索提示词、模型或错误信息"
          data-testid="history-filter-search"
        />
        {searchQuery ? (
          <button
            type="button"
            aria-label="清空搜索"
            className="mf-history-filter-clear-search"
            onClick={() => onSearchChange('')}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </label>

      <label className="mf-history-filter-control">
        <span className="mf-sr-only">历史状态</span>
        <select
          value={statusValue}
          onChange={(event) =>
            onFiltersChange({
              status: (event.target.value || undefined) as HistoryStatus | undefined,
            })
          }
          data-testid="history-filter-status"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.id} value={option.id === 'all' ? '' : option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mf-history-filter-control">
        <span className="mf-sr-only">历史时间</span>
        <select
          value={filters.datePreset}
          onChange={(event) =>
            onFiltersChange({ datePreset: event.target.value as HistoryDatePreset })
          }
          data-testid="history-filter-date"
        >
          {DATE_PRESET_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {filters.datePreset === 'custom' ? (
        <div className="mf-history-filter-range" data-testid="history-filter-custom-range">
          <DateInput
            label="起"
            value={filters.customFrom}
            testId="history-filter-from"
            onChange={(customFrom) => onFiltersChange({ customFrom, datePreset: 'custom' })}
          />
          <span aria-hidden="true">→</span>
          <DateInput
            label="止"
            value={filters.customTo}
            testId="history-filter-to"
            onChange={(customTo) => onFiltersChange({ customTo, datePreset: 'custom' })}
          />
        </div>
      ) : null}

      <label className="mf-history-filter-control">
        <span className="mf-sr-only">历史模型</span>
        <select
          value={modelValue}
          onChange={(event) => onFiltersChange({ providerModel: event.target.value || undefined })}
          data-testid="history-filter-model"
        >
          <option value="">全部模型</option>
          {modelOptions.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>

      {activeCount > 0 ? (
        <button
          type="button"
          className="mf-history-filter-clear"
          onClick={onClear}
          data-testid="history-filter-clear"
        >
          <X aria-hidden="true" />
          已筛选 {activeCount} 项{resultCount == null ? '' : ` · ${resultCount} 条`}
        </button>
      ) : null}
    </div>
  );
}

function DateInput({
  label,
  value,
  testId,
  onChange,
}: {
  label: string;
  value?: number;
  testId: string;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="mf-history-filter-date-input">
      <span>{label}</span>
      <input
        type="datetime-local"
        value={value == null ? '' : toLocalInputValue(value)}
        data-testid={testId}
        onChange={(event) => {
          const next = event.target.value ? new Date(event.target.value).getTime() : undefined;
          onChange(next != null && !Number.isNaN(next) ? next : undefined);
        }}
      />
    </label>
  );
}

function toLocalInputValue(value: number): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
