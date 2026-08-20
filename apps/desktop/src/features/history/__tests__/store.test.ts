import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryRecord } from '@musefold/desktop-contracts/models';
import { DEFAULT_HISTORY_FILTERS } from '@musefold/domain/history-filters';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  list: vi.fn(),
  clear: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../../lib/ipc', () => ({
  default: {
    image: { retry: mocks.retry },
    history: { list: mocks.list, delete: mocks.delete, clear: mocks.clear },
  },
}));

import { useHistoryStore } from '../store';

const failedRecord: HistoryRecord = {
  id: 'history-1',
  promptId: null,
  providerId: 'provider-1',
  model: 'gpt-image-2',
  promptText: 'a quiet room',
  negativeText: null,
  params: null,
  status: 'failed',
  errorCode: 'RATE_LIMIT',
  errorMessage: '429',
  imagePath: null,
  cost: null,
  costUnit: 'point',
  durationMs: 120,
  createdAt: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.clear.mockResolvedValue({ ok: true, deleted: 1 });
  mocks.delete.mockResolvedValue({ ok: true, deleted: 1 });
  useHistoryStore.setState({
    records: [failedRecord],
    loading: false,
    error: null,
    filters: { ...DEFAULT_HISTORY_FILTERS },
    filtered: false,
    selectedId: null,
    inspectorCollapsed: false,
    retryingIds: new Set(),
  });
});

describe('history remove', () => {
  it('deletes only the DB row by default', async () => {
    await useHistoryStore.getState().remove('history-1');

    expect(mocks.delete).toHaveBeenCalledWith('history-1');
    expect(useHistoryStore.getState().records).toEqual([]);
  });

  it('can request source file deletion', async () => {
    mocks.delete.mockResolvedValue({ ok: true, deleted: 1, fileDeleted: true });

    await useHistoryStore.getState().remove('history-1', { deleteFile: true });

    expect(mocks.delete).toHaveBeenCalledWith({ id: 'history-1', deleteFile: true });
    expect(useHistoryStore.getState().records).toEqual([]);
  });
});

describe('history clear', () => {
  it('passes status filters to IPC and reloads the list', async () => {
    const successRecord: HistoryRecord = {
      ...failedRecord,
      id: 'history-success',
      status: 'success',
      errorCode: null,
      errorMessage: null,
    };
    mocks.list.mockResolvedValue([successRecord]);

    await useHistoryStore.getState().clearByStatus(['failed', 'cancelled']);

    expect(mocks.clear).toHaveBeenCalledWith({ statuses: ['failed', 'cancelled'] });
    expect(mocks.list).toHaveBeenCalled();
    expect(useHistoryStore.getState().records).toEqual([successRecord]);
  });

  it('keeps current records when clear IPC rejects', async () => {
    mocks.clear.mockRejectedValue(new Error('simulated clear failure'));

    await useHistoryStore.getState().clear({ statuses: ['failed'] });

    expect(mocks.list).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().records).toEqual([failedRecord]);
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
    expect(mocks.list).toHaveBeenCalled();
  });

  it('does not retry errors that require recovery first', async () => {
    useHistoryStore.setState({
      records: [{ ...failedRecord, errorCode: 'AUTH', errorMessage: '401' }],
    });

    await useHistoryStore.getState().retry('history-1');

    expect(mocks.retry).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().retryingIds.size).toBe(0);
  });

  it('allows forced regeneration from non-failed history rows', async () => {
    useHistoryStore.setState({
      records: [{ ...failedRecord, status: 'success', errorCode: null, errorMessage: null }],
    });
    mocks.retry.mockResolvedValue({ historyId: 'history-2', status: 'success' });

    await useHistoryStore.getState().retry('history-1', {
      force: true,
      successTitle: '再次生成完成',
    });

    expect(mocks.retry).toHaveBeenCalledWith('history-1');
    expect(mocks.list).toHaveBeenCalled();
    expect(useHistoryStore.getState().retryingIds.size).toBe(0);
  });
});
