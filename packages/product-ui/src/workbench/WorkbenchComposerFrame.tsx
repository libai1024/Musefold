import type { ReactNode } from "react";
import {
  WorkbenchComposerSurface,
  type WorkbenchComposerSurfaceProps,
} from "./WorkbenchComposerSurface";
import { WorkbenchComposerToolbar } from "./WorkbenchComposerToolbar";

export interface WorkbenchComposerFrameProps extends Omit<
  WorkbenchComposerSurfaceProps,
  "children" | "surfaceClassName"
> {
  children: ReactNode;
  leadingControls: ReactNode;
  trailingControls: ReactNode;
  footer?: ReactNode;
}

/**
 * Canonical Desktop/Web composer structure. Platform capabilities enter only
 * through content and control slots; surface geometry stays shared.
 */
export function WorkbenchComposerFrame({
  children,
  leadingControls,
  trailingControls,
  footer,
  className,
  ...surfaceProps
}: WorkbenchComposerFrameProps) {
  return (
    <WorkbenchComposerSurface
      {...surfaceProps}
      className={["composer-dock", className].filter(Boolean).join(" ")}
    >
      <div className="mf-workbench-composer-content">{children}</div>
      <WorkbenchComposerToolbar className="mf-workbench-composer-toolbar">
        <div className="mf-workbench-composer-leading">{leadingControls}</div>
        <div className="mf-workbench-composer-trailing">{trailingControls}</div>
      </WorkbenchComposerToolbar>
      {footer ? (
        <div className="mf-workbench-composer-footer">{footer}</div>
      ) : null}
    </WorkbenchComposerSurface>
  );
}
