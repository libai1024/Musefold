import { useCallback, useEffect, useRef, useState } from "react";

export type WorkbenchDraftSaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "conflict"
  | "error";

export interface WorkbenchDraftSession<Draft> {
  id: string;
  version: number;
  draft: Draft;
}

export interface WorkbenchDraftSyncControllerOptions<
  Session extends WorkbenchDraftSession<Draft>,
  Draft,
> {
  session: Session | null;
  draft: Draft;
  enabled?: boolean;
  debounceMs?: number;
  areDraftsEqual: (left: Draft, right: Draft) => boolean;
  saveDraft: (session: Session, draft: Draft) => Promise<Session>;
  loadLatest: (session: Session) => Promise<Session>;
  isConflictError: (error: unknown) => boolean;
  resolveConflict?: (
    error: unknown,
    session: Session,
  ) => Session | null | Promise<Session | null>;
  onCommit: (session: Session) => void;
  onError?: (error: unknown) => void;
}

export interface WorkbenchDraftSyncController<Session, Draft> {
  status: WorkbenchDraftSaveStatus;
  conflict: Session | null;
  enqueueDraftSave: (draft?: Draft, session?: Session) => Promise<Session | null>;
  flush: () => Promise<Session | null>;
  reset: () => void;
  useRemoteDraft: () => void;
  overwriteRemoteDraft: () => Promise<Session | null>;
  captureRevision: () => number;
  isRevisionCurrent: (revision: number) => boolean;
}

/**
 * Shared optimistic draft persistence for Desktop IPC and Web HTTP hosts.
 * The host owns session state; this controller owns debounce, serialization,
 * stale-write protection and the conflict decision boundary.
 */
export function useWorkbenchDraftSyncController<
  Session extends WorkbenchDraftSession<Draft>,
  Draft,
>(
  options: WorkbenchDraftSyncControllerOptions<Session, Draft>,
): WorkbenchDraftSyncController<Session, Draft> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sessionRef = useRef(options.session);
  const draftRef = useRef(options.draft);
  sessionRef.current = options.session;
  draftRef.current = options.draft;

  const timerRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const revisionRef = useRef(0);
  const [status, setStatus] = useState<WorkbenchDraftSaveStatus>("idle");
  const [conflict, setConflict] = useState<Session | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const save = useCallback(
    (draftOverride?: Draft, sessionOverride?: Session) => {
      const target = sessionOverride ?? sessionRef.current;
      const draft = draftOverride ?? draftRef.current;
      const targetRevision = revisionRef.current;
      if (!target) return Promise.resolve<Session | null>(null);

      const operation = queueRef.current.then(async () => {
        const current = sessionOverride ?? sessionRef.current;
        if (
          !current ||
          targetRevision !== revisionRef.current ||
          current.id !== target.id
        ) {
          return null;
        }
        const currentOptions = optionsRef.current;
        if (currentOptions.areDraftsEqual(current.draft, draft)) return current;

        setStatus("saving");
        try {
          const updated = await currentOptions.saveDraft(current, draft);
          if (
            targetRevision !== revisionRef.current ||
            sessionRef.current?.id !== current.id
          ) {
            return null;
          }
          currentOptions.onCommit(updated);
          setConflict(null);
          setStatus("saved");
          return updated;
        } catch (error) {
          if (
            targetRevision !== revisionRef.current ||
            sessionRef.current?.id !== current.id
          ) {
            return null;
          }
          if (currentOptions.isConflictError(error)) {
            const latest = currentOptions.resolveConflict
              ? await currentOptions.resolveConflict(error, current)
              : await currentOptions.loadLatest(current);
            if (
              latest &&
              targetRevision === revisionRef.current &&
              sessionRef.current?.id === current.id
            ) {
              revisionRef.current += 1;
              setConflict(latest);
              setStatus("conflict");
            }
          } else {
            setStatus("error");
            currentOptions.onError?.(error);
          }
          throw error;
        }
      });

      queueRef.current = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    [],
  );

  const reset = useCallback(() => {
    revisionRef.current += 1;
    clearTimer();
    setConflict(null);
    setStatus("idle");
  }, [clearTimer]);

  const flush = useCallback(() => {
    clearTimer();
    return save();
  }, [clearTimer, save]);

  const useRemoteDraft = useCallback(() => {
    const latest = conflict;
    if (!latest) return;
    revisionRef.current += 1;
    setConflict(null);
    optionsRef.current.onCommit(latest);
    setStatus("saved");
  }, [conflict]);

  const overwriteRemoteDraft = useCallback(async () => {
    const latest = conflict;
    if (!latest) return null;
    const localDraft = draftRef.current;
    revisionRef.current += 1;
    setConflict(null);
    optionsRef.current.onCommit(latest);
    return save(localDraft, latest);
  }, [conflict, save]);

  useEffect(() => {
    const currentOptions = optionsRef.current;
    const session = sessionRef.current;
    if (
      currentOptions.enabled === false ||
      !session ||
      conflict ||
      currentOptions.areDraftsEqual(session.draft, draftRef.current)
    ) {
      return;
    }

    setStatus((current) => (current === "saved" ? "idle" : current));
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void save().catch(() => undefined);
    }, currentOptions.debounceMs ?? 700);
    return clearTimer;
  }, [
    clearTimer,
    conflict,
    options.draft,
    options.enabled,
    options.session,
    save,
  ]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    status,
    conflict,
    enqueueDraftSave: save,
    flush,
    reset,
    useRemoteDraft,
    overwriteRemoteDraft,
    captureRevision: () => revisionRef.current,
    isRevisionCurrent: (revision) => revision === revisionRef.current,
  };
}
