import type { CSSProperties, ReactNode } from "react";

export interface WorkbenchPageFrameProps {
  timeline: ReactNode;
  composer: ReactNode;
  auxiliary?: ReactNode;
  auxiliaryWidth?: number;
  className?: string;
  stageClassName?: string;
  testId?: string;
}

/** Shared page-level workbench shell; host capabilities remain explicit slots. */
export function WorkbenchPageFrame({
  timeline,
  composer,
  auxiliary,
  auxiliaryWidth,
  className = "",
  stageClassName = "",
  testId = "generation-workbench",
}: WorkbenchPageFrameProps) {
  const style =
    auxiliary && auxiliaryWidth
      ? ({
          "--mf-workbench-auxiliary-width": `${auxiliaryWidth}px`,
        } as CSSProperties)
      : undefined;

  return (
    <div
      className={["mf-workbench-page", className].filter(Boolean).join(" ")}
      data-auxiliary-open={auxiliary ? "true" : "false"}
      data-testid={testId}
      style={style}
    >
      <div className="mf-workbench-primary">
        <div
          className={["mf-workbench-stage", stageClassName]
            .filter(Boolean)
            .join(" ")}
        >
          {timeline}
        </div>
        {composer}
      </div>
      {auxiliary ? (
        <div className="mf-workbench-auxiliary">{auxiliary}</div>
      ) : null}
    </div>
  );
}
