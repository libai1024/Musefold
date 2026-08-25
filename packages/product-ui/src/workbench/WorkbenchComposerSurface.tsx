import type { HTMLAttributes, ReactNode, Ref } from "react";

export interface WorkbenchComposerSurfaceProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className" | "ref"
> {
  children: ReactNode;
  attachments?: ReactNode;
  layout?: "floating" | "flow";
  /** v2.0(11 §5):empty = 新对话首屏 20px 品牌焦点外框;active = 已有任务 12px 密集工作态。 */
  variant?: "empty" | "active";
  /** 生成运行中:外框使用 Ember 低透明边界提示状态,几何不变(02 §7)。 */
  running?: boolean;
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
  variant = "active",
  running = false,
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
      data-variant={variant}
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
        data-running={running || undefined}
        data-testid={surfaceTestId}
      >
        {children}
      </div>
    </div>
  );
}
