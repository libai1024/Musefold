import type { ReactNode } from "react";

export interface WorkbenchPageFrameProps {
  timeline: ReactNode;
  composer: ReactNode;
  auxiliary?: ReactNode;
  className?: string;
  stageClassName?: string;
  testId?: string;
}

/** Shared page-level workbench shell; host capabilities remain explicit slots. */
export function WorkbenchPageFrame({
  timeline,
  composer,
  auxiliary,
  className = "",
  stageClassName = "",
  testId = "generation-workbench",
}: WorkbenchPageFrameProps) {
  return (
    <div
      className={["mf-workbench-page", className].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      <div
        className={["mf-workbench-stage", stageClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {timeline}
        {auxiliary}
      </div>
      {composer}
    </div>
  );
}
