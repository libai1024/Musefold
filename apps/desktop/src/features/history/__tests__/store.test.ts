import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HISTORY_FILTERS } from '@musefold/domain/history-filters';
import { musefoldQueryKeys } from '@musefold/product-ui';
import { historyEntryFixture } from './entry-fixture';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  list: vi.fn(),
  clear: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../../runtime', () => ({
  desktopGateway: {
    retryImage: mocks.retry,
    listHistory: mocks.list,
    deleteHistory: mocks.delete,
    clearHistory: mocks.clear,
  },
}));

import { desktopQueryClient } from '../../../runtime/query-client';
import { toHistoryListQueryKey, useHistoryStore } from '../store';
import type { DesktopGenerationEntry } from '@musefold/desktop-contracts/history-documents';

const failedRecord = historyEntryFixture();
const defaultListKey = musefoldQueryKeys.history.list(toHistoryListQueryKey(DEFAULT_HISTORY_FILTERS));

function seedList(records: DesktopGenerationEntry[]): void {
  desktopQueryClient.setQueryData(defaultListKey, records);
}

function cachedList(): DesktopGenerationEntry[] {
  return desktopQueryClient.getQueryData<DesktopGenerationEntry[]>(defaultListKey) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  desktopQueryClient.clear();
  mocks.list.mockResolvedValue([]);
  mocks.clear.mockResolvedValue({ ok: true, deleted: 1 });
  mocks.delete.mockResolvedValue({ ok: true, deleted: 1 });
  seedList([failedRecord]);
  useHistoryStore.setState({
    filters: { ...DEFAULT_HISTORY_FILTERS },
    searchQuery: '',
    selectedId: null,
    inspectorCollapsed: false,
    retryingIds: new Set(),
  });
});

describe('history renderer filters', () => {
  it('counts prompt search and clears it with the domain filters', () => {
    const state = useHistoryStore.getState();

    state.setSearchQuery('夜间建筑');
    expect(useHistoryStore.getState().hasActiveFilters()).toBe(true);
    expect(useHistoryStore.getState().activeFilterCount()).toBe(1);

    state.setFilters({ status: 'failed' });
    expect(useHistoryStore.getState().activeFilterCount()).toBe(2);

    state.clearFilters();
    expect(useHistoryStore.getState().searchQuery).toBe('');
    expect(useHistoryStore.getState().filters).toEqual(DEFAULT_HISTORY_FILTERS);
    expect(useHistoryStore.getState().hasActiveFilters()).toBe(false);
  });
});

describe('history remove', () => {
  it('deletes only the DB row by default', async () => {
    await useHistoryStore.getState().remove('history-1');

    expect(mocks.delete).toHaveBeenCalledWith('history-1');
    expect(cachedList()).toEqual([]);
  });

  it('can request source file deletion', async () => {
    mocks.delete.mockResolvedValue({ ok: true, deleted: 1, fileDeleted: true });

    await useHistoryStore.getState().remove('history-1', { deleteFile: true });

    expect(mocks.delete).toHaveBeenCalledWith({ id: 'history-1', deleteFile: true });
    expect(cachedList()).toEqual([]);
  });
});

describe('history clear', () => {
  it('passes status filters to IPC and invalidates the list', async () => {
    await useHistoryStore.getState().clearByStatus(['failed', 'cancelled']);

    expect(mocks.clear).toHaveBeenCalledWith({ statuses: ['failed', 'cancelled'] });
    expect(desktopQueryClient.getQueryState(defaultListKey)?.isInvalidated).toBe(true);
  });

  it('keeps current records when clear IPC rejects', async () => {
    mocks.clear.mockRejectedValue(new Error('simulated clear failure'));

    await useHistoryStore.getState().clear({ statuses: ['failed'] });

    expect(cachedList()).toEqual([failedRecord]);
    expect(useHistoryStore.getState().selectedId).toBeNull();
  });
});

describe('history retry state', () => {
  it('marks a retry as in flight and ignores duplicate requests', async () => {
    let resolveRetry!: (result: { historyId: string; status: 'success' }) => void;
    mocks.retry.mockReturnValue(
      new Promise((resolve) => {
        resolveRetry = resolve;
      }),
    );

    const first = useHistoryStore.getState().retry('history-1');
    expect(useHistoryStore.getState().retryingIds.has('history-1')).toBe(true);

    await useHistoryStore.getState().retry('history-1');
    expect(mocks.retry).toHaveBeenCalledTimes(1);

    resolveRetry({ historyId: 'history-2', status: 'success' });
    await first;

    expect(useHistoryStore.getState().retryingIds.has('history-1')).toBe(false);
    expect(desktopQueryClient.getQueryState(defaultListKey)?.isInvalidated).toBe(true);
  });

  it('does not retry errors that require recovery first', async () => {
    seedList([{ ...failedRecord, errorCode: 'AUTH', errorMessage: '401' }]);

    await useHistoryStore.getState().retry('history-1');

    expect(mocks.retry).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().retryingIds.size).toBe(0);
  });

  it('allows forced regeneration from non-failed history rows', async () => {
    seedList([
      historyEntryFixture({
        status: 'succeeded',
        error: null,
        errorCode: null,
        errorMessage: null,
      }),
    ]);
    mocks.retry.mockResolvedValue({ historyId: 'history-2', status: 'success' });

    await useHistoryStore.getState().retry('history-1', {
      force: true,
      successTitle: '再次生成完成',
    });

    expect(mocks.retry).toHaveBeenCalledWith('history-1');
    expect(useHistoryStore.getState().retryingIds.size).toBe(0);
  });
});

describe('history list query key', () => {
  it('stays stable across Date.now ticks for relative date presets', () => {
    const first = toHistoryListQueryKey(DEFAULT_HISTORY_FILTERS);
    const second = toHistoryListQueryKey(DEFAULT_HISTORY_FILTERS);
    expect(first).toEqual(second);
    expect(first).not.toHaveProperty('from');
    expect(first).not.toHaveProperty('to');
    expect(musefoldQueryKeys.history.list(first)).toEqual(musefoldQueryKeys.history.list(second));
  });
});
