import { beforeEach, describe, expect, it, vi } from 'vitest';

function installBrowserStorage(): Map<string, string> {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
  const browserWindow = new EventTarget() as EventTarget & { localStorage: Storage };
  browserWindow.localStorage = storage;
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', browserWindow);
  return values;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  installBrowserStorage();
});

describe('workbench session preferences', () => {
  it('persists pinned sessions without duplicates', async () => {
    const { readPinnedSessionIds, setSessionPinned } = await import('../sessionPreferences');
    expect(setSessionPinned('session-1', true)).toEqual(['session-1']);
    expect(setSessionPinned('session-1', true)).toEqual(['session-1']);
    expect(readPinnedSessionIds()).toEqual(['session-1']);
    expect(setSessionPinned('session-1', false)).toEqual([]);
  });

  it('persists unread state independently from pinned state', async () => {
    const {
      readPinnedSessionIds,
      readUnreadSessionIds,
      setSessionPinned,
      setSessionUnread,
    } = await import('../sessionPreferences');
    setSessionPinned('session-1', true);
    expect(setSessionUnread('session-1', true)).toEqual(['session-1']);
    expect(readPinnedSessionIds()).toEqual(['session-1']);
    expect(readUnreadSessionIds()).toEqual(['session-1']);
    expect(setSessionUnread('session-1', false)).toEqual([]);
    expect(readPinnedSessionIds()).toEqual(['session-1']);
  });
});
