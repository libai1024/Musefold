import type { PointerEventHandler, ReactNode } from "react";
import { WorkbenchTimelineContent } from "./WorkbenchTimelineContent";
import { WorkbenchTimelineViewport } from "./WorkbenchTimelineViewport";
import type { WorkbenchTimelineController } from "./useWorkbenchTimelineController";

export interface WorkbenchTimelineStageProps {
  controller: WorkbenchTimelineController;
  itemCount: number;
  children?: ReactNode;
  empty?: ReactNode;
  bottomInset?: "composer" | "attachments";
  className?: string;
  testId?: string;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  trailing?: ReactNode;
}

/** Shared timeline viewport + content. Hosts bind empty copy, turns, and trailing chrome. */
export function WorkbenchTimelineStage({
  controller,
  itemCount,
  children,
  empty,
  bottomInset,
  className,
  testId,
  onPointerDown,
  trailing,
}: WorkbenchTimelineStageProps) {
  return (
    <WorkbenchTimelineViewport
      controller={controller}
      className={className}
      testId={testId}
      onPointerDown={onPointerDown}
    >
      <WorkbenchTimelineContent
        itemCount={itemCount}
        bottomInset={bottomInset}
        empty={empty}
      >
        {children}
      </WorkbenchTimelineContent>
      {trailing}
    </WorkbenchTimelineViewport>
  );
}
