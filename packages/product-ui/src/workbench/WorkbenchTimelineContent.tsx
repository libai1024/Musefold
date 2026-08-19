import type { ReactNode } from "react";

export interface WorkbenchTimelineContentProps {
  itemCount: number;
  children: ReactNode;
  empty?: ReactNode;
  bottomInset?: "composer" | "attachments";
  className?: string;
}

/** Shared inner timeline geometry. Hosts only provide turns, empty state and capability content. */
export function WorkbenchTimelineContent({
  itemCount,
  children,
  empty,
  bottomInset = "composer",
  className,
}: WorkbenchTimelineContentProps) {
  return (
    <div
      className={["mf-workbench-timeline-content", className]
        .filter(Boolean)
        .join(" ")}
      data-bottom-inset={bottomInset}
    >
      <div className="mf-workbench-turn-list">
        {itemCount === 0 && empty ? empty : children}
      </div>
    </div>
  );
}

