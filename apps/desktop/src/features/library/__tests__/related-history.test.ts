import { describe, expect, it, vi } from 'vitest';
import type { HistoryRecord } from '@shared/types/models';
import {
  directHistoryFallback,
  isMissingRelatedHistoryHandler,
  linkHistoriesToPrompt,
  loadRelatedHistory,
} from '../related-history';

function history(id: string, promptId: string | null, status: HistoryRecord['status'] = 'success'): HistoryRecord {
  return {
    id,
    promptId,
    providerId: 'provider',
    model: 'model',
    promptText: id,
    negativeText: null,
    params: null,
    status,
    errorCode: null,
    errorMessage: null,
    imagePath: status === 'success' ? `/tmp/${id}.png` : null,
    cost: null,
    costUnit: 'point',
    durationMs: null,
    createdAt: 1,
  };
}

describe('related history compatibility', () => {
  it('recognizes only the missing-handler transport error', () => {
    expect(isMissingRelatedHistoryHandler(new Error(
      "Error invoking remote method 'db:history:related': Error: No handler registered for 'db:history:related'",
    ))).toBe(true);
    expect(isMissingRelatedHistoryHandler(new Error(
      "Error invoking remote method 'db:history:linkPrompt': Error: No handler registered for 'db:history:linkPrompt'",
    ))).toBe(true);
    expect(isMissingRelatedHistoryHandler(new Error('SQLITE_CORRUPT'))).toBe(false);
  });

  it('fallback keeps exact direct prompt ids, status results, and pagination', () => {
    const result = directHistoryFallback(
      [history('a', 'prompt-1'), history('b', 'other'), history('c', 'prompt-1')],
      { promptId: 'prompt-1', limit: 1, offset: 1 },
    );
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(['c']);
    expect(result.items[0].promptRelations).toEqual([{ kind: 'source' }]);
  });

  it('DB v8 skips the unavailable channel and returns direct-only coverage', async () => {
    const related = vi.fn();
    const list = vi.fn().mockResolvedValue([history('direct', 'prompt-1')]);
    const result = await loadRelatedHistory(
      { promptId: 'prompt-1', status: 'success' },
      {
        history: { list, related },
        system: { getVersion: vi.fn().mockResolvedValue({ app: '0.1.0', db: 8 }) },
      },
    );
    expect(related).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ status: 'success' });
    expect(result.coverage).toBe('direct-only');
    expect(result.runtimeDbVersion).toBe(8);
  });

  it('DB v9 uses the indexed relation query', async () => {
    const related = vi.fn().mockResolvedValue({
      items: [{ ...history('reference', null), promptRelations: [{ kind: 'reference', scope: 'excerpt' }] }],
      total: 1,
    });
    const list = vi.fn();
    const result = await loadRelatedHistory(
      { promptId: 'prompt-1' },
      {
        history: { list, related },
        system: { getVersion: vi.fn().mockResolvedValue({ app: '0.1.0', db: 9 }) },
      },
    );
    expect(related).toHaveBeenCalledWith({ promptId: 'prompt-1' });
    expect(list).not.toHaveBeenCalled();
    expect(result.coverage).toBe('full');
  });

  it('links generated history only when the v10 main-process capability exists', async () => {
    const linkPrompt = vi.fn().mockResolvedValue({
      linked: 2,
      alreadyLinked: 0,
      conflicts: [],
      missing: [],
    });
    const client = {
      history: { list: vi.fn(), related: vi.fn(), linkPrompt },
      system: { getVersion: vi.fn().mockResolvedValue({ app: '0.1.0', db: 10 }) },
    };
    await expect(linkHistoriesToPrompt('prompt-1', ['h1', 'h1', 'h2'], client)).resolves.toEqual({
      linked: 2,
      alreadyLinked: 0,
      conflicts: [],
      missing: [],
    });
    expect(linkPrompt).toHaveBeenCalledWith({ promptId: 'prompt-1', historyIds: ['h1', 'h2'] });

    client.system.getVersion.mockResolvedValue({ app: '0.1.0', db: 9 });
    linkPrompt.mockClear();
    await expect(linkHistoriesToPrompt('prompt-1', ['h1'], client)).resolves.toBeNull();
    expect(linkPrompt).not.toHaveBeenCalled();
  });
});
