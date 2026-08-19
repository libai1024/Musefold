import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from "react";

export interface UseWorkbenchTimelineControllerOptions {
  /** Changes when a new turn or a visible generation state is available. */
  followKey: string;
  itemCount: number;
  initialNearLatest?: boolean;
}

export interface WorkbenchTimelineController {
  viewportRef: RefObject<HTMLDivElement>;
  nearLatest: boolean;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollToLatest: (behavior?: ScrollBehavior) => void;
}

export function isWorkbenchTimelineNearLatest({
  scrollHeight,
  scrollTop,
  clientHeight,
  threshold = 96,
}: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  threshold?: number;
}): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * Shared scroll behavior for the Desktop and Web workbench timelines.
 * The caller owns the rendered turns; this controller only owns viewport state.
 */
export function useWorkbenchTimelineController({
  followKey,
  itemCount,
  initialNearLatest = true,
}: UseWorkbenchTimelineControllerOptions): WorkbenchTimelineController {
  const viewportRef = useRef<HTMLDivElement>(null);
  const nearLatestRef = useRef(initialNearLatest);
  const [nearLatest, setNearLatest] = useState(initialNearLatest);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nextNearLatest = isWorkbenchTimelineNearLatest({
      scrollHeight: target.scrollHeight,
      scrollTop: target.scrollTop,
      clientHeight: target.clientHeight,
    });
    nearLatestRef.current = nextNearLatest;
    setNearLatest(nextNearLatest);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = viewportRef.current;
    element?.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    if (itemCount === 0) {
      element.scrollTo({ top: 0 });
      return;
    }
    if (!nearLatest) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [followKey, itemCount, nearLatest]);

  useEffect(() => {
    const element = viewportRef.current;
    const content = element?.firstElementChild;
    if (!element || !content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (nearLatestRef.current) {
        element.scrollTo({ top: element.scrollHeight });
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [itemCount]);

  return { viewportRef, nearLatest, onScroll, scrollToLatest };
}
