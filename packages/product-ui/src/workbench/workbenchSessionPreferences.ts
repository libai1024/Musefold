const SESSION_STORAGE_PREFIX = "musefold:v0.3.0:";
const PINNED_SESSIONS_KEY = `${SESSION_STORAGE_PREFIX}pinned-workbench-sessions`;
const UNREAD_SESSIONS_KEY = `${SESSION_STORAGE_PREFIX}unread-workbench-sessions`;

export const SESSION_PINS_CHANGED_EVENT = "musefold:session-pins-changed";
export const SESSION_UNREAD_CHANGED_EVENT = "musefold:session-unread-changed";

function readIds(key: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

function writeIds(
  key: string,
  eventName: string,
  sessionId: string,
  enabled: boolean,
): string[] {
  const current = readIds(key);
  const next = enabled
    ? [sessionId, ...current.filter((id) => id !== sessionId)]
    : current.filter((id) => id !== sessionId);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(key, JSON.stringify(next));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(eventName));
    }
  }
  return next;
}

export function readPinnedSessionIds(): string[] {
  return readIds(PINNED_SESSIONS_KEY);
}

export function setSessionPinned(sessionId: string, pinned: boolean): string[] {
  return writeIds(
    PINNED_SESSIONS_KEY,
    SESSION_PINS_CHANGED_EVENT,
    sessionId,
    pinned,
  );
}

export function readUnreadSessionIds(): string[] {
  return readIds(UNREAD_SESSIONS_KEY);
}

export function setSessionUnread(sessionId: string, unread: boolean): string[] {
  return writeIds(
    UNREAD_SESSIONS_KEY,
    SESSION_UNREAD_CHANGED_EVENT,
    sessionId,
    unread,
  );
}
