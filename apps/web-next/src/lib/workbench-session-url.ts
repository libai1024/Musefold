import type { WorkbenchSession } from '@musefold/contracts';
import { entityIdSchema } from '@musefold/contracts';

export const WORKBENCH_SESSION_QUERY = 'session';

export interface WorkbenchSessionUrlTarget {
  hasParameter: boolean;
  sessionId: string | null;
}

export type WorkbenchSessionUrlWriteMode = 'push' | 'replace';

export type WorkbenchSessionResolution =
  | { kind: 'session'; sessionId: string }
  | { kind: 'fallback'; sessionId: string | null };

/** Parse the untrusted query value before checking it against the authorized session list. */
export function readWorkbenchSessionUrl(
  search: string | URLSearchParams,
): WorkbenchSessionUrlTarget {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = params.get(WORKBENCH_SESSION_QUERY);
  if (raw === null) return { hasParameter: false, sessionId: null };

  const parsed = entityIdSchema.safeParse(raw);
  return {
    hasParameter: true,
    sessionId: parsed.success ? parsed.data : null,
  };
}

/** Only sessions from the current user's loaded list are valid URL targets. */
export function isAuthorizedWorkbenchSession(
  sessionId: string | null,
  sessions: readonly Pick<WorkbenchSession, 'id'>[],
): sessionId is string {
  return sessionId !== null && sessions.some((session) => session.id === sessionId);
}

/** Resolve URL input against the authorized list. Draft state is handled by the page adapter. */
export function resolveWorkbenchSession(
  target: WorkbenchSessionUrlTarget,
  sessions: readonly Pick<WorkbenchSession, 'id'>[],
): WorkbenchSessionResolution {
  if (target.hasParameter && isAuthorizedWorkbenchSession(target.sessionId, sessions)) {
    return { kind: 'session', sessionId: target.sessionId };
  }
  return { kind: 'fallback', sessionId: sessions[0]?.id ?? null };
}

/** Build a Workbench URL while retaining every unrelated query parameter and the hash. */
export function createWorkbenchHref(sessionId: string | null, sourceUrl?: string): string {
  const base =
    sourceUrl ?? (typeof window === 'undefined' ? 'http://musefold.local/' : window.location.href);
  const url = new URL(base, 'http://musefold.local');
  url.pathname = '/workbench';
  if (sessionId?.trim()) url.searchParams.set(WORKBENCH_SESSION_QUERY, sessionId.trim());
  else url.searchParams.delete(WORKBENCH_SESSION_QUERY);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Update only the active session pointer without a document navigation. */
export function writeWorkbenchSessionUrl(
  sessionId: string | null,
  mode: WorkbenchSessionUrlWriteMode = 'replace',
): void {
  if (typeof window === 'undefined' || window.location.pathname !== '/workbench') return;
  const nextUrl = createWorkbenchHref(sessionId, window.location.href);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  if (mode === 'push') window.history.pushState(window.history.state, '', nextUrl);
  else window.history.replaceState(window.history.state, '', nextUrl);
}
