'use client';

import {
  type WorkbenchDraft,
  type WorkbenchSession,
  workbenchDraftSchema,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

const signature = (draft: WorkbenchDraft) => JSON.stringify(workbenchDraftSchema.parse(draft));
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '草稿保存失败，请重试';

/** The version belongs to the draft the editor actually loaded, not its latest query result. */
export function useSessionDraftWriter(activeId: string | null) {
  const gateway = useGateway();
  const client = useQueryClient();
  const bases = useRef(new Map<string, { version: number; signature: string }>());
  const blocked = useRef(new Map<string, Error>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const currentId = useRef(activeId);
  currentId.current = activeId;
  const reviewEpoch = useRef(0);
  const busyRef = useRef(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [review, setReview] = useState<WorkbenchSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    reviewEpoch.current++;
    setReview((previous) => (previous?.id === activeId ? previous : null));
    setReviewError(null);
  }, [activeId]);

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.workbench.all() });
  }, [client]);

  const clearFailure = useCallback((id: string) => {
    blocked.current.delete(id);
    setIssues((previous) => {
      if (!(id in previous)) return previous;
      const { [id]: _removed, ...rest } = previous;
      return rest;
    });
  }, []);

  const accept = useCallback(
    (session: WorkbenchSession) => {
      // Loading/reviewing creates a new editor identity. Queued work belongs to the old one.
      bases.current.set(session.id, {
        version: session.version,
        signature: signature(session.draft),
      });
      clearFailure(session.id);
    },
    [clearFailure],
  );

  const observe = useCallback((session: WorkbenchSession) => {
    const base = bases.current.get(session.id);
    const nextSignature = signature(session.draft);
    if (!base) {
      bases.current.set(session.id, { version: session.version, signature: nextSignature });
    } else if (session.version > base.version && nextSignature === base.signature) {
      base.version = session.version;
    }
  }, []);

  const fail = useCallback((id: string, error: unknown) => {
    const failure = error instanceof Error ? error : new Error(errorMessage(error));
    blocked.current.set(id, failure);
    setIssues((previous) => ({ ...previous, [id]: failure.message }));
    return failure;
  }, []);

  const prepareWrite = useCallback(
    (id: string, fallbackVersion: number, draft: WorkbenchDraft): (() => Promise<void>) => {
      const base = bases.current.get(id) ?? { version: fallbackVersion, signature: '' };
      bases.current.set(id, base);
      const run = async () => {
        // A Session switch/reload must not give old queued input a newly accepted version.
        if (bases.current.get(id) !== base) return;
        const previousFailure = blocked.current.get(id);
        if (previousFailure) throw previousFailure;
        try {
          const saved = await gateway.workbench.updateSession(id, {
            expectedVersion: base.version,
            draft,
          });
          if (bases.current.get(id) === base) {
            // Same-editor successors use this commit, without invalidating their identity.
            base.version = saved.version;
            base.signature = signature(saved.draft);
            clearFailure(id);
          }
          refresh();
        } catch (error) {
          // An ambiguous response is also a reason to stop queued writes until reviewed.
          refresh();
          if (bases.current.get(id) !== base) return;
          throw fail(id, error);
        }
      };
      return () => {
        const result = chain.current.catch(() => undefined).then(run);
        chain.current = result.catch(() => undefined);
        return result;
      };
    },
    [gateway, clearFailure, refresh, fail],
  );

  const write = useCallback(
    (id: string, fallbackVersion: number, draft: WorkbenchDraft) =>
      prepareWrite(id, fallbackVersion, draft)(),
    [prepareWrite],
  );

  const openReview = useCallback(async () => {
    const id = currentId.current;
    if (!id || busyRef.current) return;
    const epoch = ++reviewEpoch.current;
    busyRef.current = true;
    setBusy(true);
    setReviewError(null);
    try {
      await chain.current;
      const latest = await gateway.workbench.getSession(id);
      if (currentId.current !== id || epoch !== reviewEpoch.current) return;
      if (latest.deletedAt || latest.archivedAt) {
        throw new Error('该对话已删除或归档，请从对话列表重新选择');
      }
      setReview(latest);
    } catch (error) {
      if (currentId.current === id && epoch === reviewEpoch.current) {
        fail(id, error);
        setReviewError(errorMessage(error));
        refresh();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [gateway, fail, refresh]);

  const closeReview = useCallback(() => {
    if (busyRef.current) return;
    reviewEpoch.current++;
    setReview(null);
    setReviewError(null);
  }, []);

  const loadReviewed = useCallback(() => {
    if (!review || busyRef.current || review.id !== currentId.current) return null;
    accept(review);
    closeReview();
    return review;
  }, [review, accept, closeReview]);

  const saveReviewed = useCallback(
    async (draft: WorkbenchDraft) => {
      if (!review || busyRef.current || review.id !== currentId.current) return false;
      const selected = review;
      const selectedBase = bases.current.get(selected.id);
      busyRef.current = true;
      setBusy(true);
      setReviewError(null);
      try {
        // Exact reviewed version, including when another query has since refreshed.
        const saved = await gateway.workbench.updateSession(selected.id, {
          expectedVersion: selected.version,
          draft,
        });
        if (bases.current.get(selected.id) === selectedBase) {
          accept(saved);
          if (currentId.current === selected.id) setReview(null);
        }
        refresh();
        return true;
      } catch (error) {
        refresh();
        if (bases.current.get(selected.id) === selectedBase) {
          fail(selected.id, error);
          if (currentId.current === selected.id) setReviewError(errorMessage(error));
        }
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [review, gateway, accept, fail, refresh],
  );

  return {
    observe,
    accept,
    write,
    prepareWrite,
    issue: activeId ? issues[activeId] : undefined,
    review,
    busy,
    reviewError,
    openReview,
    closeReview,
    loadReviewed,
    saveReviewed,
  };
}
