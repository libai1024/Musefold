'use client';

import type { WorkbenchSession, WorkbenchSessionPage } from '@musefold/contracts';
import { useActiveSession, useSessionList } from '@musefold/features/workbench';
import { queryKeys, usePlatform } from '@musefold/platform';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  createWorkbenchHref,
  readWorkbenchSessionUrl,
  type WorkbenchSessionUrlTarget,
  writeWorkbenchSessionUrl,
} from '../../lib/workbench-session-url';

interface WorkbenchSessionUrlSyncProps {
  children: ReactNode;
}

/** Keep a directly addressed session visible to the shared list query. */
function mergeSessionIntoList(
  page: WorkbenchSessionPage | undefined,
  session: WorkbenchSession,
): WorkbenchSessionPage | undefined {
  if (!page || page.items.some((item) => item.id === session.id)) return page;
  return { ...page, items: [...page.items, session] };
}

/** Web-only page adapter for the shared Workbench active-session pointer. */
export function WorkbenchSessionUrlSync({ children }: WorkbenchSessionUrlSyncProps) {
  const { gateway } = usePlatform();
  const queryClient = useQueryClient();
  const activeSessionId = useActiveSession((state) => state.activeSessionId);
  const draftSession = useActiveSession((state) => state.draftSession);
  const setActiveSessionId = useActiveSession((state) => state.setActiveSessionId);
  const startDraftSession = useActiveSession((state) => state.startDraftSession);
  const sessions = useSessionList({ limit: 50 });
  const sessionItems = sessions.data?.items ?? [];
  const [urlTarget, setUrlTarget] = useState<WorkbenchSessionUrlTarget | null>(null);
  const [ready, setReady] = useState(false);
  const popNavigation = useRef(false);
  const appliedTarget = useRef<string | null>(null);
  const suppressNextStoreSync = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  const draftSessionRef = useRef(draftSession);

  activeSessionIdRef.current = activeSessionId;
  draftSessionRef.current = draftSession;

  const requestedSessionId = urlTarget?.hasParameter ? urlTarget.sessionId : null;
  const requestedSession = useQuery({
    queryKey: queryKeys.workbench.session(requestedSessionId ?? ''),
    queryFn: () => gateway.workbench.getSession(requestedSessionId as string),
    enabled: requestedSessionId !== null,
    retry: false,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    function readLocation(): void {
      appliedTarget.current = null;
      setReady(false);
      setUrlTarget(readWorkbenchSessionUrl(window.location.search));
    }

    readLocation();

    function handlePopState(): void {
      popNavigation.current = true;
      readLocation();
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!urlTarget || !sessions.isSuccess) return;
    if (
      requestedSessionId !== null &&
      (requestedSession.isPending || requestedSession.isFetching)
    ) {
      return;
    }

    const targetKey = `${urlTarget.hasParameter ? 'param' : 'none'}:${urlTarget.sessionId ?? ''}`;
    if (appliedTarget.current === targetKey) return;
    const isPopNavigation = popNavigation.current;
    popNavigation.current = false;

    if (requestedSessionId !== null) {
      if (requestedSession.isSuccess && requestedSession.data) {
        const authorizedSession = requestedSession.data;
        queryClient.setQueryData<WorkbenchSessionPage | undefined>(
          queryKeys.workbench.sessions({ limit: 50 }),
          (current) => mergeSessionIntoList(current, authorizedSession),
        );
        appliedTarget.current = targetKey;
        suppressNextStoreSync.current =
          activeSessionIdRef.current !== authorizedSession.id || draftSessionRef.current;
        if (suppressNextStoreSync.current) setActiveSessionId(authorizedSession.id);
        setReady(true);
        return;
      }

      if (!requestedSession.isError) return;
      const fallbackId = sessionItems[0]?.id ?? null;
      writeWorkbenchSessionUrl(fallbackId, 'replace');
      appliedTarget.current = targetKey;
      suppressNextStoreSync.current =
        activeSessionIdRef.current !== fallbackId ||
        (fallbackId === null && !draftSessionRef.current);
      if (fallbackId === null) {
        if (suppressNextStoreSync.current) startDraftSession();
      } else if (suppressNextStoreSync.current) {
        setActiveSessionId(fallbackId);
      }
      setReady(true);
      return;
    }

    // A malformed session value is invalid after the list has loaded. A missing
    // value is a draft only for a draft navigation; initial /workbench retains
    // the existing newest-session fallback used by WorkbenchScreen.
    if (urlTarget.hasParameter) {
      const fallbackId = sessionItems[0]?.id ?? null;
      writeWorkbenchSessionUrl(fallbackId, 'replace');
      appliedTarget.current = targetKey;
      suppressNextStoreSync.current =
        activeSessionIdRef.current !== fallbackId ||
        (fallbackId === null && !draftSessionRef.current);
      if (fallbackId === null) {
        if (suppressNextStoreSync.current) startDraftSession();
      } else if (suppressNextStoreSync.current) {
        setActiveSessionId(fallbackId);
      }
      setReady(true);
      return;
    }

    appliedTarget.current = targetKey;
    if (isPopNavigation || draftSessionRef.current) {
      if (isPopNavigation && !draftSessionRef.current) {
        suppressNextStoreSync.current = true;
        startDraftSession();
      }
      setReady(true);
      return;
    }

    const fallbackId =
      (activeSessionIdRef.current &&
      sessionItems.some((item) => item.id === activeSessionIdRef.current)
        ? activeSessionIdRef.current
        : sessionItems[0]?.id) ?? null;
    suppressNextStoreSync.current = true;
    if (fallbackId === null) {
      startDraftSession();
    } else {
      setActiveSessionId(fallbackId);
      writeWorkbenchSessionUrl(fallbackId, 'replace');
    }
    setReady(true);
  }, [
    queryClient,
    requestedSession.data,
    requestedSession.isError,
    requestedSession.isFetching,
    requestedSession.isPending,
    requestedSession.isSuccess,
    requestedSessionId,
    sessionItems,
    sessions.isSuccess,
    setActiveSessionId,
    startDraftSession,
    urlTarget,
  ]);

  // Store changes from sidebar/mobile selection or first-send creation become
  // browser history entries. URL-driven changes consume the suppression flag.
  useEffect(() => {
    if (!ready || !urlTarget) return;

    if (suppressNextStoreSync.current) {
      suppressNextStoreSync.current = false;
      return;
    }

    const nextSessionId = draftSession ? null : activeSessionId;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const targetUrl = createWorkbenchHref(nextSessionId, window.location.href);
    if (currentUrl === targetUrl) return;

    writeWorkbenchSessionUrl(nextSessionId, 'push');
  }, [activeSessionId, draftSession, ready, urlTarget]);

  return ready || sessions.isError ? children : null;
}
