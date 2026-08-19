import { useEffect, useMemo } from "react";
import {
  activeWorkbenchGenerationSnapshots,
  isWorkbenchGenerationActive,
  type WorkbenchGenerationSnapshot,
  type WorkbenchGenerationStatus,
} from "./generationSnapshots";

export interface WorkbenchGenerationEventCursor {
  seq: number;
}

export interface WorkbenchGenerationSyncControllerOptions<
  Job extends WorkbenchGenerationSnapshot & { status: WorkbenchGenerationStatus },
> {
  jobs: readonly Job[];
  enabled?: boolean;
  getSnapshot: (id: string) => Promise<Job>;
  streamEvents: (
    id: string,
    afterSeq: number,
    onEvent: (event: WorkbenchGenerationEventCursor) => void | Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>;
  onSnapshot: (job: Job) => void;
  onAuthRequired?: (error: unknown) => void;
  onError?: (error: unknown) => void;
}

/**
 * Shared background generation recovery for Desktop/Web hosts.
 * The host supplies transport and owns the rendered snapshot collection.
 */
export function useWorkbenchGenerationSyncController<
  Job extends WorkbenchGenerationSnapshot & { status: WorkbenchGenerationStatus },
>({
  jobs,
  enabled = true,
  getSnapshot,
  streamEvents,
  onSnapshot,
  onAuthRequired,
  onError,
}: WorkbenchGenerationSyncControllerOptions<Job>): void {
  const activeJobIds = useMemo(
    () =>
      activeWorkbenchGenerationSnapshots(jobs)
        .map((job) => job.id)
        .sort()
        .join("\u0000"),
    [jobs],
  );

  useEffect(() => {
    if (!enabled || !activeJobIds) return;
    const controller = new AbortController();
    let stopped = false;
    const retryTimers = new Set<number>();

    const reportError = (error: unknown) => {
      if (stopped) return;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["AUTH_REQUIRED", "AUTH_SESSION_EXPIRED"].includes(
          String((error as { code?: unknown }).code),
        )
      ) {
        onAuthRequired?.(error);
        return;
      }
      onError?.(error);
    };

    for (const jobId of activeJobIds.split("\u0000")) {
      let lastEventId = 0;
      let retryDelay = 500;

      const syncSnapshot = async (): Promise<Job | null> => {
        try {
          const next = await getSnapshot(jobId);
          if (stopped || controller.signal.aborted) return null;
          onSnapshot(next);
          return next;
        } catch (error) {
          reportError(error);
          return null;
        }
      };

      const scheduleReconnect = (connect: () => void) => {
        if (stopped || controller.signal.aborted) return;
        const timer = window.setTimeout(() => {
          retryTimers.delete(timer);
          connect();
        }, retryDelay);
        retryTimers.add(timer);
        retryDelay = Math.min(8_000, retryDelay * 2);
      };

      const connect = async (): Promise<void> => {
        if (stopped || controller.signal.aborted) return;
        try {
          await streamEvents(
            jobId,
            lastEventId,
            async (event) => {
              lastEventId = Math.max(lastEventId, event.seq);
              const next = await syncSnapshot();
              if (next && !isWorkbenchGenerationActive(next.status)) return;
              retryDelay = 500;
            },
            controller.signal,
          );
          if (stopped || controller.signal.aborted) return;
          const next = await syncSnapshot();
          if (next && !isWorkbenchGenerationActive(next.status)) return;
          retryDelay = 500;
          scheduleReconnect(() => void connect());
        } catch (error) {
          if (stopped || controller.signal.aborted) return;
          reportError(error);
          const next = await syncSnapshot();
          if (next && !isWorkbenchGenerationActive(next.status)) return;
          scheduleReconnect(() => void connect());
        }
      };

      void connect();
    }

    return () => {
      stopped = true;
      controller.abort();
      for (const timer of retryTimers) window.clearTimeout(timer);
      retryTimers.clear();
    };
  }, [activeJobIds, enabled, getSnapshot, onAuthRequired, onError, onSnapshot, streamEvents]);
}
