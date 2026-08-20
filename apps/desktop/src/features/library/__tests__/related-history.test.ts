import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryRecord } from '@musefold/desktop-contracts/models';
import {
  directHistoryFallback,
  isMissingRelatedHistoryHandler,
  linkHistoriesToPrompt,
  loadRelatedHistory,
} from '../related-history';

const relatedHistorySource = readFileSync(new URL('../related-history.ts', import.meta.url), 'utf8');
const promptWorksPanelSource = readFileSync(
  new URL('../components/PromptWorksPanel.tsx', import.meta.url),
  'utf8',
);

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
  it('related-history 不再经 lib/ipc，查询走 extras.relatedHistory', () => {
    expect(relatedHistorySource).not.toContain("from '../../lib/ipc'");
    expect(relatedHistorySource).not.toContain('api.history');
    expect(relatedHistorySource).toContain('relatedHistory');
    expect(relatedHistorySource).toContain('linkHistoryPrompt');
    expect(promptWorksPanelSource).not.toContain('api.history');
    expect(promptWorksPanelSource).toContain('loadRelatedHistory');
  });

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
    const relatedHistory = vi.fn();
    const listHistory = vi.fn().mockResolvedValue([history('direct', 'prompt-1')]);
    const result = await loadRelatedHistory(
      { promptId: 'prompt-1', status: 'success' },
      {
        listHistory,
        relatedHistory,
        getSystemVersion: vi.fn().mockResolvedValue({ app: '0.1.0', db: 8 }),
      },
    );
    expect(relatedHistory).not.toHaveBeenCalled();
    expect(listHistory).toHaveBeenCalledWith({ status: 'success' });
    expect(result.coverage).toBe('direct-only');
    expect(result.runtimeDbVersion).toBe(8);
  });

  it('DB v9 uses extras.relatedHistory', async () => {
    const relatedHistory = vi.fn().mockResolvedValue({
      items: [{ ...history('reference', null), promptRelations: [{ kind: 'reference', scope: 'excerpt' }] }],
      total: 1,
    });
    const listHistory = vi.fn();
    const query = { promptId: 'prompt-1' };
    const result = await loadRelatedHistory(
      query,
      {
        listHistory,
        relatedHistory,
        getSystemVersion: vi.fn().mockResolvedValue({ app: '0.1.0', db: 9 }),
      },
    );
    expect(relatedHistory).toHaveBeenCalledWith(query);
    expect(relatedHistory.mock.calls[0][0]).toBe(query);
    expect(listHistory).not.toHaveBeenCalled();
    expect(result.coverage).toBe('full');
  });

  it('links generated history only when the v10 main-process capability exists', async () => {
    const linkHistoryPrompt = vi.fn().mockResolvedValue({
      linked: 2,
      alreadyLinked: 0,
      conflicts: [],
      missing: [],
    });
    const extras = {
      listHistory: vi.fn(),
      relatedHistory: vi.fn(),
      linkHistoryPrompt,
      getSystemVersion: vi.fn().mockResolvedValue({ app: '0.1.0', db: 10 }),
    };
    await expect(linkHistoriesToPrompt('prompt-1', ['h1', 'h1', 'h2'], extras)).resolves.toEqual({
      linked: 2,
      alreadyLinked: 0,
      conflicts: [],
      missing: [],
    });
    expect(linkHistoryPrompt).toHaveBeenCalledWith({ promptId: 'prompt-1', historyIds: ['h1', 'h2'] });

    extras.getSystemVersion.mockResolvedValue({ app: '0.1.0', db: 9 });
    linkHistoryPrompt.mockClear();
    await expect(linkHistoriesToPrompt('prompt-1', ['h1'], extras)).resolves.toBeNull();
    expect(linkHistoryPrompt).not.toHaveBeenCalled();
  });
});
