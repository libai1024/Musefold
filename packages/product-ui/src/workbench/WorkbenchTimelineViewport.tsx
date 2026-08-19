import type { PointerEventHandler, ReactNode } from "react";
import type { WorkbenchTimelineController } from "./useWorkbenchTimelineController";

export interface WorkbenchTimelineViewportProps {
  controller: WorkbenchTimelineController;
  children: ReactNode;
  className?: string;
  testId?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
}

/** Shared scroll viewport boundary for Desktop and Web workbench timelines. */
export function WorkbenchTimelineViewport({
  controller,
  children,
  className,
  testId = "generation-timeline",
  onPointerDown,
}: WorkbenchTimelineViewportProps) {
  return (
    <div
      ref={controller.viewportRef}
      onPointerDown={onPointerDown}
      onScroll={controller.onScroll}
      className={["mf-workbench-scroll", className]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
