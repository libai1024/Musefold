import { LOCAL_STORAGE_PREFIX } from '@shared/constants';

const PINNED_SESSIONS_KEY = `${LOCAL_STORAGE_PREFIX}pinned-workbench-sessions`;
const UNREAD_SESSIONS_KEY = `${LOCAL_STORAGE_PREFIX}unread-workbench-sessions`;
export const SESSION_PINS_CHANGED_EVENT = 'musefold:session-pins-changed';
export const SESSION_UNREAD_CHANGED_EVENT = 'musefold:session-unread-changed';

export function readPinnedSessionIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(PINNED_SESSIONS_KEY) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function setSessionPinned(sessionId: string, pinned: boolean): string[] {
  const current = readPinnedSessionIds();
  const next = pinned
    ? [sessionId, ...current.filter((id) => id !== sessionId)]
    : current.filter((id) => id !== sessionId);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(next));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_PINS_CHANGED_EVENT));
  }
  return next;
}

export function readUnreadSessionIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(UNREAD_SESSIONS_KEY) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function setSessionUnread(sessionId: string, unread: boolean): string[] {
  const current = readUnreadSessionIds();
  const next = unread
    ? [sessionId, ...current.filter((id) => id !== sessionId)]
    : current.filter((id) => id !== sessionId);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(UNREAD_SESSIONS_KEY, JSON.stringify(next));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_UNREAD_CHANGED_EVENT));
  }
  return next;
}
