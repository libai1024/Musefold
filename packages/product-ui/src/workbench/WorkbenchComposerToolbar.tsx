import type { ReactNode } from "react";

export interface WorkbenchComposerToolbarProps {
  children: ReactNode;
  className?: string;
}

/** Shared layout boundary for the prompt composer controls.
 * Hosts own the actions inside it because Desktop and Web expose different capabilities.
 */
export function WorkbenchComposerToolbar({
  children,
  className,
}: WorkbenchComposerToolbarProps) {
  return (
    <div
      className={["mf-workbench-toolbar", className].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
