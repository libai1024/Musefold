import type { HTMLAttributes, ReactNode, Ref } from "react";

export interface WorkbenchComposerSurfaceProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "ref"
> {
  children: ReactNode;
  attachments?: ReactNode;
  layout?: "floating" | "flow";
  className?: string;
  surfaceClassName?: string;
  rootRef?: Ref<HTMLDivElement>;
  surfaceRef?: Ref<HTMLDivElement>;
  rootTestId?: string;
  surfaceTestId?: string;
  surfaceProps?: Omit<
    HTMLAttributes<HTMLDivElement>,
    "children" | "className" | "ref"
  >;
}

/** Shared Composer shell. Hosts own input behavior and capability-specific slots. */
export function WorkbenchComposerSurface({
  children,
  attachments,
  layout = "floating",
  className,
  surfaceClassName,
  rootRef,
  surfaceRef,
  rootTestId = "workbench-composer",
  surfaceTestId = "workbench-composer-surface",
  surfaceProps,
  ...surfaceAttributes
}: WorkbenchComposerSurfaceProps) {
  return (
    <div
      ref={rootRef}
      className={["mf-workbench-composer", className].filter(Boolean).join(" ")}
      data-layout={layout}
      data-testid={rootTestId}
    >
      {attachments ? (
        <div className="mf-workbench-composer-attachments">
          {attachments}
        </div>
      ) : null}
      <div
        {...surfaceAttributes}
        {...surfaceProps}
        ref={surfaceRef}
        className={["mf-workbench-composer-surface", surfaceClassName]
          .filter(Boolean)
          .join(" ")}
        data-testid={surfaceTestId}
      >
        {children}
      </div>
    </div>
  );
}
