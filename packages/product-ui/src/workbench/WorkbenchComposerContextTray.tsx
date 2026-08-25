import type { ReactNode } from "react";

export interface WorkbenchComposerContextTrayProps {
  children: ReactNode;
  label?: string;
}

/** A compact, horizontally scannable home for prompt context and references. */
export function WorkbenchComposerContextTray({
  children,
  label = "上下文",
}: WorkbenchComposerContextTrayProps) {
  return (
    <div
      className="mf-workbench-context-tray"
      data-testid="workbench-context-tray"
    >
      <span className="mf-workbench-context-tray-label">{label}</span>
      <div className="mf-workbench-context-tray-items">{children}</div>
    </div>
  );
}
