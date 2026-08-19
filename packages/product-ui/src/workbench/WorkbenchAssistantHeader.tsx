import type { ReactNode } from "react";

export interface WorkbenchAssistantHeaderProps {
  label: ReactNode;
  detail?: ReactNode;
  className?: string;
}

/** Shared assistant identity row for every workbench result. */
export function WorkbenchAssistantHeader({
  label,
  detail,
  className,
}: WorkbenchAssistantHeaderProps) {
  return (
    <div
      className={["mf-workbench-assistant-header", className]
        .filter(Boolean)
        .join(" ")}
    >
      <strong>{label}</strong>
      {detail ? <span>· {detail}</span> : null}
    </div>
  );
}

